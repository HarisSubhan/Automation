'use strict';

/**
 * iris-captcha-module server.
 *
 * Express (REST) + Socket.IO (real-time CAPTCHA delivery) + Playwright
 * (browser automation against the FBR IRIS portal).
 *
 * REST
 *   GET    /api/health                        liveness + db check
 *   GET    /api/health/socket                 socket.io diagnostics (clients + rooms)
 *   POST   /api/iris/start                    create session, open browser
 *   GET    /api/iris/sessions                 list sessions
 *   GET    /api/iris/sessions/:id             one session
 *   GET    /api/iris/sessions/:id/captcha     current CAPTCHA as base64
 *   POST   /api/iris/sessions/:id/captcha     submit human-read CAPTCHA text
 *   GET    /api/iris/sessions/:id/watchers    how many socket clients are watching
 *   DELETE /api/iris/sessions/:id             abandon a session
 *
 * Socket.IO (namespace /iris)
 *   client -> server : session:watch {sessionId}, captcha:submit {sessionId,text}
 *   server -> client : session:update {session}, captcha:image {sessionId,captcha}
 */

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./config');
const { SessionManager, STATUS } = require('./sessionManager');
const { runIrisLogin } = require('./irisSession');
const { decrypt } = require('./crypto');
const store = require('./store');

const manager = new SessionManager();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Module', 'iris-captcha-module');
  next();
});

const pendingCaptcha = new Map();

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

app.get('/api/health', async (_req, res) => {
  const db = await store.pingDb();
  res.json({ ok: true, env: config.env, db, sessions: manager.activeCount() });
});

/**
 * Socket.IO diagnostics.
 * Returns how many clients are currently attached to the /iris namespace,
 * plus each client's id and the rooms it has joined (session:* rooms etc).
 */
app.get('/api/health/socket', (_req, res) => {
  const clients = [...iris.sockets.values()].map((s) => ({
    id: s.id,
    rooms: [...s.rooms].filter((r) => r !== s.id),
    connected: s.connected,
  }));
  res.json({
    ok: true,
    namespace: '/iris',
    connectedClients: clients.length,
    clients,
  });
});

app.post('/api/iris/start', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  let session;
  try {
    session = await manager.create(username, password);
  } catch (err) {
    const code = err.code === 'CONCURRENCY_LIMIT' ? 429 : 500;
    return res.status(code).json({ error: err.message });
  }

  let plainPassword = password;
  if (session.passwordEnc) {
    try {
      plainPassword = decrypt(session.passwordEnc);
    } catch (_) {
      plainPassword = password;
    }
  }

  const captchaPromise = new Promise((resolve, reject) => {
    pendingCaptcha.set(session.id, { resolve, reject });
  });

  const chromium = require('playwright').chromium;
  runIrisLogin({
    chromium,
    manager,
    sessionId: session.id,
    username: session.username,
    password: plainPassword,
    waitForCaptchaText: () => captchaPromise,
  }).catch((err) => {
    manager.setStatus(session.id, STATUS.FAILED, { error: err.message }).catch(() => {});
  });

  res.status(202).json({ sessionId: session.id, status: session.status });
});

app.get('/api/iris/sessions', async (_req, res) => {
  res.json({ sessions: manager.list() });
});

app.get('/api/iris/sessions/:id', (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ session: manager.publicView(session) });
});

app.get('/api/iris/sessions/:id/captcha', (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (!session.captcha) return res.status(409).json({ error: 'captcha not ready yet' });
  res.json({
    sessionId: session.id,
    selector: session.captcha.selector,
    mimeType: session.captcha.mimeType,
    base64: session.captcha.base64,
  });
});

app.post('/api/iris/sessions/:id/captcha', (req, res) => {
  const pending = pendingCaptcha.get(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!pending) return res.status(404).json({ error: 'no captcha awaited for this session' });
  if (!text) return res.status(400).json({ error: 'captcha text is required' });
  pending.resolve(text);
  res.json({ ok: true });
});

/**
 * How many Socket.IO clients are watching a specific session room.
 * (Clients join `session:<id>` via the `session:watch` event.)
 */
app.get('/api/iris/sessions/:id/watchers', (req, res) => {
  const room = `session:${req.params.id}`;
  const roomSockets = iris.adapter.rooms.get(room);
  res.json({ sessionId: req.params.id, room, watchers: roomSockets ? roomSockets.size : 0 });
});

app.delete('/api/iris/sessions/:id', (req, res) => {
  const pending = pendingCaptcha.get(req.params.id);
  if (pending) {
    pending.reject(new Error('session cancelled'));
    pendingCaptcha.delete(req.params.id);
  }
  const session = manager.get(req.params.id);
  if (session) manager.setStatus(req.params.id, STATUS.CANCELLED);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.server.corsOrigin, methods: ['GET', 'POST'] },
});

const iris = io.of('/iris');

iris.on('connection', (socket) => {
  console.log(`[iris-captcha] ✅ socket connected: ${socket.id} | clients=${iris.sockets.size}`);

  socket.on('session:watch', (payload = {}) => {
    const { sessionId } = payload;
    if (sessionId) {
      socket.join(`session:${sessionId}`);
      console.log(`[iris-captcha] ${socket.id} watching session:${sessionId}`);
    }
  });

  socket.on('captcha:submit', (payload = {}) => {
    const { sessionId, text } = payload;
    const pending = pendingCaptcha.get(sessionId);
    if (!pending || !text) {
      socket.emit('captcha:rejected', { sessionId, error: 'no captcha awaited or empty text' });
      return;
    }
    pending.resolve(String(text).trim());
  });

  socket.on('disconnect', (reason) => {
    console.log(`[iris-captcha] ❌ socket disconnected: ${socket.id} — ${reason} | clients=${iris.sockets.size}`);
  });
});

manager.on('update', (publicSession) => {
  iris.to(`session:${publicSession.id}`).emit('session:update', publicSession);
  if (publicSession.status === STATUS.CAPTCHA_WAIT) {
    const session = manager.get(publicSession.id);
    if (session && session.captcha) {
      iris.to(`session:${publicSession.id}`).emit('captcha:image', {
        sessionId: publicSession.id,
        captcha: session.captcha,
      });
    }
  }
});

manager.on('error', (err) => {
  console.error('[iris-captcha] manager error:', err.message);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  manager.start();
  await new Promise((resolve) => {
    server.listen(config.server.port, config.server.host, resolve);
  });
  console.log(`[iris-captcha] listening on http://${config.server.host}:${config.server.port}`);
  console.log(`[iris-captcha] db ${store.isDbEnabled() ? 'enabled (mysql)' : 'disabled (in-memory store)'}`);
  console.log(`[iris-captcha] socket.io namespace: /iris`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[iris-captcha] fatal:', err);
    process.exit(1);
  });
}

module.exports = { app, server, io, manager };