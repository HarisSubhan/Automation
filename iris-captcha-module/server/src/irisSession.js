'use strict';

/**
 * Playwright automation against the FBR IRIS portal.
 *
 * The login flow is intentionally interactive: IRIS shows a CAPTCHA that a
 * human must read. This module
 *   1. launches a browser and opens the IRIS login page,
 *   2. scans the page for login inputs and the CAPTCHA image (see scan.js),
 *   3. emits the CAPTCHA as a base64 PNG via the session manager, and
 *   4. waits for the human-supplied text before submitting credentials.
 */

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const store = require('./store');
const { STATUS } = require('./sessionManager');
const { scanLoginPage, findCaptchaImage, describeLoginForm } = require('./scan');

async function newBrowserContext({ chromium }) {
  const browser = await chromium.launch({
    headless: config.iris.headless,
    slowMo: config.iris.slowMo,
  });
  const context = await browser.newContext({
    userAgent: config.iris.userAgent,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  return { browser, context };
}

async function openLoginPage(page) {
  const url = new URL(config.iris.loginPath, config.iris.baseUrl).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.iris.navigationTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  return url;
}

function guessSelectors(described) {
  const inputs = described.inputs || {};
  const username = inputs.user?.selector || 'input[type="text"], input[name*="user" i], input[name*="login" i]';
  const password = inputs.password?.selector || 'input[type="password"]';
  const submit = inputs.submit?.selector || 'input[type="submit"], button[type="submit"], button:has-text("Login")';
  const captcha = inputs.captcha?.selector || 'input[name*="captcha" i], input[id*="captcha" i]';
  return { username, password, submit, captcha };
}

async function captureCaptcha(page, described) {
  const found = await findCaptchaImage(page);
  if (!found) {
    const err = new Error('CAPTCHA image not found on the IRIS login page.');
    err.code = 'CAPTCHA_NOT_FOUND';
    throw err;
  }
  const base64 = (await found.element.screenshot({ type: 'png' })).toString('base64');
  return { base64, selector: found.selector, mimeType: 'image/png' };
}

/**
 * Runs the full interactive login for one session.
 */
async function runIrisLogin({ chromium, manager, sessionId, username, password, waitForCaptchaText }) {
  const { browser, context } = await newBrowserContext({ chromium });
  let settled = false;

  const finish = (status, error = null) => {
    if (settled) return;
    settled = true;
    manager.releaseRunner(sessionId);
    manager.setStatus(sessionId, status, { error }).catch(() => {});
  };

  manager.attachRunner(sessionId, () => {
    finish(STATUS.CANCELLED, 'cancelled by server shutdown or TTL sweep');
    browser.close().catch(() => {});
  });

  const page = await context.newPage();

  try {
    await manager.setStatus(sessionId, STATUS.LAUNCHING);
    const url = await openLoginPage(page);
    await store.logEvent(sessionId, 'info', 'login page opened', { url });

    const described = await describeLoginForm(page);
    const selectors = guessSelectors(described);
    await manager.update(sessionId, { scan: described.summary });
    await store.logEvent(sessionId, 'info', 'login form scanned', described.summary);

    const captcha = await captureCaptcha(page, described);
    await manager.setStatus(sessionId, STATUS.CAPTCHA_WAIT, { captcha });

    const captchaText = (await waitForCaptchaText()).trim();
    await manager.update(sessionId, { captchaText });
    await store.logEvent(sessionId, 'info', 'captcha submitted by human');

    await manager.setStatus(sessionId, STATUS.LOGGING_IN);
    await page.fill(selectors.username, username);
    await page.fill(selectors.password, password || '');
    await page.fill(selectors.captcha, captchaText);
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: config.iris.loginResultTimeoutMs }).catch(() => {}),
      page.click(selectors.submit),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const result = await scanLoginPage(page, { afterSubmit: true });
    const loginConfirmed = result.summary.navigation?.containsLogout ||
      (!result.summary.navigation?.hasLoginForm && result.summary.detectedErrors.length === 0);
    await store.logEvent(sessionId, loginConfirmed ? 'info' : 'warn', 'post-submit scan', result.summary);

    if (loginConfirmed) {
      const shotPath = path.join(config.storage.dir, `${sessionId}.png`);
      await fs.mkdir(path.dirname(shotPath), { recursive: true });
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      finish(STATUS.LOGGED_IN, null);
      return { status: STATUS.LOGGED_IN, error: null, screenshot: shotPath, summary: result.summary };
    }

    const reason = result.summary.detectedErrors[0] || 'Login could not be confirmed on the IRIS portal.';
    finish(STATUS.FAILED, reason);
    return { status: STATUS.FAILED, error: reason, summary: result.summary };
  } catch (err) {
    const shotPath = path.join(config.storage.dir, `${sessionId}-error.png`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    await store.logEvent(sessionId, 'error', err.message, { stack: err.stack });
    finish(STATUS.FAILED, err.message);
    return { status: STATUS.FAILED, error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  newBrowserContext,
  openLoginPage,
  captureCaptcha,
  runIrisLogin,
};
