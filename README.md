# Research OS

Research OS is a private academic research workspace built on Flask, HTML, CSS, JavaScript, and PostgreSQL/Supabase (SQLite remains available for local development and tests). It supports research projects, manuscript drafting, scholarly source discovery, references, deterministic statistics, AI-assisted writing, appendix storage, and document export.

## Run locally

1. Install Python 3.12 or newer.
2. Create and activate a virtual environment:

   ```powershell
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Copy `.env.example` to `.env`. Set a long, unique `SECRET_KEY`. For Supabase, paste the PostgreSQL connection URI from **Project Settings → Database → Connection string** into `DATABASE_URL` (include SSL; use the session pooler if direct connections are unavailable). Add `GEMINI_API_KEY` to enable AI writing tools; it is read only by the backend. The default Gemini model is `gemini-3.1-flash-lite`.
5. Start the server:

   ```powershell
   python app.py
   ```

6. Open <http://127.0.0.1:5000> and create an account. New accounts start with an empty workspace; no sample research data is presented as real.

When `DATABASE_URL` is set, the app uses PostgreSQL and initializes its application tables automatically; otherwise it falls back to SQLite at `DATABASE_PATH` for local work. PostgreSQL uses one connection per request; configure Supabase connection pooling for larger deployments. Uploaded files remain private local files under `UPLOAD_FOLDER`; for a hosted multi-instance deployment, configure Supabase Storage or another shared private object store before scaling out.

## Architecture

```text
Browser
  └── Flask-rendered page + static JavaScript/CSS
       └── same-origin JSON API (/api/...)
            ├── PostgreSQL/Supabase or local SQLite
            ├── private appendix storage (instance/uploads/)
            ├── Crossref Works API (verified provider records)
            ├── Gemini API (optional, server-side only)
            └── deterministic statistics and DOCX/PDF generation
```

### Project structure

```text
app.py                  Flask routes, validation, access controls, and exports
ai_service.py           Central Gemini client
schema.sql              Relational schema, foreign keys, and indexes
templates/index.html    Application shell and authentication screen
static/app.js           Same-origin API client and workspace interactions
static/styles.css       Responsive workspace styling
tests/test_app.py       API, privacy, autosave, statistics, and export tests
instance/                Local database and private uploaded files (not source)
```

### Data model

```text
users 1──* research_projects 1──* documents 1──* document_versions
                         ├──* research_sources
                         ├──* appendices
                         └──* statistical_analyses
users 1──* writing_analyses
users 1──* ai_generation_history
```

Project-owned records cascade when a project is deleted. Uploaded binaries are kept outside the database; the database stores a private path and file metadata.

### API overview

Project/data write operations require the signed-in session and the `X-CSRF-Token` returned by `/api/auth/me`, login, or registration. AI generation requires an authenticated session and generated requests/results are stored in private account-scoped history; statistical input files are processed temporarily and are not saved to the project. JSON errors have the shape `{"error":{"code":"...","message":"..."}}`.

| Area | Routes |
|---|---|
| Health and account | `GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/{id}` (multiple account-owned projects) |
| Manuscripts | `GET /api/projects/{id}/documents`, `PUT /api/documents/{id}/autosave`, `GET /api/documents/{id}/versions`, `GET /api/documents/{id}/versions/{version_number}` |
| Writing | `POST /api/writing/grammar`, `/ai-analysis`, `/correct`, `/refine`, `/summarize` |
| Literature | `GET /api/literature/search?q=...`, `GET/POST /api/projects/{id}/sources`, `POST /api/projects/{id}/sources/import` (RIS/BibTeX), `POST /api/projects/{id}/literature/synthesize`, `DELETE /api/projects/{id}/sources/{source_id}` |
| Frameworks | `POST /api/projects/{id}/framework` (Gemini-generated draft), `GET/POST /api/projects/{id}/frameworks`, `PUT/DELETE /api/frameworks/{board_id}` (editable, project-scoped whiteboard boards) |
| Citations | `POST /api/citations/generate` (APA 7 journal articles, books, webpages, reports, edited-book chapters, dissertations, and newspaper articles), `GET /api/citations/lookup?doi=...` (Crossref metadata lookup), `GET /api/projects/{id}/references` |
| Statistics | `GET /api/statistics/catalog`, `POST /api/statistics/calculate`, `POST /api/statistics/import` (CSV/XLS/XLSX) |
| Appendices | `GET/POST /api/projects/{id}/appendices`, `GET /api/appendices/{id}/preview` (PDF/image/TXT/CSV), `GET/DELETE /api/appendices/{id}` |
| Compilation | `POST /api/export/validate`, `POST /api/export/{docx,pdf}` (CSRF-protected), `GET /api/export/{docx,pdf}?project_id=...` (authenticated download) |

### Primary screen layout

```text
┌─────────────────────┬──────────────────────────────────────────┐
│ Research OS         │ Page title                 Account       │
│ Current project     ├──────────────────────────────────────────┤
│ Dashboard           │ Current project / current tool            │
│ My Research         │                                          │
│ Writing Lab         │ Editor, literature, statistics, or files  │
│ Frameworkshop       │ Canva-style framework whiteboard          │
│ Literature Review   │                                          │
│ Statistical Lab     │                                          │
│ Manuscript Editor  │                                          │
│ Appendices          │                                          │
│ References          │                                          │
└─────────────────────┴──────────────────────────────────────────┘
```

## Current functionality and boundaries

- Account registration/login, password hashing, private project ownership, CSRF checks on writes, and same-origin API requests are implemented. Each account can create and switch between multiple independent manuscripts from the dashboard or My Research.
- Basic request throttling is in-process for login, AI, and scholarly search endpoints. It is a development safeguard, not a substitute for shared rate limiting behind a multi-worker production deployment.
- Project manuscripts use debounced autosave and immutable prior snapshots. The Manuscript Editor includes collapsible sections, basic rich-text formatting, links, tables, local image insertion, version previews/restoration, DOCX/PDF export, and basic completeness checks; validation is not an academic approval. Rich content in exports is currently linearized to readable text rather than preserving all editor styling. Project title, field, type, institution, and status can be updated from My Research. Accounts can create and switch between multiple independent projects.
- Literature results come from Crossref. The app does not invent source metadata; provider records are stored with their source URLs and verification indicator.
- The literature workspace imports RIS and BibTeX metadata as unverified, deduplicates within a project, and can request a source-grounded Gemini synthesis from saved records. The APA 7 citation generator supports common source types, in-text parenthetical/narrative citations, italicized reference components, optional Crossref DOI lookup, and warnings for missing metadata; it is a formatting aid and should be checked against the source and institution's requirements.
- Statistics support descriptive summaries, Slovin sample-size estimates, Pearson and Spearman correlations, one-sample and paired t-tests, Welch's independent t-test, Mann–Whitney U, one-way ANOVA, Kruskal-Wallis, and chi-square independence tests. CSV, XLS, and XLSX files can be uploaded for temporary analysis; select the sheet and data columns in the UI. Imported rows are not persisted to the project. Statistical output includes assumptions and limitations; it is not a substitute for checking study design, data quality, or specialist review.
- AI writing features use Google's Gemini `generateContent` API. AI scores are not proof of authorship, and generated text remains a researcher-reviewed suggestion.
- The saved-source "verified" flag is assigned by the backend only after Crossref confirms its DOI; user-submitted metadata remains unverified.
- Literature synthesis is an optional Gemini draft based on up to ten saved source records and their available abstracts. It uses project-local source keys, rejects citations to unknown keys, and requires researcher verification; it is not an evidence review.
- Frameworkshop accepts study text and an optional framework description, then requests a theory-grounded or conceptual model with constructs, proposed relationships, an editable diagram, and manuscript-ready draft prose. Boards save per project and support text, shapes, connections, and arrangement; generated frameworks must be reviewed because proposed theories and relationships are not independently validated.
- Appendix originals are retained privately. PDFs, common images, TXT, and CSV can be previewed; DOCX and spreadsheet files remain download-only, and originals are not inserted into the compiled document.
- PostgreSQL/Supabase is supported when `DATABASE_URL` is configured; SQLite remains the local test/development fallback. Live Supabase behavior requires verification against a configured project. Team collaboration, instrument discovery, full citation validation, expanded statistical visualization, appendix selection, and institution-specific pagination remain later implementation phases.
- The obsolete TypeScript/Vite artifacts were removed after the Python migration. The Vite entry point was absent, and multiple source filenames contained unrelated code or image data.
- The browser and Flask API must be served from the same origin. If the browser reports that it cannot connect, start the backend from the project directory with `python app.py` and reload the page; the UI also provides a retry action for transient server outages.

## Implementation roadmap

1. **Foundation — implemented:** local account access, project CRUD, relational persistence, document autosave/revisions, responsive navigation.
2. **Writing and research — initial vertical slice:** Gemini writing tools and Crossref search/source saving.
3. **APA and statistics — initial vertical slice:** APA-style citations/references and selected deterministic statistical methods.
4. **Document workflow — initial vertical slice:** editable chapter sections, basic validation, appendix upload, DOCX/PDF export.
5. **Production completion:** managed schema migrations, collaboration/roles, broader source providers and instrument catalog, expanded statistics/assumption checks/charts, appendix previews and selection, robust pagination, and broader security/integration tests.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Tests force SQLite and use temporary databases and upload folders, even when a deployment `DATABASE_URL` is present in `.env`. They do not contact Gemini or scholarly APIs.

## Deployment notes

- Use a unique secret key, HTTPS, `COOKIE_SECURE=true`, and a production WSGI server such as Gunicorn.
- Add a real database migration process and a shared rate limiter before running multiple production workers.
- Do not expose the SQLite file or upload directory through a static web server.
- Configure backups and access-restricted storage for private research files.
- The default development server is bound to `127.0.0.1`; set `HOST` explicitly for a trusted deployment.
#   R E S E A R C H - O S  
 