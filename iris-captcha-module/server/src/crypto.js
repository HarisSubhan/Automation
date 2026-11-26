'use strict';

const crypto = require('crypto');
const config = require('./config');

const ALGO = 'aes-256-gcm';

function getKey() {
  const key = Buffer.from(config.crypto.keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  }
  return key;
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognised ciphertext format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 2) return '**';
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(s.length - 2, 2))}`;
}

module.exports = { encrypt, decrypt, mask };
