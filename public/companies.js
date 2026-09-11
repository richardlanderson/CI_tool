const companiesState = {
  status: "idle", // idle | running | success | error
  currentSicIndex: 0,
  totalSicCodes: 0,
  progressLabel: "",
  companies: [],
  breakdown: [],
  failures: [],
  errorMessage: undefined,
};

const PAGE_SIZE = 100;
let sicCodesForRun = [];
let filterText = "";
let sortKey = "companyName";
let sortDir = "asc";
let currentPage = 1;
let activeRunToken = 0;

const progressPanel = document.getElementById("companies-progress");
const progressText = document.getElementById("companies-progress-text");
const setupErrorPanel = document.getElementById("companies-setup-error");
const setupErrorMessage = document.getElementById("companies-setup-error-message");
const setupRetryButton = document.getElementById("companies-retry-button");
const summaryBanner = document.getElementById("companies-summary");
const failuresPanel = document.getElementById("companies-failures");
const controls = document.getElementById("companies-controls");
const filterInput = document.getElementById("companies-filter");
const downloadButton = document.getElementById("download-csv-button");
const tableWrap = document.getElementById("companies-table-wrap");
const tableHead = document.querySelector(".companies-table thead");
const tableBody = document.getElementById("companies-table-body");
const paginationEl = document.getElementById("companies-pagination");
const emptyState = document.getElementById("companies-empty");
const backButton = document.getElementById("back-to-sic-button");

function render() {
  progressPanel.hidden = companiesState.status !== "running";
  if (companiesState.status === "running") {
    progressText.textContent = companiesState.progressLabel || "Starting…";
  }

  setupErrorPanel.hidden = companiesState.status !== "error";
  if (companiesState.status === "error") {
    setupErrorMessage.textContent = companiesState.errorMessage || "Something went wrong.";
  }

  const done = companiesState.status === "success";
  summaryBanner.hidden = !done;
  if (done) renderSummary();

  failuresPanel.hidden = companiesState.status === "idle" || companiesState.failures.length === 0;
  if (!failuresPanel.hidden) renderFailures();

  if (done) {
    renderTable();
  } else {
    controls.hidden = true;
    tableWrap.hidden = true;
    emptyState.hidden = true;
  }
}

function renderSummary() {
  summaryBanner.innerHTML = "";
  const total = companiesState.companies.length;

  const headline = document.createElement("p");
  headline.className = "summary-headline";
  const strong = document.createElement("strong");
  strong.textContent = String(total);
  headline.append(
    strong,
    ` unique compan${total === 1 ? "y" : "ies"} found across ${companiesState.breakdown.length} SIC code${companiesState.breakdown.length === 1 ? "" : "s"}.`,
  );
  summaryBanner.appendChild(headline);

  if (companiesState.breakdown.length > 0) {
    const breakdownEl = document.createElement("div");
    breakdownEl.className = "summary-breakdown";
    breakdownEl.textContent = companiesState.breakdown
      .map((b) => {
        const capped = b.totalHits && b.totalHits > b.count ? ` of ${b.totalHits} (capped)` : "";
        return `${b.code}${b.description ? ` (${b.description})` : ""}: ${b.count}${capped}`;
      })
      .join("  ·  ");
    summaryBanner.appendChild(breakdownEl);
  }
}

function renderFailures() {
  failuresPanel.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "failures-heading";
  heading.textContent = "Some SIC codes could not be retrieved:";
  failuresPanel.appendChild(heading);

  for (const failure of companiesState.failures) {
    const row = document.createElement("div");
    row.className = "failure-row";

    const label = document.createElement("span");
    label.textContent = `SIC code ${failure.code}${failure.description ? ` — ${failure.description}` : ""}: ${failure.message}`;

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "retry-button";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => retryCode(failure));

    row.append(label, retryBtn);
    failuresPanel.appendChild(row);
  }
}

