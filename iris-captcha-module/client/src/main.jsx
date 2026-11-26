import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const css = `
body { font-family: system-ui, sans-serif; margin: 0; background: #f4f6f8; }
.iris-screen { max-width: 560px; margin: 48px auto; background: #fff; padding: 24px 32px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.iris-screen__form { display: flex; flex-direction: column; gap: 12px; }
.iris-screen__form label { display: flex; flex-direction: column; font-size: 14px; gap: 4px; }
.iris-screen__form input { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; }
.captcha-panel { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.captcha-panel__image { border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
.captcha-panel__form { display: flex; gap: 8px; width: 100%; }
.captcha-panel__input { flex: 1; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; }
.captcha-panel__submit { padding: 8px 16px; border-radius: 6px; border: none; background: #046a38; color: #fff; cursor: pointer; }
.captcha-panel__submit:disabled { background: #9ca3af; cursor: not-allowed; }
.iris-screen__error { color: #b91c1c; }
.iris-screen__success { color: #046a38; font-weight: 600; }
button { padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
button[type='submit'] { background: #046a38; color: #fff; border-color: #046a38; }
`;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <style>{css}</style>
    <App />
  </StrictMode>,
);
