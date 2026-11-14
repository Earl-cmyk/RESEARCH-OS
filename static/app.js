const state = {
  user: null,
  csrf: null,
  projects: [],
  project: null,
  view: "dashboard",
  renderToken: 0,
  authMode: "login",
  statisticsTable: null,
  activeEditor: null,
  savedSelection: null,
  documents: [],
  sources: [],
  appendices: [],
};

const viewTitles = {
  dashboard: ["RESEARCH WORKSPACE", "Dashboard"],
  projects: ["YOUR WORKSPACE", "My Research"],
  writing: ["WRITING LAB", "Writing Lab"],
  literature: ["RESEARCH INTELLIGENCE", "Literature Review"],
  statistics: ["DETERMINISTIC ANALYSIS", "Statistical Lab"],
  builder: ["MANUSCRIPT", "Document Builder"],
  appendices: ["PROJECT MATERIALS", "Appendices"],
  references: ["APA 7TH EDITION", "References"],
};

const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const viewRoot = document.querySelector("#view-root");
const toastElement = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function notify(message, error = false) {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", error);
  toastElement.classList.add("visible");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toastElement.classList.remove("visible"), 3600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body !== undefined) headers.set("Content-Type", "application/json");
  if (state.csrf && options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
    headers.set("X-CSRF-Token", state.csrf);
  }
  let response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  } catch (error) {
    if (error instanceof TypeError) {
      const port = window.location.port;
      const startCommand = port
        ? `$env:PORT='${port}'; .\\.venv\\Scripts\\python.exe app.py`
        : "python app.py";
      throw new Error(`Cannot connect to the Research OS server. Start it from the project folder in PowerShell with \`${startCommand}\`, then retry.`);
    }
    throw error;
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const message = payload?.error?.message || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function showAuth() {
  authScreen.hidden = false;
  appShell.hidden = true;
}

function showApp() {
  authScreen.hidden = true;
  appShell.hidden = false;
  document.querySelector("#user-name").textContent = state.user.full_name;
  document.querySelector("#user-avatar").textContent = state.user.full_name.trim().charAt(0).toUpperCase();
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === mode);
  });
  document.querySelector("#name-field").hidden = mode !== "register";
  const password = document.querySelector('#auth-form [name="password"]');
  password.autocomplete = mode === "register" ? "new-password" : "current-password";
  password.required = true;
  password.minLength = mode === "register" ? 12 : 1;
  document.querySelector("#password-hint").hidden = mode !== "register";
  document.querySelector("#auth-submit").textContent = mode === "register" ? "Create private workspace" : "Sign in";
  document.querySelector("#auth-error").textContent = "";
}

async function authenticate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  document.querySelector("#auth-error").textContent = "";
  try {
    const endpoint = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(endpoint, { method: "POST", body: jsonBody(values) });
    state.user = result.user;
    state.csrf = result.csrf_token;
    showApp();
    await loadProjects();
    await renderView("dashboard");
  } catch (error) {
    document.querySelector("#auth-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadProjects() {
  const result = await api("/api/projects");
  state.projects = result.projects;
  const savedId = localStorage.getItem("research-os-project");
  state.project = state.projects.find((project) => project.id === savedId) || state.projects[0] || null;
  renderProjectSelect();
}

function renderProjectSelect() {
  const select = document.querySelector("#project-select");
  if (!state.projects.length) {
    select.innerHTML = '<option value="">No project selected</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = state.projects.map((project) =>
    `<option value="${escapeHtml(project.id)}" ${project.id === state.project?.id ? "selected" : ""}>${escapeHtml(project.project_title)}</option>`
  ).join("");
}

function setProject(projectId) {
  state.project = state.projects.find((project) => project.id === projectId) || null;
  state.documents = [];
  state.sources = [];
  state.appendices = [];
  if (state.project) localStorage.setItem("research-os-project", state.project.id);
  renderProjectSelect();
  renderView(state.view);
}

async function loadProjectData() {
  if (!state.project) return;
  const projectId = state.project.id;
  const [documents, sources, appendices] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(projectId)}/documents`),
    api(`/api/projects/${encodeURIComponent(projectId)}/sources`),
    api(`/api/projects/${encodeURIComponent(projectId)}/appendices`),
  ]);
  if (state.project?.id !== projectId) return;
  state.documents = documents.documents;
  state.sources = sources.sources;
  state.appendices = appendices.appendices;
}

function currentDocument() {
  return state.documents[0] || null;
}

function documentSections() {
  const document = currentDocument();
  const content = document?.content;
  if (content && Array.isArray(content.sections)) return content.sections;
  return [{ id: "main-text", title: document?.document_title || "Research Manuscript", content: content?.text || "" }];
}

function updateHeader(view) {
  const values = viewTitles[view] || ["RESEARCH WORKSPACE", "Dashboard"];
  document.querySelector("#page-kicker").textContent = values[0];
  document.querySelector("#page-title").textContent = values[1];
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
}

async function renderView(view) {
  const renderToken = ++state.renderToken;
  state.view = view;
  updateHeader(view);
  document.querySelector("#notice").hidden = true;
  if (state.project && ["dashboard", "builder", "literature", "statistics", "appendices", "references"].includes(view)) {
    viewRoot.innerHTML = '<div class="empty-state">Loading your project…</div>';
    try {
      await loadProjectData();
    } catch (error) {
      if (renderToken !== state.renderToken) return;
      viewRoot.innerHTML = `<div class="empty-state"><p>${escapeHtml(error.message)}</p><button class="button" id="retry-view">Retry</button></div>`;
      document.querySelector("#retry-view").addEventListener("click", () => renderView(view));
      return;
    }
  }
  if (renderToken !== state.renderToken) return;
  if (!state.project && view !== "projects") {
    viewRoot.innerHTML = renderNoProject();
    bindProjectForm();
    return;
  }
  const renderers = {
    dashboard: renderDashboard,
    projects: renderProjects,
    writing: renderWriting,
    literature: renderLiterature,
    statistics: renderStatistics,
    builder: renderBuilder,
    appendices: renderAppendices,
    references: renderReferences,
  };
  viewRoot.innerHTML = (renderers[view] || renderDashboard)();
  bindView(view);
}

function renderNoProject() {
  return `<div class="welcome"><div><p class="eyebrow">START HERE</p><h2>Make room for your next research idea.</h2><p>Create a project to organize your manuscript, literature, and research materials.</p></div></div>
    <div class="panel" style="margin-top:16px"><h2>Create a research project</h2>${projectForm()}</div>`;
}

function projectForm() {
  return `<form id="project-form" class="form-grid">
    <label class="full">Project title<input name="title" maxlength="240" required placeholder="e.g. Student experiences with…"></label>
    <label>Research field<input name="field" maxlength="160" placeholder="Education, public health…"></label>
    <label>Research type<select name="research_type"><option>Quantitative</option><option>Qualitative</option><option selected>Mixed Methods</option><option>Experimental</option><option>Descriptive</option></select></label>
    <label class="full">Institution<input name="institution" maxlength="200" placeholder="Optional"></label>
    <div class="full"><button class="button primary" type="submit">Create project</button></div>
  </form>`;
}

function renderDashboard() {
  const project = state.project;
  const sections = documentSections();
  const words = sections.reduce((total, section) => total + cleanEditorText(section.content || "").trim().split(/\s+/).filter(Boolean).length, 0);
  return `<div class="welcome"><div><p class="eyebrow">MANUSCRIPT DASHBOARD</p><h2>${escapeHtml(project.project_title)}</h2><p>${escapeHtml(project.research_field || "Research field not set")} · ${escapeHtml(project.research_type)} · ${escapeHtml(project.institution || "Institution not set")}</p></div><button class="button" data-go="builder">Open full manuscript →</button></div>
    <div class="stats-grid">
      <div class="metric"><span>Manuscript sections</span><strong>${sections.length}</strong></div>
      <div class="metric"><span>Words in manuscript</span><strong id="manuscript-word-count">${words.toLocaleString()}</strong></div>
      <div class="metric"><span>Saved scholarly sources</span><strong>${state.sources.length}</strong></div>
      <div class="metric"><span>Appendix files</span><strong>${state.appendices.length}</strong></div>
    </div>
    ${renderManuscriptEditor("Preliminary manuscript", false)}
    <div class="section-heading"><h2>Material included in your manuscript export</h2></div>
    <div class="card-grid">
      <article class="context-panel"><h3>Saved literature (${state.sources.length})</h3>${state.sources.length
        ? `<ol class="preview-list">${state.sources.map((source) => `<li>${escapeHtml(sourceReference(source))}</li>`).join("")}</ol>`
        : '<p class="muted">Save scholarly sources in Literature Review to include a reference list in your export.</p>'}
        <button class="button small" data-go="literature">Manage literature</button></article>
      <article class="context-panel"><h3>Appendices (${state.appendices.length})</h3>${state.appendices.length
        ? `<ul class="preview-list">${state.appendices.map((appendix) => `<li>Appendix ${escapeHtml(appendix.appendix_letter)}: ${escapeHtml(appendix.title)}</li>`).join("")}</ul>`
        : '<p class="muted">Upload project materials in Appendices to include them in your export.</p>'}
        <button class="button small" data-go="appendices">Manage appendices</button></article>
    </div>
    <div class="section-heading"><h2>Research workspace</h2><button class="button small" data-go="projects">Manage projects</button></div>
    <div class="card-grid">
      ${toolCard("Writing Lab", "Review text, explore writing patterns, correct grammar, or summarize a draft.", "writing", "Open writing tools")}
      ${toolCard("Literature Review", "Search Crossref records and save source metadata to this project.", "literature", "Search scholarly literature")}
      ${toolCard("Statistical Lab", "Run deterministic descriptive and inferential calculations with assumptions.", "statistics", "Open statistical tools")}
      ${toolCard("APA References", "Review a generated reference list and build in-text citations.", "references", "Manage references")}
    </div>`;
}

function cleanEditorText(value) {
  const element = document.createElement("div");
  element.innerHTML = String(value || "");
  return element.textContent || "";
}

function editorContent(value) {
  const text = String(value || "");
  if (/<\/?[a-z][^>]*>/i.test(text)) return text;
  return `<p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`;
}

function editorToolbar() {
  return `<div class="toolbar editor-toolbar">
    <button class="button small" type="button" data-editor-command="bold" aria-label="Bold"><strong>B</strong></button>
    <button class="button small" type="button" data-editor-command="italic" aria-label="Italic"><em>I</em></button>
    <button class="button small" type="button" data-editor-command="underline" aria-label="Underline"><u>U</u></button>
    <button class="button small" type="button" data-editor-command="insertUnorderedList" aria-label="Bulleted list">• List</button>
    <button class="button small" type="button" data-editor-command="insertOrderedList" aria-label="Numbered list">1. List</button>
    <select aria-label="Text style" data-editor-block><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
    <select aria-label="Font family" data-editor-font><option>Georgia</option><option>Arial</option><option>Times New Roman</option><option>Verdana</option></select>
    <select aria-label="Font size" data-editor-size><option value="3">Normal</option><option value="2">Small</option><option value="4">Large</option><option value="5">Extra large</option></select>
    <label class="font-color">Text color<input type="color" value="#34242a" aria-label="Text color" data-editor-color></label>
  </div>`;
}

function renderManuscriptEditor(title, includeExports = true) {
  if (!currentDocument()) return '<div class="empty-state">This project does not have a document yet.</div>';
  const sections = documentSections();
  const exportTools = includeExports
    ? '<button class="button" id="validate-document">Validate</button><button class="button" data-export="pdf">Export PDF</button><button class="button primary" data-export="docx">Export DOCX</button>'
    : '<span class="small-label">Autosaves to this project</span>';
  return `<div class="panel manuscript-workspace"><div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p class="muted">Edit your draft here. Saved literature and appendix records are included in the references and appendix list when exported.</p></div><div class="toolbar">${exportTools}</div></div>
    ${includeExports ? '<div id="document-validation" class="notice" hidden></div>' : ""}
    ${editorToolbar()}
    <div class="toolbar" style="margin:12px 0"><span id="save-status" class="small-label">All changes saved</span><span class="spacer"></span><button class="button small" id="add-section" type="button">Add section</button></div>
    <div id="document-sections">${sections.map((section, index) => `<details class="section-editor" open data-section-index="${index}">
      <summary><span class="section-title">${escapeHtml(section.title || `Section ${index + 1}`)}</span></summary>
      <div class="form-grid" style="padding:14px"><label>Heading<input class="section-heading-input" maxlength="240" value="${escapeHtml(section.title || "")}"></label><label>Heading level<select class="section-level">${[1, 2, 3].map((level) => `<option value="${level}" ${Number(section.level || 1) === level ? "selected" : ""}>Heading ${level}</option>`).join("")}</select></label>
      <div class="full section-content editor" contenteditable="true" role="textbox" aria-label="${escapeHtml(section.title || `Section ${index + 1}`)} content" aria-multiline="true" spellcheck="true">${editorContent(section.content)}</div>
      <div class="full toolbar"><button class="button small danger remove-section" type="button">Remove section</button></div></div></details>`).join("")}</div></div>`;
}

function toolCard(title, description, view, action) {
  return `<article class="card project-card"><div><h3>${title}</h3><p class="muted">${description}</p></div><div class="card-footer"><span class="small-label">PROJECT: ${escapeHtml(state.project?.project_title || "")}</span><button class="button small" data-go="${view}">${action} →</button></div></article>`;
}

function renderProjects() {
  const cards = state.projects.map((project) => `<article class="card project-card">
    <div><p class="eyebrow">${escapeHtml(project.research_type)} · ${escapeHtml(project.research_status)}</p><h3>${escapeHtml(project.project_title)}</h3>
    <p class="muted">${escapeHtml(project.research_field || "Research field not set")} · ${escapeHtml(project.institution || "Institution not set")}</p></div>
    <div class="card-footer"><span class="small-label">${Number(project.source_count) || 0} saved sources</span><div class="toolbar">
      <button class="button small" data-open-project="${escapeHtml(project.id)}">Open project</button>
      <button class="button small danger" data-delete-project="${escapeHtml(project.id)}">Delete</button>
    </div></div></article>`).join("");
  return `<div class="section-heading"><h2>Your research projects</h2></div>
    ${state.projects.length ? `<div class="card-grid">${cards}</div>` : '<div class="empty-state">No projects yet. Create one to begin.</div>'}
    <div class="panel" style="margin-top:20px"><h2>Create a project</h2>${projectForm()}</div>`;
}

function renderWriting() {
  return `<div class="panel"><div class="section-heading"><div><h2>Writing workspace</h2><p class="muted">AI-assisted suggestions are probabilistic; inspect and accept changes yourself.</p></div></div>
    <label>Text to analyze<textarea id="writing-input" class="editor" maxlength="30000" placeholder="Paste or type your research text here…"></textarea></label>
    <div class="toolbar">
      <button class="button primary" data-writing-action="grammar">Check grammar</button>
      <button class="button" data-writing-action="correct">Suggest corrections</button>
      <button class="button" data-writing-action="refine">Refine writing</button>
      <button class="button" data-writing-action="summary">Summarize</button>
      <button class="button" data-writing-action="analysis">Analyze writing patterns</button>
    </div>
    <div id="writing-options" class="form-grid" style="margin-top:15px">
      <label id="style-option">Writing style<select id="writing-style"><option>Formal academic</option><option>Concise academic</option><option>Explanatory academic</option><option>Technical</option><option>Simple and direct</option></select></label>
      <label id="length-option">Summary length<select id="summary-length"><option>short</option><option selected>medium</option><option>comprehensive</option></select></label>
    </div>
    <div id="writing-result" class="result-box" aria-live="polite"></div></div>`;
}

function renderLiterature() {
  return `<div class="panel"><h2>Search scholarly literature</h2><p>Search Crossref's bibliographic records. Metadata is returned by the source provider; abstracts may be unavailable.</p>
    <form id="literature-form" class="toolbar"><input name="q" required maxlength="500" placeholder="Topic, title, keyword, or author"><button class="button primary" type="submit">Search Crossref</button></form>
    <h3 style="margin-top:20px">Import references</h3><p>Import RIS or BibTeX exports from a reference manager. Imported metadata is unverified until checked against a provider record.</p>
    <form id="reference-import-form" class="toolbar"><input name="file" type="file" accept=".ris,.bib,.bibtex" required><button class="button" type="submit">Import references</button></form>
    <div id="reference-import-status" class="result-meta" aria-live="polite"></div>
    <div id="literature-results" class="result-list" style="margin-top:16px"></div></div>
    <div class="section-heading"><h2>Saved sources (${state.sources.length})</h2><button class="button primary" id="synthesize-literature" ${state.sources.length ? "" : "disabled"}>Draft literature synthesis</button></div>
    <p class="muted">AI-generated synthesis is a researcher-reviewed draft based only on saved source metadata and available abstracts.</p>
    <div id="literature-synthesis" class="result-list"></div>
    <div class="result-list">${state.sources.length ? state.sources.map(sourceCard).join("") : '<div class="empty-state">Saved project sources will appear here.</div>'}</div>`;
}

function sourceCard(source, saveButton = false) {
  const authors = (source.authors || []).map((author) => `${author.lastName || ""}${author.firstName ? `, ${author.firstName}` : ""}`).join("; ");
  const metadata = [authors, source.publication_year, source.journal, source.doi ? `DOI: ${source.doi}` : ""].filter(Boolean).join(" · ");
  const sourceUrl = safeHttpUrl(source.source_url);
  return `<article class="result-item"><h3>${escapeHtml(source.title)}</h3><p class="result-meta">${escapeHtml(metadata || "Author/date metadata unavailable")} ${source.metadata_verified ? "· Crossref record" : "· User-provided metadata"}</p>
    ${source.abstract ? `<p>${escapeHtml(source.abstract.replace(/<[^>]*>/g, " ").slice(0, 900))}</p>` : '<p class="result-meta">Abstract unavailable in the provider record.</p>'}
    <div class="toolbar">${sourceUrl ? `<a class="button small" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}
    ${saveButton ? `<button class="button small primary" data-save-source='${escapeHtml(JSON.stringify(source))}'>Save to project</button>` : ""}
    ${source.id && !saveButton ? `<button class="button small danger" data-delete-source="${escapeHtml(source.id)}">Remove</button>` : ""}</div></article>`;
}

function renderStatistics() {
  const methods = [
    ["descriptive", "Descriptive statistics"],
    ["slovin", "Slovin sample size"],
    ["pearson", "Pearson correlation"],
    ["spearman", "Spearman rank correlation (rho)"],
    ["one_sample_t", "One-sample t-test"],
    ["independent_t", "Independent samples t-test (Welch)"],
    ["paired_t", "Paired samples t-test"],
    ["mann_whitney", "Mann–Whitney U test"],
    ["one_way_anova", "One-way ANOVA"],
    ["kruskal_wallis", "Kruskal-Wallis H test"],
    ["chi_square", "Chi-square test of independence"],
  ];
  return `<div class="panel"><h2>Import spreadsheet data</h2><p>Upload CSV, XLS, or XLSX data (20 MB max). The selected sheet is processed temporarily for analysis and is not saved to your project.</p>
    <form id="statistics-import-form" class="toolbar"><input name="file" type="file" accept=".csv,.xls,.xlsx" required><button class="button" type="submit">Load data</button></form>
    <div id="statistics-import-status" class="result-meta" aria-live="polite"></div>
    <label id="statistics-sheet-label" hidden>Worksheet<select id="statistics-sheet"></select></label>
    <div id="statistics-preview" class="result-box" hidden></div></div>
    <div class="panel" style="margin-top:16px"><h2>Statistical calculation</h2><p>Calculations are deterministic. Review each method’s assumptions and the suitability of your data.</p>
    <div class="form-grid"><label>Method<select id="stat-method">${methods.map(([value, name]) =>
      `<option value="${value}">${name}</option>`).join("")}</select></label>
    <label>Data entry<select id="stat-source"><option value="manual">Enter values manually</option><option value="spreadsheet" ${state.statisticsTable ? "" : "disabled"}>Use imported spreadsheet</option></select></label></div>
    <div id="stat-inputs"></div><button class="button primary" id="run-stat">Calculate</button>
    <div id="stat-result" style="margin-top:16px"></div></div>`;
}

function needsAlpha(method) {
  return ["pearson", "spearman", "one_sample_t", "independent_t", "paired_t", "mann_whitney", "one_way_anova", "kruskal_wallis", "chi_square"].includes(method);
}

function alphaInput() {
  return '<label>Significance level (alpha)<input id="alpha" type="number" min="0.001" max="0.999" step="0.001" value="0.05"></label>';
}

function statInputs(method) {
  const alpha = needsAlpha(method) ? alphaInput() : "";
  if (method === "descriptive") return '<label>Numeric values (comma or newline separated)<textarea id="stat-values" placeholder="12, 14, 17, 18"></textarea></label>';
  if (method === "slovin") return '<div class="form-grid"><label>Population size<input id="population" type="number" min="1" step="1"></label><label>Margin of error (0–1)<input id="margin" type="number" min="0.001" max="0.999" step="0.001" value="0.05"></label></div>';
  if (method === "one_sample_t") return `<div class="form-grid"><label>Sample values<textarea id="stat-values"></textarea></label><label>Hypothesized population mean<input id="population-mean" type="number" step="any" value="0"></label>${alpha}</div>`;
  if (["pearson", "spearman", "paired_t"].includes(method)) return `<div class="form-grid"><label>${method === "paired_t" ? "Measurement 1" : "X values"}<textarea id="stat-x"></textarea></label><label>${method === "paired_t" ? "Measurement 2" : "Y values"}<textarea id="stat-y"></textarea></label>${alpha}</div>`;
  if (["independent_t", "mann_whitney"].includes(method)) return `<div class="form-grid"><label>Group A values<textarea id="group-a"></textarea></label><label>Group B values<textarea id="group-b"></textarea></label>${alpha}</div>`;
  if (method === "chi_square") return `<label>Observed contingency counts (one row per line; comma-separated)<textarea id="contingency-table" placeholder="20, 10&#10;12, 18"></textarea></label>${alpha}`;
  if (["one_way_anova", "kruskal_wallis"].includes(method)) return `<label>Independent groups (one group per line; values separated by commas)<textarea id="groups" placeholder="12, 14, 16&#10;18, 19, 20&#10;21, 22, 24"></textarea></label>${alpha}`;
  return "";
}

function spreadsheetStatInputs(method, table) {
  const numericColumns = table.headers.filter((_, column) => table.rows.some((row) =>
    row[column] !== null && row[column] !== ""
  ) && table.rows.every((row) =>
    row[column] === null || row[column] === "" || Number.isFinite(Number(row[column]))
  ));
  const numericOptions = numericColumns.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  const categoryOptions = table.headers.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  const numericSelect = (id, label) => `<label>${label}<select id="${id}">${numericOptions}</select></label>`;
  const categorySelect = (id, label) => `<label>${label}<select id="${id}">${categoryOptions}</select></label>`;
  const alpha = needsAlpha(method) ? alphaInput() : "";
  if (!numericOptions && method !== "chi_square" && method !== "slovin") {
    return '<p class="empty-state">No numeric columns were detected. Choose a sheet with numeric observations or enter values manually.</p>';
  }
  if (method === "descriptive" || method === "one_sample_t") {
    return `<div class="form-grid">${numericSelect("column-values", "Numeric values")}${method === "one_sample_t" ? '<label>Hypothesized population mean<input id="population-mean" type="number" step="any" value="0"></label>' : ""}${alpha}</div>`;
  }
  if (["pearson", "spearman", "paired_t"].includes(method)) {
    return `<div class="form-grid">${numericSelect("column-x", method === "paired_t" ? "Measurement 1" : "X variable")}${numericSelect("column-y", method === "paired_t" ? "Measurement 2" : "Y variable")}${alpha}</div>`;
  }
  if (["independent_t", "mann_whitney", "one_way_anova", "kruskal_wallis"].includes(method)) {
    return `<div class="form-grid">${numericSelect("column-values", "Numeric outcome")}${categorySelect("column-group", "Group/category column")}${alpha}</div>`;
  }
  if (method === "chi_square") {
    return `<div class="form-grid">${categorySelect("column-row", "Row category")}${categorySelect("column-column", "Column category")}${alpha}</div>`;
  }
  return `<p class="muted">Slovin sample size uses population size and margin of error; select manual data entry for this formula.</p>${statInputs(method)}`;
}

function parseNumbers(selector, label) {
  const text = document.querySelector(selector).value.trim();
  return parseNumberText(text, label);
}

function parseNumberText(text, label) {
  if (!text) throw new Error(`${label} is required.`);
  const values = text.split(/[,\s;]+/).filter(Boolean).map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error(`${label} must contain only numbers.`);
  return values;
}

function renderBuilder() {
  return renderManuscriptEditor(currentDocument()?.document_title || "Research Manuscript", true);
}

function renderAppendices() {
  return `<div class="panel"><h2>Add appendix material</h2><p>Original files are stored separately from the editable manuscript. Supported types: PDF, DOCX, PNG/JPG, Excel, CSV, and TXT (20 MB max).</p>
    <form id="appendix-form"><div class="form-grid">
      <label>File<input name="file" type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt" required></label>
      <label>Title<input name="title" maxlength="240" placeholder="e.g. Research questionnaire"></label>
      <label class="full">Description<input name="description" maxlength="2000" placeholder="Optional notes"></label>
      <div class="full"><button class="button primary" type="submit">Upload appendix</button></div></div></form></div>
    <div class="section-heading"><h2>Appendix repository</h2></div>
    <div class="result-list">${state.appendices.length ? state.appendices.map((appendix) => `<article class="result-item">
      <h3>APPENDIX ${escapeHtml(appendix.appendix_letter)} · ${escapeHtml(appendix.title)}</h3>
      <p class="result-meta">${escapeHtml(appendix.original_filename)} · ${(appendix.file_size / 1024).toFixed(1)} KB · ${escapeHtml(appendix.created_at)}</p>
      <p>${escapeHtml(appendix.description || "No description provided.")}</p>
      <div class="toolbar"><a class="button small" href="/api/appendices/${encodeURIComponent(appendix.id)}/download">Download original</a>
      ${/\.(pdf|png|jpe?g|txt|csv)$/i.test(appendix.original_filename) ? `<button class="button small" data-preview-appendix="${escapeHtml(appendix.id)}" data-preview-filename="${escapeHtml(appendix.original_filename)}">Preview</button>` : ""}
      <button class="button small danger" data-delete-appendix="${escapeHtml(appendix.id)}">Remove</button></div></article>`).join("") : '<div class="empty-state">Appendices saved to this project will appear here.</div>'}</div>`;
}

function renderReferences() {
  return `<div class="panel"><h2>Generate an in-text citation</h2><p>In-text citations and reference entries use deterministic APA-style formatting. Verify each record against the original publication.</p>
    <form id="citation-form" class="form-grid">
      <label>Author surnames (comma-separated)<input name="authors" placeholder="Smith, Jones"></label>
      <label>Publication year<input name="year" type="number" min="1" max="3000" placeholder="2024"></label>
      <label>Citation style<select name="style"><option value="parenthetical">Parenthetical</option><option value="narrative">Narrative</option></select></label>
      <label>Title<input name="title" maxlength="1000" placeholder="Article or book title"></label>
      <label>Journal or publisher<input name="journal" maxlength="500"></label>
      <label>DOI<input name="doi" maxlength="300" placeholder="10.xxxx/xxxxx"></label>
      <label class="full">Source URL<input name="source_url" maxlength="2000" type="url"></label>
      <div class="full"><button class="button primary" type="submit">Generate citation</button></div></form>
    <div id="citation-output" class="result-box" style="margin-top:14px"></div></div>
    <div class="section-heading"><h2>Project reference list (${state.sources.length})</h2><button class="button small" id="copy-references">Copy references</button></div>
    ${state.sources.length ? `<div class="panel"><ol class="reference-list">${state.sources.map((source) => `<li>${escapeHtml(sourceReference(source))}</li>`).join("")}</ol></div>` : '<div class="empty-state">Save verified sources from Literature Review to build this project’s reference list.</div>'}`;
}

function sourceReference(source) {
  const authors = (source.authors || []).map((author) => {
    const initials = (author.firstName || "").split(/\s+/).filter(Boolean).map((part) => `${part[0]}.`).join(" ");
    return `${author.lastName || ""}${initials ? `, ${initials}` : ""}`;
  });
  let authorText = "Anonymous";
  if (authors.length === 1) authorText = authors[0];
  else if (authors.length === 2) authorText = `${authors[0]}, & ${authors[1]}`;
  else if (authors.length > 2) authorText = `${authors.slice(0, 19).join(", ")}, & ${authors[authors.length - 1]}`;
  const year = source.publication_year || "n.d.";
  const sourceName = source.journal || source.publisher || "";
  const link = source.doi ? `https://doi.org/${source.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : source.source_url || "";
  return `${authorText} (${year}). ${source.title}.${sourceName ? ` ${sourceName}.` : ""}${link ? ` ${link}` : ""}`;
}

function bindProjectForm() {
  const form = document.querySelector("#project-form");
  if (form) form.addEventListener("submit", createProject);
}

async function createProject(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/api/projects", { method: "POST", body: jsonBody(data) });
    await loadProjects();
    setProject(result.project.id);
    notify("Research project created.");
  } catch (error) {
    notify(error.message, true);
  }
}

function bindView(view) {
  viewRoot.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => renderView(button.dataset.go)));
  if (view === "dashboard") bindBuilder();
  if (view === "projects") {
    bindProjectForm();
    viewRoot.querySelectorAll("[data-open-project]").forEach((button) => button.addEventListener("click", () => setProject(button.dataset.openProject)));
    viewRoot.querySelectorAll("[data-delete-project]").forEach((button) => button.addEventListener("click", () => deleteProject(button.dataset.deleteProject)));
  }
  if (view === "writing") bindWriting();
  if (view === "literature") bindLiterature();
  if (view === "statistics") bindStatistics();
  if (view === "builder") bindBuilder();
  if (view === "appendices") bindAppendices();
  if (view === "references") bindReferences();
}

async function deleteProject(projectId) {
  if (!confirm("Delete this project, its sources, documents, and uploaded files? This cannot be undone.")) return;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    localStorage.removeItem("research-os-project");
    await loadProjects();
    await renderView(state.projects.length ? "projects" : "dashboard");
    notify("Project deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

function bindWriting() {
  viewRoot.querySelectorAll("[data-writing-action]").forEach((button) => button.addEventListener("click", async () => {
    const text = document.querySelector("#writing-input").value;
    const resultElement = document.querySelector("#writing-result");
    const action = button.dataset.writingAction;
    const endpoints = { grammar: "grammar", correct: "correct", refine: "refine", summary: "summarize", analysis: "ai-analysis" };
    const payload = { text };
    if (action === "refine") payload.style = document.querySelector("#writing-style").value;
    if (action === "summary") payload.length = document.querySelector("#summary-length").value;
    button.disabled = true;
    resultElement.textContent = "Analyzing…";
    try {
      const result = await api(`/api/writing/${endpoints[action]}`, { method: "POST", body: jsonBody(payload) });
      resultElement.textContent = JSON.stringify(result, null, 2);
      if (action === "correct" && result.corrected) resultElement.textContent = `Suggested correction:\n\n${result.corrected}\n\nChanges:\n${JSON.stringify(result.changes || [], null, 2)}`;
      if (action === "refine" && result.rewritten) resultElement.textContent = `Suggested rewrite:\n\n${result.rewritten}\n\nNotes:\n${(result.notes || []).join("\n")}`;
      if (action === "summary" && result.summary) resultElement.textContent = `${result.summary}\n\nKey points:\n${(result.keyPoints || []).join("\n")}`;
    } catch (error) {
      resultElement.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }));
}

function bindLiterature() {
  document.querySelector("#reference-import-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector("#reference-import-status");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "Importing references…";
    try {
      const result = await api(`/api/projects/${encodeURIComponent(state.project.id)}/sources/import`, {
        method: "POST",
        body: new FormData(form),
      });
      await renderView("literature");
      notify(`Imported ${result.imported} reference${result.imported === 1 ? "" : "s"}; skipped ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? "" : "s"}.`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#literature-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("q");
    const resultsElement = document.querySelector("#literature-results");
    resultsElement.innerHTML = '<div class="empty-state">Searching Crossref…</div>';
    try {
      const result = await api(`/api/literature/search?q=${encodeURIComponent(query)}`);
      resultsElement.innerHTML = result.results.length ? result.results.map((source) => sourceCard(source, true)).join("") : '<div class="empty-state">No results were returned for this search.</div>';
      resultsElement.querySelectorAll("[data-save-source]").forEach((button) => button.addEventListener("click", () => saveSource(button)));
    } catch (error) {
      resultsElement.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  });
  const synthesizeButton = document.querySelector("#synthesize-literature");
  synthesizeButton.addEventListener("click", async () => {
    const output = document.querySelector("#literature-synthesis");
    synthesizeButton.disabled = true;
    output.innerHTML = '<div class="empty-state">Drafting from saved source records…</div>';
    try {
      const result = await api(`/api/projects/${encodeURIComponent(state.project.id)}/literature/synthesize`, {
        method: "POST",
        body: "{}",
      });
      const themes = result.themes.map((theme) => `<li>${escapeHtml(theme)}</li>`).join("");
      const sourceKeys = result.sources.map((source) => `<li>[${escapeHtml(source.key)}] ${escapeHtml(source.citation)}</li>`).join("");
      output.innerHTML = `<article class="result-item"><h3>Draft synthesis</h3><p class="muted">Verify each claim and citation against the original publication before use.</p>
        <div class="result-box">${escapeHtml(result.synthesis)}</div>
        ${themes ? `<h4>Possible themes</h4><ul>${themes}</ul>` : ""}
        ${sourceKeys ? `<h4>Source key</h4><ol>${sourceKeys}</ol>` : ""}
        <div class="toolbar"><button class="button small primary" id="insert-synthesis">Insert into manuscript</button></div></article>`;
      output.querySelector("#insert-synthesis").addEventListener("click", () => insertSynthesis(result.synthesis));
    } catch (error) {
      output.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
      synthesizeButton.disabled = false;
    }
  });
  viewRoot.querySelectorAll("[data-delete-source]").forEach((button) => button.addEventListener("click", () => removeSource(button.dataset.deleteSource)));
}

async function insertSynthesis(synthesis) {
  const documentRecord = currentDocument();
  if (!documentRecord) return notify("Create a manuscript before inserting a synthesis.", true);
  const sections = documentSections().map((section) => ({ ...section }));
  sections.push({
    id: `section-${sections.length + 1}`,
    title: "Literature synthesis draft",
    content: `<p>${escapeHtml(synthesis).replace(/\n/g, "<br>")}</p>`,
    level: 1,
  });
  try {
    const result = await api(`/api/documents/${encodeURIComponent(documentRecord.id)}/autosave`, {
      method: "PUT",
      body: jsonBody({ content: { sections }, version: documentRecord.version }),
    });
    documentRecord.version = result.version;
    documentRecord.content = { sections };
    await renderView("dashboard");
    notify("Synthesis added to the manuscript; review and edit it before use.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function saveSource(button) {
  try {
    const data = JSON.parse(button.dataset.saveSource);
    await api(`/api/projects/${encodeURIComponent(state.project.id)}/sources`, { method: "POST", body: jsonBody(data) });
    await renderView("literature");
    notify("Source saved to this project.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function removeSource(sourceId) {
  try {
    await api(`/api/projects/${encodeURIComponent(state.project.id)}/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    await renderView("literature");
    notify("Source removed.");
  } catch (error) {
    notify(error.message, true);
  }
}

