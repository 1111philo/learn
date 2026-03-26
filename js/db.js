/**
 * SQLite database module for 1111 Learn.
 * Uses sql.js (WASM) with persistence to chrome.storage.local.
 * Screenshots remain in IndexedDB — only referenced by key in the drafts table.
 */

const DB_STORAGE_KEY = '_sqliteDb';
const PERSIST_DEBOUNCE_MS = 1000;

let _db = null;
let _dirty = false;
let _persistTimer = null;

// -- Schema -------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS profile_summary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  summary TEXT NOT NULL DEFAULT '',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS courses (
  course_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  depends_on TEXT,
  is_user_created INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(course_id),
  name TEXT NOT NULL,
  description TEXT,
  depends_on TEXT,
  sequence INTEGER,
  status TEXT DEFAULT 'not_started',
  current_activity_index INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  final_work_product_url TEXT,
  journey_order INTEGER,
  rubric_criteria TEXT
);

CREATE TABLE IF NOT EXISTS summatives (
  course_id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  rubric TEXT NOT NULL,
  exemplar TEXT NOT NULL,
  tool TEXT,
  estimated_time INTEGER,
  personalized INTEGER DEFAULT 0,
  conversation_id TEXT,
  course_intro TEXT,
  summary_for_learner TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS summative_attempts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  screenshots TEXT,
  criteria_scores TEXT,
  overall_score REAL,
  mastery INTEGER DEFAULT 0,
  feedback TEXT,
  next_steps TEXT,
  is_baseline INTEGER DEFAULT 0,
  summary_for_learner TEXT,
  timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS gap_analysis (
  course_id TEXT PRIMARY KEY,
  gaps TEXT NOT NULL,
  suggested_focus TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS journeys (
  course_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  phase TEXT DEFAULT 'summative_setup',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES units(unit_id),
  type TEXT NOT NULL,
  activity_id TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(unit_id),
  type TEXT NOT NULL,
  goal TEXT NOT NULL,
  instruction TEXT,
  tips TEXT,
  sequence INTEGER,
  conversation_id TEXT REFERENCES conversations(id),
  rubric_criteria TEXT
);

CREATE INDEX IF NOT EXISTS idx_summative_attempts_course
  ON summative_attempts(course_id, attempt_number);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id),
  unit_id TEXT NOT NULL,
  screenshot_key TEXT,
  url TEXT,
  score REAL,
  feedback TEXT,
  strengths TEXT,
  improvements TEXT,
  recommendation TEXT,
  timestamp INTEGER,
  rubric_criteria_scores TEXT
);

CREATE INDEX IF NOT EXISTS idx_drafts_activity ON drafts(activity_id);

CREATE TABLE IF NOT EXISTS work_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  course_name TEXT,
  url TEXT,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT,
  refresh_token TEXT,
  user_json TEXT
);

CREATE TABLE IF NOT EXISTS pending_state (
  key TEXT PRIMARY KEY,
  state_json TEXT,
  updated_at INTEGER
);

`;

// Migrations for adding columns to existing tables.
// ALTER TABLE ADD COLUMN throws if column exists; caught in init().
const MIGRATIONS = [
  'ALTER TABLE units ADD COLUMN journey_order INTEGER',
  'ALTER TABLE units ADD COLUMN rubric_criteria TEXT',
  'ALTER TABLE activities ADD COLUMN rubric_criteria TEXT',
  'ALTER TABLE drafts ADD COLUMN rubric_criteria_scores TEXT',
  'ALTER TABLE summatives ADD COLUMN course_intro TEXT',
  'ALTER TABLE summatives ADD COLUMN summary_for_learner TEXT',
  'ALTER TABLE summative_attempts ADD COLUMN summary_for_learner TEXT',
];

// -- Initialization -----------------------------------------------------------

export async function init() {
  // sql-wasm.js is loaded as a classic script in sidepanel.html,
  // making initSqlJs available as a global before this module runs.
  const SQL = await globalThis.initSqlJs({
    locateFile: file => chrome.runtime.getURL(`lib/${file}`),
  });

  const stored = await chrome.storage.local.get(DB_STORAGE_KEY);
  if (stored[DB_STORAGE_KEY]) {
    _db = new SQL.Database(new Uint8Array(stored[DB_STORAGE_KEY]));
    // Ensure any new tables exist (for future schema additions)
    _db.run(SCHEMA_SQL);
    // Migrate: add new columns to existing tables (safe to re-run)
    for (const stmt of MIGRATIONS) {
      try { _db.run(stmt); } catch (_) { /* column already exists */ }
    }
    // Clean up any activity rows with bare (non-scoped) IDs from before the fix
    _db.run("DELETE FROM drafts WHERE activity_id NOT LIKE '%::%'");
    _db.run("DELETE FROM messages WHERE conversation_id IN (SELECT conversation_id FROM activities WHERE id NOT LIKE '%::%')");
    _db.run("DELETE FROM conversations WHERE activity_id NOT LIKE '%::%' AND activity_id IS NOT NULL");
    _db.run("DELETE FROM activities WHERE id NOT LIKE '%::%'");
    _dirty = true;
  } else {
    _db = new SQL.Database();
    _db.run(SCHEMA_SQL);
    _dirty = true;
    await persist();
  }

  // Persist on visibility change (panel hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _dirty) {
      persist();
    }
  });
}

// -- Query API ----------------------------------------------------------------

/** Execute a write statement (INSERT, UPDATE, DELETE). Marks DB dirty. */
export function run(sql, params = []) {
  _db.run(sql, params);
  _dirty = true;
  schedulePersist();
}

/** Execute multiple statements in a string (no params). Marks DB dirty. */
export function exec(sql) {
  _db.exec(sql);
  _dirty = true;
  schedulePersist();
}

/** Return the first row as an object, or null. */
export function query(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/** Return all rows as an array of objects. */
export function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// -- Persistence --------------------------------------------------------------

function schedulePersist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persist();
  }, PERSIST_DEBOUNCE_MS);
}

/** Serialize the database and save to chrome.storage.local. */
export async function persist() {
  if (!_db) return;
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  const data = _db.export();
  await chrome.storage.local.set({ [DB_STORAGE_KEY]: Array.from(data) });
  _dirty = false;
}

/** Return the raw sql.js Database instance (escape hatch). */
export function getDb() {
  return _db;
}

/** Drop all data and re-create the schema. Used by sign-out. */
export async function clearAllData() {
  if (_db) {
    _db.close();
  }
  _db = null;
  _dirty = false;
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  await chrome.storage.local.remove(DB_STORAGE_KEY);
}
