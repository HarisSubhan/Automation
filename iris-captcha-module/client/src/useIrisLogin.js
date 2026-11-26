import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const EMPTY_SESSION = {
  id: null,
  status: 'idle',
  username: null,
  error: null,
  createdAt: null,
  updatedAt: null,
};

export function useIrisLogin({ serverUrl = 'https://automation.wahatliwadocumentclearingservice.com' } = {}) {
  const socketRef = useRef(null);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [captcha, setCaptcha] = useState(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const socket = io(`${serverUrl}/iris`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('session:update', (next) => {
      setSession((prev) => (prev.id === next.id || prev.id === null ? next : prev));
      if (['logged-in', 'failed', 'expired', 'cancelled'].includes(next.status)) {
        setBusy(false);
      }
    });

    socket.on('captcha:image', ({ sessionId, captcha: image }) => {
      setSession((prev) => (prev.id === sessionId ? prev : prev));
      setCaptcha(image);
    });

    socket.on('captcha:rejected', ({ error }) => {
      setSession((prev) => ({ ...prev, error }));
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [serverUrl]);

  const start = useCallback(async ({ username, password }) => {
    setBusy(true);
    setCaptcha(null);
    setSession({ ...EMPTY_SESSION, status: 'starting' });
    try {
      const res = await fetch(`${serverUrl}/api/iris/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `start failed (${res.status})`);
      setSession((prev) => ({ ...prev, id: data.sessionId, status: data.status }));
      socketRef.current?.emit('session:watch', { sessionId: data.sessionId });
      return data.sessionId;
    } catch (err) {
      setSession((prev) => ({ ...prev, status: 'failed', error: err.message }));
      setBusy(false);
      return null;
    }
  }, [serverUrl]);

  const submitCaptcha = useCallback(async (text) => {
    const sessionId = session.id;
    if (!sessionId || !text) return;
    const res = await fetch(`${serverUrl}/api/iris/sessions/${sessionId}/captcha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSession((prev) => ({ ...prev, error: data.error || 'captcha submit failed' }));
    }
  }, [serverUrl, session.id]);

  const cancel = useCallback(async () => {
    if (!session.id) return;
    await fetch(`${serverUrl}/api/iris/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
    setBusy(false);
    setCaptcha(null);
  }, [serverUrl, session.id]);

  const status = useMemo(() => session.status, [session.status]);

  return { session, status, captcha, connected, busy, start, submitCaptcha, cancel };
}

export default useIrisLogin;
