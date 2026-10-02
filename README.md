# Live Voting

Presenter-led live polling for talks and events. Participants join without an
account, follow the presenter's current Question, and vote from a phone while a
separate public display updates in real time.

- The homepage lists only Live Sessions.
- `/{joinName}` is the anonymous Participant View.
- `/{joinName}/display` is the read-only Presentation Display and QR-code Lobby.
- `/admin` contains Draft editing, Presenter Controls, history, exports, and
  deletion behind one deployment-wide password.

The v1 behavior is specified in the [Product brief](docs/PRODUCT.md), with
[domain language](CONTEXT.md) and [architecture decisions](docs/adr).

## Local development

Requirements: Node.js 24 or newer and npm.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Set a long `ADMIN_PASSWORD` in `.env`. For local HTTP development, also set:

```dotenv
PUBLIC_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
```

Open `http://localhost:5173`. Vite serves the client and proxies API and
Socket.IO traffic to the Fastify server on port 3000. SQLite data and daily
backups are written to the ignored `data/` and `backups/` directories.

## Optional AI closing recap

Set `OPENAI_API_KEY` in the server's `.env`, then enable **AI recap** in a Draft
Session. Existing and new sessions default to disabled. The setting is copied
when duplicating a session; generated content and responses are not.

After the last Question, **Show recap** closes voting and starts generation of
the final slide. Ending directly from the last Question also shows the recap;
ending earlier does not. Generation runs in the background and updates every
Presentation Display and Presenter Control. Participant Views wait during the
recap and include it in Session Results after End.

The server uses the official OpenAI SDK and Responses API with
[`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna),
`reasoning.effort: "xhigh"`, and
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
The model receives the title, Session Language, ordered Questions, aggregate
results, and visible feedback text. Hidden Comments, Guest Identities, guest
secrets, and response timestamps are excluded. The key stays on the server and
the request sets `store: false`. Normal OpenAI API usage charges apply.

The model chooses text alone, a bar chart, or a donut chart. It selects and groups
existing Options; the server calculates chart counts and percentages from saved
Votes and shows the source Question, Options, and denominator. Free-text themes
are qualitative interpretations, not measured sentiment scores. Recaps use the
Session Language and never render model-generated HTML.

Completed recaps persist in SQLite. Refreshing, reconnecting, or revisiting a
locked Question reuses the recap. Reopening an unlocked Question or changing
Comment Wall visibility discards it; the next recap uses the updated inputs.
Failed requests and interrupted generations show a fallback with a presenter-only
**Retry recap** control, also available in session history. Requests time out
after three minutes and are not automatically retried. Voting and saved Results
remain available if OpenAI is unconfigured or unavailable.

## Verification

```powershell
npm run typecheck
npm test
npm run test:load
npm run build
```

`npm test` covers the domain, HTTP/realtime behavior, and mocked OpenAI recap
requests and validation (no API key or paid requests needed). `npm run test:load`
exercises a 100-participant synchronized session.

## Production with Docker Compose

Copy `.env.example` to `.env`, then set at least:

```dotenv
ADMIN_PASSWORD=use-a-long-unique-password
PUBLIC_ORIGIN=https://vote.example.com
COOKIE_SECURE=true
```

Build and start the single application container:

```powershell
docker compose up -d --build
```

The service listens on `127.0.0.1:3000`; place an HTTPS reverse proxy in front
of it and proxy both normal HTTP requests and Socket.IO upgrades. Set
`TRUST_PROXY` only to the IP address or CIDR of that proxy.

SQLite runs inside the application process, so no database container is
needed. The Compose volumes `live_data` and `live_backups` persist the database
and daily snapshots independently. Copy backups to another machine or storage
provider if host loss is part of the recovery plan. Schema migrations and a
pre-migration backup run automatically at startup.

The Presentation Display is intentionally public. Participant screens hide
live aggregate Results, but that is a presentation rule rather than an access
control boundary.
