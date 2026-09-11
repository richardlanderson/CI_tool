const BASE_URL =
  process.env.COMPANIES_HOUSE_BASE_URL ||
  "https://api.company-information.service.gov.uk/advanced-search/companies";
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

  const url = new URL(BASE_URL);
  url.searchParams.set("sic_codes", sicCode);
  url.searchParams.set("company_status", "active,open");
  url.searchParams.set("start_index", String(startIndex));
  url.searchParams.set("size", String(size));

  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Companies House rejected the API key.");
    }
    if (response.status === 429) {
      throw new Error("Companies House rate limit exceeded.");
    }
    throw new Error(`Companies House API error (HTTP ${response.status}).`);
  }

  return response.json();
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

export const CONFIG = { PAGE_SIZE, PER_CODE_CAP, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS };
