-- Multi-Document Intelligence Workbench – SQLite schema.
-- Applied idempotently at start-up (see db.ts).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,                       -- sanitised original filename (display only)
  format            TEXT,                                -- pdf | png | jpeg | csv | txt | md
  mime_type         TEXT,                                -- detected from content, never client supplied
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT,
  storage_key       TEXT,                                -- uuid file name in STORAGE_DIR; NULL when not stored
  status            TEXT NOT NULL CHECK (status IN ('ready','partial','failed','rejected')),
  status_reason     TEXT,
  extraction_method TEXT CHECK (extraction_method IN ('text-layer','ocr','native')),
  page_count        INTEGER,
  char_count        INTEGER NOT NULL DEFAULT 0,
  warnings          TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS pages (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (document_id, page_no)
);

CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  ref         TEXT NOT NULL,                             -- stable short ref, e.g. 'p2-c1'
  page_no     INTEGER NOT NULL,
  char_start  INTEGER NOT NULL,                          -- offsets within pages.text
  char_end    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  UNIQUE (document_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id, ordinal);

-- Deterministically extracted facts (tier: extracted). No AI involved.
CREATE TABLE IF NOT EXISTS facts (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('labelled_field','blank_field','table_cell','date','money','identifier','email','phone','postcode')),
  label       TEXT,
  raw_value   TEXT NOT NULL,
  normalized  TEXT,
  char_start  INTEGER NOT NULL,                          -- offsets within pages.text
  char_end    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_doc ON facts(document_id, type);

CREATE TABLE IF NOT EXISTS analyses (
  id             TEXT PRIMARY KEY,
  instruction    TEXT NOT NULL,
  template_id    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('queued','planning','extracting','comparing','synthesising','completed','failed')),
  progress       TEXT NOT NULL DEFAULT '{"perDocument":{}}', -- JSON
  plan           TEXT,                                   -- JSON AnalysisPlan
  result         TEXT,                                   -- JSON AnalysisResult (validated)
  error          TEXT,
  provider       TEXT NOT NULL,
  model          TEXT,
  prompt_version TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at   TEXT
);

CREATE TABLE IF NOT EXISTS analysis_documents (
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,                             -- 'D1'… the only document handle the LLM sees
  position    INTEGER NOT NULL,
  PRIMARY KEY (analysis_id, document_id),
  UNIQUE (analysis_id, alias)
);

-- Audit trail and cache for language-model calls.
CREATE TABLE IF NOT EXISTS llm_calls (
  id          TEXT PRIMARY KEY,
  analysis_id TEXT REFERENCES analyses(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT,
  cache_key   TEXT NOT NULL,
  duration_ms INTEGER,
  outcome     TEXT NOT NULL CHECK (outcome IN ('ok','invalid_output','unavailable','error')),
  output      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_cache ON llm_calls(cache_key, outcome);
