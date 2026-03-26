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

// -- Schema (matches db.js) ---------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profile_summary (id INTEGER PRIMARY KEY CHECK (id = 1), summary TEXT NOT NULL DEFAULT '', updated_at INTEGER);
CREATE TABLE IF NOT EXISTS courses (course_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, depends_on TEXT, is_user_created INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS units (unit_id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(course_id), name TEXT NOT NULL, description TEXT, depends_on TEXT, sequence INTEGER, status TEXT DEFAULT 'not_started', current_activity_index INTEGER DEFAULT 0, started_at INTEGER, completed_at INTEGER, final_work_product_url TEXT, journey_order INTEGER, rubric_criteria TEXT);
CREATE TABLE IF NOT EXISTS summatives (course_id TEXT PRIMARY KEY, task TEXT NOT NULL, rubric TEXT NOT NULL, exemplar TEXT NOT NULL, tool TEXT, estimated_time INTEGER, personalized INTEGER DEFAULT 0, conversation_id TEXT, course_intro TEXT, summary_for_learner TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS summative_attempts (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, screenshots TEXT, criteria_scores TEXT, overall_score REAL, mastery INTEGER DEFAULT 0, feedback TEXT, next_steps TEXT, is_baseline INTEGER DEFAULT 0, summary_for_learner TEXT, timestamp INTEGER);
CREATE INDEX IF NOT EXISTS idx_summative_attempts_course ON summative_attempts(course_id, attempt_number);
CREATE TABLE IF NOT EXISTS gap_analysis (course_id TEXT PRIMARY KEY, gaps TEXT NOT NULL, suggested_focus TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS journeys (course_id TEXT PRIMARY KEY, plan TEXT NOT NULL, phase TEXT DEFAULT 'summative_setup', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, unit_id TEXT REFERENCES units(unit_id), type TEXT NOT NULL, activity_id TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, timestamp);
CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(unit_id), type TEXT NOT NULL, goal TEXT NOT NULL, instruction TEXT, tips TEXT, sequence INTEGER, conversation_id TEXT REFERENCES conversations(id), rubric_criteria TEXT);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id), unit_id TEXT NOT NULL, screenshot_key TEXT, url TEXT, score REAL, feedback TEXT, strengths TEXT, improvements TEXT, recommendation TEXT, timestamp INTEGER, rubric_criteria_scores TEXT);
CREATE INDEX IF NOT EXISTS idx_drafts_activity ON drafts(activity_id);
CREATE TABLE IF NOT EXISTS work_products (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id TEXT NOT NULL, course_name TEXT, url TEXT, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK (id = 1), access_token TEXT, refresh_token TEXT, user_json TEXT);
CREATE TABLE IF NOT EXISTS pending_state (key TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER);
`;

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
    assert.ok(names.includes('summatives'));
    assert.ok(names.includes('summative_attempts'));
    assert.ok(names.includes('gap_analysis'));
    assert.ok(names.includes('journeys'));
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

  function saveProgress(unitId, progress) {
    run('BEGIN TRANSACTION');

    run(
      `INSERT OR REPLACE INTO units
       (unit_id, course_id, name, description, sequence, status,
        current_activity_index, started_at, completed_at, final_work_product_url,
        journey_order, rubric_criteria)
       VALUES (?, ?, '', '', 0, ?, ?, ?, ?, ?, ?, ?)`,
      [unitId, 'foundations', progress.status, progress.currentActivityIndex || 0,
       progress.startedAt || null, progress.completedAt || null, progress.finalWorkProductUrl || null,
       progress.journeyOrder ?? null,
       progress.rubricCriteria ? JSON.stringify(progress.rubricCriteria) : null]
    );

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
        `INSERT OR REPLACE INTO activities (id, unit_id, type, goal, instruction, tips, sequence, conversation_id, rubric_criteria)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [actId, unitId, a.type, a.goal, a.instruction || null, a.tips || null, i, convId,
         a.rubricCriteria ? JSON.stringify(a.rubricCriteria) : null]
      );
    }

    for (const d of progress.drafts || []) {
      run(
        `INSERT OR REPLACE INTO drafts
         (id, activity_id, unit_id, screenshot_key, url, score, feedback,
          strengths, improvements, recommendation, timestamp, rubric_criteria_scores)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.id, d.activityId, unitId, d.screenshotKey || null, d.url || null,
         d.score ?? null, d.feedback || null,
         d.strengths ? JSON.stringify(d.strengths) : null,
         d.improvements ? JSON.stringify(d.improvements) : null,
         d.recommendation || null, d.timestamp || Date.now(),
         d.rubricCriteriaScores ? JSON.stringify(d.rubricCriteriaScores) : null]
      );
    }

    run('COMMIT');
  }

  function getProgress(unitId) {
    const unitRow = query('SELECT * FROM units WHERE unit_id = ?', [unitId]);
    if (!unitRow) return null;

    const activityRows = queryAll('SELECT * FROM activities WHERE unit_id = ? ORDER BY sequence', [unitId]);
    const activities = activityRows.map(a => {
      const msgs = a.conversation_id
        ? queryAll('SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp',
            [a.conversation_id])
        : [];
      return {
        id: a.id, type: a.type, goal: a.goal, instruction: a.instruction, tips: a.tips,
        rubricCriteria: a.rubric_criteria ? JSON.parse(a.rubric_criteria) : null,
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
      rubricCriteriaScores: d.rubric_criteria_scores ? JSON.parse(d.rubric_criteria_scores) : null,
    }));

    return {
      unitId: unitRow.unit_id, courseId: unitRow.course_id,
      status: unitRow.status, currentActivityIndex: unitRow.current_activity_index,
      journeyOrder: unitRow.journey_order,
      rubricCriteria: unitRow.rubric_criteria ? JSON.parse(unitRow.rubric_criteria) : null,
      activities, drafts,
      startedAt: unitRow.started_at, completedAt: unitRow.completed_at,
      finalWorkProductUrl: unitRow.final_work_product_url,
    };
  }

  it('returns null for non-existent unit', () => {
    assert.equal(getProgress('no-such-unit'), null);
  });

  it('round-trips a full unit progress blob', () => {
    const now = Date.now();
    const progress = {
      status: 'in_progress',
      currentActivityIndex: 1,
      journeyOrder: 0,
      rubricCriteria: ['Professional communication', 'Technical proficiency'],
      activities: [
        {
          id: 'a1', type: 'explore', goal: 'Explore the WP dashboard',
          instruction: 'Navigate to wp-admin and explore.',
          tips: 'Look at the sidebar menu.',
          rubricCriteria: ['Technical proficiency'],
          messages: [
            { role: 'user', content: 'Where is the theme editor?', timestamp: now - 1000 },
            { role: 'assistant', content: 'Go to Appearance > Editor.', timestamp: now - 500 },
          ],
        },
        {
          id: 'a2', type: 'apply', goal: 'Customize a theme',
          instruction: 'Change the site title and colors.',
          tips: 'Use the Customizer.',
          rubricCriteria: ['Professional communication', 'Technical proficiency'],
          messages: [],
        },
      ],
      drafts: [
        {
          id: 'draft-1000', activityId: 'a1',
          screenshotKey: 'activity-a1-draft-1000',
          url: 'https://example.com/wp-admin',
          feedback: 'Good start', strengths: ['found the menu'], improvements: ['explore more'],
          score: 0.7, recommendation: 'advance', timestamp: now,
          rubricCriteriaScores: [{ criterion: 'Technical proficiency', level: 'developing', score: 0.5 }],
        },
      ],
      startedAt: now - 10000,
      completedAt: null,
      finalWorkProductUrl: null,
    };

    saveProgress(unitId, progress);
    const loaded = getProgress(unitId);

    // Core fields
    assert.equal(loaded.unitId, unitId);
    assert.equal(loaded.courseId, 'foundations');
    assert.equal(loaded.status, 'in_progress');
    assert.equal(loaded.currentActivityIndex, 1);
    assert.equal(loaded.journeyOrder, 0);
    assert.deepEqual(loaded.rubricCriteria, ['Professional communication', 'Technical proficiency']);

    // Activities
    assert.equal(loaded.activities.length, 2);
    assert.equal(loaded.activities[0].id, 'a1');
    assert.equal(loaded.activities[0].instruction, 'Navigate to wp-admin and explore.');
    assert.deepEqual(loaded.activities[0].rubricCriteria, ['Technical proficiency']);
    assert.equal(loaded.activities[0].messages.length, 2);
    assert.equal(loaded.activities[0].messages[1].content, 'Go to Appearance > Editor.');
    assert.equal(loaded.activities[1].messages.length, 0);

    // Drafts
    assert.equal(loaded.drafts.length, 1);
    assert.equal(loaded.drafts[0].activityId, 'a1');
    assert.equal(loaded.drafts[0].score, 0.7);
    assert.deepEqual(loaded.drafts[0].strengths, ['found the menu']);
    assert.deepEqual(loaded.drafts[0].rubricCriteriaScores, [{ criterion: 'Technical proficiency', level: 'developing', score: 0.5 }]);
  });

  it('overwrites existing progress on re-save', () => {
    saveProgress(unitId, {
      status: 'in_progress', currentActivityIndex: 0,
      activities: [], drafts: [],
      startedAt: 1000, completedAt: null, finalWorkProductUrl: null,
    });

    saveProgress(unitId, {
      status: 'completed', currentActivityIndex: 2,
      activities: [], drafts: [],
      startedAt: 1000, completedAt: 2000, finalWorkProductUrl: 'https://example.com',
    });

    const loaded = getProgress(unitId);
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.completedAt, 2000);
    assert.equal(loaded.finalWorkProductUrl, 'https://example.com');
  });
});

describe('summatives', () => {
  it('round-trips a summative', () => {
    const courseId = 'foundations';
    const summative = {
      task: { steps: [{ instruction: 'Create a portfolio page' }] },
      rubric: [{ name: 'Communication', levels: { beginning: 'x', developing: 'y', proficient: 'z', mastery: 'w' } }],
      exemplar: 'A well-crafted portfolio page',
      tool: 'Google Docs',
      estimatedTime: 30,
      personalized: false,
      courseIntro: 'This course covers portfolio building. Take the assessment first, then learn.',
      summaryForLearner: 'You will build a portfolio page in Google Docs.',
    };

    run(
      `INSERT INTO summatives (course_id, task, rubric, exemplar, tool, estimated_time, personalized, course_intro, summary_for_learner, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [courseId, JSON.stringify(summative.task), JSON.stringify(summative.rubric),
       summative.exemplar, summative.tool, summative.estimatedTime, 0,
       summative.courseIntro, summative.summaryForLearner, Date.now()]
    );

    const row = query('SELECT * FROM summatives WHERE course_id = ?', [courseId]);
    assert.equal(row.course_id, courseId);
    assert.deepEqual(JSON.parse(row.task), summative.task);
    assert.deepEqual(JSON.parse(row.rubric), summative.rubric);
    assert.equal(row.exemplar, summative.exemplar);
    assert.equal(row.tool, 'Google Docs');
    assert.equal(row.course_intro, summative.courseIntro);
    assert.equal(row.summary_for_learner, summative.summaryForLearner);
  });
});

