'use strict';

/**
 * Page scanner for the IRIS login flow.
 *
 * Instead of hard-coding brittle selectors, this module inspects the current
 * page and describes what it sees: candidate inputs, the CAPTCHA image,
 * submit controls, error banners, and whether the page looks logged-in
 * (e.g. contains logout links / the IRIS dashboard).
 */

async function describeInputs(page) {
  return page.evaluate(() => {
    const describe = (el) => ({
      selector: (() => {
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        if (el.id) return `#${el.id}`;
        if (el.getAttribute('name')) return `${tag}[name="${el.getAttribute('name')}"]`;
        if (el.type) return `${tag}[type="${el.type}"]`;
        return tag;
      })(),
      id: el.id || null,
      name: el.getAttribute('name'),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      visible: Boolean(el.offsetParent || el.getClientRects().length),
    });

    const fields = Array.from(document.querySelectorAll('input'))
      .filter((el) => el.type !== 'hidden')
      .map(describe);

    const byType = (type) => fields.find((f) => f.type === type && f.visible) || null;
    const byName = (re) => fields.find((f) => (f.name || '').toLowerCase().match(re)) || fields.find((f) => (f.id || '').toLowerCase().match(re)) || null;

    const inputs = {
      fields,
      user: byType('email') || byName(/user|login|cnic|reg|email/),
      password: byType('password'),
      captcha: byName(/captcha|verification|code/),
      submit: null,
    };

    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
    const submitEl = candidates.find((el) => /login|sign in|log in|submit/i.test(el.textContent || el.value || '')) || candidates[0];
    inputs.submit = describe(submitEl);

    return inputs;
  });
}

async function describeCaptcha(page, selector) {
  const el = page.locator(selector).first();
  const count = await el.count().catch(() => 0);
  if (!count) return { present: false, selector: null };
  const visible = await el.isVisible().catch(() => false);
  const box = visible ? await el.boundingBox().catch(() => null) : null;
  return { present: true, selector, visible, box };
}

async function detectErrors(page) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const patterns = [
    /invalid (?:captcha|code)/i,
    /incorrect (?:captcha|password)/i,
    /captcha (?:is )?(?:required|does not match)/i,
    /invalid (?:credentials|username|password)/i,
    /account (?:is )?locked/i,
  ];
  const found = [];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) found.push(match[0]);
  }
  return Array.from(new Set(found));
}

async function detectLoggedIn(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    const markers = ['logout', 'sign out', 'dashboard', 'welcome'];
    const containsLogout = markers.some((m) => html.includes(m));
    const hasLoginForm = Boolean(document.querySelector('input[type="password"]'));
    return { containsLogout, hasLoginForm };
  });
}

/**
 * Scan either the initial login page or the post-submit result page.
 */
async function scanLoginPage(page, options = {}) {
  const inputs = await describeInputs(page);
  const captchaSelector = options.captchaSelector || 'img[id*="captcha" i], img[src*="captcha" i]';
  const captcha = await describeCaptcha(page, captchaSelector);

  let detectedErrors = [];
  let navigation = { containsLogout: false, hasLoginForm: true };
  if (options.afterSubmit) {
    detectedErrors = await detectErrors(page);
    navigation = await detectLoggedIn(page);
  }

  return {
    url: page.url(),
    inputs,
    captcha,
    detectedErrors,
    summary: {
      url: page.url(),
      captcha,
      inputCount: inputs.fields.length,
      user: inputs.user,
      password: inputs.password,
      captchaInput: inputs.captcha,
      submit: inputs.submit,
      detectedErrors,
      navigation,
    },
  };
}

async function findCaptchaImage(page) {
  const selectors = [
    'img[id*="captcha" i]',
    'img[src*="captcha" i]',
    'img[name*="captcha" i]',
    'img[alt*="captcha" i]',
    'img[alt*="code" i]',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count && (await locator.isVisible().catch(() => false))) {
      return { selector, element: locator };
    }
  }
  return null;
}

module.exports = {
  scanLoginPage,
  findCaptchaImage,
  describeLoginForm: scanLoginPage,
};
