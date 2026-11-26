# iris-captcha-module

FBR IRIS login automation with a **human-verified CAPTCHA** step.

A Playwright browser opens the FBR IRIS portal, reads the login form, screenshots the
CAPTCHA, and streams it to a React UI over Socket.IO. A human types the CAPTCHA text;
only then are the credentials submitted and the login confirmed by scanning the
resulting page. Passwords are encrypted at rest with AES-256-GCM; sessions live in
MySQL (optional) or in memory.

```
client (React: useIrisLogin + CaptchaPanel)
   │  REST: start / submit captcha      Socket.IO: session:update, captcha:image
   ▼
server (Express + Socket.IO)
   │  sessionManager ── store (MySQL or in-memory)
   ▼
irisSession + scan.js ── Playwright ── https://iris.fbr.gov.pk
```

## Layout

```
server/
  schema.sql            MySQL schema (iris_sessions, iris_events)
  .env.example          copy to .env
  src/
    config.js           env-driven configuration
    crypto.js           AES-256-GCM encrypt/decrypt + masking
    store.js            MySQL persistence with in-memory fallback
    sessionManager.js   session lifecycle, TTL sweeper, event emitter
    irisSession.js      Playwright login flow (open → captcha → submit → verify)
    scan.js             page scanner: inputs, captcha image, errors, logged-in state
    index.js            Express REST + Socket.IO wiring

client/
  src/useIrisLogin.js               React hook (socket + REST)
  src/components/CaptchaPanel.jsx   CAPTCHA image + input UI
  src/screens/IrisLoginScreen.jsx   example screen wiring it all together
```

## Prerequisites

- Node.js ≥ 18
- Playwright Chromium: `npx playwright install chromium`
- MySQL 8 (optional — set `DB_ENABLED=false` to run in-memory)

## Setup

```bash
git clone https://github.com/HarisSubhan/Automation.git
cd Automation/iris-captcha-module

cp server/.env.example server/.env       # edit CREDENTIAL_ENCRYPTION_KEY etc.
npm run setup:server                     # npm install + playwright install chromium
npm run setup:client

mysql -u root -p < server/schema.sql     # only if using MySQL (DB_ENABLED=true)
```

Generate a fresh encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Run

```bash
npm run dev:server     # http://127.0.0.1:4000
npm run dev:client     # http://localhost:5173
```

## API & events

REST:

| Method   | Path                             | Body                     | Purpose                     |
| -------- | -------------------------------- | ------------------------ | --------------------------- |
| `GET`    | `/api/health`                    | —                        | liveness + DB check         |
| `POST`   | `/api/iris/start`                | `{ username, password }` | open browser, fetch CAPTCHA |
| `GET`    | `/api/iris/sessions`             | —                        | list sessions               |
| `GET`    | `/api/iris/sessions/:id`         | —                        | one session                 |
| `GET`    | `/api/iris/sessions/:id/captcha` | —                        | current CAPTCHA as base64   |
| `POST`   | `/api/iris/sessions/:id/captcha` | `{ text }`               | submit human-read CAPTCHA   |
| `DELETE` | `/api/iris/sessions/:id`         | —                        | cancel a session            |

Socket.IO (`/iris` namespace):

- client → server: `session:watch {sessionId}`, `captcha:submit {sessionId, text}`
- server → client: `session:update {session}`, `captcha:image {sessionId, captcha}`, `captcha:rejected`

Session states: `created → launching → captcha-wait → logging-in → logged-in`
(or `failed` / `expired` / `cancelled`).

## Testing

### Smoke test (no IRIS account needed)

```bash
SERVER=http://127.0.0.1:4000
curl -s $SERVER/api/health            # {"ok":true,...,"db":{"enabled":...}}
curl -s $SERVER/api/iris/sessions     # {"sessions":[]}
```

### Manual login flow with curl

```bash
SERVER=http://127.0.0.1:4000
SID=$(curl -s -X POST $SERVER/api/iris/start \
  -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_IRIS_ID","password":"YOUR_SECRET"}' \
  | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
echo "session: $SID"

# wait a few seconds, then save and open the CAPTCHA:
curl -s $SERVER/api/iris/sessions/$SID/captcha \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);require('fs').writeFileSync('captcha.png',Buffer.from(j.base64,'base64'))})"
open captcha.png

# type what you read, then submit:
curl -s -X POST $SERVER/api/iris/sessions/$SID/captcha \
  -H 'Content-Type: application/json' -d '{"text":"ABC12"}'

# confirm the outcome:
curl -s $SERVER/api/iris/sessions/$SID
```

### Via the React UI

Open `http://localhost:5173`, enter your IRIS credentials, and the CAPTCHA panel appears
as soon as the server screenshots it — type the characters and submit.

## Notes

- The CAPTCHA is deliberately solved by a human; there is no OCR or solver.
- `IRIS_HEADLESS=false` (in `server/.env`) is useful to watch the browser during development.
- Failed/errored sessions save a full-page screenshot under `server/storage/screenshots/`.
- Do not commit `server/.env`; it is already in `.gitignore`.
