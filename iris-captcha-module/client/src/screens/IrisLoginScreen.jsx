import { useState } from 'react';
import useIrisLogin from '../useIrisLogin';
import CaptchaPanel from '../components/CaptchaPanel';

const SERVER_URL = import.meta.env.VITE_IRIS_SERVER_URL || 'http://localhost:4000';

export default function IrisLoginScreen() {
  const { session, status, captcha, connected, busy, start, submitCaptcha, cancel } = useIrisLogin({ serverUrl: SERVER_URL });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const isRunning = ['launching', 'captcha-wait', 'logging-in'].includes(status);

  return (
    <main className="iris-screen">
      <h1>FBR IRIS — Human-verified CAPTCHA login</h1>
      <p className="iris-screen__meta" data-testid="connection">
        Server: {connected ? 'connected' : 'offline'} · Session: {session.id || '—'} · Status:{' '}
        <strong data-testid="status">{status}</strong>
      </p>

      {!session.id && (
        <form
          className="iris-screen__form"
          onSubmit={(event) => {
            event.preventDefault();
            start({ username, password });
          }}
        >
          <label>
            Username / CNIC / Reg. No.
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy || !username || !password}>
            Start IRIS login
          </button>
        </form>
      )}

      {isRunning && (
        <section className="iris-screen__captcha">
          <h2>CAPTCHA</h2>
          <CaptchaPanel captcha={captcha} onSubmit={submitCaptcha} disabled={status !== 'captcha-wait'} />
        </section>
      )}

      {(session.error || status === 'failed') && (
        <p className="iris-screen__error" data-testid="error">
          {session.error || 'Login failed.'}
        </p>
      )}

      {status === 'logged-in' && (
        <p className="iris-screen__success" data-testid="success">
          ✅ Logged in to IRIS as {session.username}.
        </p>
      )}

      {session.id && (
        <button type="button" onClick={cancel}>
          Cancel session
        </button>
      )}
    </main>
  );
}
