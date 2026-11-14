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
  frameworkBoards: [],
  frameworkBoard: null,
  frameworkSelectedNode: null,
  frameworkConnectFrom: null,
  frameworkZoom: 1,
};

const viewTitles = {
  dashboard: ["RESEARCH WORKSPACE", "Dashboard"],
  projects: ["YOUR WORKSPACE", "My Research"],
  writing: ["WRITING LAB", "Writing Lab"],
  literature: ["RESEARCH INTELLIGENCE", "Literature Review"],
  framework: ["THEORY & CONCEPTS", "Frameworkshop"],
  statistics: ["DETERMINISTIC ANALYSIS", "Statistical Lab"],
  builder: ["WRITE YOUR RESEARCH", "Manuscript Editor"],
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

function setProject(projectId, nextView = state.view) {
  state.project = state.projects.find((project) => project.id === projectId) || null;
  state.documents = [];
  state.sources = [];
  state.appendices = [];
  state.frameworkBoards = [];
  state.frameworkBoard = null;
  state.frameworkSelectedNode = null;
  state.frameworkConnectFrom = null;
  if (state.project) localStorage.setItem("research-os-project", state.project.id);
  renderProjectSelect();
  renderView(nextView);
}

async function loadProjectData(includeFrameworks = false) {
  if (!state.project) return;
  const projectId = state.project.id;
  const requests = [
    api(`/api/projects/${encodeURIComponent(projectId)}/documents`),
    api(`/api/projects/${encodeURIComponent(projectId)}/sources`),
    api(`/api/projects/${encodeURIComponent(projectId)}/appendices`),
  ];
  if (includeFrameworks) requests.push(api(`/api/projects/${encodeURIComponent(projectId)}/frameworks`));
  const [documents, sources, appendices, frameworks] = await Promise.all(requests);
  if (state.project?.id !== projectId) return;
  state.documents = documents.documents;
  state.sources = sources.sources;
  state.appendices = appendices.appendices;
  if (includeFrameworks) {
    state.frameworkBoards = frameworks.boards;
    if (state.frameworkBoard && !state.frameworkBoards.some((board) => board.id === state.frameworkBoard.id)) {
      state.frameworkBoard = null;
    }
  }
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
  window.scrollTo({ top: 0, behavior: "smooth" });
  appShell.classList.toggle("document-mode", view === "builder" && Boolean(state.project));
  appShell.classList.toggle("framework-mode", view === "framework" && Boolean(state.project));
  updateHeader(view);
  document.querySelector("#notice").hidden = true;
  if (state.project && ["dashboard", "builder", "literature", "framework", "statistics", "appendices", "references"].includes(view)) {
    viewRoot.innerHTML = '<div class="empty-state">Loading your project…</div>';
    try {
      await loadProjectData(view === "framework");
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
    framework: renderFramework,
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
  return `<div class="welcome"><div><p class="eyebrow">MANUSCRIPT DASHBOARD</p><h2>${escapeHtml(project.project_title)}</h2><p>${escapeHtml(project.research_field || "Research field not set")} · ${escapeHtml(project.research_type)} · ${escapeHtml(project.institution || "Institution not set")}</p></div></div>
    <div class="stats-grid">
      <div class="metric"><span>Manuscript sections</span><strong>${sections.length}</strong></div>
      <div class="metric"><span>Words in manuscript</span><strong id="manuscript-word-count">${words.toLocaleString()}</strong></div>
      <div class="metric"><span>Saved scholarly sources</span><strong>${state.sources.length}</strong></div>
      <div class="metric"><span>Appendix files</span><strong>${state.appendices.length}</strong></div>
    </div>
    <div class="panel manuscript-launch"><div><p class="eyebrow">YOUR RESEARCH DOCUMENT</p><h2>Write and format your manuscript</h2><p class="muted">Open the full-page editor to work on sections, insert tables or images, and export your paper.</p></div><button class="button primary" data-go="builder">Open Manuscript Editor →</button></div>
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
      ${toolCard("Frameworkshop", "Build and edit a theory-grounded or conceptual framework on a whiteboard.", "framework", "Open Frameworkshop")}
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
  return `<div class="toolbar editor-toolbar" role="toolbar" aria-label="Document formatting">
    <div class="docs-tool-group">
      <button class="button small" type="button" data-editor-command="undo" aria-label="Undo" title="Undo">↶</button>
      <button class="button small" type="button" data-editor-command="redo" aria-label="Redo" title="Redo">↷</button>
    </div>
    <select aria-label="Text style" data-editor-block><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
    <select aria-label="Font family" data-editor-font><option>Georgia</option><option>Arial</option><option>Times New Roman</option><option>Verdana</option></select>
    <select aria-label="Font size" data-editor-size><option value="3">Normal</option><option value="2">Small</option><option value="4">Large</option><option value="5">Extra large</option></select>
    <span class="docs-toolbar-divider" aria-hidden="true"></span>
    <div class="docs-tool-group">
      <button class="button small" type="button" data-editor-command="bold" aria-label="Bold" title="Bold"><strong>B</strong></button>
      <button class="button small" type="button" data-editor-command="italic" aria-label="Italic" title="Italic"><em>I</em></button>
      <button class="button small" type="button" data-editor-command="underline" aria-label="Underline" title="Underline"><u>U</u></button>
      <label class="font-color" title="Text color"><span aria-hidden="true">A</span><input type="color" value="#34242a" aria-label="Text color" data-editor-color></label>
    </div>
    <span class="docs-toolbar-divider" aria-hidden="true"></span>
    <div class="docs-tool-group">
      <button class="button small" type="button" data-editor-command="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">•</button>
      <button class="button small" type="button" data-editor-command="insertOrderedList" aria-label="Numbered list" title="Numbered list">1.</button>
      <button class="button small" type="button" data-editor-command="justifyLeft" aria-label="Align left" title="Align left">☰</button>
      <button class="button small" type="button" data-editor-command="justifyCenter" aria-label="Center align" title="Center align">≡</button>
      <button class="button small" type="button" data-editor-command="justifyRight" aria-label="Align right" title="Align right">☷</button>
    </div>
    <span class="docs-toolbar-divider" aria-hidden="true"></span>
    <div class="docs-tool-group">
      <button class="button small" type="button" data-insert-link title="Insert link">Link</button>
      <button class="button small" type="button" data-insert-table title="Insert table">Table</button>
      <label class="button small image-insert-button">Image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-insert-image hidden></label>
    </div>
  </div>`;
}

function renderManuscriptEditor(title, includeExports = true) {
  if (!currentDocument()) return '<div class="empty-state">This project does not have a document yet.</div>';
  const sections = documentSections();
  const wordCount = sections
    .map((section) => cleanEditorText(section.content))
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
  const exportTools = includeExports
    ? '<button class="button" type="button" id="toggle-document-history" aria-expanded="false">Version history</button><button class="button" id="validate-document">Validate</button><button class="button" data-export="pdf">Export PDF</button><button class="button primary" data-export="docx">Export DOCX</button>'
    : '<span class="small-label">Autosaves to this project</span>';
  return `<div class="docs-editor-shell">
    <header class="docs-filebar">
      <div class="docs-file-info">
        <button class="docs-back-button" type="button" data-go="dashboard" aria-label="Back to research workspace">←</button>
        <span class="docs-file-icon" aria-hidden="true">▤</span>
        <div class="docs-file-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(state.project.project_title)} · Research OS</span></div>
      </div>
      <div class="docs-file-actions">${exportTools}</div>
    </header>
    ${includeExports ? '<div id="document-validation" class="notice" hidden></div>' : ""}
    ${includeExports ? '<section id="document-history" class="document-history" aria-live="polite" hidden></section>' : ""}
    <div class="docs-toolbar-wrap">${editorToolbar()}</div>
    <div class="docs-statusbar"><span id="save-status" role="status">All changes saved</span><span class="docs-status-divider"></span><span><strong id="manuscript-word-count">${wordCount.toLocaleString()}</strong> words</span><span class="spacer"></span><button class="button small" id="add-section" type="button">＋ Add section</button></div>
    <div class="docs-content-layout">
      <aside class="docs-outline" aria-label="Document outline">
        <p class="docs-outline-label">DOCUMENT OUTLINE</p>
        <nav>${sections.map((section, index) => `<button type="button" data-outline-index="${index}">${escapeHtml(section.title || `Section ${index + 1}`)}</button>`).join("")}</nav>
      </aside>
      <div class="docs-canvas" role="region" aria-label="Document">
        <div id="document-sections" class="docs-page">${sections.map((section, index) => `<details class="section-editor" open id="document-section-${index}" data-section-index="${index}">
          <summary><span class="section-title">${escapeHtml(section.title || `Section ${index + 1}`)}</span></summary>
          <div class="section-meta"><label>Section heading<input class="section-heading-input" maxlength="240" value="${escapeHtml(section.title || "")}"></label><label>Style<select class="section-level" aria-label="Heading level">${[1, 2, 3].map((level) => `<option value="${level}" ${Number(section.level || 1) === level ? "selected" : ""}>Heading ${level}</option>`).join("")}</select></label></div>
          <div class="section-content editor" contenteditable="true" role="textbox" aria-label="${escapeHtml(section.title || `Section ${index + 1}`)} content" aria-multiline="true" spellcheck="true">${editorContent(section.content)}</div>
          <div class="section-actions"><button class="button small danger remove-section" type="button">Remove section</button></div></details>`).join("")}</div>
      </div>
    </div>
  </div>`;
}

function toolCard(title, description, view, action) {
  return `<article class="card project-card"><div><h3>${title}</h3><p class="muted">${description}</p></div><div class="card-footer"><span class="small-label">PROJECT: ${escapeHtml(state.project?.project_title || "")}</span><button class="button small" data-go="${view}">${action} →</button></div></article>`;
}

function renderProjects() {
  const cards = state.projects.map((project) => `<article class="card project-card">
    <div><p class="eyebrow">${escapeHtml(project.research_type)} · ${escapeHtml(project.research_status)}</p><h3>${escapeHtml(project.project_title)}</h3>
    <p class="muted">${escapeHtml(project.research_field || "Research field not set")} · ${escapeHtml(project.institution || "Institution not set")}</p></div>
    <button class="button small" type="button" data-edit-project="${escapeHtml(project.id)}" aria-expanded="false">Edit details</button>
    <form class="project-edit-form form-grid" data-project-update="${escapeHtml(project.id)}" hidden>
      <label class="full">Project title<input name="title" maxlength="240" required value="${escapeHtml(project.project_title)}"></label>
      <label>Research field<input name="field" maxlength="160" value="${escapeHtml(project.research_field || "")}"></label>
      <label>Research type<input name="research_type" maxlength="60" required value="${escapeHtml(project.research_type)}"></label>
      <label>Institution<input name="institution" maxlength="200" value="${escapeHtml(project.institution || "")}"></label>
      <label>Research status<input name="status" maxlength="40" required value="${escapeHtml(project.research_status)}"></label>
      <div class="full toolbar"><button class="button primary" type="submit">Save changes</button><button class="button" type="button" data-cancel-project-edit>Cancel</button></div>
    </form>
    <div class="card-footer"><span class="small-label">${Number(project.source_count) || 0} saved sources</span><div class="toolbar">
      <button class="button small" data-open-project="${escapeHtml(project.id)}">Open project</button>
      <button class="button small danger" data-delete-project="${escapeHtml(project.id)}">Delete</button>
    </div></div></article>`).join("");
  return `<div class="section-heading"><h2>Your research projects</h2></div>
    ${state.projects.length ? `<div class="card-grid">${cards}</div>` : '<div class="empty-state">No projects yet. Create one to begin.</div>'}
    <div class="panel" style="margin-top:20px"><h2>Create a project</h2>${projectForm()}</div>`;
}

function renderDocumentHistory(versions) {
  if (!versions.length) return '<p class="muted">No earlier versions have been saved yet.</p>';
  return versions.map((version) => {
    const savedAt = Number.isNaN(Date.parse(version.created_at))
      ? version.created_at
      : new Date(version.created_at).toLocaleString();
    return `<article class="version-item">
      <div><strong>Version ${Number(version.version_number)}</strong><span class="muted">${escapeHtml(savedAt)}</span></div>
      <pre class="version-preview" hidden></pre>
      <div class="toolbar"><button class="button small" type="button" data-preview-version="${Number(version.version_number)}">Preview</button>
      <button class="button small" type="button" data-restore-version="${Number(version.version_number)}">Restore this version</button>
      </div>
    </article>`;
  }).join("");
}

function documentVersionPreviewText(content) {
  const sections = content?.sections;
  if (Array.isArray(sections)) {
    return sections.map((section) => `${section.title || "Untitled section"}\n${cleanEditorText(section.content || "")}`).join("\n\n");
  }
  const text = typeof content === "string" ? content : content?.text || "";
  return cleanEditorText(text);
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

function renderFramework() {
  if (!state.frameworkBoard) state.frameworkBoard = emptyFrameworkBoard();
  const projectOptions = state.projects.map((project) =>
    `<option value="${escapeHtml(project.id)}" ${project.id === state.project.id ? "selected" : ""}>${escapeHtml(project.project_title)}</option>`
  ).join("");
  const boardOptions = state.frameworkBoards.map((board) =>
    `<option value="${escapeHtml(board.id)}" ${board.id === state.frameworkBoard.id ? "selected" : ""}>${escapeHtml(board.title)}</option>`
  ).join("");
  return `<div class="frameworkshop">
    <header class="frameworkshop-header">
      <div class="frameworkshop-brand"><button class="fw-back" type="button" data-go="dashboard" aria-label="Back to dashboard">←</button><span class="fw-logo">◇</span><strong>Frameworkshop</strong><span class="fw-divider"></span><select id="framework-project-select" aria-label="Current project">${projectOptions}</select></div>
      <div class="frameworkshop-document">
        <input id="framework-board-title" aria-label="Framework board name" maxlength="240" value="${escapeHtml(state.frameworkBoard.title)}">
        <select id="framework-board-select" aria-label="Open saved board"><option value="">New board</option>${boardOptions}</select>
      </div>
      <div class="frameworkshop-actions"><span id="framework-save-status" role="status">${state.frameworkBoard.id ? "Saved to this project" : "Unsaved board"}</span><button class="button small" id="framework-new-board" type="button">＋ New</button><button class="button small danger" id="framework-delete-board" type="button" ${state.frameworkBoard.id ? "" : "disabled"}>Delete</button><button class="button primary small" id="framework-save-board" type="button">Save</button></div>
    </header>
    <div class="frameworkshop-workspace">
      <aside class="framework-ai-panel">
        <div class="fw-panel-title"><span>✦</span><div><strong>AI framework builder</strong><small>Grounded in your study</small></div></div>
        <p>Gemini can draft a theoretical or conceptual model. Check every suggested theory and relationship before use.</p>
        <form id="framework-form">
          <label>Framework type<select name="framework_type"><option value="theoretical" ${state.frameworkBoard.framework_type === "theoretical" ? "selected" : ""}>Theoretical framework</option><option value="conceptual" ${state.frameworkBoard.framework_type === "conceptual" ? "selected" : ""}>Conceptual framework</option></select></label>
          <label>Study or research description<textarea name="study" required maxlength="27000" rows="9" placeholder="Paste your title, background, questions, variables, and methods…">${escapeHtml(state.frameworkBoard.study || "")}</textarea></label>
          <label>What should the framework show?<textarea name="description" maxlength="2500" rows="5" placeholder="Optional: describe constructs, directions, or relationships.">${escapeHtml(state.frameworkBoard.description || "")}</textarea></label>
          <button class="button primary wide" type="submit">✦ Generate diagram</button>
        </form>
        <div id="framework-ai-status" class="fw-ai-status" aria-live="polite"></div>
        <button class="button small fw-insert-manuscript" id="insert-framework" type="button" ${state.frameworkBoard.manuscript_section ? "" : "disabled"}>Add write-up to manuscript</button>
      </aside>
      <section class="framework-board" aria-label="Framework whiteboard">
        <div class="fw-toolbar" role="toolbar" aria-label="Whiteboard tools">
          <div class="fw-tool-group">
            <button type="button" class="fw-tool" data-add-shape="rectangle" title="Add rounded rectangle" aria-label="Add rounded rectangle">▱</button>
            <button type="button" class="fw-tool" data-add-shape="ellipse" title="Add oval" aria-label="Add oval">◯</button>
            <button type="button" class="fw-tool" data-add-shape="diamond" title="Add diamond" aria-label="Add diamond">◇</button>
            <button type="button" class="fw-tool" data-add-shape="text" title="Add text" aria-label="Add text">T</button>
          </div>
          <span class="fw-toolbar-divider"></span>
          <button type="button" class="fw-tool ${state.frameworkConnectFrom !== null ? "active" : ""}" id="framework-connect" title="Connect two shapes">↗ Connect</button>
          <button type="button" class="fw-tool danger" id="framework-delete-node" title="Delete selected shape">⌫ Delete</button>
          <span class="fw-toolbar-spacer"></span>
          <button type="button" class="fw-tool" id="framework-zoom-out" aria-label="Zoom out">−</button><span id="framework-zoom-label">100%</span><button type="button" class="fw-tool" id="framework-zoom-in" aria-label="Zoom in">＋</button>
        </div>
        <div class="fw-canvas-wrap" id="framework-canvas-wrap">
          <svg id="framework-svg" role="img" aria-label="Editable research framework diagram" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
        <footer class="fw-canvas-status"><span>Drag shapes to arrange · double-click a shape to rename · use Connect to add arrows</span><span id="framework-object-count"></span></footer>
      </section>
      <aside class="framework-inspector">
        <div class="fw-inspector-heading"><strong>Design</strong><button class="button small" type="button" id="framework-reset-zoom">Fit</button></div>
        <div id="framework-inspector-content"></div>
        <div class="fw-board-help"><strong>Quick guide</strong><p>Add shapes from the toolbar, select one to edit its text and color, then use Connect and select two shapes to draw a relationship.</p></div>
      </aside>
    </div>
  </div>`;
}

function renderLiterature() {
  return `<div class="panel"><h2>Search scholarly literature</h2><p>Search Crossref's bibliographic records. Metadata is returned by the source provider; abstracts may be unavailable.</p>
    <form id="literature-form" class="toolbar"><input name="q" required maxlength="500" placeholder="Topic, title, keyword, or author"><button class="button primary" type="submit">Search Crossref</button></form>
    <h3 style="margin-top:20px">Import references</h3><p>Import RIS or BibTeX exports from a reference manager. Imported metadata is unverified until checked against a provider record.</p>
    <form id="reference-import-form" class="toolbar"><label class="file-picker-label">Reference file${filePicker("file", ".ris,.bib,.bibtex", true)}</label><button class="button" type="submit">Import references</button></form>
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
    <form id="statistics-import-form" class="toolbar"><label class="file-picker-label">Spreadsheet${filePicker("file", ".csv,.xls,.xlsx", true)}</label><button class="button" type="submit">Load data</button></form>
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

function filePicker(name, accept, required = false) {
  const identifier = `${name}-${Math.random().toString(36).slice(2, 9)}`;
  return `<div class="file-picker">
    <input id="${identifier}" class="file-input-native" name="${escapeHtml(name)}" type="file" accept="${escapeHtml(accept)}" ${required ? "required" : ""}>
    <button class="button small" type="button" data-file-trigger>Choose file</button>
    <span class="file-picker-name" data-file-name>No file chosen</span>
  </div>`;
}

function bindFilePickers(root) {
  root.querySelectorAll(".file-picker").forEach((picker) => {
    if (picker.dataset.bound === "true") return;
    picker.dataset.bound = "true";
    const input = picker.querySelector('input[type="file"]');
    picker.querySelector("[data-file-trigger]").addEventListener("click", (event) => {
      event.preventDefault();
      input.click();
    });
    input.addEventListener("change", () => {
      picker.querySelector("[data-file-name]").textContent =
        [...input.files].map((file) => file.name).join(", ") || "No file chosen";
      picker.classList.toggle("has-file", input.files.length > 0);
    });
  });
}

function renderAppendices() {
  return `<div class="panel"><h2>Add appendix material</h2><p>Original files are stored separately from the editable manuscript. Supported types: PDF, DOCX, PNG/JPG, Excel, CSV, and TXT (20 MB max).</p>
    <form id="appendix-form"><div class="form-grid">
      <label>File${filePicker("file", ".pdf,.docx,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt", true)}</label>
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
  return `<div class="panel citation-generator"><div class="section-heading"><div><p class="eyebrow">APA 7TH EDITION</p><h2>Reference and citation generator</h2><p class="muted">Choose a source type, enter its details, and create a reference-list entry plus parenthetical or narrative in-text citation. Check the finished citation against the original source.</p></div></div>
    <form id="citation-form" class="form-grid">
      <label>Source type<select name="source_type" id="citation-source-type">
        <option value="journal_article">Journal article</option><option value="book">Book</option>
        <option value="webpage">Webpage</option><option value="report">Report</option>
        <option value="book_chapter">Chapter in an edited book</option><option value="dissertation">Thesis or dissertation</option>
        <option value="newspaper_article">Newspaper article</option></select></label>
      <label>Citation form<select name="style"><option value="parenthetical">Parenthetical (Smith, 2024)</option><option value="narrative">Narrative Smith (2024)</option></select></label>
      <label class="full">Author(s)<textarea name="author_names" rows="3" placeholder="One author per line:&#10;Smith, John A.&#10;Jones, Taylor"></textarea><small>Enter each person as Family name, Given and middle names. Use one name per line.</small></label>
      <label class="full">Group or organization author<input name="group_author" maxlength="240" placeholder="Use this instead of person authors, if applicable"></label>
      <label class="full">Title<input name="title" maxlength="1000" required placeholder="Title of the article, book, webpage, or report"></label>
      <label>Publication year<input name="publication_year" type="number" min="1" max="3000" placeholder="2024"></label>
      <label data-citation-field="journal">Journal or newspaper name<input name="journal" maxlength="500"></label>
      <label data-citation-field="volume">Volume<input name="volume" maxlength="100"></label>
      <label data-citation-field="issue">Issue<input name="issue" maxlength="100"></label>
      <label data-citation-field="pages">Page range<input name="pages" maxlength="100" placeholder="123–145"></label>
      <label data-citation-field="publisher">Publisher<input name="publisher" maxlength="500"></label>
      <label data-citation-field="edition">Edition number<input name="edition" type="number" min="1" max="99" placeholder="2"></label>
      <label class="full" data-citation-field="book_title">Edited book title<input name="book_title" maxlength="1000"></label>
      <label class="full" data-citation-field="editors">Editor(s)<textarea name="editor_names" rows="2" placeholder="One per line: Family name, Given names"></textarea></label>
      <label data-citation-field="website">Website name<input name="website" maxlength="500"></label>
      <label data-citation-field="report_number">Report number<input name="report_number" maxlength="100"></label>
      <label data-citation-field="institution">Awarding institution<input name="institution" maxlength="500"></label>
      <label data-citation-field="degree_type">Degree<select name="degree_type"><option>Doctoral dissertation</option><option>Master's thesis</option></select></label>
      <label data-citation-field="month">Publication month<input name="month" maxlength="20" placeholder="March"></label>
      <label data-citation-field="day">Publication day<input name="day" type="number" min="1" max="31"></label>
      <div class="full doi-lookup-row"><label>DOI<input name="doi" maxlength="300" placeholder="10.xxxx/xxxxx or https://doi.org/…"></label><button class="button" type="button" id="lookup-citation-doi">Find DOI details</button><span id="citation-lookup-status" class="muted" aria-live="polite"></span></div>
      <label class="full" data-citation-field="source_url">Source URL<input name="source_url" maxlength="2000" type="url" placeholder="https://…"></label>
      <div class="full"><button class="button primary" type="submit">Create APA 7 citation</button></div></form>
    <div id="citation-output" class="citation-output" aria-live="polite"></div></div>
    <div class="section-heading"><h2>Project reference list (${state.sources.length})</h2><button class="button small" id="copy-references">Copy references</button></div>
    ${state.sources.length ? `<div class="panel"><ol class="reference-list">${state.sources.map((source) => `<li>${escapeHtml(sourceReference(source))}</li>`).join("")}</ol></div>` : '<div class="empty-state">Save verified sources from Literature Review to build this project’s reference list.</div>'}`;
}

function sourceReference(source) {
  const authors = (source.authors || []).map((author) => {
    const initials = (author.firstName || "").split(/\s+/).filter(Boolean).map((part) => `${part[0]}.`).join(" ");
    return `${author.lastName || ""}${initials ? `, ${initials}` : ""}`;
  });
  let authorText = "";
  if (authors.length === 1) authorText = authors[0];
  else if (authors.length === 2) authorText = `${authors[0]}, & ${authors[1]}`;
  else if (authors.length > 2) authorText = `${authors.slice(0, 19).join(", ")}, & ${authors[authors.length - 1]}`;
  const year = source.publication_year || "n.d.";
  const title = source.title || "Title unavailable";
  const journal = source.journal || "";
  const publisher = source.publisher || "";
  const link = source.doi ? `https://doi.org/${source.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : source.source_url || "";
  if (!authorText) return `${title}. (${year}).${journal ? ` ${journal}.` : ""}${link ? ` ${link}` : ""}`;
  if (journal) return `${authorText} (${year}). ${title}. ${journal}.${link ? ` ${link}` : ""}`;
  return `${authorText} (${year}). ${title}.${publisher ? ` ${publisher}.` : ""}${link ? ` ${link}` : ""}`;
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
    setProject(result.project.id, "dashboard");
    notify("Research project created.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function updateProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const projectId = form.dataset.projectUpdate;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: jsonBody(Object.fromEntries(new FormData(form).entries())),
    });
    await loadProjects();
    await renderView("projects");
    notify("Project details updated.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (submitButton.isConnected) submitButton.disabled = false;
  }
}

function bindView(view) {
  bindFilePickers(viewRoot);
  viewRoot.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => {
    if (viewTitles[button.dataset.go]) renderView(button.dataset.go);
  }));
  if (view === "projects") {
    bindProjectForm();
    viewRoot.querySelectorAll("[data-project-update]").forEach((form) => form.addEventListener("submit", updateProject));
    viewRoot.querySelectorAll("[data-edit-project]").forEach((button) => button.addEventListener("click", () => {
      const form = viewRoot.querySelector(`[data-project-update="${CSS.escape(button.dataset.editProject)}"]`);
      form.hidden = !form.hidden;
      button.setAttribute("aria-expanded", String(!form.hidden));
    }));
    viewRoot.querySelectorAll("[data-cancel-project-edit]").forEach((button) => button.addEventListener("click", () => {
      const form = button.closest("[data-project-update]");
      form.hidden = true;
      viewRoot.querySelector(`[data-edit-project="${CSS.escape(form.dataset.projectUpdate)}"]`)?.setAttribute("aria-expanded", "false");
    }));
    viewRoot.querySelectorAll("[data-open-project]").forEach((button) => button.addEventListener("click", () => setProject(button.dataset.openProject, "dashboard")));
    viewRoot.querySelectorAll("[data-delete-project]").forEach((button) => button.addEventListener("click", () => deleteProject(button.dataset.deleteProject)));
  }
  if (view === "writing") bindWriting();
  if (view === "literature") bindLiterature();
  if (view === "framework") bindFramework();
  if (view === "statistics") bindStatistics();
  if (view === "builder") bindBuilder();
  if (view === "appendices") bindAppendices();
  if (view === "references") bindReferences();
}

function bindFramework() {
  const form = viewRoot.querySelector("#framework-form");
  const svg = viewRoot.querySelector("#framework-svg");
  const board = state.frameworkBoard;
  const status = viewRoot.querySelector("#framework-save-status");
  const aiStatus = viewRoot.querySelector("#framework-ai-status");
  let drag = null;
  const randomId = () => window.crypto?.randomUUID?.() || `shape-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const markDirty = () => {
    status.textContent = board.id ? "Unsaved changes" : "Unsaved board";
    viewRoot.querySelector("#framework-delete-board").disabled = !board.id;
  };
  const pointFromEvent = (event) => {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };
  const draw = () => renderFrameworkSvg(svg);
  const newNode = (kind, label = "New concept", body = "") => {
    if (board.diagram.nodes.length >= 60) return notify("A framework can contain up to 60 shapes.", true);
    const index = board.diagram.nodes.length;
    const x = 110 + (index % 3) * 410;
    const y = 110 + Math.floor(index / 3) * 205;
    const node = {
      id: randomId(), kind, label, body, x, y,
      width: kind === "text" ? 280 : 240, height: kind === "text" ? 88 : 120,
      fill: kind === "text" ? "#fff8f9" : "#ffffff", color: "#30242a",
    };
    board.diagram.nodes.push(node);
    state.frameworkSelectedNode = node.id;
    draw();
    renderFrameworkInspector();
    markDirty();
  };
  const setZoom = (value) => {
    state.frameworkZoom = Math.max(0.55, Math.min(1.5, value));
    const width = Math.round(1400 / state.frameworkZoom);
    const height = Math.round(900 / state.frameworkZoom);
    svg.setAttribute("viewBox", `${Math.round((1400 - width) / 2)} ${Math.round((900 - height) / 2)} ${width} ${height}`);
    viewRoot.querySelector("#framework-zoom-label").textContent = `${Math.round(state.frameworkZoom * 100)}%`;
  };
  const syncFields = () => {
    board.title = viewRoot.querySelector("#framework-board-title").value.trim() || "Untitled framework";
    board.framework_type = form.elements.framework_type.value;
    board.study = form.elements.study.value;
    board.description = form.elements.description.value;
  };
  const selectBoard = (id) => {
    const saved = state.frameworkBoards.find((item) => item.id === id);
    if (!saved) {
      state.frameworkBoard = emptyFrameworkBoard();
    } else {
      state.frameworkBoard = {
        id: saved.id,
        title: saved.title,
        framework_type: saved.framework_type,
        study: saved.study_text,
        description: saved.description,
        diagram: saved.diagram,
        manuscript_section: saved.manuscript_section || "",
      };
    }
    state.frameworkSelectedNode = null;
    state.frameworkConnectFrom = null;
    renderView("framework");
  };

  draw();
  setZoom(state.frameworkZoom);
  renderFrameworkInspector();
  viewRoot.querySelector("#framework-project-select").addEventListener("change", (event) => setProject(event.target.value, "framework"));
  viewRoot.querySelector("#framework-board-select").addEventListener("change", (event) => {
    if (event.target.value) selectBoard(event.target.value);
    else selectBoard("");
  });
  viewRoot.querySelector("#framework-board-title").addEventListener("input", () => {
    syncFields();
    markDirty();
  });
  for (const field of form.querySelectorAll("select, textarea")) {
    field.addEventListener("input", () => {
      syncFields();
      markDirty();
    });
    field.addEventListener("change", () => {
      syncFields();
      markDirty();
    });
  }
  viewRoot.querySelectorAll("[data-add-shape]").forEach((button) => {
    button.addEventListener("click", () => newNode(button.dataset.addShape, button.dataset.addShape === "text" ? "Double-click to edit" : "New concept"));
  });
  viewRoot.querySelector("#framework-connect").addEventListener("click", () => {
    state.frameworkConnectFrom = null;
    svg.classList.toggle("connecting");
    const enabled = svg.classList.contains("connecting");
    viewRoot.querySelector("#framework-connect").classList.toggle("active", enabled);
    aiStatus.textContent = enabled ? "Select the starting shape, then the destination shape." : "";
  });
  viewRoot.querySelector("#framework-delete-node").addEventListener("click", () => {
    const selected = state.frameworkSelectedNode;
    if (!selected) return notify("Select a shape to remove.", true);
    board.diagram.nodes = board.diagram.nodes.filter((node) => node.id !== selected);
    board.diagram.edges = board.diagram.edges.filter((edge) => edge.from !== selected && edge.to !== selected);
    state.frameworkSelectedNode = null;
    draw();
    renderFrameworkInspector();
    markDirty();
  });
  viewRoot.querySelector("#framework-zoom-out").addEventListener("click", () => setZoom(state.frameworkZoom - 0.1));
  viewRoot.querySelector("#framework-zoom-in").addEventListener("click", () => setZoom(state.frameworkZoom + 0.1));
  viewRoot.querySelector("#framework-reset-zoom").addEventListener("click", () => setZoom(1));
  viewRoot.querySelector("#framework-new-board").addEventListener("click", () => selectBoard(""));
  viewRoot.querySelector("#framework-save-board").addEventListener("click", async () => {
    syncFields();
    const button = viewRoot.querySelector("#framework-save-board");
    button.disabled = true;
    try {
      const payload = {
        title: board.title,
        framework_type: board.framework_type,
        study: board.study,
        description: board.description,
        manuscript_section: board.manuscript_section || "",
        diagram: board.diagram,
      };
      const result = await api(
        board.id ? `/api/frameworks/${encodeURIComponent(board.id)}` : `/api/projects/${encodeURIComponent(state.project.id)}/frameworks`,
        { method: board.id ? "PUT" : "POST", body: jsonBody(payload) },
      );
      const saved = result.board;
      Object.assign(board, {
        id: saved.id,
        title: saved.title,
        framework_type: saved.framework_type,
        study: saved.study_text,
        description: saved.description,
        diagram: saved.diagram,
        manuscript_section: saved.manuscript_section || "",
      });
      state.frameworkBoards = [saved, ...state.frameworkBoards.filter((item) => item.id !== saved.id)];
      viewRoot.querySelector("#framework-board-select").innerHTML =
        `<option value="">New board</option>${state.frameworkBoards.map((item) =>
          `<option value="${escapeHtml(item.id)}" ${item.id === saved.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`
        ).join("")}`;
      status.textContent = "All changes saved";
      viewRoot.querySelector("#framework-delete-board").disabled = false;
      notify("Framework board saved to this project.");
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  viewRoot.querySelector("#framework-delete-board").addEventListener("click", async () => {
    if (!board.id || !confirm("Delete this saved framework board?")) return;
    try {
      await api(`/api/frameworks/${encodeURIComponent(board.id)}`, { method: "DELETE" });
      state.frameworkBoards = state.frameworkBoards.filter((item) => item.id !== board.id);
      state.frameworkBoard = emptyFrameworkBoard();
      state.frameworkSelectedNode = null;
      renderView("framework");
      notify("Framework board deleted.");
    } catch (error) {
      notify(error.message, true);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    aiStatus.textContent = "Gemini is reading your study and arranging the framework…";
    try {
      const result = await api(`/api/projects/${encodeURIComponent(state.project.id)}/framework`, {
        method: "POST",
        body: jsonBody(values),
      });
      Object.assign(board, {
        id: null,
        title: result.title,
        framework_type: result.framework_type,
        study: values.study,
        description: values.description,
        diagram: frameworkDiagramFromResult(result, randomId),
        manuscript_section: result.manuscript_section,
      });
      state.frameworkSelectedNode = null;
      viewRoot.querySelector("#framework-board-title").value = result.title;
      viewRoot.querySelector("#framework-board-select").value = "";
      aiStatus.textContent = `${result.framework_type === "theoretical" ? "Theoretical" : "Conceptual"} draft ready. Move, edit, and arrange each shape, then save the board.`;
      draw();
      renderFrameworkInspector();
      markDirty();
    } catch (error) {
      aiStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  viewRoot.querySelector("#insert-framework").addEventListener("click", () => {
    syncFields();
    if (board.manuscript_section) insertFramework({
      framework_type: board.framework_type,
      manuscript_section: board.manuscript_section,
    });
  });
  svg.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-node-id]");
    if (!target) {
      state.frameworkSelectedNode = null;
      renderFrameworkInspector();
      draw();
      return;
    }
    const nodeId = target.dataset.nodeId;
    if (svg.classList.contains("connecting")) {
      if (!state.frameworkConnectFrom) {
        state.frameworkConnectFrom = nodeId;
        state.frameworkSelectedNode = nodeId;
        aiStatus.textContent = "Now select the destination shape.";
      } else {
        if (state.frameworkConnectFrom !== nodeId) {
          if (board.diagram.edges.length >= 100) {
            notify("A framework can contain up to 100 connections.", true);
          } else {
            board.diagram.edges.push({
              id: randomId(), from: state.frameworkConnectFrom, to: nodeId, label: "",
            });
            markDirty();
          }
        }
        state.frameworkConnectFrom = null;
        svg.classList.remove("connecting");
        viewRoot.querySelector("#framework-connect").classList.remove("active");
        aiStatus.textContent = "";
      }
      draw();
      renderFrameworkInspector();
      return;
    }
    state.frameworkSelectedNode = nodeId;
    const node = board.diagram.nodes.find((item) => item.id === nodeId);
    const point = pointFromEvent(event);
    drag = { id: nodeId, x: point.x, y: point.y, nodeX: node.x, nodeY: node.y, moved: false };
    svg.setPointerCapture(event.pointerId);
    draw();
    renderFrameworkInspector();
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    const node = board.diagram.nodes.find((item) => item.id === drag.id);
    if (!node) return;
    node.x = Math.max(0, Math.min(10000, Math.round(drag.nodeX + point.x - drag.x)));
    node.y = Math.max(0, Math.min(10000, Math.round(drag.nodeY + point.y - drag.y)));
    drag.moved = true;
    draw();
  });
  const finishDrag = () => {
    if (drag?.moved) markDirty();
    drag = null;
  };
  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
  svg.addEventListener("dblclick", (event) => {
    const target = event.target.closest("[data-node-id]");
    if (!target) return;
    const node = board.diagram.nodes.find((item) => item.id === target.dataset.nodeId);
    const label = prompt("Edit shape text:", node.label);
    if (label === null) return;
    node.label = label.trim().slice(0, 240) || "Untitled";
    state.frameworkSelectedNode = node.id;
    draw();
    renderFrameworkInspector();
    markDirty();
  });
  svg.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(state.frameworkZoom + (event.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
}

function emptyFrameworkBoard() {
  return {
    id: null,
    title: "Untitled framework",
    framework_type: "conceptual",
    study: "",
    description: "",
    diagram: { nodes: [], edges: [] },
    manuscript_section: "",
  };
}

function frameworkDiagramFromResult(result, randomId) {
  const nodes = result.constructs.map((construct, index) => {
    const role = construct.role.toLowerCase();
    const kind = /outcome|dependent|result/.test(role)
      ? "ellipse"
      : /mediator|moderator/.test(role) ? "diamond" : "rectangle";
    return {
      id: randomId(),
      kind,
      label: construct.name.slice(0, 240),
      body: `${construct.role}: ${construct.description}`.slice(0, 1000),
      x: 100 + (index % 3) * 430,
      y: 120 + Math.floor(index / 3) * 230,
      width: 250,
      height: 128,
      fill: kind === "ellipse" ? "#fde9ee" : kind === "diamond" ? "#fff1df" : "#ffffff",
      color: "#30242a",
    };
  });
  if (result.theoretical_basis) {
    nodes.push({
      id: randomId(), kind: "text", label: "Theoretical basis",
      body: result.theoretical_basis.slice(0, 1000),
      x: 1020, y: 120, width: 280, height: 150,
      fill: "#fff8f9", color: "#30242a",
    });
  }
  const findNode = (name) => {
    const query = name.trim().toLowerCase();
    return nodes.find((node) => node.label.toLowerCase() === query)
      || nodes.find((node) => node.label.toLowerCase().includes(query) || query.includes(node.label.toLowerCase()));
  };
  const edges = result.relationships.flatMap((relationship) => {
    const from = findNode(relationship.from);
    const to = findNode(relationship.to);
    return from && to ? [{
      id: randomId(),
      from: from.id,
      to: to.id,
      label: relationship.description.slice(0, 120),
    }] : [];
  });
  return { nodes, edges };
}

function renderFrameworkSvg(svg) {
  if (!svg) return;
  const board = state.frameworkBoard || emptyFrameworkBoard();
  const ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `<pattern id="fw-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#d9d4d7"/></pattern><marker id="fw-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9f6172"/></marker><filter id="fw-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#60404b" flood-opacity=".12"/></filter>`;
  svg.append(defs);
  const background = document.createElementNS(ns, "rect");
  background.setAttribute("width", "1400");
  background.setAttribute("height", "900");
  background.setAttribute("fill", "url(#fw-grid)");
  svg.append(background);
  const nodeById = new Map(board.diagram.nodes.map((node) => [node.id, node]));
  for (const edge of board.diagram.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const direction = { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y };
    const boundaryPoint = (node, center, vector, reverse = false) => {
      const dx = reverse ? -vector.x : vector.x;
      const dy = reverse ? -vector.y : vector.y;
      if (Math.hypot(dx, dy) < 0.0001) return center;
      const halfWidth = node.width / 2;
      const halfHeight = node.height / 2;
      let scale;
      if (node.kind === "ellipse") {
        scale = 1 / Math.sqrt((dx / halfWidth) ** 2 + (dy / halfHeight) ** 2);
      } else if (node.kind === "diamond") {
        scale = 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight);
      } else {
        scale = Math.min(
          halfWidth / Math.max(Math.abs(dx), 0.0001),
          halfHeight / Math.max(Math.abs(dy), 0.0001),
        );
      }
      return { x: center.x + dx * scale, y: center.y + dy * scale };
    };
    const start = boundaryPoint(from, fromCenter, direction);
    const end = boundaryPoint(to, toCenter, direction, true);
    const { x: x1, y: y1 } = start;
    const { x: x2, y: y2 } = end;
    const line = document.createElementNS(ns, "line");
    for (const [name, value] of Object.entries({
      x1, y1, x2, y2, stroke: "#9f6172", "stroke-width": "3", "marker-end": "url(#fw-arrow)",
      "data-edge-id": edge.id,
    })) line.setAttribute(name, String(value));
    svg.append(line);
    if (edge.label) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", String((x1 + x2) / 2));
      label.setAttribute("y", String((y1 + y2) / 2 - 8));
      label.setAttribute("class", "fw-edge-label");
      label.textContent = edge.label;
      svg.append(label);
    }
  }
  for (const node of board.diagram.nodes) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    group.setAttribute("class", `fw-node ${state.frameworkSelectedNode === node.id ? "selected" : ""}`);
    group.setAttribute("data-node-id", node.id);
    if (node.kind === "ellipse") {
      const shape = document.createElementNS(ns, "ellipse");
      shape.setAttribute("cx", String(node.width / 2));
      shape.setAttribute("cy", String(node.height / 2));
      shape.setAttribute("rx", String(node.width / 2));
      shape.setAttribute("ry", String(node.height / 2));
      shape.setAttribute("class", "fw-shape");
      shape.setAttribute("fill", node.fill);
      group.append(shape);
    } else if (node.kind === "diamond") {
      const shape = document.createElementNS(ns, "path");
      shape.setAttribute("d", `M${node.width / 2} 0 L${node.width} ${node.height / 2} L${node.width / 2} ${node.height} L0 ${node.height / 2} Z`);
      shape.setAttribute("class", "fw-shape");
      shape.setAttribute("fill", node.fill);
      group.append(shape);
    } else {
      const shape = document.createElementNS(ns, "rect");
      shape.setAttribute("width", String(node.width));
      shape.setAttribute("height", String(node.height));
      shape.setAttribute("rx", node.kind === "text" ? "8" : "18");
      shape.setAttribute("class", `fw-shape ${node.kind === "text" ? "fw-text-shape" : ""}`);
      shape.setAttribute("fill", node.fill);
      group.append(shape);
    }
    const labelLines = wrapFrameworkText(node.label, Math.max(12, Math.floor(node.width / 10)));
    const bodyLines = wrapFrameworkText(node.body || "", Math.max(18, Math.floor(node.width / 8)));
    const totalLines = labelLines.length + bodyLines.length;
    const startY = node.height / 2 - totalLines * 9 + 12;
    [...labelLines, ...bodyLines].slice(0, 6).forEach((line, index) => {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String(node.width / 2));
      text.setAttribute("y", String(startY + index * 19));
      text.setAttribute("class", `fw-node-text ${index < labelLines.length ? "fw-node-label" : "fw-node-body"}`);
      text.setAttribute("fill", node.color);
      text.textContent = line;
      group.append(text);
    });
    svg.append(group);
  }
  const count = viewRoot.querySelector("#framework-object-count");
  if (count) count.textContent = `${board.diagram.nodes.length} shapes · ${board.diagram.edges.length} connections`;
}

function wrapFrameworkText(value, width) {
  if (!value) return [];
  const words = value.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function renderFrameworkInspector() {
  const root = viewRoot.querySelector("#framework-inspector-content");
  if (!root) return;
  const node = state.frameworkBoard?.diagram.nodes.find((item) => item.id === state.frameworkSelectedNode);
  if (!node) {
    root.innerHTML = '<p class="fw-inspector-empty">Select a shape to edit its text, shape, and colors.</p>';
    return;
  }
  root.innerHTML = `<label>Text<input id="fw-node-label" maxlength="240" value="${escapeHtml(node.label)}"></label>
    <label>Notes<textarea id="fw-node-body" maxlength="1000" rows="4">${escapeHtml(node.body || "")}</textarea></label>
    <label>Shape<select id="fw-node-kind"><option value="rectangle" ${node.kind === "rectangle" ? "selected" : ""}>Rounded rectangle</option><option value="ellipse" ${node.kind === "ellipse" ? "selected" : ""}>Oval</option><option value="diamond" ${node.kind === "diamond" ? "selected" : ""}>Diamond</option><option value="text" ${node.kind === "text" ? "selected" : ""}>Text</option></select></label>
    <div class="fw-color-row"><label>Fill<input id="fw-node-fill" type="color" value="${escapeHtml(node.fill)}"></label><label>Text color<input id="fw-node-color" type="color" value="${escapeHtml(node.color)}"></label></div>`;
  const update = (key, value) => {
    node[key] = value;
    renderFrameworkSvg(viewRoot.querySelector("#framework-svg"));
    viewRoot.querySelector("#framework-object-count").textContent =
      `${state.frameworkBoard.diagram.nodes.length} shapes · ${state.frameworkBoard.diagram.edges.length} connections`;
    viewRoot.querySelector("#framework-save-status").textContent = state.frameworkBoard.id ? "Unsaved changes" : "Unsaved board";
  };
  root.querySelector("#fw-node-label").addEventListener("input", (event) => update("label", event.target.value));
  root.querySelector("#fw-node-body").addEventListener("input", (event) => update("body", event.target.value));
  root.querySelector("#fw-node-kind").addEventListener("change", (event) => update("kind", event.target.value));
  root.querySelector("#fw-node-fill").addEventListener("input", (event) => update("fill", event.target.value));
  root.querySelector("#fw-node-color").addEventListener("input", (event) => update("color", event.target.value));
}

async function insertFramework(framework) {
  const documentRecord = currentDocument();
  if (!documentRecord) return notify("Create a manuscript before inserting a framework.", true);
  const sections = documentSections().map((section) => ({ ...section }));
  sections.push({
    id: `section-${sections.length + 1}`,
    title: framework.framework_type === "theoretical" ? "Theoretical Framework" : "Conceptual Framework",
    content: `<p>${escapeHtml(framework.manuscript_section).replace(/\n/g, "<br>")}</p>`,
    level: 1,
  });
  try {
    const result = await api(`/api/documents/${encodeURIComponent(documentRecord.id)}/autosave`, {
      method: "PUT",
      body: jsonBody({ content: { sections }, version: documentRecord.version }),
    });
    documentRecord.version = result.version;
    documentRecord.content = { sections };
    await renderView("builder");
    notify("Framework draft added to the manuscript; review it before use.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteProject(projectId) {
  if (!confirm("Delete this project, its sources, documents, and uploaded files? This cannot be undone.")) return;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (state.project?.id === projectId) localStorage.removeItem("research-os-project");
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
  let hasUnsavedChanges = false;
  let editSequence = 0;
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
    if (!hasUnsavedChanges) return saveInProgress;
    const sections = collectSections();
    const savedSequence = editSequence;
    const operation = saveInProgress.then(async () => {
      setStatus("Saving…");
      try {
        const result = await api(`/api/documents/${encodeURIComponent(documentId)}/autosave`, {
          method: "PUT",
          body: jsonBody({ content: { sections }, version: documentRecord.version }),
        });
        documentRecord.version = result.version;
        documentRecord.content = { sections };
        if (editSequence === savedSequence) {
          hasUnsavedChanges = false;
          setStatus(`Saved · version ${result.version}`);
        }
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
    hasUnsavedChanges = true;
    editSequence += 1;
    setStatus("Unsaved changes");
    updateWordCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  };
  const outline = viewRoot.querySelector(".docs-outline nav");
  const refreshOutline = () => {
    const sections = [...container.querySelectorAll(".section-editor")];
    sections.forEach((section, index) => {
      section.dataset.sectionIndex = String(index);
      section.id = `document-section-${index}`;
    });
    outline.innerHTML = sections.map((section, index) => {
      const heading = section.querySelector(".section-heading-input").value || `Section ${index + 1}`;
      return `<button type="button" data-outline-index="${index}">${escapeHtml(heading)}</button>`;
    }).join("");
  };
  outline.addEventListener("click", (event) => {
    const button = event.target.closest("[data-outline-index]");
    if (!button) return;
    const section = container.querySelector(`#document-section-${Number(button.dataset.outlineIndex)}`);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.querySelector(".section-content").focus({ preventScroll: true });
  });
  container.addEventListener("input", (event) => {
    if (event.target.matches(".section-heading-input")) {
      const section = event.target.closest(".section-editor");
      const heading = event.target.value || "Untitled section";
      section.querySelector("summary .section-title").textContent = heading;
      const outlineButton = outline.querySelector(`[data-outline-index="${section.dataset.sectionIndex}"]`);
      if (outlineButton) outlineButton.textContent = heading;
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
  const notifyEditorInput = () => {
    if (state.activeEditor) state.activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  viewRoot.querySelectorAll(".editor-toolbar [data-editor-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      restoreSelection();
      document.execCommand(button.dataset.editorCommand, false);
      notifyEditorInput();
    });
  });
  const blockStyle = viewRoot.querySelector("[data-editor-block]");
  blockStyle.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("formatBlock", false, `<${blockStyle.value}>`);
    notifyEditorInput();
  });
  const fontFamily = viewRoot.querySelector("[data-editor-font]");
  fontFamily.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("fontName", false, fontFamily.value);
    notifyEditorInput();
  });
  const fontSize = viewRoot.querySelector("[data-editor-size]");
  fontSize.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("fontSize", false, fontSize.value);
    notifyEditorInput();
  });
  const fontColor = viewRoot.querySelector("[data-editor-color]");
  fontColor.addEventListener("mousedown", () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) state.savedSelection = selection.getRangeAt(0).cloneRange();
  });
  fontColor.addEventListener("change", () => {
    restoreSelection();
    document.execCommand("foreColor", false, fontColor.value);
    notifyEditorInput();
  });
  viewRoot.querySelector("[data-insert-link]").addEventListener("mousedown", (event) => event.preventDefault());
  viewRoot.querySelector("[data-insert-link]").addEventListener("click", () => {
    const enteredUrl = prompt("Enter the full http(s) URL for this link:");
    if (enteredUrl === null) return;
    const url = safeHttpUrl(enteredUrl);
    if (!url) return notify("Enter a valid http or https URL.", true);
    restoreSelection();
    const selection = window.getSelection();
    if (selection?.toString()) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    }
    notifyEditorInput();
  });
  viewRoot.querySelector("[data-insert-table]").addEventListener("mousedown", (event) => event.preventDefault());
  viewRoot.querySelector("[data-insert-table]").addEventListener("click", () => {
    const rowCount = prompt("Number of rows (1-10):", "3");
    if (rowCount === null) return;
    const columnCount = prompt("Number of columns (1-10):", "3");
    if (columnCount === null) return;
    const rows = Number(rowCount);
    const columns = Number(columnCount);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 10 || columns < 1 || columns > 10) {
      notify("Table dimensions must be whole numbers from 1 to 10.", true);
      return;
    }
    const tableRows = Array.from({ length: rows }, () =>
      `<tr>${Array.from({ length: columns }, () => "<td><br></td>").join("")}</tr>`).join("");
    restoreSelection();
    document.execCommand("insertHTML", false, `<table><tbody>${tableRows}</tbody></table><p><br></p>`);
    notifyEditorInput();
  });
  viewRoot.querySelector("[data-insert-image]").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 350_000) {
      notify("Choose a PNG, JPEG, GIF, or WebP image smaller than 350 KB.", true);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith(`data:${file.type};base64,`)) {
        notify("The image could not be read.", true);
        return;
      }
      restoreSelection();
      document.execCommand("insertHTML", false, `<img src="${reader.result}" alt="${escapeHtml(file.name)}"><p><br></p>`);
      notifyEditorInput();
    });
    reader.addEventListener("error", () => notify("The image could not be read.", true));
    reader.readAsDataURL(file);
  });
  document.querySelector("#add-section").addEventListener("click", () => {
    const section = document.createElement("details");
    section.className = "section-editor";
    section.open = true;
    section.innerHTML = `<summary><span class="section-title">New section</span></summary><div class="section-meta"><label>Section heading<input class="section-heading-input" maxlength="240" value="New section"></label><label>Style<select class="section-level" aria-label="Heading level"><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option></select></label></div><div class="section-content editor" contenteditable="true" role="textbox" aria-label="New section content" aria-multiline="true" spellcheck="true"><p></p></div><div class="section-actions"><button class="button small danger remove-section" type="button">Remove section</button></div>`;
    container.append(section);
    refreshOutline();
    const editor = section.querySelector(".section-content");
    const rememberSelection = () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
        state.activeEditor = editor;
        state.savedSelection = selection.getRangeAt(0).cloneRange();
      }
    };
    editor.addEventListener("focus", () => { state.activeEditor = editor; });
    editor.addEventListener("mouseup", rememberSelection);
    editor.addEventListener("keyup", rememberSelection);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    editor.focus({ preventScroll: true });
    scheduleSave();
  });
  container.addEventListener("click", (event) => {
    if (event.target.matches(".remove-section")) {
      event.preventDefault();
      event.target.closest(".section-editor").remove();
      refreshOutline();
      scheduleSave();
    }
  });
  const validateButton = document.querySelector("#validate-document");
  const historyButton = document.querySelector("#toggle-document-history");
  if (historyButton) historyButton.addEventListener("click", async () => {
    const historyPanel = document.querySelector("#document-history");
    const opening = historyPanel.hidden;
    historyPanel.hidden = !opening;
    historyButton.setAttribute("aria-expanded", String(opening));
    if (!opening) return;
    historyPanel.innerHTML = '<p class="muted">Loading version history…</p>';
    try {
      const result = await api(`/api/documents/${encodeURIComponent(documentId)}/versions`);
      historyPanel.innerHTML = `<h3>Saved versions</h3>${renderDocumentHistory(result.versions)}`;
      historyPanel.querySelectorAll("[data-preview-version]").forEach((button) => {
        button.addEventListener("click", async () => {
          const preview = button.closest(".version-item").querySelector(".version-preview");
          if (!preview.hidden) {
            preview.hidden = true;
            button.textContent = "Preview";
            return;
          }
          if (preview.dataset.loaded !== "true") {
            button.disabled = true;
            try {
              const version = await api(`/api/documents/${encodeURIComponent(documentId)}/versions/${button.dataset.previewVersion}`);
              preview.textContent = documentVersionPreviewText(version.version.content) || "This version is empty.";
              preview.dataset.loaded = "true";
            } catch (error) {
              notify(error.message, true);
              return;
            } finally {
              button.disabled = false;
            }
          }
          preview.hidden = false;
          button.textContent = "Hide preview";
        });
      });
      historyPanel.querySelectorAll("[data-restore-version]").forEach((button) => {
        button.addEventListener("click", async () => {
          const version = result.versions.find((item) => item.version_number === Number(button.dataset.restoreVersion));
          if (!version) return notify("That version is no longer available. Reload the history.", true);
          if (!confirm(`Restore version ${version.version_number}? Your current draft will be saved as a new version first.`)) return;
          button.disabled = true;
          try {
            if (!await save()) throw new Error("Save your current draft before restoring a version.");
            const snapshot = await api(`/api/documents/${encodeURIComponent(documentId)}/versions/${button.dataset.restoreVersion}`);
            const restored = await api(`/api/documents/${encodeURIComponent(documentId)}/autosave`, {
              method: "PUT",
              body: jsonBody({ content: snapshot.version.content, version: documentRecord.version }),
            });
            documentRecord.version = restored.version;
            documentRecord.content = snapshot.version.content;
            await renderView(state.view);
            notify(`Restored version ${version.version_number} as version ${restored.version}.`);
          } catch (error) {
            notify(error.message, true);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      historyPanel.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p><button class="button small" type="button" id="retry-document-history">Retry</button>`;
      historyPanel.querySelector("#retry-document-history").addEventListener("click", () => {
        historyButton.click();
        historyButton.click();
      });
    }
  });
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
  const form = document.querySelector("#citation-form");
  const sourceType = form.querySelector("#citation-source-type");
  const fieldVisibility = {
    journal_article: ["journal", "volume", "issue", "pages"],
    book: ["publisher", "edition"],
    webpage: ["website", "month", "day", "source_url"],
    report: ["publisher", "report_number", "source_url"],
    book_chapter: ["book_title", "editors", "pages", "publisher"],
    dissertation: ["institution", "degree_type", "source_url"],
    newspaper_article: ["journal", "month", "day", "pages", "source_url"],
  };
  const updateCitationFields = () => {
    const visibleFields = new Set(fieldVisibility[sourceType.value] || []);
    form.querySelectorAll("[data-citation-field]").forEach((field) => {
      field.hidden = !visibleFields.has(field.dataset.citationField);
    });
  };
  sourceType.addEventListener("change", updateCitationFields);
  updateCitationFields();
  document.querySelector("#lookup-citation-doi").addEventListener("click", async () => {
    const status = document.querySelector("#citation-lookup-status");
    const doi = form.elements.doi.value.trim();
    if (!doi) {
      status.textContent = "Enter a DOI first.";
      return;
    }
    const button = document.querySelector("#lookup-citation-doi");
    button.disabled = true;
    status.textContent = "Looking up DOI at Crossref…";
    try {
      const result = await api(`/api/citations/lookup?doi=${encodeURIComponent(doi)}`);
      const source = result.source;
      sourceType.value = source.source_type;
      updateCitationFields();
      const fields = {
        title: source.title,
        publication_year: source.publication_year,
        journal: source.journal,
        publisher: source.publisher,
        volume: source.volume,
        issue: source.issue,
        pages: source.pages,
        book_title: source.book_title,
        doi: source.doi,
        source_url: source.source_url,
      };
      for (const [name, value] of Object.entries(fields)) {
        if (value !== null && value !== undefined && form.elements[name]) form.elements[name].value = value;
      }
      if (Array.isArray(source.authors) && source.authors.length) {
        form.elements.author_names.value = source.authors
          .map((author) => `${author.lastName || ""}${author.firstName ? `, ${author.firstName}` : ""}`)
          .join("\n");
      }
      if (source.month) form.elements.month.value = new Date(2000, Number(source.month) - 1).toLocaleString(undefined, { month: "long" });
      if (source.day) form.elements.day.value = source.day;
      status.textContent = "Crossref details loaded. Review them before generating the citation.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const parseAuthors = (text) => text.split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
      if (!line.includes(",")) {
        const words = line.split(/\s+/);
        return { lastName: words.pop(), firstName: words.join(" ") };
      }
      const [lastName, ...givenNames] = line.split(",");
      return { lastName: lastName.trim(), firstName: givenNames.join(",").trim() };
    });
    const payload = {
      authors: parseAuthors(values.author_names || ""),
      editors: parseAuthors(values.editor_names || ""),
      group_author: values.group_author,
      publication_year: values.publication_year ? Number(values.publication_year) : null,
      style: values.style,
      source_type: values.source_type,
      title: values.title,
      journal: values.journal,
      publisher: values.publisher,
      volume: values.volume,
      issue: values.issue,
      pages: values.pages,
      edition: values.edition ? `${values.edition}` : "",
      book_title: values.book_title,
      website: values.website,
      report_number: values.report_number,
      institution: values.institution,
      degree_type: values.degree_type,
      month: values.month,
      day: values.day,
      doi: values.doi,
      source_url: values.source_url,
    };
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const output = document.querySelector("#citation-output");
    output.innerHTML = '<p class="muted">Creating APA 7 citation…</p>';
    try {
      const result = await api("/api/citations/generate", { method: "POST", body: jsonBody(payload) });
      output.innerHTML = `<div class="citation-result"><section><div class="section-heading"><h3>In-text citation</h3><button class="button small" type="button" data-copy-citation="in-text">Copy</button></div><p class="citation-text" id="citation-in-text"></p></section>
        <section><div class="section-heading"><h3>Reference-list entry</h3><button class="button small" type="button" data-copy-citation="reference">Copy</button></div><p class="reference-entry" id="citation-reference"></p></section>
        <ul class="citation-warnings"></ul><p class="muted citation-disclaimer">APA 7 formatting aid: verify source details and institution-specific requirements before submitting.</p></div>`;
      output.querySelector("#citation-in-text").textContent = result.in_text;
      const referenceElement = output.querySelector("#citation-reference");
      result.reference_parts.forEach((part) => {
        const item = part.italic ? document.createElement("em") : document.createTextNode(part.text);
        if (part.italic) item.textContent = part.text;
        referenceElement.append(item);
      });
      const warningList = output.querySelector(".citation-warnings");
      warningList.innerHTML = (result.warnings || []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
      output.querySelectorAll("[data-copy-citation]").forEach((button) => button.addEventListener("click", async () => {
        const element = button.dataset.copyCitation === "in-text"
          ? output.querySelector("#citation-in-text")
          : output.querySelector("#citation-reference");
        try {
          await navigator.clipboard.writeText(element.innerText);
          notify("Citation copied.");
        } catch (error) {
          notify(`Could not copy citation: ${error.message}`, true);
        }
      }));
    } catch (error) {
      output.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    } finally {
      submitButton.disabled = false;
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
