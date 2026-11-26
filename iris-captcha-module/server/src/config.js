'use strict';

require('dotenv').config();

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: int(process.env.PORT, 4000),
    corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  iris: {
    baseUrl: process.env.IRIS_BASE_URL || 'https://iris.fbr.gov.pk',
    loginPath: process.env.IRIS_LOGIN_PATH || '/public/login',
    captchaSelector: process.env.IRIS_CAPTCHA_SELECTOR || 'img[id*="captcha"], img[src*="captcha"]',
    headless: process.env.IRIS_HEADLESS !== 'false',
    slowMo: int(process.env.IRIS_SLOW_MO, 0),
    navigationTimeoutMs: int(process.env.IRIS_NAV_TIMEOUT_MS, 60000),
    captchaWaitTimeoutMs: int(process.env.IRIS_CAPTCHA_TIMEOUT_MS, 45000),
    loginResultTimeoutMs: int(process.env.IRIS_LOGIN_RESULT_TIMEOUT_MS, 30000),
    userAgent:
      process.env.IRIS_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  },

  session: {
    ttlMs: int(process.env.SESSION_TTL_MS, 15 * 60 * 1000),
    maxConcurrency: int(process.env.SESSION_MAX_CONCURRENCY, 5),
  },

  crypto: {
    keyHex: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
  },

  db: {
    enabled: process.env.DB_ENABLED === 'true',
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'iris',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iris_captcha',
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
  },

  storage: {
    dir: process.env.STORAGE_DIR || './storage/screenshots',
  },
};

if (!config.crypto.keyHex) {
  if (config.env === 'production') {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production (64 hex chars = 32 bytes).');
  }
  config.crypto.keyHex = '5f4dcc3b5aa765d61d8327deb882cf99a1b2c3d4e5f60718293a4b5c6d7e8f90';
}

module.exports = config;
