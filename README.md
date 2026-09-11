# SIC Code Finder

An internal, localhost-only tool:

1. Describe a type of business in plain English and get back relevant UK Companies
   House SIC codes, grouped by section.
2. Curate that list, then click **Find Companies** to pull every active/open company
   registered against those SIC codes from the real Companies House API, view them in
   a sortable/filterable table, and download the combined result as a CSV.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — see "API keys" below
npm start
```

Then open http://localhost:3000

### API keys

- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com).
  Powers the SIC code suggestions.
- `COMPANIES_HOUSE_API_KEY` — register a free account at
  [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/)
  and create a REST API key. Only required for the "Find Companies" step; the SIC
  code search works without it. If it's missing, "Find Companies" shows a clear
  setup error rather than failing silently.

## How it works

- `public/` is a static, no-build-step frontend: `index.html`, `app.js` (SIC code
  search + results), `companies.js` (company search results view), `styles.css`.
- `server.js` is a small Express server, both API keys stay server-side:
  - `POST /api/sic-codes` calls the Claude API (`claude-opus-5`) with structured
    outputs to get back reliably-shaped JSON (section letter/name + codes).
  - `POST /api/find-companies` takes the curated SIC code list, queries the
    Companies House Advanced Search API (`company_status=active,open`) once per
    code — paginating up to a 2,000-company cap per code — and streams progress
    back to the browser as newline-delimited JSON while it works. Results are
    deduplicated by company number, merging `matchedSicCodes` for companies that
    match more than one searched code.
  - `POST /api/find-companies/retry-code` retries a single SIC code that failed,
    without re-running the whole search.
  - `lib/companiesHouse.js` holds the Companies House client, including a sliding-
    window rate limiter (600 requests / 5 minutes, per the API's published limit).
- Deleting a SIC code, filtering/sorting/paginating the companies table, and CSV
  export are all client-side — no extra network calls.

## Out of scope (v1)

No auth, no persistence beyond the current session (the CSV download is the durable
output), no validation of LLM-returned codes against the official SIC list, and no
Companies House enrichment (officers, PSCs, filings) — see the requirements doc for
fast-follows.
