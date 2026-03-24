import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

// -- Setup: initialize sql.js and wire up db.js functions in-process ----------

let SQL;
let _db;

// Minimal chrome.storage.local mock (only used by db.js persist — not tested)
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { getURL: (p) => p },
};

// We can't import db.js (it uses chrome.runtime.getURL for WASM loading),
// so we replicate its query API backed by the npm sql.js package.
function run(sql, params = []) { _db.run(sql, params); }
function query(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free();
  return null;
}
function queryAll(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Mock db.js exports so storage.js picks them up
const dbExports = { run, query, queryAll, persist: async () => {} };

// Dynamic import with module mock — we inject our db functions
// Since storage.js imports from './db.js', we use a loader trick:
// We'll just re-implement the storage functions inline using our query API.
// This tests the SQL logic directly.

// -- Schema (copied from db.js) -----------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile_summary (id INTEGER PRIMARY KEY CHECK (id = 1), summary TEXT NOT NULL DEFAULT '', updated_at INTEGER);
CREATE TABLE IF NOT EXISTS courses (course_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, depends_on TEXT, is_user_created INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS units (unit_id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(course_id), name TEXT NOT NULL, description TEXT, depends_on TEXT, sequence INTEGER, status TEXT DEFAULT 'not_started', current_activity_index INTEGER DEFAULT 0, started_at INTEGER, completed_at INTEGER, final_work_product_url TEXT);
CREATE TABLE IF NOT EXISTS learning_plans (unit_id TEXT PRIMARY KEY REFERENCES units(unit_id), final_work_product_description TEXT, work_product_tool TEXT, data TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, unit_id TEXT REFERENCES units(unit_id), type TEXT NOT NULL, activity_id TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp);
CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(unit_id), type TEXT NOT NULL, goal TEXT NOT NULL, instruction TEXT, tips TEXT, sequence INTEGER, conversation_id TEXT REFERENCES conversations(id));
CREATE TABLE IF NOT EXISTS diagnostics (unit_id TEXT PRIMARY KEY REFERENCES units(unit_id), conversation_id TEXT REFERENCES conversations(id), instruction TEXT, score REAL, feedback TEXT, strengths TEXT, improvements TEXT, recommendation TEXT, passed INTEGER, skip_for TEXT);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id), unit_id TEXT NOT NULL, screenshot_key TEXT, url TEXT, score REAL, feedback TEXT, strengths TEXT, improvements TEXT, recommendation TEXT, timestamp INTEGER);
CREATE INDEX IF NOT EXISTS idx_drafts_activity ON drafts(activity_id);
CREATE TABLE IF NOT EXISTS work_products (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id TEXT NOT NULL, course_name TEXT, url TEXT, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT, refresh_token TEXT, user_json TEXT);
CREATE TABLE IF NOT EXISTS pending_state (key TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS dev_log (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, data TEXT, timestamp INTEGER);
`;

// -- Inline storage functions (same SQL logic as storage.js) ------------------

// We import storage.js but override the db dependency. Since that's hard with
// static ESM, we instead test by calling the SQL directly — this validates
// the schema and the query patterns that storage.js uses.

beforeEach(async () => {
  if (!SQL) SQL = await initSqlJs();
  _db = new SQL.Database();
  _db.run(SCHEMA_SQL);
  // Seed a course so unit FK works
  run('INSERT INTO courses (course_id, name) VALUES (?, ?)', ['foundations', 'Foundations']);
});

// -- Tests --------------------------------------------------------------------

describe('SQLite schema', () => {
  it('creates all tables without error', () => {
    const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = tables.map(t => t.name);
    assert.ok(names.includes('settings'));
    assert.ok(names.includes('units'));
    assert.ok(names.includes('conversations'));
    assert.ok(names.includes('messages'));
    assert.ok(names.includes('activities'));
    assert.ok(names.includes('drafts'));
    assert.ok(names.includes('profile'));
    assert.ok(names.includes('work_products'));
  });
});

describe('settings (key-value)', () => {
  it('stores and retrieves a setting', () => {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('apiKey', ?)", [JSON.stringify('sk-test')]);
    const row = query("SELECT value FROM settings WHERE key = 'apiKey'");
    assert.equal(JSON.parse(row.value), 'sk-test');
  });

  it('returns null for missing setting', () => {
    const row = query("SELECT value FROM settings WHERE key = 'missing'");
    assert.equal(row, null);
  });
});

describe('preferences (singleton)', () => {
  it('round-trips preferences', () => {
    const prefs = { name: 'Blake' };
    run('INSERT OR REPLACE INTO preferences (id, data, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(prefs), Date.now()]);
    const row = query('SELECT data FROM preferences WHERE id = 1');
    assert.deepEqual(JSON.parse(row.data), prefs);
  });
});

describe('profile', () => {
  it('round-trips learner profile', () => {
    const profile = { name: 'Blake', goal: 'Learn web dev', strengths: ['css'], weaknesses: [] };
    run('INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(profile), Date.now()]);
    const row = query('SELECT data FROM profile WHERE id = 1');
    assert.deepEqual(JSON.parse(row.data), profile);
  });
});

describe('unit progress round-trip', () => {
  const unitId = 'foundations-0-basic-wordpress';

  function saveUnitProgress(unitId, progress) {
    run('BEGIN TRANSACTION');
    const courseId = 'foundations';

    run(
      `INSERT OR REPLACE INTO units
       (unit_id, course_id, name, description, sequence, status,
        current_activity_index, started_at, completed_at, final_work_product_url)
       VALUES (?, ?, '', '', 0, ?, ?, ?, ?, ?)`,
      [unitId, courseId, progress.status, progress.currentActivityIndex || 0,
       progress.startedAt || null, progress.completedAt || null, progress.finalWorkProductUrl || null]
    );

    if (progress.learningPlan) {
      run(
        `INSERT OR REPLACE INTO learning_plans (unit_id, final_work_product_description, work_product_tool, data, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [unitId, progress.learningPlan.finalWorkProductDescription, progress.learningPlan.workProductTool,
         JSON.stringify(progress.learningPlan), Date.now()]
      );
    }

    if (progress.diagnostic) {
      const diagConvId = `diag-${unitId}`;
      run('INSERT OR IGNORE INTO conversations (id, unit_id, type, created_at) VALUES (?, ?, ?, ?)',
        [diagConvId, unitId, 'diagnostic', Date.now()]);
      run('DELETE FROM messages WHERE conversation_id = ?', [diagConvId]);
      for (const m of progress.diagnostic.messages || []) {
        run('INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
          [diagConvId, m.role, m.content, m.timestamp || Date.now()]);
      }
      const result = progress.diagnostic.result;
      run(
        `INSERT OR REPLACE INTO diagnostics
         (unit_id, conversation_id, instruction, score, feedback, strengths, improvements, recommendation, passed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [unitId, diagConvId, progress.diagnostic.instruction,
         result?.score ?? null, result?.feedback || null,
         result?.strengths ? JSON.stringify(result.strengths) : null,
         result?.improvements ? JSON.stringify(result.improvements) : null,
         result?.recommendation || null, result?.passed ? 1 : 0]
      );
    }

    const acts = progress.activities || [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const actId = a.id || `act-${unitId}-${i}`;
      const convId = `activity-${unitId}-${actId}`;
      run('INSERT OR IGNORE INTO conversations (id, unit_id, type, activity_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [convId, unitId, 'activity', actId, Date.now()]);
      run('DELETE FROM messages WHERE conversation_id = ?', [convId]);
      for (const m of a.messages || []) {
        run('INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
          [convId, m.role, m.content, m.timestamp || Date.now()]);
      }
      run(
        `INSERT OR REPLACE INTO activities (id, unit_id, type, goal, instruction, tips, sequence, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [actId, unitId, a.type, a.goal, a.instruction || null, a.tips || null, i, convId]
      );
    }

    for (const d of progress.drafts || []) {
      run(
        `INSERT OR REPLACE INTO drafts
         (id, activity_id, unit_id, screenshot_key, url, score, feedback, strengths, improvements, recommendation, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.id, d.activityId, unitId, d.screenshotKey || null, d.url || null,
         d.score ?? null, d.feedback || null,
         d.strengths ? JSON.stringify(d.strengths) : null,
         d.improvements ? JSON.stringify(d.improvements) : null,
         d.recommendation || null, d.timestamp || Date.now()]
      );
    }

    run('COMMIT');
  }

  function getUnitProgress(unitId) {
    const unitRow = query('SELECT * FROM units WHERE unit_id = ?', [unitId]);
    if (!unitRow) return null;

    const planRow = query('SELECT * FROM learning_plans WHERE unit_id = ?', [unitId]);
    let learningPlan = null;
    if (planRow) {
      const planData = planRow.data ? JSON.parse(planRow.data) : null;
      learningPlan = {
        activities: planData?.activities || [],
        finalWorkProductDescription: planRow.final_work_product_description,
        workProductTool: planRow.work_product_tool,
      };
    }

    const diagRow = query('SELECT * FROM diagnostics WHERE unit_id = ?', [unitId]);
    let diagnostic = null;
    if (diagRow) {
      const diagMessages = diagRow.conversation_id
        ? queryAll('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp',
            [diagRow.conversation_id])
        : [];
      diagnostic = {
        instruction: diagRow.instruction,
        messages: diagMessages.map(m => ({ role: m.role, content: m.content })),
        result: diagRow.score != null ? {
          score: diagRow.score,
          feedback: diagRow.feedback,
          strengths: diagRow.strengths ? JSON.parse(diagRow.strengths) : [],
          improvements: diagRow.improvements ? JSON.parse(diagRow.improvements) : [],
          recommendation: diagRow.recommendation,
          passed: !!diagRow.passed,
        } : null,
      };
    }

    const activityRows = queryAll('SELECT * FROM activities WHERE unit_id = ? ORDER BY sequence', [unitId]);
    const activities = activityRows.map(a => {
      const msgs = a.conversation_id
        ? queryAll('SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp',
            [a.conversation_id])
        : [];
      return {
        id: a.id, type: a.type, goal: a.goal, instruction: a.instruction, tips: a.tips,
        messages: msgs.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      };
    });

    const draftRows = queryAll('SELECT * FROM drafts WHERE unit_id = ? ORDER BY timestamp', [unitId]);
    const drafts = draftRows.map(d => ({
      id: d.id, activityId: d.activity_id, screenshotKey: d.screenshot_key, url: d.url,
      feedback: d.feedback,
      strengths: d.strengths ? JSON.parse(d.strengths) : [],
      improvements: d.improvements ? JSON.parse(d.improvements) : [],
      score: d.score, recommendation: d.recommendation, timestamp: d.timestamp,
    }));

    return {
      unitId: unitRow.unit_id, status: unitRow.status,
      currentActivityIndex: unitRow.current_activity_index,
      diagnostic, learningPlan, activities, drafts,
      startedAt: unitRow.started_at, completedAt: unitRow.completed_at,
      finalWorkProductUrl: unitRow.final_work_product_url,
    };
  }

  it('returns null for non-existent unit', () => {
    assert.equal(getUnitProgress('no-such-unit'), null);
  });

  it('round-trips a full unit progress blob', () => {
    const now = Date.now();
    const progress = {
      unitId,
      status: 'in_progress',
      currentActivityIndex: 1,
      diagnostic: {
        instruction: 'Tell me about your WordPress experience.',
        messages: [
          { role: 'assistant', content: 'What do you know about WordPress?', timestamp: now - 5000 },
          { role: 'user', content: 'I have used it a bit.', timestamp: now - 4000 },
        ],
        result: {
          score: 0.6,
          feedback: 'Moderate familiarity',
          strengths: ['basic navigation'],
          improvements: ['theme customization'],
          recommendation: 'continue',
          passed: false,
        },
      },
      learningPlan: {
        activities: [
          { id: 'a1', type: 'explore', goal: 'Explore the WP dashboard' },
          { id: 'a2', type: 'apply', goal: 'Customize a theme' },
        ],
        finalWorkProductDescription: 'A customized WordPress page',
        workProductTool: 'WordPress',
      },
      activities: [
        {
          id: 'a1', type: 'explore', goal: 'Explore the WP dashboard',
          instruction: 'Navigate to wp-admin and explore.',
          tips: 'Look at the sidebar menu.',
          messages: [
            { role: 'user', content: 'Where is the theme editor?', timestamp: now - 1000 },
            { role: 'assistant', content: 'Go to Appearance > Editor.', timestamp: now - 500 },
          ],
        },
        {
          id: 'a2', type: 'apply', goal: 'Customize a theme',
          instruction: 'Change the site title and colors.',
          tips: 'Use the Customizer.',
          messages: [],
        },
      ],
      drafts: [
        {
          id: 'draft-1000',
          activityId: 'a1',
          screenshotKey: 'activity-a1-draft-1000',
          url: 'https://example.com/wp-admin',
          feedback: 'Good start',
          strengths: ['found the menu'],
          improvements: ['explore more'],
          score: 0.7,
          recommendation: 'advance',
          timestamp: now,
        },
      ],
      startedAt: now - 10000,
      completedAt: null,
      finalWorkProductUrl: null,
    };

    saveUnitProgress(unitId, progress);
    const loaded = getUnitProgress(unitId);

    // Core fields
    assert.equal(loaded.unitId, unitId);
    assert.equal(loaded.status, 'in_progress');
    assert.equal(loaded.currentActivityIndex, 1);
    assert.equal(loaded.startedAt, now - 10000);
    assert.equal(loaded.completedAt, null);

    // Diagnostic
    assert.equal(loaded.diagnostic.instruction, progress.diagnostic.instruction);
    assert.equal(loaded.diagnostic.messages.length, 2);
    assert.equal(loaded.diagnostic.messages[0].role, 'assistant');
    assert.equal(loaded.diagnostic.result.score, 0.6);
    assert.deepEqual(loaded.diagnostic.result.strengths, ['basic navigation']);

    // Learning plan
    assert.equal(loaded.learningPlan.activities.length, 2);
    assert.equal(loaded.learningPlan.finalWorkProductDescription, 'A customized WordPress page');

    // Activities
    assert.equal(loaded.activities.length, 2);
    assert.equal(loaded.activities[0].id, 'a1');
    assert.equal(loaded.activities[0].instruction, 'Navigate to wp-admin and explore.');
    assert.equal(loaded.activities[0].messages.length, 2);
    assert.equal(loaded.activities[0].messages[1].content, 'Go to Appearance > Editor.');
    assert.equal(loaded.activities[1].messages.length, 0);

    // Drafts
    assert.equal(loaded.drafts.length, 1);
    assert.equal(loaded.drafts[0].activityId, 'a1');
    assert.equal(loaded.drafts[0].score, 0.7);
    assert.deepEqual(loaded.drafts[0].strengths, ['found the menu']);
    assert.equal(loaded.drafts[0].screenshotKey, 'activity-a1-draft-1000');
  });

  it('overwrites existing progress on re-save', () => {
    saveUnitProgress(unitId, {
      status: 'in_progress', currentActivityIndex: 0,
      learningPlan: null, diagnostic: null, activities: [], drafts: [],
      startedAt: 1000, completedAt: null, finalWorkProductUrl: null,
    });

    saveUnitProgress(unitId, {
      status: 'completed', currentActivityIndex: 2,
      learningPlan: null, diagnostic: null, activities: [], drafts: [],
      startedAt: 1000, completedAt: 2000, finalWorkProductUrl: 'https://example.com',
    });

    const loaded = getUnitProgress(unitId);
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.completedAt, 2000);
    assert.equal(loaded.finalWorkProductUrl, 'https://example.com');
  });

  it('handles progress with no diagnostic', () => {
    saveUnitProgress(unitId, {
      status: 'in_progress', currentActivityIndex: 0,
      learningPlan: null, diagnostic: null, activities: [], drafts: [],
      startedAt: 1000, completedAt: null, finalWorkProductUrl: null,
    });

    const loaded = getUnitProgress(unitId);
    assert.equal(loaded.diagnostic, null);
  });
});

describe('conversations and messages', () => {
  it('stores messages in separate table with proper ordering', () => {
    const convId = 'test-conv-1';
    run('INSERT INTO conversations (id, type, created_at) VALUES (?, ?, ?)',
      [convId, 'activity', Date.now()]);
    run('INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
      [convId, 'user', 'Hello', 100]);
    run('INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
      [convId, 'assistant', 'Hi there', 200]);

    const msgs = queryAll(
      'SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp',
      [convId]
    );
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].timestamp, 200);
  });
});

describe('work products', () => {
  it('inserts and retrieves work products', () => {
    run('INSERT INTO work_products (unit_id, course_name, url, completed_at) VALUES (?, ?, ?, ?)',
      ['unit-1', 'Foundations', 'https://example.com', 1000]);
    run('INSERT INTO work_products (unit_id, course_name, url, completed_at) VALUES (?, ?, ?, ?)',
      ['unit-2', 'Advanced', 'https://example.com/2', 2000]);

    const rows = queryAll('SELECT * FROM work_products ORDER BY completed_at');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].unit_id, 'unit-1');
    assert.equal(rows[1].course_name, 'Advanced');
  });
});

describe('auth (singleton)', () => {
  it('stores and retrieves auth tokens', () => {
    run('INSERT INTO auth (id, access_token, refresh_token, user_json) VALUES (1, ?, ?, ?)',
      ['at-123', 'rt-456', JSON.stringify({ email: 'test@test.com' })]);

    const row = query('SELECT * FROM auth WHERE id = 1');
    assert.equal(row.access_token, 'at-123');
    assert.deepEqual(JSON.parse(row.user_json), { email: 'test@test.com' });
  });
});

describe('pending state', () => {
  it('stores and retrieves diagnostic state', () => {
    const state = { phase: 'activity', messages: [{ role: 'user', content: 'hi' }] };
    run("INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES ('diagnostic', ?, ?)",
      [JSON.stringify(state), Date.now()]);

    const row = query("SELECT state_json FROM pending_state WHERE key = 'diagnostic'");
    assert.deepEqual(JSON.parse(row.state_json), state);
  });

  it('clears pending state', () => {
    run("INSERT INTO pending_state (key, state_json) VALUES ('onboarding', ?)", [JSON.stringify({})]);
    run("DELETE FROM pending_state WHERE key = 'onboarding'");
    const row = query("SELECT * FROM pending_state WHERE key = 'onboarding'");
    assert.equal(row, null);
  });
});
