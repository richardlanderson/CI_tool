# SIC Code Finder

An internal, localhost-only tool:

1. Describe a type of business in plain English **or** pick an exact SIC code from a
   searchable dropdown of the full official list — either way you get back relevant
   SIC codes, grouped by section.
2. Curate that list, then click **Find Companies** to pull every active/open company
   registered against those SIC codes from the real Companies House API, view them in
   a sortable/filterable table, and download the combined result as a CSV.
3. Per company, on demand: expand **Officers & PSC** to see current directors and
   persons with significant control (fetched from Companies House only when you
   expand a row), or open a **LinkedIn** search for that company name in a new tab.

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
  search + results, both entry modes), `companies.js` (company search results view),
  `styles.css`, and `data/sic-codes.json` — the full official Companies House
  condensed SIC code list (730 codes, grouped into the 21 standard sections),
  sourced from [companieshouse/sic-code-data](https://github.com/companieshouse/sic-code-data)
  on GitHub and shipped as a static asset for the "Pick a SIC code" dropdown — no
  network call needed to populate it, and no API key required for that part.
- `server.js` is a small Express server, both API keys stay server-side:
  - `POST /api/sic-codes` calls the Claude API (`claude-opus-5`) with structured
    outputs to get back reliably-shaped JSON (section letter/name + codes).
  - `POST /api/related-sic-codes` powers "Pick a SIC code": given a code selected
    from the dropdown, asks Claude for related codes, same structured contract.
    The originally selected code is always merged back into the result client-side
    (into its real section), even if the model doesn't repeat it.
  - `POST /api/find-companies` takes the curated SIC code list, queries the
    Companies House Advanced Search API (`company_status=active,open`) once per
    code — paginating up to a 2,000-company cap per code — and streams progress
    back to the browser as newline-delimited JSON while it works. Results are
    deduplicated by company number, merging `matchedSicCodes` for companies that
    match more than one searched code.
  - `POST /api/find-companies/retry-code` retries a single SIC code that failed,
    without re-running the whole search.
  - `GET /api/companies/:companyNumber/details` fetches that one company's current
    officers and persons with significant control, on demand — called only when
    you expand a row, not for the whole result set.
  - `lib/companiesHouse.js` holds the Companies House client, including a single
    shared sliding-window rate limiter (600 requests / 5 minutes, per the API's
    published limit) used by every route that calls Companies House, since the
    limit is per API key across the whole app, not per request.
- Deleting a SIC code, filtering/sorting/paginating the companies table, and CSV
  export are all client-side — no extra network calls. Officers/PSC data is cached
  client-side per company after first fetch (re-expanding doesn't refetch) and is
  never included in the CSV export.
- The LinkedIn link opens LinkedIn's own company search for that name — it's a
  search link, not a verified direct profile link (LinkedIn has no public API for
  this, and scraping their site would violate their Terms of Service), so you
  confirm the right match yourself.

## Out of scope (v1)

No auth, no persistence beyond the current session (the CSV download is the durable
output), no validation of LLM-returned codes against the official SIC list, and no
employee headcount data (Companies House doesn't publish this as structured data —
see the requirements doc for fast-follows).
