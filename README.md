# SIC Code Finder

An internal, localhost-only tool: describe a type of business in plain English and get
back relevant UK Companies House SIC codes, grouped by section.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Then open http://localhost:3000

## How it works

- `public/` is a static, no-build-step frontend (`index.html` + `app.js` + `styles.css`).
- `server.js` is a small Express server that serves the frontend and exposes a single
  `POST /api/sic-codes` endpoint, which calls the Claude API (`claude-opus-5`) with
  structured outputs to get back reliably-shaped JSON (section letter/name + codes).
  Keeping the LLM call server-side means your API key never reaches the browser.
- Deleting a code is purely client-side state — no extra API call.

## Out of scope (v1)

No auth, no persistence beyond the current session, no export, and no validation of
returned codes against the official SIC list (see the requirements doc for fast-follows).