describe('summative attempts', () => {
  it('stores and retrieves ordered attempts', () => {
    const courseId = 'foundations';

    run(
      `INSERT INTO summative_attempts (id, course_id, attempt_number, screenshots, criteria_scores, overall_score, mastery, feedback, is_baseline, summary_for_learner, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['att-1', courseId, 1, JSON.stringify([{ screenshot_key: 's1', step_index: 0 }]),
       JSON.stringify([{ criterion: 'Comm', level: 'developing', score: 0.5 }]),
       0.5, 0, 'Good baseline', 1, 'Solid start — your structure is there but needs depth.', 1000]
    );

    run(
      `INSERT INTO summative_attempts (id, course_id, attempt_number, screenshots, criteria_scores, overall_score, mastery, feedback, is_baseline, summary_for_learner, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['att-2', courseId, 2, JSON.stringify([{ screenshot_key: 's2', step_index: 0 }]),
       JSON.stringify([{ criterion: 'Comm', level: 'proficient', score: 0.8 }]),
       0.8, 1, 'Mastery achieved', 0, 'Strong work across the board.', 2000]
    );

    const rows = queryAll('SELECT * FROM summative_attempts WHERE course_id = ? ORDER BY attempt_number', [courseId]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].is_baseline, 1);
    assert.equal(rows[1].mastery, 1);
    assert.equal(rows[1].overall_score, 0.8);
  });
});

