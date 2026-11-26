'use strict';

/**
 * In-process session manager.
 *
 * Owns the lifecycle of IRIS login sessions:
 *   created -> launching -> captcha-wait -> logging-in -> logged-in
 *                                              \-> failed / expired
 * Emits change events so Socket.IO can broadcast state to connected clients.
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');

const STATUS = {
  CREATED: 'created',
  LAUNCHING: 'launching',
  CAPTCHA_WAIT: 'captcha-wait',
  LOGGING_IN: 'logging-in',
  LOGGED_IN: 'logged-in',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.runners = new Map();
    this.sweeper = null;
  }

  start() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweepExpired(), Math.min(config.session.ttlMs / 2, 60_000));
    if (this.sweeper.unref) this.sweeper.unref();
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const [id, stop] of this.runners) {
      try {
        if (typeof stop === 'function') stop();
      } catch (_) { /* noop */ }
      this.runners.delete(id);
    }
  }

  newId() {
    return crypto.randomUUID();
  }

  nowIso() {
    return new Date().toISOString();
  }

  build(username, password) {
    return {
      id: this.newId(),
      status: STATUS.CREATED,
      username,
      passwordEnc: null,
      captchaText: null,
      error: null,
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      expiresAt: new Date(Date.now() + config.session.ttlMs).toISOString(),
    };
  }

  async create(username, password) {
    if (this.activeCount() >= config.session.maxConcurrency) {
      const err = new Error('Too many concurrent IRIS sessions. Try again shortly.');
      err.code = 'CONCURRENCY_LIMIT';
      throw err;
    }
    const session = this.build(username, password);
    const persistable = {
      ...session,
      passwordEnc: password ? require('./crypto').encrypt(password) : null,
    };
    this.sessions.set(session.id, persistable);
    await store.saveSession(this.publicView(persistable));
    await store.logEvent(session.id, 'info', 'session created', { username: session.username });
    this.emit('update', this.publicView(persistable));
    return persistable;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  async update(id, patch) {
    const session = this.sessions.get(id);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: this.nowIso(), expiresAt: new Date(Date.now() + config.session.ttlMs).toISOString() });
    await store.saveSession(this.publicView(session));
    this.emit('update', this.publicView(session));
    return session;
  }

  async setStatus(id, status, extra = {}) {
    return this.update(id, { status, ...extra });
  }

  attachRunner(id, stopFn) {
    this.runners.set(id, stopFn);
  }

  releaseRunner(id) {
    this.runners.delete(id);
  }

  list() {
    return Array.from(this.sessions.values()).map((s) => this.publicView(s));
  }

  activeCount() {
    let n = 0;
    for (const session of this.sessions.values()) {
      if (![STATUS.LOGGED_IN, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED].includes(session.status)) n += 1;
    }
    return n;
  }

  publicView(session) {
    return {
      id: session.id,
      status: session.status,
      username: session.username,
      error: session.error || null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
    };
  }

  async sweepExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt).getTime() < now && session.status !== STATUS.EXPIRED) {
        const stop = this.runners.get(id);
        if (typeof stop === 'function') {
          try { stop(); } catch (_) { /* noop */ }
        }
        this.runners.delete(id);
        session.status = STATUS.EXPIRED;
        session.updatedAt = this.nowIso();
        this.emit('update', this.publicView(session));
      }
    }
    try {
      await store.deleteExpiredSessions();
    } catch (err) {
      this.emit('error', err);
    }
  }
}

module.exports = { SessionManager, STATUS };
