# Wanderlore

Wanderlore is a context-aware cultural discovery assistant for the PromptWars Destination Discovery & Cultural Experiences challenge. It uses live city, place, and weather signals to decide what to recommend, then optionally uses Gemini to generate grounded heritage and story content.

## Production Shape

- Zero runtime npm dependencies.
- Static frontend in `web/`, copied to `dist/` by `npm run build`.
- Native Node API handler in `server/api.js`, reused by local dev and Vercel Functions.
- Live data sources: Nominatim, Overpass, Open-Meteo, optional Gemini, optional Ticketmaster.
- Local Threads writes to an append-only JSONL ledger with bounded size and strict validation. On Vercel the ledger is stored in `/tmp`, which is functional but ephemeral; use a hosted database for durable production storage.

## Security Controls

- Manual schema validation and normalization for all request bodies.
- 64 KB request body cap.
- Per-IP in-memory rate limit.
- Fixed outbound API hosts only; no user-supplied outbound URLs.
- CORS origin checks for localhost, configured origins, and Vercel preview URLs.
- Security headers on API responses.
- Secrets are read only from environment variables and are never sent to the client.
- Connection request ledger has a 512 KB cap to prevent disk exhaustion.

## Setup

```bash
npm install
npm run build
npm run dev
```

Open `http://localhost:8787`.

## Tests

```bash
npm test
npm run build
npm run size
```

`npm test` uses Node's built-in test runner and covers the deterministic decision engine plus input validation edge cases.

## Vercel Deployment

1. Import this repository into Vercel.
2. Keep the settings from `vercel.json`:
   - Build command: `npm run build`
   - Output directory: `dist`
   - API: `api/[...path].js`
3. Add optional environment variables:
   - `GEMINI_API_KEY`
   - `EVENTS_API_KEY`
   - `FRONTEND_ORIGIN` for a comma-separated allowlist of production origins.
4. Deploy.

## Challenge Integrity

The app does not fabricate live data. If optional AI or events keys are missing, those features fail with explicit configuration messages. Passport stamps are awarded only after the corresponding endpoint succeeds.