function bindStatistics() {
  const select = document.querySelector("#stat-method");
  const inputs = document.querySelector("#stat-inputs");
  const source = document.querySelector("#stat-source");
  const renderInputs = () => {
    inputs.innerHTML = source.value === "spreadsheet" && state.statisticsTable
      ? spreadsheetStatInputs(select.value, state.statisticsTable)
      : statInputs(select.value);
  };
  select.addEventListener("change", renderInputs);
  source.addEventListener("change", renderInputs);
  renderInputs();
  const importForm = document.querySelector("#statistics-import-form");
  const importStatus = document.querySelector("#statistics-import-status");
  const sheetLabel = document.querySelector("#statistics-sheet-label");
  const sheetSelect = document.querySelector("#statistics-sheet");
  const preview = document.querySelector("#statistics-preview");
  const importButton = importForm.querySelector("button[type=submit]");
  const importFile = async (file, sheetName = "") => {
    const formData = new FormData();
    formData.append("file", file);
    if (sheetName) formData.append("sheet_name", sheetName);
    importButton.disabled = true;
    importStatus.textContent = "Reading spreadsheet…";
    try {
      state.statisticsTable = await api("/api/statistics/import", { method: "POST", body: formData });
      const table = state.statisticsTable;
      sheetSelect.innerHTML = table.sheet_names.map((name) =>
        `<option value="${escapeHtml(name)}" ${name === table.sheet_name ? "selected" : ""}>${escapeHtml(name)}</option>`
      ).join("");
      sheetLabel.hidden = table.sheet_names.length < 2;
      const headings = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
      const previewRows = table.rows.slice(0, 5).map((row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`
      ).join("");
      preview.innerHTML = `<p>${table.row_count.toLocaleString()} rows · ${table.headers.length} columns · Sheet: ${escapeHtml(table.sheet_name)}</p><div style="overflow:auto"><table class="data-table"><thead><tr>${headings}</tr></thead><tbody>${previewRows}</tbody></table></div>${table.row_count > 5 ? "<p>Preview shows the first 5 data rows.</p>" : ""}`;
      preview.hidden = false;
      source.querySelector('option[value="spreadsheet"]').disabled = false;
      source.value = "spreadsheet";
      renderInputs();
      importStatus.textContent = "Spreadsheet loaded. Choose the columns for your analysis.";
    } catch (error) {
      importStatus.textContent = error.message;
    } finally {
      importButton.disabled = false;
    }
  };
  importForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const file = importForm.elements.file.files[0];
    if (!file) {
      importStatus.textContent = "Choose a CSV, XLS, or XLSX file.";
      return;
    }
    importForm.dataset.loadedFile = file.name;
    importFile(file);
  });
  sheetSelect.addEventListener("change", () => {
    const file = importForm.elements.file.files[0];
    if (file) importFile(file, sheetSelect.value);
  });
  document.querySelector("#run-stat").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const method = select.value;
    let payload = { method };
    try {
      if (source.value === "spreadsheet" && method !== "slovin") {
        Object.assign(payload, spreadsheetPayload(method, state.statisticsTable));
      } else {
        if (method === "descriptive") payload.values = parseNumbers("#stat-values", "Values");
        if (method === "slovin") {
          payload.population = Number(document.querySelector("#population").value);
          payload.margin_of_error = Number(document.querySelector("#margin").value);
        }
        if (method === "one_sample_t") {
          payload.values = parseNumbers("#stat-values", "Values");
          payload.population_mean = Number(document.querySelector("#population-mean").value);
        }
        if (["pearson", "spearman", "paired_t"].includes(method)) {
          payload.x = parseNumbers("#stat-x", method === "paired_t" ? "Measurement 1" : "X");
          payload.y = parseNumbers("#stat-y", method === "paired_t" ? "Measurement 2" : "Y");
        }
        if (["independent_t", "mann_whitney"].includes(method)) {
          payload.group_a = parseNumbers("#group-a", "Group A");
          payload.group_b = parseNumbers("#group-b", "Group B");
        }
        if (["one_way_anova", "kruskal_wallis"].includes(method)) {
          payload.groups = document.querySelector("#groups").value.split(/\r?\n/).filter((line) => line.trim())
            .map((line, index) => parseNumberText(line, `Group ${index + 1}`));
        }
        if (method === "chi_square") {
          payload.observed = document.querySelector("#contingency-table").value.split(/\r?\n/).filter((line) => line.trim())
            .map((line, index) => parseNumberText(line, `Row ${index + 1}`));
        }
      }
      if (needsAlpha(method)) payload.alpha = Number(document.querySelector("#alpha").value);
      button.disabled = true;
      const result = await api("/api/statistics/calculate", { method: "POST", body: jsonBody(payload) });
      document.querySelector("#stat-result").innerHTML = formatStatResult(result);
    } catch (error) {
      document.querySelector("#stat-result").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
      button.disabled = false;
    }
  });
}

function spreadsheetColumnValues(table, columnName) {
  const columnIndex = table.headers.indexOf(columnName);
  if (columnIndex < 0) throw new Error("Choose a column from the imported spreadsheet.");
  return table.rows.map((row) => row[columnIndex]);
}

function spreadsheetNumbers(table, columnName) {
  const values = spreadsheetColumnValues(table, columnName).filter((value) => value !== null && value !== "");
  const numbers = values.map(Number);
  if (!numbers.length || numbers.some((value) => !Number.isFinite(value))) {
    throw new Error(`Column “${columnName}” must contain numeric values only (blank cells are ignored).`);
  }
  return numbers;
}

function spreadsheetGroupedValues(table, valueColumn, groupColumn) {
  const values = spreadsheetColumnValues(table, valueColumn);
  const labels = spreadsheetColumnValues(table, groupColumn);
  const grouped = new Map();
  values.forEach((value, index) => {
    if (value === null || value === "" || labels[index] === null || labels[index] === "") return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Column “${valueColumn}” must contain numeric values only.`);
    const label = String(labels[index]);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(numeric);
  });
  if (grouped.size < 2) throw new Error("The selected group column must contain at least two groups with data.");
  return [...grouped.entries()];
}

function spreadsheetPayload(method, table) {
  if (!table) throw new Error("Load a spreadsheet before selecting spreadsheet data.");
  if (method === "descriptive") return { values: spreadsheetNumbers(table, document.querySelector("#column-values").value) };
  if (method === "one_sample_t") {
    return {
      values: spreadsheetNumbers(table, document.querySelector("#column-values").value),
      population_mean: Number(document.querySelector("#population-mean").value),
    };
  }
  if (["pearson", "spearman", "paired_t"].includes(method)) {
    const x = spreadsheetColumnValues(table, document.querySelector("#column-x").value);
    const y = spreadsheetColumnValues(table, document.querySelector("#column-y").value);
    const pairs = x.map((left, index) => [left, y[index]])
      .filter(([left, right]) => left !== null && left !== "" && right !== null && right !== "");
    if (pairs.some(([left, right]) => !Number.isFinite(Number(left)) || !Number.isFinite(Number(right)))) {
      throw new Error("Selected paired columns must contain numeric values. Incomplete pairs are ignored.");
    }
    return { x: pairs.map(([left]) => Number(left)), y: pairs.map(([, right]) => Number(right)) };
  }
  if (["independent_t", "mann_whitney", "one_way_anova", "kruskal_wallis"].includes(method)) {
    const grouped = spreadsheetGroupedValues(
      table,
      document.querySelector("#column-values").value,
      document.querySelector("#column-group").value,
    );
    if (["independent_t", "mann_whitney"].includes(method) && grouped.length !== 2) {
      throw new Error("Choose a group column with exactly two groups for this test.");
    }
    return ["independent_t", "mann_whitney"].includes(method)
      ? { group_a: grouped[0][1], group_b: grouped[1][1] }
      : { groups: grouped.map(([, values]) => values) };
  }
  if (method === "chi_square") {
    const rowLabels = spreadsheetColumnValues(table, document.querySelector("#column-row").value);
    const columnLabels = spreadsheetColumnValues(table, document.querySelector("#column-column").value);
    const rowNames = [...new Set(rowLabels.filter((value) => value !== null && value !== "").map(String))];
    const columnNames = [...new Set(columnLabels.filter((value) => value !== null && value !== "").map(String))];
    if (rowNames.length < 2 || columnNames.length < 2) throw new Error("Each selected category column must contain at least two categories.");
    const rowIndex = new Map(rowNames.map((name, index) => [name, index]));
    const columnIndex = new Map(columnNames.map((name, index) => [name, index]));
    const observed = rowNames.map(() => columnNames.map(() => 0));
    rowLabels.forEach((rowValue, index) => {
      const columnValue = columnLabels[index];
      if (rowValue === null || rowValue === "" || columnValue === null || columnValue === "") return;
      observed[rowIndex.get(String(rowValue))][columnIndex.get(String(columnValue))] += 1;
    });
    return { observed };
  }
  throw new Error("Choose a supported method for spreadsheet input.");
}

function formatStatResult(result) {
  const values = result.result || {};
  const steps = (values.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const assumptions = (result.assumptions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const limitations = (result.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const hypotheses = result.hypotheses ? `<h3>Hypotheses (alpha = ${escapeHtml(result.alpha)})</h3><p><strong>H₀:</strong> ${escapeHtml(result.hypotheses.null)}<br><strong>H₁:</strong> ${escapeHtml(result.hypotheses.alternative)}</p>` : "";
  return `<div class="panel">${hypotheses}<h3>Result</h3><div class="result-box">${escapeHtml(JSON.stringify(Object.fromEntries(Object.entries(values).filter(([key]) => key !== "steps")), null, 2))}</div>
    <h3 style="margin-top:16px">Calculation steps</h3><ol>${steps}</ol>
    ${assumptions ? `<h3>Assumptions to review</h3><ul>${assumptions}</ul>` : ""}
    ${limitations ? `<h3>Limitations</h3><ul>${limitations}</ul>` : ""}</div>`;
}

function bindBuilder() {
  const container = document.querySelector("#document-sections");
  const documentRecord = currentDocument();
  const documentId = documentRecord.id;
  const projectId = state.project.id;
  let saveTimer;
  const statusElement = viewRoot.querySelector("#save-status");
  const setStatus = (message) => {
    if (statusElement?.isConnected) statusElement.textContent = message;
  };
  const updateWordCount = () => {
    const counter = viewRoot.querySelector("#manuscript-word-count");
    if (!counter) return;
    const words = [...container.querySelectorAll(".section-content")]
      .reduce((total, editor) => total + editor.innerText.trim().split(/\s+/).filter(Boolean).length, 0);
    counter.textContent = words.toLocaleString();
  };
  const collectSections = () => [...container.querySelectorAll(".section-editor")].map((section, index) => ({
    id: `section-${index + 1}`,
    title: section.querySelector(".section-heading-input").value,
    content: section.querySelector(".section-content").innerHTML,
    level: Number(section.querySelector(".section-level").value),
  }));
  let saveInProgress = Promise.resolve(true);
  const save = async () => {
    clearTimeout(saveTimer);
    const sections = collectSections();
    const operation = saveInProgress.then(async () => {
      setStatus("Saving…");
      try {
        const result = await api(`/api/documents/${encodeURIComponent(documentId)}/autosave`, {
          method: "PUT",
          body: jsonBody({ content: { sections }, version: documentRecord.version }),
        });
        documentRecord.version = result.version;
        documentRecord.content = { sections };
        setStatus(`Saved · version ${result.version}`);
        return true;
      } catch (error) {
        setStatus(`Save failed: ${error.message}`);
        return false;
      }
    });
    saveInProgress = operation;
    return operation;
  };
  const scheduleSave = () => {
    setStatus("Unsaved changes");
    updateWordCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  };
  container.addEventListener("input", (event) => {
    if (event.target.matches(".section-heading-input")) {
      event.target.closest(".section-editor").querySelector("summary .section-title").textContent = event.target.value || "Untitled section";
    }
    scheduleSave();
  });
  container.querySelectorAll(".section-content[contenteditable=true]").forEach((editor) => {
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
        state.activeEditor = editor;
        state.savedSelection = selection.getRangeAt(0).cloneRange();
      }
    };
    editor.addEventListener("mouseup", rememberSelection);
    editor.addEventListener("keyup", rememberSelection);
    editor.addEventListener("focus", () => { state.activeEditor = editor; });
  });
  container.addEventListener("change", (event) => {
    if (event.target.matches(".section-level")) scheduleSave();
  });
  const restoreSelection = () => {
    if (!state.activeEditor || !container.contains(state.activeEditor) || !state.savedSelection) return;
    state.activeEditor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(state.savedSelection);
  };
  viewRoot.querySelectorAll(".editor-toolbar [data-editor-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      restoreSelection();
      document.execCommand(button.dataset.editorCommand, false);
      if (state.activeEditor) {
        state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
  const blockStyle = viewRoot.querySelector("[data-editor-block]");
  blockStyle.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("formatBlock", false, `<${blockStyle.value}>`);
    if (state.activeEditor) state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const fontFamily = viewRoot.querySelector("[data-editor-font]");
  fontFamily.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("fontName", false, fontFamily.value);
    if (state.activeEditor) state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const fontSize = viewRoot.querySelector("[data-editor-size]");
  fontSize.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("fontSize", false, fontSize.value);
    if (state.activeEditor) state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const fontColor = viewRoot.querySelector("[data-editor-color]");
  fontColor.addEventListener("mousedown", () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) state.savedSelection = selection.getRangeAt(0).cloneRange();
  });
  fontColor.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("foreColor", false, fontColor.value);
    if (state.activeEditor) state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  document.querySelector("#add-section").addEventListener("click", () => {
    const section = document.createElement("details");
    section.className = "section-editor";
    section.open = true;
    section.innerHTML = `<summary><span class="section-title">New section</span></summary><div class="form-grid" style="padding:14px"><label>Heading<input class="section-heading-input" maxlength="240" value="New section"></label><label>Heading level<select class="section-level"><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option></select></label><div class="full section-content editor" contenteditable="true" role="textbox" aria-label="New section content" aria-multiline="true" spellcheck="true"><p></p></div><div class="full toolbar"><button class="button small danger remove-section" type="button">Remove section</button></div></div>`;
    container.append(section);
    const editor = section.querySelector(".section-content");
    editor.addEventListener("focus", () => { state.activeEditor = editor; });
    editor.addEventListener("mouseup", () => { state.activeEditor = editor; });
    editor.addEventListener("keyup", () => { state.activeEditor = editor; });
    scheduleSave();
  });
  container.addEventListener("click", (event) => {
    if (event.target.matches(".remove-section")) {
      event.preventDefault();
      event.target.closest(".section-editor").remove();
      scheduleSave();
    }
  });
  const validateButton = document.querySelector("#validate-document");
  if (validateButton) validateButton.addEventListener("click", async () => {
    try {
      if (!await save()) throw new Error("Save the manuscript before validation.");
      const result = await api("/api/export/validate", {
        method: "POST", body: jsonBody({ project_id: projectId }),
      });
      const box = document.querySelector("#document-validation");
      box.hidden = false;
      box.textContent = result.issues.length ? result.issues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`).join(" · ") : "No basic completeness issues found. This is not an academic approval or quality judgment.";
    } catch (error) {
      notify(error.message, true);
    }
  });
  viewRoot.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", async () => {
    if (!await save()) return notify("Save the manuscript before export.", true);
    await exportDocument(button.dataset.export, projectId);
  }));
}

async function exportDocument(format, projectId) {
  try {
    const link = document.createElement("a");
    link.href = `/api/export/${format}?project_id=${encodeURIComponent(projectId)}`;
    link.download = format === "docx" ? "research-paper.docx" : "research-paper.pdf";
    link.click();
    notify(`${format.toUpperCase()} export requested.`);
  } catch (error) {
    notify(error.message, true);
  }
}

function bindAppendices() {
  document.querySelector("#appendix-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api(`/api/projects/${encodeURIComponent(state.project.id)}/appendices`, {
        method: "POST",
        body: formData,
      });
      await renderView("appendices");
      notify("Appendix uploaded; the original file is preserved.");
    } catch (error) {
      notify(error.message, true);
    }
  });
  viewRoot.querySelectorAll("[data-delete-appendix]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Remove this appendix and its stored original file?")) return;
    try {
      await api(`/api/appendices/${encodeURIComponent(button.dataset.deleteAppendix)}`, { method: "DELETE" });
      await renderView("appendices");
      notify("Appendix removed.");
    } catch (error) {
      notify(error.message, true);
    }
  }));
  viewRoot.querySelectorAll("[data-preview-appendix]").forEach((button) => button.addEventListener("click", () => {
    const article = button.closest(".result-item");
    const existingPreview = article.querySelector(".appendix-preview");
    if (existingPreview) {
      existingPreview.remove();
      button.textContent = "Preview";
      return;
    }
    const appendixId = encodeURIComponent(button.dataset.previewAppendix);
    const filename = button.dataset.previewFilename;
    const isImage = /\.(png|jpe?g)$/i.test(filename);
    const content = isImage
      ? `<img class="appendix-preview-image" src="/api/appendices/${appendixId}/preview" alt="${escapeHtml(filename)}">`
      : `<iframe class="appendix-preview-frame" src="/api/appendices/${appendixId}/preview" title="${escapeHtml(filename)}" loading="lazy"></iframe>`;
    article.insertAdjacentHTML("beforeend", `<div class="appendix-preview">${content}</div>`);
    button.textContent = "Hide preview";
  }));
}

function bindReferences() {
  document.querySelector("#citation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const authors = values.authors.split(",").map((lastName) => lastName.trim()).filter(Boolean).map((lastName) => ({ lastName }));
    const payload = {
      authors,
      publication_year: values.year ? Number(values.year) : null,
      style: values.style,
      title: values.title || "Title unavailable",
      journal: values.journal,
      doi: values.doi,
      source_url: values.source_url,
    };
    try {
      const result = await api("/api/citations/generate", { method: "POST", body: jsonBody(payload) });
      document.querySelector("#citation-output").textContent = `In-text citation: ${result.in_text}\n\nReference entry: ${result.reference}`;
    } catch (error) {
      notify(error.message, true);
    }
  });
  document.querySelector("#copy-references").addEventListener("click", async () => {
    if (!state.sources.length) return notify("There are no project references to copy.", true);
    try {
      await navigator.clipboard.writeText(state.sources.map(sourceReference).join("\n\n"));
      notify("Reference list copied.");
    } catch (error) {
      notify(`Could not copy references: ${error.message}`, true);
    }
  });
}

async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.user = null;
    state.csrf = null;
    state.projects = [];
    state.project = null;
    showAuth();
  } catch (error) {
    notify(error.message, true);
  }
}

async function bootstrap() {
  document.querySelectorAll("[data-auth-mode]").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));
  document.querySelector("#auth-form").addEventListener("submit", authenticate);
  document.querySelectorAll(".nav-item[data-view], .brand[data-view]").forEach((item) => item.addEventListener("click", (event) => {
    event.preventDefault();
    renderView(item.dataset.view);
  }));
  document.querySelector("#project-select").addEventListener("change", (event) => setProject(event.target.value));
  document.querySelector("#sign-out").addEventListener("click", signOut);
  try {
    const result = await api("/api/auth/me");
    state.user = result.user;
    state.csrf = result.csrf_token;
    if (!state.user) {
      setAuthMode("login");
      showAuth();
      return;
    }
    showApp();
    await loadProjects();
    await renderView("dashboard");
  } catch (error) {
    showAuth();
    document.querySelector("#auth-error").textContent = `Could not connect to Research OS: ${error.message}`;
  }
}

bootstrap();
