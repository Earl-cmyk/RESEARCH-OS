PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_title TEXT NOT NULL,
    research_field TEXT NOT NULL DEFAULT '',
    research_type TEXT NOT NULL DEFAULT 'Mixed Methods',
    institution TEXT NOT NULL DEFAULT '',
    research_status TEXT NOT NULL DEFAULT 'Draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated
    ON research_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    document_title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project_updated
    ON documents(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content_snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version_number)
);

CREATE TABLE IF NOT EXISTS research_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    publication_year INTEGER,
    journal TEXT NOT NULL DEFAULT '',
    abstract TEXT NOT NULL DEFAULT '',
    doi TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    publication_type TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    metadata_verified INTEGER NOT NULL DEFAULT 0 CHECK (metadata_verified IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_project_title
    ON research_sources(project_id, lower(title));
CREATE INDEX IF NOT EXISTS idx_sources_doi
    ON research_sources(doi) WHERE doi <> '';

CREATE TABLE IF NOT EXISTS appendices (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    appendix_letter TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    original_filename TEXT NOT NULL,
    original_storage_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    page_count INTEGER,
    ordering_position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appendices_project_order
    ON appendices(project_id, ordering_position);

CREATE TABLE IF NOT EXISTS statistical_analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
    analysis_name TEXT NOT NULL,
    test_type TEXT NOT NULL,
    input_data TEXT NOT NULL,
    results TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_project_created
    ON statistical_analyses(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS writing_analyses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_type TEXT NOT NULL,
    original_text TEXT NOT NULL,
    analysis_results TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_analyses_user_created
    ON writing_analyses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_generation_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_type TEXT NOT NULL,
    input_content TEXT NOT NULL,
    output_content TEXT NOT NULL,
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_history_user_created
    ON ai_generation_history(user_id, created_at DESC);
