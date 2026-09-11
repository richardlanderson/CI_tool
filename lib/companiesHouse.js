const ADVANCED_SEARCH_URL =
  process.env.COMPANIES_HOUSE_BASE_URL ||
  "https://api.company-information.service.gov.uk/advanced-search/companies";
const API_HOST = process.env.COMPANIES_HOUSE_API_HOST || "https://api.company-information.service.gov.uk";
const PAGE_SIZE = 100;
const PER_CODE_CAP = 2000;
const RATE_LIMIT_MAX_REQUESTS = 600;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

export class RateLimiter {
  constructor(maxRequests = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_MS) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async acquire() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      const waitMs = this.windowMs - (now - this.timestamps[0]) + 50;
      await sleep(waitMs);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(apiKey) {
  return { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
}

function throwForStatus(status) {
  if (status === 401 || status === 403) {
    throw new Error("Companies House rejected the API key.");
  }
  if (status === 429) {
    throw new Error("Companies House rate limit exceeded.");
  }
  throw new Error(`Companies House API error (HTTP ${status}).`);
}

function flattenAddress(address) {
  if (!address) return "";
  return [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function mapItem(item) {
  return {
    companyNumber: item.company_number,
    companyName: item.company_name,
    companyStatus: item.company_status,
    companyType: item.company_type,
    incorporationDate: item.date_of_creation,
    registeredOfficeAddress: flattenAddress(item.registered_office_address),
  };
}

async function fetchPage({ apiKey, sicCode, startIndex, size, rateLimiter }) {
  await rateLimiter.acquire();

  const url = new URL(ADVANCED_SEARCH_URL);
  url.searchParams.set("sic_codes", sicCode);
  url.searchParams.set("company_status", "active,open");
  url.searchParams.set("start_index", String(startIndex));
  url.searchParams.set("size", String(size));

  const response = await fetch(url, { headers: authHeader(apiKey) });
  if (!response.ok) throwForStatus(response.status);

  return response.json();
}

async function fetchJson(path, { apiKey, rateLimiter }) {
  await rateLimiter.acquire();

  const response = await fetch(`${API_HOST}${path}`, { headers: authHeader(apiKey) });
  if (response.status === 404) return null;
  if (!response.ok) throwForStatus(response.status);

  return response.json();
}

async function fetchOfficersAndPsc(apiKey, companyNumber, rateLimiter) {
  const [officersData, pscData] = await Promise.all([
    fetchJson(`/company/${companyNumber}/officers`, { apiKey, rateLimiter }),
    fetchJson(`/company/${companyNumber}/persons-with-significant-control`, { apiKey, rateLimiter }),
  ]);
  return { officersData, pscData };
}

export async function fetchCompanyDetails({ apiKey, companyNumber, rateLimiter }) {
  const { officersData, pscData } = await fetchOfficersAndPsc(apiKey, companyNumber, rateLimiter);

  const officers = (officersData?.items || [])
    .filter((o) => !o.resigned_on)
    .map((o) => ({
      name: o.name,
      role: o.officer_role,
      appointedOn: o.appointed_on,
      nationality: o.nationality,
      occupation: o.occupation,
    }));

  const pscs = (pscData?.items || [])
    .filter((p) => !p.ceased_on)
    .map((p) => ({
      name: p.name || "Unknown",
      kind: p.kind,
      naturesOfControl: p.natures_of_control || [],
      notifiedOn: p.notified_on,
    }));

  return {
    officers,
    officersTotal: officersData?.active_count ?? officers.length,
    pscs,
    pscsTotal: pscData?.active_count ?? pscs.length,
  };
}

// An officer's `links.officer.appointments` URL embeds a stable ID that Companies
// House uses to track the same natural person across every company they're
// appointed at — the reliable way to detect "same director, different company".
// Corporate officers (a company acting as director) don't carry this link and are
// skipped, since they aren't the "individual" this feature is looking for.
function extractOfficerAppointments(officersData) {
  const appointments = [];
  for (const o of officersData?.items || []) {
    if (o.resigned_on) continue;
    const appointmentsLink = o.links?.officer?.appointments;
    const match = appointmentsLink?.match(/\/officers\/([^/]+)\/appointments/);
    if (!match) continue;

    appointments.push({
      identityKey: `officer:${match[1]}`,
      name: o.name,
      matchType: "officer",
      role: o.officer_role,
    });
  }
  return appointments;
}

// PSC records have no equivalent cross-company person ID via this endpoint, so
// individuals are matched by normalized name plus birth month/year when available
// (day of birth is withheld by Companies House for privacy) — a heuristic, not a
// guarantee, unlike the officer match above. Corporate/legal-person PSCs are
// excluded since they represent companies, not individuals.
function extractPscAppearances(pscData) {
  const appearances = [];
  for (const p of pscData?.items || []) {
    if (p.ceased_on) continue;
    if (p.kind !== "individual-person-with-significant-control") continue;

    const name = (p.name || "").trim();
    if (!name) continue;

    const dob = p.date_of_birth ? `${p.date_of_birth.month}-${p.date_of_birth.year}` : "unknown-dob";
    appearances.push({
      identityKey: `psc:${name.toLowerCase()}:${dob}`,
      name,
      matchType: "psc-name",
      role: "psc",
    });
  }
  return appearances;
}

export async function fetchCompanyPeople({ apiKey, companyNumber, rateLimiter }) {
  const { officersData, pscData } = await fetchOfficersAndPsc(apiKey, companyNumber, rateLimiter);
  return [...extractOfficerAppointments(officersData), ...extractPscAppearances(pscData)];
}

export async function searchSicCode({
  apiKey,
  sicCode,
  rateLimiter,
  cap = PER_CODE_CAP,
  pageSize = PAGE_SIZE,
}) {
  const companies = [];
  let startIndex = 0;
  let totalHits = null;

  while (companies.length < cap) {
    const size = Math.min(pageSize, cap - companies.length);
    const data = await fetchPage({ apiKey, sicCode, startIndex, size, rateLimiter });

    if (typeof data.hits === "number") totalHits = data.hits;
    const items = Array.isArray(data.items) ? data.items : [];

    for (const item of items) companies.push(mapItem(item));

    startIndex += items.length;

    if (items.length < size) break;
    if (totalHits !== null && startIndex >= totalHits) break;
  }

  return { companies, totalHits: totalHits ?? companies.length };
}

// Single shared instance: the 600-req/5-min limit is per API key across the whole
// server process, not per request, so every route must throttle against the same budget.
export const sharedRateLimiter = new RateLimiter();

export const CONFIG = { PAGE_SIZE, PER_CODE_CAP, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS };
