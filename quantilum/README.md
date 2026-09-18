# Quantilum — backend scaffold

Full-stack backend for the Quantilum prototype: GitHub OAuth, Postgres (Neon),
Express API, and a Groq/Llama-powered Jarvis endpoint. The `client/` folder has
your existing static landing page as a starting point — the API is what's new.

## What's included

```
server/
  migrations/001_init.sql   — full Postgres schema (users, wallets, quests, etc.)
  src/db/                   — pool connection + migration runner
  src/middleware/auth.js    — JWT cookie auth, role/verification guards
  src/services/
    walletService.js        — ledger-based fintech engine (all money flows through here)
    jarvisService.js         — Groq API wrapper + adaptive preference tracking
  src/routes/
    auth.js                 — GitHub OAuth login/callback, /auth/me
    jarvis.js                — POST /api/jarvis/chat
    quests.js                — quest CRUD, completion, approval + payout
    wallet.js                 — balance, history, transfers, $5 biz fee
    studentHub.js             — notes, quizzes, tutor trials
    teacher.js                 — classes, enrollment, trial payout release
    business.js                 — registration, ads, P&L, project posting
    worker.js                    — portfolios, project applications, DMs
  src/index.js                    — Express app entry point
client/
  index.html                        — your existing static prototype
```

## 1. Set up Neon Postgres

1. Create a free project at https://neon.tech
2. Copy the connection string into `server/.env` as `DATABASE_URL`
3. Run the migration:
   ```bash
   cd server
   npm install
   cp .env.example .env   # then fill in the values
   npm run migrate
   ```

## 2. Set up GitHub OAuth

1. Go to https://github.com/settings/developers → "New OAuth App"
2. Homepage URL: `http://localhost:5173` (or your deployed client URL)
3. Authorization callback URL: `http://localhost:8080/auth/github/callback`
4. Copy the Client ID and Client Secret into `server/.env`

## 3. Set up Groq (Jarvis)

1. Get a free API key at https://console.groq.com/keys
2. Put it in `server/.env` as `GROQ_API_KEY`
3. Default model is `llama-3.3-70b-versatile` — change `GROQ_MODEL` if you want a different one

## 4. Run locally

```bash
cd server
npm install
npm run dev
```

API runs on `http://localhost:8080`. Health check: `GET /health`.

## 5. Deploy

- **API**: push `server/` to a repo, connect it to [Render](https://render.com) as a
  Web Service. Set the same env vars from `.env.example` in Render's dashboard.
  Build command: `npm install`. Start command: `npm start`.
- **DB**: already on Neon from step 1 — just point `DATABASE_URL` at it.
- **Client**: the current `client/index.html` is static and has no API calls wired
  in yet. Next step (not done here) is connecting its forms/buttons to these
  endpoints with `fetch(..., { credentials: 'include' })` so the auth cookie is sent.

## Design notes

- **Money** is stored as integer cents (`balance_cents`) to avoid floating-point
  errors. Every balance change goes through `walletService.applyLedgerEntry`,
  which writes an immutable ledger row and updates the cached wallet balance in
  the same transaction — so the ledger is always the source of truth.
- **Auth** is a JWT stored in an httpOnly cookie after GitHub OAuth completes.
  Role is chosen at the start of the OAuth flow (`/auth/github?role=student`) and
  stored on the user record; route guards (`requireRole`) enforce it server-side.
- **Verification** (student/worker/teacher ID, business registration cert) is
  modeled as a status field + doc URL on `users`/`businesses` but the actual
  document upload/review flow isn't built yet — that's the natural next piece.
- **Jarvis** keeps a rolling preference profile per student (`jarvis_preferences`)
  that nudges upward when they complete quests tagged with a subject, and feeds
  that into the system prompt so responses lean toward their interests.

## Not yet built (natural next steps)

- Frontend wiring (the HTML prototype doesn't call any of these endpoints yet)
- File/image upload handling (notes images, ID verification docs) — needs S3/R2 or similar
- Admin review flow for ID/business verification
- Withdrawal-to-real-money flow (ledger supports it, no payment processor wired in)