function getFilteredSorted() {
  const q = filterText.trim().toLowerCase();
  let list = companiesState.companies;

  if (q) {
    list = list.filter((c) =>
      [c.companyName, c.companyNumber, c.registeredOfficeAddress, ...(c.matchedSicCodes || [])]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q)),
    );
  }

  return [...list].sort((a, b) => {
    const av = (a[sortKey] || "").toString().toLowerCase();
    const bv = (b[sortKey] || "").toString().toLowerCase();
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function td(text, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text || "";
  return cell;
}

function renderTable() {
  tableBody.innerHTML = "";

  if (companiesState.companies.length === 0) {
    tableWrap.hidden = true;
    controls.hidden = true;
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  controls.hidden = false;
  tableWrap.hidden = false;

  const filtered = getFilteredSorted();

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "no-match-cell";
    cell.textContent = "No companies match your filter.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    paginationEl.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;

  for (const company of filtered.slice(start, start + PAGE_SIZE)) {
    const row = document.createElement("tr");
    row.append(
      td(company.companyName),
      td(company.companyNumber, "mono"),
      td(company.companyStatus),
      td(company.companyType),
      td(company.incorporationDate),
      td(company.registeredOfficeAddress),
      td((company.matchedSicCodes || []).join(", "), "mono"),
    );
    tableBody.appendChild(row);
  }

  renderPagination(totalPages, filtered.length);
}

function renderPagination(totalPages, totalCount) {
  paginationEl.innerHTML = "";
  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "Previous";
  prevBtn.disabled = currentPage <= 1;
  prevBtn.addEventListener("click", () => {
    currentPage -= 1;
    renderTable();
  });

  const info = document.createElement("span");
  info.className = "pagination-info";
  info.textContent = `Page ${currentPage} of ${totalPages} (${totalCount} companies)`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "Next";
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.addEventListener("click", () => {
    currentPage += 1;
    renderTable();
  });

  paginationEl.append(prevBtn, info, nextBtn);
}

function updateSortIndicators() {
  tableHead.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted-asc", th.dataset.sort === sortKey && sortDir === "asc");
    th.classList.toggle("sorted-desc", th.dataset.sort === sortKey && sortDir === "desc");
  });
}

function mergeCompanies(newCompanies) {
  const byNumber = new Map(companiesState.companies.map((c) => [c.companyNumber, c]));
  for (const company of newCompanies) {
    const existing = byNumber.get(company.companyNumber);
    if (existing) {
      existing.matchedSicCodes = [...new Set([...existing.matchedSicCodes, ...company.matchedSicCodes])];
    } else {
      byNumber.set(company.companyNumber, company);
      companiesState.companies.push(company);
    }
  }
}

async function retryCode(failure) {
  try {
    const response = await fetch("/api/find-companies/retry-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: failure.code, description: failure.description }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);

    mergeCompanies(body.companies);
    companiesState.breakdown.push({
      code: failure.code,
      description: failure.description,
      count: body.companies.length,
      totalHits: body.totalHits,
    });
    companiesState.failures = companiesState.failures.filter((f) => f.code !== failure.code);
  } catch (err) {
    failure.message = err instanceof Error ? err.message : "Retry failed.";
  }
  render();
}

function toCsvValue(value) {
  const str = value == null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(companies) {
  const header = [
    "Company Name",
    "Company Number",
    "Status",
    "Company Type",
    "Incorporation Date",
    "Registered Office Address",
    "Matched SIC Codes",
  ];
  const lines = [header.map(toCsvValue).join(",")];

  for (const c of companies) {
    lines.push(
      [
        c.companyName,
        c.companyNumber,
        c.companyStatus,
        c.companyType || "",
        c.incorporationDate || "",
        c.registeredOfficeAddress || "",
        (c.matchedSicCodes || []).join("; "),
      ]
        .map(toCsvValue)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

function downloadCsv() {
  const sorted = [...companiesState.companies].sort((a, b) =>
    (a.companyName || "").localeCompare(b.companyName || ""),
  );
  const csv = buildCsv(sorted);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const link = document.createElement("a");
  link.href = url;
  link.download = `companies-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleEvent(event, myToken) {
  if (myToken !== activeRunToken) return;

  if (event.type === "progress") {
    companiesState.currentSicIndex = event.currentIndex;
    companiesState.totalSicCodes = event.total;
    companiesState.progressLabel = `Searching SIC code ${event.currentIndex} of ${event.total} (${event.code}${event.description ? ` — ${event.description}` : ""})…`;
  } else if (event.type === "code-error") {
    companiesState.failures.push({ code: event.code, description: event.description, message: event.message });
  } else if (event.type === "done") {
    companiesState.companies = event.companies;
    companiesState.breakdown = event.breakdown;
    companiesState.failures = event.failures;
    companiesState.status = "success";
  }
  render();
}

async function runSearch(sicCodes) {
  const myToken = ++activeRunToken;
  sicCodesForRun = sicCodes;
  Object.assign(companiesState, {
    status: "running",
    currentSicIndex: 0,
    totalSicCodes: sicCodes.length,
    progressLabel: "",
    companies: [],
    breakdown: [],
    failures: [],
    errorMessage: undefined,
  });
  currentPage = 1;
  sortKey = "companyName";
  sortDir = "asc";
  filterText = "";
  filterInput.value = "";
  updateSortIndicators();
  render();

  try {
    const response = await fetch("/api/find-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sicCodes }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      if (myToken !== activeRunToken) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) handleEvent(JSON.parse(line), myToken);
      }
    }
    if (buffer.trim()) handleEvent(JSON.parse(buffer.trim()), myToken);
  } catch (err) {
    if (myToken !== activeRunToken) return;
    companiesState.status = "error";
    companiesState.errorMessage = err instanceof Error ? err.message : "Something went wrong.";
    render();
  }
}

tableHead.addEventListener("click", (event) => {
  const th = event.target.closest("th[data-sort]");
  if (!th) return;

  if (sortKey === th.dataset.sort) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortKey = th.dataset.sort;
    sortDir = "asc";
  }
  currentPage = 1;
  updateSortIndicators();
  renderTable();
});

filterInput.addEventListener("input", () => {
  filterText = filterInput.value;
  currentPage = 1;
  renderTable();
});

downloadButton.addEventListener("click", downloadCsv);

setupRetryButton.addEventListener("click", () => {
  if (sicCodesForRun.length > 0) runSearch(sicCodesForRun);
});

backButton.addEventListener("click", () => {
  window.SicApp?.showSicView?.();
});

window.SicApp = window.SicApp || {};
window.SicApp.showCompaniesView = (sicCodes) => {
  document.getElementById("view-sic").hidden = true;
  document.getElementById("view-companies").hidden = false;
  runSearch(sicCodes);
};
