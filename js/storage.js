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
    const originalId = a.id.includes('::') ? a.id.split('::')[1] : a.id;
    return {
      id: originalId,
      type: a.type,
      goal: a.goal,
      instruction: a.instruction,
      tips: a.tips,
      rubricCriteria: a.rubric_criteria ? JSON.parse(a.rubric_criteria) : null,
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
    rubricCriteriaScores: d.rubric_criteria_scores ? JSON.parse(d.rubric_criteria_scores) : null,
    timestamp: d.timestamp,
  }));

  return {
    unitId: unitRow.unit_id,
    courseId: unitRow.course_id,
    status: unitRow.status,
    currentActivityIndex: unitRow.current_activity_index,
    journeyOrder: unitRow.journey_order,
    rubricCriteria: unitRow.rubric_criteria ? JSON.parse(unitRow.rubric_criteria) : null,
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
        current_activity_index, started_at, completed_at, final_work_product_url,
        journey_order, rubric_criteria)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unitId, courseId, '', '', null, 0, progress.status || 'not_started',
        progress.currentActivityIndex || 0,
        progress.startedAt || null,
        progress.completedAt || null,
        progress.finalWorkProductUrl || null,
        progress.journeyOrder ?? null,
        progress.rubricCriteria ? JSON.stringify(progress.rubricCriteria) : null,
      ]
    );

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
         (id, unit_id, type, goal, instruction, tips, sequence, conversation_id, rubric_criteria)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dbActId, unitId, a.type, a.goal, a.instruction || null, a.tips || null, i, convId,
         a.rubricCriteria ? JSON.stringify(a.rubricCriteria) : null]
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
          strengths, improvements, recommendation, timestamp, rubric_criteria_scores)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          d.rubricCriteriaScores ? JSON.stringify(d.rubricCriteriaScores) : null,
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


// -- Summative ----------------------------------------------------------------

export async function getSummative(courseId) {
  const row = query('SELECT * FROM summatives WHERE course_id = ?', [courseId]);
  if (!row) return null;
  return {
    courseId: row.course_id,
    task: JSON.parse(row.task),
    rubric: JSON.parse(row.rubric),
    exemplar: row.exemplar,
    tool: row.tool,
    estimatedTime: row.estimated_time,
    personalized: !!row.personalized,
    conversationId: row.conversation_id,
    courseIntro: row.course_intro || null,
    summaryForLearner: row.summary_for_learner || null,
    createdAt: row.created_at,
  };
}

export async function saveSummative(courseId, data) {
  run(
    `INSERT OR REPLACE INTO summatives
     (course_id, task, rubric, exemplar, tool, estimated_time, personalized, conversation_id, course_intro, summary_for_learner, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId,
      JSON.stringify(data.task),
      JSON.stringify(data.rubric),
      data.exemplar,
      data.tool || null,
      data.estimatedTime || null,
      data.personalized ? 1 : 0,
      data.conversationId || null,
      data.courseIntro || null,
      data.summaryForLearner || null,
      data.createdAt || Date.now(),
    ]
  );
}

// -- Summative Attempts -------------------------------------------------------

export async function getSummativeAttempts(courseId) {
  const rows = queryAll(
    'SELECT * FROM summative_attempts WHERE course_id = ? ORDER BY attempt_number',
    [courseId]
  );
  return rows.map(r => ({
    id: r.id,
    courseId: r.course_id,
    attemptNumber: r.attempt_number,
    screenshots: r.screenshots ? JSON.parse(r.screenshots) : [],
    criteriaScores: r.criteria_scores ? JSON.parse(r.criteria_scores) : [],
    overallScore: r.overall_score,
    mastery: !!r.mastery,
    feedback: r.feedback,
    nextSteps: r.next_steps ? JSON.parse(r.next_steps) : [],
    isBaseline: !!r.is_baseline,
    summaryForLearner: r.summary_for_learner || null,
    timestamp: r.timestamp,
  }));
}

export async function saveSummativeAttempt(courseId, attempt) {
  run(
    `INSERT OR REPLACE INTO summative_attempts
     (id, course_id, attempt_number, screenshots, criteria_scores, overall_score,
      mastery, feedback, next_steps, is_baseline, summary_for_learner, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attempt.id,
      courseId,
      attempt.attemptNumber,
      JSON.stringify(attempt.screenshots || []),
      JSON.stringify(attempt.criteriaScores || []),
      attempt.overallScore ?? null,
      attempt.mastery ? 1 : 0,
      attempt.feedback || null,
      attempt.nextSteps ? JSON.stringify(attempt.nextSteps) : null,
      attempt.isBaseline ? 1 : 0,
      attempt.summaryForLearner || null,
      attempt.timestamp || Date.now(),
    ]
  );
}

