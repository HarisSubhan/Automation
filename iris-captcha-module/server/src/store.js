'use strict';

/**
 * Storage layer for IRIS sessions.
 *
 * Uses MySQL (mysql2/promise) when db.enabled is true; otherwise falls back to
 * an in-memory map so the module can run and be tested without a database.
 * The MySQL schema lives in ../schema.sql.
 */

const config = require('./config');

let pool = null;

if (config.db.enabled) {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    namedPlaceholders: true,
  });
}

const memory = {
  sessions: new Map(),
  events: [],
};

function isDbEnabled() {
  return Boolean(pool);
}

async function pingDb() {
  if (!pool) return { enabled: false, ok: false };
  try {
    await pool.query('SELECT 1');
    return { enabled: true, ok: true };
  } catch (err) {
    return { enabled: true, ok: false, error: err.message };
  }
}

function toRow(session) {
  return {
    id: session.id,
    status: session.status,
    username: session.username,
    password_enc: session.passwordEnc || null,
    captcha_text: session.captchaText || null,
    error: session.error || null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    expires_at: session.expiresAt,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    status: row.status,
    username: row.username,
    passwordEnc: row.password_enc || null,
    captchaText: row.captcha_text || null,
    error: row.error || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
  };
}

async function saveSession(session) {
  if (!pool) {
    memory.sessions.set(session.id, { ...session });
    return session;
  }
  const row = toRow(session);
  await pool.execute(
    `INSERT INTO iris_sessions
       (id, status, username, password_enc, captcha_text, error, created_at, updated_at, expires_at)
     VALUES (:id, :status, :username, :password_enc, :captcha_text, :error, :created_at, :updated_at, :expires_at)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       username = VALUES(username),
       password_enc = VALUES(password_enc),
       captcha_text = VALUES(captcha_text),
       error = VALUES(error),
       updated_at = VALUES(updated_at),
       expires_at = VALUES(expires_at)`,
    row,
  );
  return session;
}

async function getSession(id) {
  if (!pool) {
    const hit = memory.sessions.get(id);
    return hit ? { ...hit } : null;
  }
  const [rows] = await pool.execute('SELECT * FROM iris_sessions WHERE id = :id LIMIT 1', { id });
  return rows.length ? fromRow(rows[0]) : null;
}

async function listSessions({ limit = 50 } = {}) {
  if (!pool) {
    return Array.from(memory.sessions.values()).slice(-limit).reverse();
  }
  const [rows] = await pool.execute(
    'SELECT * FROM iris_sessions ORDER BY created_at DESC LIMIT :limit',
    { limit: Number(limit) },
  );
  return rows.map(fromRow);
}

async function deleteSession(id) {
  if (!pool) {
    return memory.sessions.delete(id);
  }
  const [result] = await pool.execute('DELETE FROM iris_sessions WHERE id = :id', { id });
  return result.affectedRows > 0;
}

async function deleteExpiredSessions() {
  if (!pool) {
    const now = Date.now();
    let removed = 0;
    for (const [id, session] of memory.sessions) {
      if (new Date(session.expiresAt).getTime() < now) {
        memory.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
  const [result] = await pool.execute('DELETE FROM iris_sessions WHERE expires_at < NOW()');
  return result.affectedRows;
}

async function logEvent(sessionId, level, message, meta = null) {
  const at = new Date().toISOString();
  if (!pool) {
    memory.events.push({ sessionId, level, message, meta, at });
    if (memory.events.length > 1000) memory.events.splice(0, memory.events.length - 1000);
    return;
  }
  await pool.execute(
    'INSERT INTO iris_events (session_id, level, message, meta, created_at) VALUES (:sessionId, :level, :message, :meta, :at)',
    { sessionId, level, message, meta: meta ? JSON.stringify(meta) : null, at },
  );
}

async function listEvents(sessionId, { limit = 100 } = {}) {
  if (!pool) {
    return memory.events.filter((e) => e.sessionId === sessionId).slice(-limit);
  }
  const [rows] = await pool.execute(
    'SELECT * FROM iris_events WHERE session_id = :sessionId ORDER BY created_at ASC LIMIT :limit',
    { sessionId, limit: Number(limit) },
  );
  return rows;
}

module.exports = {
  isDbEnabled,
  pingDb,
  saveSession,
  getSession,
  listSessions,
  deleteSession,
  deleteExpiredSessions,
  logEvent,
  listEvents,
};
