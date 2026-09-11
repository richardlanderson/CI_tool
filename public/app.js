const state = {
  query: "",
  mode: "describe", // "describe" | "pick" — which entry mode last produced the current results, for retry
  pickedCode: null, // { code, description } when mode === "pick"
  status: "idle", // idle | loading | success | error
  sections: [],
  errorMessage: undefined,
};

const page = document.getElementById("view-sic");
const form = document.getElementById("search-form");
const input = document.getElementById("query-input");
const submitButton = document.getElementById("submit-button");
const loadingState = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const errorMessageEl = document.getElementById("error-message");
const retryButton = document.getElementById("retry-button");
const emptyState = document.getElementById("empty-state");
const resultsActionsEl = document.getElementById("results-actions");
const resultsEl = document.getElementById("results");
const findCompaniesButton = document.getElementById("find-companies-button");

const modeTabDescribe = document.getElementById("mode-tab-describe");
const modeTabPick = document.getElementById("mode-tab-pick");
const describeModePanel = document.getElementById("describe-mode");
const pickModePanel = document.getElementById("pick-mode");
const pickForm = document.getElementById("pick-form");
const pickSubmitButton = document.getElementById("pick-submit-button");
const comboboxEl = document.getElementById("sic-combobox");
const comboboxInput = document.getElementById("combobox-input");
const comboboxList = document.getElementById("combobox-list");

function render() {
  page.classList.toggle("has-results", state.status !== "idle");

  loadingState.hidden = state.status !== "loading";
  errorState.hidden = state.status !== "error";
  emptyState.hidden = !(state.status === "success" && state.sections.length === 0);
  const hasResults = state.status === "success" && state.sections.length > 0;
  resultsEl.hidden = !hasResults;
  resultsActionsEl.hidden = !hasResults;

  if (state.status === "error") {
    errorMessageEl.textContent = state.errorMessage || "Something went wrong.";
  }

  if (hasResults) {
    renderResults();
  }
}

function renderResults() {
  resultsEl.innerHTML = "";

  for (const section of state.sections) {
    const block = document.createElement("div");
    block.className = "section-block";
    block.dataset.sectionLetter = section.sectionLetter;

    const header = document.createElement("div");
    header.className = "section-header";
    header.textContent = `Section ${section.sectionLetter} — ${section.sectionName}`;
    block.appendChild(header);

    for (const code of section.codes) {
      const row = document.createElement("div");
      row.className = "code-row";
      row.dataset.code = code.code;

      const codeEl = document.createElement("span");
      codeEl.className = "code-value";
      codeEl.textContent = code.code;

      const descEl = document.createElement("span");
      descEl.className = "code-description";
      descEl.textContent = code.description;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-button";
      deleteBtn.setAttribute("aria-label", `Remove SIC code ${code.code}`);
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", () => {
        deleteCode(section.sectionLetter, code.code);
      });

      row.append(codeEl, descEl, deleteBtn);
      block.appendChild(row);
    }

    resultsEl.appendChild(block);
  }
}

function deleteCode(sectionLetter, code) {
  const section = state.sections.find((s) => s.sectionLetter === sectionLetter);
  if (!section) return;

  section.codes = section.codes.filter((c) => c.code !== code);
  state.sections = state.sections.filter((s) => s.codes.length > 0);

  render();
}

function mapSections(rawSections) {
  return rawSections.map((section) => ({
    sectionLetter: section.section_letter,
    sectionName: section.section_name,
    codes: Array.isArray(section.codes) ? section.codes : [],
  }));
}

async function postForSections(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  const sections = Array.isArray(body?.sections) ? body.sections : null;
  if (!sections) {
    throw new Error("The AI response was not in the expected format.");
  }

  return mapSections(sections);
}

async function runSearch(query) {
  state.mode = "describe";
  state.query = query;
  state.status = "loading";
  state.errorMessage = undefined;
  render();

  try {
    state.sections = await postForSections("/api/sic-codes", { query });
    state.status = "success";
  } catch (err) {
    state.status = "error";
    state.errorMessage = err instanceof Error ? err.message : "Something went wrong.";
  }

  render();
}

function mergeSelectedCode(sections, picked) {
  const info = sicCodeIndex?.get(picked.code);
  if (!info) return sections;

  const existing = sections.find((s) => s.sectionLetter === info.sectionLetter);
  if (existing) {
    if (!existing.codes.some((c) => c.code === picked.code)) {
      existing.codes.unshift({ code: picked.code, description: picked.description });
    }
    return sections;
  }

  return [
    {
      sectionLetter: info.sectionLetter,
      sectionName: info.sectionName,
      codes: [{ code: picked.code, description: picked.description }],
    },
    ...sections,
  ];
}

async function runRelatedSearch(picked) {
  state.mode = "pick";
  state.pickedCode = picked;
  state.query = `${picked.code} — ${picked.description}`;
  state.status = "loading";
  state.errorMessage = undefined;
  render();

  try {
    const sections = await postForSections("/api/related-sic-codes", picked);
    state.sections = mergeSelectedCode(sections, picked);
    state.status = "success";
  } catch (err) {
    state.status = "error";
    state.errorMessage = err instanceof Error ? err.message : "Something went wrong.";
  }

  render();
}

input.addEventListener("input", () => {
  submitButton.disabled = input.value.trim().length === 0;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  runSearch(query);
});

retryButton.addEventListener("click", () => {
  if (state.mode === "pick" && state.pickedCode) {
    runRelatedSearch(state.pickedCode);
  } else if (state.query) {
    runSearch(state.query);
  }
});

