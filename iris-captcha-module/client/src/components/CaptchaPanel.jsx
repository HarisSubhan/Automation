import { useEffect, useState } from 'react';

export default function CaptchaPanel({ captcha, onSubmit, disabled }) {
  const [text, setText] = useState('');

  useEffect(() => {
    setText('');
  }, [captcha?.base64]);

  if (!captcha) {
    return (
      <p className="captcha-panel__hint" data-testid="captcha-empty">
        Waiting for the IRIS CAPTCHA to appear…
      </p>
    );
  }

  const src = `data:${captcha.mimeType || 'image/png'};base64,${captcha.base64}`;

  return (
    <div className="captcha-panel" data-testid="captcha-panel">
      <img className="captcha-panel__image" src={src} alt="IRIS CAPTCHA" data-testid="captcha-image" />
      <form
        className="captcha-panel__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) onSubmit(text.trim());
        }}
      >
        <input
          className="captcha-panel__input"
          data-testid="captcha-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type the characters you see"
          autoFocus
          disabled={disabled}
        />
        <button
          className="captcha-panel__submit"
          data-testid="captcha-submit"
          type="submit"
          disabled={disabled || !text.trim()}
        >
          Submit
        </button>
      </form>
    </div>
  );
}