describe('gap analysis', () => {
  it('round-trips gap analysis', () => {
    const courseId = 'foundations';
    const gaps = [
      { criterion: 'Technical proficiency', currentLevel: 'beginning', targetLevel: 'proficient', priority: 'high' },
    ];

    run(
      'INSERT INTO gap_analysis (course_id, gaps, suggested_focus, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [courseId, JSON.stringify(gaps), JSON.stringify(['tech skills']), Date.now(), Date.now()]
    );

    const row = query('SELECT * FROM gap_analysis WHERE course_id = ?', [courseId]);
    assert.deepEqual(JSON.parse(row.gaps), gaps);
    assert.deepEqual(JSON.parse(row.suggested_focus), ['tech skills']);
  });
});

describe('journeys', () => {
  it('round-trips a journey', () => {
    const courseId = 'foundations';
    const plan = {
      units: [
        { unitId: 'foundations-0-basic-wordpress', activities: [{ type: 'explore', goal: 'test' }] },
      ],
    };

    run(
      'INSERT INTO journeys (course_id, plan, phase, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [courseId, JSON.stringify(plan), 'formative_learning', Date.now(), Date.now()]
    );

    const row = query('SELECT * FROM journeys WHERE course_id = ?', [courseId]);
    assert.deepEqual(JSON.parse(row.plan), plan);
    assert.equal(row.phase, 'formative_learning');
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
  it('stores and retrieves rubric review state', () => {
    const state = { messages: [{ role: 'user', content: 'Can the rubric include X?' }] };
    run('INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES (?, ?, ?)',
      ['rubric-review:foundations', JSON.stringify(state), Date.now()]);

    const row = query("SELECT state_json FROM pending_state WHERE key = 'rubric-review:foundations'");
    assert.deepEqual(JSON.parse(row.state_json), state);
  });

  it('clears pending state', () => {
    run("INSERT INTO pending_state (key, state_json) VALUES ('onboarding', ?)", [JSON.stringify({})]);
    run("DELETE FROM pending_state WHERE key = 'onboarding'");
    const row = query("SELECT * FROM pending_state WHERE key = 'onboarding'");
    assert.equal(row, null);
  });
});