function setMode(mode) {
  const isDescribe = mode === "describe";
  describeModePanel.hidden = !isDescribe;
  pickModePanel.hidden = isDescribe;
  modeTabDescribe.classList.toggle("active", isDescribe);
  modeTabDescribe.setAttribute("aria-selected", String(isDescribe));
  modeTabPick.classList.toggle("active", !isDescribe);
  modeTabPick.setAttribute("aria-selected", String(!isDescribe));
}

modeTabDescribe.addEventListener("click", () => setMode("describe"));
modeTabPick.addEventListener("click", () => setMode("pick"));

pickForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedPickedCode) return;
  runRelatedSearch(selectedPickedCode);
});

findCompaniesButton.addEventListener("click", () => {
  const sicCodes = state.sections.flatMap((section) =>
    section.codes.map((c) => ({ code: c.code, description: c.description })),
  );
  window.SicApp?.showCompaniesView?.(sicCodes);
});

window.SicApp = window.SicApp || {};
window.SicApp.showSicView = () => {
  document.getElementById("view-sic").hidden = false;
  document.getElementById("view-companies").hidden = true;
};

// --- "Pick a SIC code" combobox, backed by the official condensed SIC code list ---

let sicCodeList = null; // flat: [{ code, description, sectionLetter, sectionName }]
let sicCodeIndex = null; // code -> { sectionLetter, sectionName, description }
let selectedPickedCode = null; // { code, description }
let highlightedIndex = -1;

async function loadSicCodeList() {
  try {
    const response = await fetch("/data/sic-codes.json");
    const data = await response.json();
    sicCodeList = data.sections.flatMap((section) =>
      section.codes.map((c) => ({
        code: c.code,
        description: c.description,
        sectionLetter: section.sectionLetter,
        sectionName: section.sectionName,
      })),
    );
    sicCodeIndex = new Map(sicCodeList.map((c) => [c.code, c]));
  } catch (err) {
    console.error("Failed to load SIC code list:", err);
  }
}

function filterSicCodes(query) {
  if (!sicCodeList) return [];
  const q = query.trim().toLowerCase();
  if (!q) return sicCodeList;
  return sicCodeList.filter((c) => c.code.startsWith(q) || c.description.toLowerCase().includes(q));
}

function renderComboboxList(query) {
  comboboxList.innerHTML = "";
  highlightedIndex = -1;

  if (!sicCodeList) {
    const loading = document.createElement("div");
    loading.className = "combobox-empty";
    loading.textContent = "Loading SIC codes…";
    comboboxList.appendChild(loading);
    return;
  }

  const matches = filterSicCodes(query);
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "combobox-empty";
    empty.textContent = "No matching SIC codes.";
    comboboxList.appendChild(empty);
    return;
  }

  let currentSection = null;
  for (const item of matches) {
    if (item.sectionLetter !== currentSection) {
      currentSection = item.sectionLetter;
      const header = document.createElement("div");
      header.className = "combobox-group-header";
      header.textContent = `Section ${item.sectionLetter} — ${item.sectionName}`;
      comboboxList.appendChild(header);
    }

    const option = document.createElement("div");
    option.className = "combobox-option";
    option.setAttribute("role", "option");

    const codeEl = document.createElement("span");
    codeEl.className = "combobox-option-code";
    codeEl.textContent = item.code;

    const descEl = document.createElement("span");
    descEl.className = "combobox-option-desc";
    descEl.textContent = item.description;

    option.append(codeEl, descEl);
    option.addEventListener("click", () => selectSicCode(item));
    comboboxList.appendChild(option);
  }
}

function selectSicCode(item) {
  selectedPickedCode = { code: item.code, description: item.description };
  comboboxInput.value = `${item.code} — ${item.description}`;
  closeComboboxList();
  pickSubmitButton.disabled = false;
}

function openComboboxList() {
  comboboxList.hidden = false;
  comboboxInput.setAttribute("aria-expanded", "true");
}

function closeComboboxList() {
  comboboxList.hidden = true;
  comboboxInput.setAttribute("aria-expanded", "false");
}

function updateHighlight(options) {
  options.forEach((o, i) => o.classList.toggle("highlighted", i === highlightedIndex));
  options[highlightedIndex]?.scrollIntoView({ block: "nearest" });
}

comboboxInput.addEventListener("focus", () => {
  renderComboboxList(comboboxInput.value);
  openComboboxList();
});

comboboxInput.addEventListener("click", () => {
  if (comboboxList.hidden) {
    renderComboboxList(comboboxInput.value);
    openComboboxList();
  }
});

comboboxInput.addEventListener("input", () => {
  selectedPickedCode = null;
  pickSubmitButton.disabled = true;
  renderComboboxList(comboboxInput.value);
  openComboboxList();
});

comboboxInput.addEventListener("keydown", (event) => {
  const options = [...comboboxList.querySelectorAll(".combobox-option")];
  if (options.length === 0) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightedIndex = Math.min(highlightedIndex + 1, options.length - 1);
    updateHighlight(options);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightedIndex = Math.max(highlightedIndex - 1, 0);
    updateHighlight(options);
  } else if (event.key === "Enter") {
    if (highlightedIndex >= 0 && options[highlightedIndex]) {
      event.preventDefault();
      options[highlightedIndex].click();
    }
  } else if (event.key === "Escape") {
    closeComboboxList();
  }
});

document.addEventListener("click", (event) => {
  if (!comboboxEl.contains(event.target)) closeComboboxList();
});

loadSicCodeList();

render();
