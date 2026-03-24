/**
 * Storage layer backed by sql.js (SQLite WASM).
 * All functions keep the same signatures and return shapes as the original
 * chrome.storage.local implementation so app.js requires zero changes.
 * Screenshots remain in IndexedDB — referenced by key in the drafts table.
 */

import { run, query, queryAll, persist } from './db.js';

// -- Preferences --------------------------------------------------------------

export async function getPreferences() {
  const row = query('SELECT data FROM preferences WHERE id = 1');
  return row ? JSON.parse(row.data) : { name: '' };
}

export async function savePreferences(prefs) {
  run(
    'INSERT OR REPLACE INTO preferences (id, data, updated_at) VALUES (1, ?, ?)',
    [JSON.stringify(prefs), Date.now()]
  );
}

// -- Unit progress (normalize/denormalize) ------------------------------------

export async function getUnitProgress(unitId) {
  const unitRow = query('SELECT * FROM units WHERE unit_id = ?', [unitId]);
  if (!unitRow) return null;

  // Learning plan
  const planRow = query('SELECT * FROM learning_plans WHERE unit_id = ?', [unitId]);
  let learningPlan = null;
  if (planRow) {
    // Reconstruct plan activities from the plan's stored data
    const planData = planRow.data ? JSON.parse(planRow.data) : null;
    learningPlan = {
      activities: planData?.activities || [],
      finalWorkProductDescription: planRow.final_work_product_description,
      workProductTool: planRow.work_product_tool,
    };
  }

  // Diagnostic
  const diagRow = query('SELECT * FROM diagnostics WHERE unit_id = ?', [unitId]);
  let diagnostic = null;
  if (diagRow) {
    const diagMessages = diagRow.conversation_id
      ? queryAll(
          'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp',
          [diagRow.conversation_id]
        )
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

  // Activities
  const activityRows = queryAll(
    'SELECT * FROM activities WHERE unit_id = ? ORDER BY sequence',
    [unitId]
  );
  const activities = activityRows.map(a => {
    const msgs = a.conversation_id
      ? queryAll(
          'SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp',
          [a.conversation_id]
        )
      : [];
    // Strip unit prefix from DB id to return the original activity id
    const originalId = a.id.includes('::') ? a.id.split('::')[1] : a.id;
    return {
      id: originalId,
      type: a.type,
      goal: a.goal,
      instruction: a.instruction,
      tips: a.tips,
      messages: msgs.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    };
  });

  // Drafts
  const draftRows = queryAll(
    'SELECT * FROM drafts WHERE unit_id = ? ORDER BY timestamp',
    [unitId]
  );
  const drafts = draftRows.map(d => ({
    id: d.id,
    activityId: d.activity_id?.includes('::') ? d.activity_id.split('::')[1] : d.activity_id,
    screenshotKey: d.screenshot_key,
    url: d.url,
    feedback: d.feedback,
    strengths: d.strengths ? JSON.parse(d.strengths) : [],
    improvements: d.improvements ? JSON.parse(d.improvements) : [],
    score: d.score,
    recommendation: d.recommendation,
    timestamp: d.timestamp,
  }));

  return {
    unitId: unitRow.unit_id,
    status: unitRow.status,
    currentActivityIndex: unitRow.current_activity_index,
    diagnostic,
    learningPlan,
    activities,
    drafts,
    startedAt: unitRow.started_at,
    completedAt: unitRow.completed_at,
    finalWorkProductUrl: unitRow.final_work_product_url,
  };
}

export async function saveUnitProgress(unitId, progress) {
  run('BEGIN TRANSACTION');
  try {
    // Find the course_id for this unit
    const existingUnit = query('SELECT course_id FROM units WHERE unit_id = ?', [unitId]);
    const courseId = existingUnit?.course_id || _lookupCourseId(unitId);

    // Upsert unit row
    run(
      `INSERT OR REPLACE INTO units
       (unit_id, course_id, name, description, depends_on, sequence, status,
        current_activity_index, started_at, completed_at, final_work_product_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unitId, courseId, '', '', null, 0, progress.status || 'not_started',
        progress.currentActivityIndex || 0,
        progress.startedAt || null,
        progress.completedAt || null,
        progress.finalWorkProductUrl || null,
      ]
    );

    // Upsert learning plan
    if (progress.learningPlan) {
      run(
        `INSERT OR REPLACE INTO learning_plans
         (unit_id, final_work_product_description, work_product_tool, data, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          unitId,
          progress.learningPlan.finalWorkProductDescription || null,
          progress.learningPlan.workProductTool || null,
          JSON.stringify(progress.learningPlan),
          Date.now(),
        ]
      );
    }

    // Upsert diagnostic
    if (progress.diagnostic) {
      const diagConvId = `diag-${unitId}`;
      // Ensure conversation exists
      run(
        'INSERT OR IGNORE INTO conversations (id, unit_id, type, created_at) VALUES (?, ?, ?, ?)',
        [diagConvId, unitId, 'diagnostic', Date.now()]
      );
      // Replace messages
      run('DELETE FROM messages WHERE conversation_id = ?', [diagConvId]);
      const diagMsgs = progress.diagnostic.messages || [];
      for (let i = 0; i < diagMsgs.length; i++) {
        const m = diagMsgs[i];
        run(
          'INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
          [diagConvId, m.role, m.content, m.timestamp || Date.now()]
        );
      }
      const result = progress.diagnostic.result;
      run(
        `INSERT OR REPLACE INTO diagnostics
         (unit_id, conversation_id, instruction, score, feedback, strengths, improvements, recommendation, passed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          unitId, diagConvId,
          progress.diagnostic.instruction || null,
          result?.score ?? null,
          result?.feedback || null,
          result?.strengths ? JSON.stringify(result.strengths) : null,
          result?.improvements ? JSON.stringify(result.improvements) : null,
          result?.recommendation || null,
          result?.passed ? 1 : 0,
        ]
      );
    } else {
      // Remove diagnostic if cleared
      const existingDiag = query('SELECT conversation_id FROM diagnostics WHERE unit_id = ?', [unitId]);
      if (existingDiag) {
        if (existingDiag.conversation_id) {
          run('DELETE FROM messages WHERE conversation_id = ?', [existingDiag.conversation_id]);
        }
        run('DELETE FROM diagnostics WHERE unit_id = ?', [unitId]);
      }
    }

    // Upsert activities
    // First, collect existing activity conversation IDs to clean up orphans
    const existingActivities = queryAll('SELECT id, conversation_id FROM activities WHERE unit_id = ?', [unitId]);
    const existingActivityIds = new Set(existingActivities.map(a => a.id));

    const currentActivityIds = new Set();
    const acts = progress.activities || [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const actId = a.id || `act-${i}`;
      // Use unit-scoped key for DB storage to prevent cross-unit collisions
      const dbActId = `${unitId}::${actId}`;
      currentActivityIds.add(dbActId);
      const convId = `activity-${unitId}-${actId}`;

      // Ensure conversation exists
      run(
        'INSERT OR IGNORE INTO conversations (id, unit_id, type, activity_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [convId, unitId, 'activity', dbActId, Date.now()]
      );

      // Replace messages
      run('DELETE FROM messages WHERE conversation_id = ?', [convId]);
      const msgs = a.messages || [];
      for (const m of msgs) {
        run(
          'INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
          [convId, m.role, m.content, m.timestamp || Date.now()]
        );
      }

      run(
        `INSERT OR REPLACE INTO activities
         (id, unit_id, type, goal, instruction, tips, sequence, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [dbActId, unitId, a.type, a.goal, a.instruction || null, a.tips || null, i, convId]
      );
    }

    // Remove orphaned activities
    for (const ea of existingActivities) {
      if (!currentActivityIds.has(ea.id)) {
        if (ea.conversation_id) {
          run('DELETE FROM messages WHERE conversation_id = ?', [ea.conversation_id]);
          run('DELETE FROM conversations WHERE id = ?', [ea.conversation_id]);
        }
        run('DELETE FROM drafts WHERE activity_id = ?', [ea.id]);
        run('DELETE FROM activities WHERE id = ?', [ea.id]);
      }
    }

    // Upsert drafts
    const existingDrafts = queryAll('SELECT id FROM drafts WHERE unit_id = ?', [unitId]);
    const existingDraftIds = new Set(existingDrafts.map(d => d.id));
    const currentDraftIds = new Set();

    for (const d of progress.drafts || []) {
      const draftId = d.id || `draft-${Date.now()}`;
      currentDraftIds.add(draftId);
      run(
        `INSERT OR REPLACE INTO drafts
         (id, activity_id, unit_id, screenshot_key, url, score, feedback,
          strengths, improvements, recommendation, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          draftId, `${unitId}::${d.activityId}`, unitId,
          d.screenshotKey || null,
          d.url || null,
          d.score ?? null,
          d.feedback || null,
          d.strengths ? JSON.stringify(d.strengths) : null,
          d.improvements ? JSON.stringify(d.improvements) : null,
          d.recommendation || null,
          d.timestamp || Date.now(),
        ]
      );
    }

    // Remove orphaned drafts
    for (const ed of existingDrafts) {
      if (!currentDraftIds.has(ed.id)) {
        run('DELETE FROM drafts WHERE id = ?', [ed.id]);
      }
    }

    run('COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
}

/** Look up course_id from the units table or fall back to extracting from unitId. */
function _lookupCourseId(unitId) {
  // Unit IDs follow the pattern: courseId-N-slug (e.g. "foundations-0-basic-wordpress")
  // Try to find a matching course
  const courses = queryAll('SELECT course_id FROM courses');
  for (const c of courses) {
    if (unitId.startsWith(c.course_id)) return c.course_id;
  }
  // Fallback: use the first segment
  return unitId.split('-')[0] || 'unknown';
}

export async function getAllProgress() {
  const unitRows = queryAll('SELECT unit_id FROM units');
  const out = {};
  for (const row of unitRows) {
    out[row.unit_id] = await getUnitProgress(row.unit_id);
  }
  return out;
}

// -- Work products ------------------------------------------------------------

export async function getWorkProducts() {
  const rows = queryAll('SELECT * FROM work_products ORDER BY completed_at');
  return rows.map(r => ({
    unitId: r.unit_id,
    courseName: r.course_name,
    url: r.url,
    completedAt: r.completed_at,
  }));
}

export async function saveWorkProduct(product) {
  run(
    'INSERT INTO work_products (unit_id, course_name, url, completed_at) VALUES (?, ?, ?, ?)',
    [product.unitId, product.courseName, product.url, product.completedAt]
  );
}

// -- API key ------------------------------------------------------------------

export async function getApiKey() {
  const row = query("SELECT value FROM settings WHERE key = 'apiKey'");
  return row ? JSON.parse(row.value) : null;
}

export async function saveApiKey(key) {
  run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('apiKey', ?)",
    [JSON.stringify(key)]
  );
}

// -- Learner profile ----------------------------------------------------------

export async function getLearnerProfile() {
  const row = query('SELECT data FROM profile WHERE id = 1');
  return row ? JSON.parse(row.data) : null;
}

export async function saveLearnerProfile(profile) {
  run(
    'INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (1, ?, ?)',
    [JSON.stringify(profile), Date.now()]
  );
}

export async function getLearnerProfileSummary() {
  const row = query('SELECT summary FROM profile_summary WHERE id = 1');
  return row ? row.summary : '';
}

export async function saveLearnerProfileSummary(summary) {
  run(
    'INSERT OR REPLACE INTO profile_summary (id, summary, updated_at) VALUES (1, ?, ?)',
    [summary, Date.now()]
  );
}

// -- Auth tokens (cloud sync) -------------------------------------------------

export async function getAuthTokens() {
  const row = query('SELECT access_token, refresh_token FROM auth WHERE id = 1');
  if (!row || !row.access_token) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token };
}

export async function saveAuthTokens({ accessToken, refreshToken }) {
  // Ensure the row exists, then update
  const existing = query('SELECT id FROM auth WHERE id = 1');
  if (existing) {
    run(
      'UPDATE auth SET access_token = ?, refresh_token = ? WHERE id = 1',
      [accessToken, refreshToken]
    );
  } else {
    run(
      'INSERT INTO auth (id, access_token, refresh_token) VALUES (1, ?, ?)',
      [accessToken, refreshToken]
    );
  }
}

export async function clearAuth() {
  run('DELETE FROM auth WHERE id = 1');
}

export async function getAuthUser() {
  const row = query('SELECT user_json FROM auth WHERE id = 1');
  return row?.user_json ? JSON.parse(row.user_json) : null;
}

export async function saveAuthUser(user) {
  const existing = query('SELECT id FROM auth WHERE id = 1');
  if (existing) {
    run('UPDATE auth SET user_json = ? WHERE id = 1', [JSON.stringify(user)]);
  } else {
    run('INSERT INTO auth (id, user_json) VALUES (1, ?)', [JSON.stringify(user)]);
  }
}

// -- Bedrock proxy URL --------------------------------------------------------

// -- Onboarding ---------------------------------------------------------------

export async function getOnboardingComplete() {
  const row = query("SELECT value FROM settings WHERE key = 'onboardingComplete'");
  return row ? JSON.parse(row.value) : false;
}

export async function saveOnboardingComplete() {
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboardingComplete', ?)", [JSON.stringify(true)]);
}


// -- Conversation state (diagnostic + onboarding) -----------------------------

export async function getDiagnosticState() {
  const row = query("SELECT state_json FROM pending_state WHERE key = 'diagnostic'");
  return row ? JSON.parse(row.state_json) : null;
}

export async function saveDiagnosticState(diagState) {
  run(
    "INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES ('diagnostic', ?, ?)",
    [JSON.stringify(diagState), Date.now()]
  );
}

export async function clearDiagnosticState() {
  run("DELETE FROM pending_state WHERE key = 'diagnostic'");
}

export async function getOnboardingState() {
  const row = query("SELECT state_json FROM pending_state WHERE key = 'onboarding'");
  return row ? JSON.parse(row.state_json) : null;
}

export async function saveOnboardingState(state) {
  run(
    "INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES ('onboarding', ?, ?)",
    [JSON.stringify(state), Date.now()]
  );
}

export async function clearOnboardingState() {
  run("DELETE FROM pending_state WHERE key = 'onboarding'");
}


// -- Delete functions (used by sync.js removeLocalData) -----------------------

export async function deleteProfile() {
  run('DELETE FROM profile WHERE id = 1');
}

export async function deleteProfileSummary() {
  run('DELETE FROM profile_summary WHERE id = 1');
}

export async function deletePreferences() {
  run('DELETE FROM preferences WHERE id = 1');
}

export async function deleteWorkProducts() {
  run('DELETE FROM work_products');
}

export async function deleteUnitProgress(unitId) {
  // Delete in dependency order
  const acts = queryAll('SELECT id, conversation_id FROM activities WHERE unit_id = ?', [unitId]);
  for (const a of acts) {
    run('DELETE FROM drafts WHERE activity_id = ?', [a.id]);
    if (a.conversation_id) {
      run('DELETE FROM messages WHERE conversation_id = ?', [a.conversation_id]);
      run('DELETE FROM conversations WHERE id = ?', [a.conversation_id]);
    }
  }
  run('DELETE FROM activities WHERE unit_id = ?', [unitId]);

  const diag = query('SELECT conversation_id FROM diagnostics WHERE unit_id = ?', [unitId]);
  if (diag?.conversation_id) {
    run('DELETE FROM messages WHERE conversation_id = ?', [diag.conversation_id]);
    run('DELETE FROM conversations WHERE id = ?', [diag.conversation_id]);
  }
  run('DELETE FROM diagnostics WHERE unit_id = ?', [unitId]);
  run('DELETE FROM learning_plans WHERE unit_id = ?', [unitId]);
  run('DELETE FROM units WHERE unit_id = ?', [unitId]);
}

// -- IndexedDB for binary assets (screenshots) --------------------------------

const DB_NAME = '1111-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'screenshots';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScreenshot(key, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getScreenshot(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function exportAllBlobs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    const keyReq = store.getAllKeys();
    const result = {};
    tx.oncomplete = () => {
      for (let i = 0; i < keyReq.result.length; i++) {
        result[keyReq.result[i]] = req.result[i];
      }
      resolve(result);
    };
    tx.onerror = () => reject(tx.error);
  });
}