// -- Gap Analysis -------------------------------------------------------------

export async function getGapAnalysis(courseId) {
  const row = query('SELECT * FROM gap_analysis WHERE course_id = ?', [courseId]);
  if (!row) return null;
  return {
    courseId: row.course_id,
    gaps: JSON.parse(row.gaps),
    suggestedFocus: row.suggested_focus ? JSON.parse(row.suggested_focus) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveGapAnalysis(courseId, data) {
  run(
    `INSERT OR REPLACE INTO gap_analysis
     (course_id, gaps, suggested_focus, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      courseId,
      JSON.stringify(data.gaps),
      data.suggestedFocus ? JSON.stringify(data.suggestedFocus) : null,
      data.createdAt || Date.now(),
      Date.now(),
    ]
  );
}

// -- Journey ------------------------------------------------------------------

export async function getJourney(courseId) {
  const row = query('SELECT * FROM journeys WHERE course_id = ?', [courseId]);
  if (!row) return null;
  return {
    courseId: row.course_id,
    plan: JSON.parse(row.plan),
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveJourney(courseId, data) {
  run(
    `INSERT OR REPLACE INTO journeys
     (course_id, plan, phase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      courseId,
      JSON.stringify(data.plan),
      data.phase || 'summative_setup',
      data.createdAt || Date.now(),
      Date.now(),
    ]
  );
}

export async function updateJourneyPhase(courseId, phase) {
  run(
    'UPDATE journeys SET phase = ?, updated_at = ? WHERE course_id = ?',
    [phase, Date.now(), courseId]
  );
}

// -- Course Phase (derived) ---------------------------------------------------

export async function getCoursePhase(courseId) {
  const journey = query('SELECT phase FROM journeys WHERE course_id = ?', [courseId]);
  if (journey) return journey.phase;
  // No journey record yet — check if summative exists
  const summative = query('SELECT course_id FROM summatives WHERE course_id = ?', [courseId]);
  if (summative) return 'summative_setup';
  return null;
}

// -- Conversation state (rubric review + onboarding) --------------------------

export async function getRubricReviewState(courseId) {
  const key = `rubric-review:${courseId}`;
  const row = query('SELECT state_json FROM pending_state WHERE key = ?', [key]);
  return row ? JSON.parse(row.state_json) : null;
}

export async function saveRubricReviewState(courseId, state) {
  const key = `rubric-review:${courseId}`;
  run(
    'INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES (?, ?, ?)',
    [key, JSON.stringify(state), Date.now()]
  );
}

export async function clearRubricReviewState(courseId) {
  run('DELETE FROM pending_state WHERE key = ?', [`rubric-review:${courseId}`]);
}

// -- Summative capture state (survives panel reload) --------------------------

export async function getSummativeCaptureState(courseId) {
  const key = `summative-capture:${courseId}`;
  const row = query('SELECT state_json FROM pending_state WHERE key = ?', [key]);
  return row ? JSON.parse(row.state_json) : null;
}

export async function saveSummativeCaptureState(courseId, state) {
  const key = `summative-capture:${courseId}`;
  run(
    'INSERT OR REPLACE INTO pending_state (key, state_json, updated_at) VALUES (?, ?, ?)',
    [key, JSON.stringify(state), Date.now()]
  );
}

export async function clearSummativeCaptureState(courseId) {
  run('DELETE FROM pending_state WHERE key = ?', [`summative-capture:${courseId}`]);
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
  run('DELETE FROM units WHERE unit_id = ?', [unitId]);
}

export async function deleteCourseProgress(courseId) {
  // Delete summative data
  run('DELETE FROM summative_attempts WHERE course_id = ?', [courseId]);
  run('DELETE FROM summatives WHERE course_id = ?', [courseId]);
  run('DELETE FROM gap_analysis WHERE course_id = ?', [courseId]);
  run('DELETE FROM journeys WHERE course_id = ?', [courseId]);
  // Delete all units for this course
  const units = queryAll('SELECT unit_id FROM units WHERE course_id = ?', [courseId]);
  for (const u of units) {
    await deleteUnitProgress(u.unit_id);
  }
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
