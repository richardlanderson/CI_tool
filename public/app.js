const state = {
  query: "",
  status: "idle", // idle | loading | success | error
  sections: [],
  errorMessage: undefined,
};

const page = document.getElementById("page");
const form = document.getElementById("search-form");
const input = document.getElementById("query-input");
const submitButton = document.getElementById("submit-button");
const loadingState = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const errorMessageEl = document.getElementById("error-message");
const retryButton = document.getElementById("retry-button");
const emptyState = document.getElementById("empty-state");
const resultsEl = document.getElementById("results");

function render() {
  page.classList.toggle("has-results", state.status !== "idle");

  loadingState.hidden = state.status !== "loading";
  errorState.hidden = state.status !== "error";
  emptyState.hidden = !(state.status === "success" && state.sections.length === 0);
  resultsEl.hidden = !(state.status === "success" && state.sections.length > 0);

  if (state.status === "error") {
    errorMessageEl.textContent = state.errorMessage || "Something went wrong.";
  }

  if (state.status === "success" && state.sections.length > 0) {
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

async function runSearch(query) {
  state.query = query;
  state.status = "loading";
  state.errorMessage = undefined;
  render();

  try {
    const response = await fetch("/api/sic-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(body?.error || `Request failed (${response.status})`);
    }

    const sections = Array.isArray(body?.sections) ? body.sections : null;
    if (!sections) {
      throw new Error("The AI response was not in the expected format.");
    }

    state.sections = sections.map((section) => ({
      sectionLetter: section.section_letter,
      sectionName: section.section_name,
      codes: Array.isArray(section.codes) ? section.codes : [],
    }));
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
  if (state.query) runSearch(state.query);
});

render();
