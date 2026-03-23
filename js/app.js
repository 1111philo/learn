import {
  getPreferences, savePreferences,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getWorkProducts, saveWorkProduct,
  saveScreenshot, getScreenshot,
  getApiKey, saveApiKey,
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary,
  getDevMode, saveDevMode, appendDevLog,
  getOnboardingComplete, saveOnboardingComplete,
  getLastSync,
  getDiagnosticState, saveDiagnosticState, clearDiagnosticState,
  getOnboardingState, saveOnboardingState, clearOnboardingState,
  getProxyUrl, saveProxyUrl
} from './storage.js';
import { loadCourses, flattenCourses, checkPrerequisite } from './courses.js';
import * as orchestrator from './orchestrator.js';
import { ApiError } from './api.js';
import { trackEvent, flushNow } from './telemetry.js';
import { runMigrations } from './migrations.js';
import * as auth from './auth.js';
import * as sync from './sync.js';

const $ = (sel) => document.querySelector(sel);
const $main = () => $('#main-content');

const _confettiFired = new Set();

function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: Math.random() * 9 + 4,
    h: Math.random() * 4 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.18,
    vx: (Math.random() - 0.5) * 2.5,
    vy: Math.random() * 2.5 + 1.5,
    opacity: 1,
  }));

  const duration = 3800;
  let startTime = null;

  function draw(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.rotationSpeed;
      piece.vy += 0.04;
      if (elapsed > duration * 0.55) piece.opacity = Math.max(0, piece.opacity - 0.018);
      if (piece.y < canvas.height && piece.opacity > 0) alive = true;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.globalAlpha = piece.opacity;
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(draw);
    else canvas.remove();
  }

  requestAnimationFrame(draw);
}

const _MODAL_BG_SELECTORS = ['header', 'nav'];

function showModal(html, role = 'dialog', label = '') {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.hidden = true;
    $main().appendChild(overlay);
  }
  overlay._triggerEl = document.activeElement;
  overlay.innerHTML = `<div class="modal" role="${role}" aria-modal="true"${label ? ` aria-label="${label}"` : ''}>${html}</div>`;

  // Size overlay to cover only the main content area (fixed, so scroll position doesn't matter)
  const mainRect = document.getElementById('main-content').getBoundingClientRect();
  overlay.style.top = mainRect.top + 'px';
  overlay.style.height = mainRect.height + 'px';
  overlay.hidden = false;

  // Hide background landmarks from screen readers
  for (const sel of _MODAL_BG_SELECTORS) {
    document.querySelector(sel)?.setAttribute('aria-hidden', 'true');
  }

  // Focus first focusable element
  const modal = overlay.querySelector('.modal');
  const firstFocusable = modal.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]');
  firstFocusable?.focus();

  // Focus trap
  overlay._trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const els = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  };
  document.addEventListener('keydown', overlay._trapHandler);

  // Escape to close
  overlay._escHandler = (e) => { if (e.key === 'Escape') hideModal(); };
  document.addEventListener('keydown', overlay._escHandler);
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.hidden) return;
  if (overlay._escHandler) { document.removeEventListener('keydown', overlay._escHandler); overlay._escHandler = null; }
  if (overlay._trapHandler) { document.removeEventListener('keydown', overlay._trapHandler); overlay._trapHandler = null; }

  const finish = () => {
    overlay.hidden = true;
    overlay.innerHTML = '';
    overlay.classList.remove('modal-closing');
    for (const sel of _MODAL_BG_SELECTORS) {
      document.querySelector(sel)?.removeAttribute('aria-hidden');
    }
    overlay._triggerEl?.focus();
    overlay._triggerEl = null;
  };

  // Animate out, or finish immediately if reduced motion
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { finish(); return; }

  overlay.classList.add('modal-closing');
  overlay.addEventListener('animationend', finish, { once: true });
  // Safety fallback in case animationend doesn't fire
  setTimeout(finish, 250);
}

async function logDev(type, data) {
  try {
    if (await getDevMode()) {
      await appendDevLog({ type, ...data });
      trackEvent(type, data);
    }
  } catch { /* non-blocking */ }
}

let state = {
  view: 'courses',        // onboarding | courses | units | course | work | work-detail | settings
  courseGroups: [],         // top-level course groups (from courses.json)
  courses: [],             // flat list of all playable courses/units (derived from courseGroups)
  activeCourseGroupId: null, // which course group is selected (for units view)
  activeCourseId: null,
  progress: null,
  allProgress: {},
  preferences: null,
  activeWorkCourseId: null,  // for work-detail view
  generating: null,          // { courseId, promise } — in-flight generation tracker
  // Diagnostic flow (consolidated)
  diagnostic: {
    phase: null,          // 'generating' | 'activity' | null
    activity: null,       // generated diagnostic activity object
    messages: [],         // conversation history [{role, content}]
    result: null,         // { courseId, result } — assessment for plan generation
    skipFor: null,        // courseId — bypass diagnostic
  }
};

// -- Time tracking state ------------------------------------------------------
const _sessionStartMs = Date.now();
let _activityStartMs = null;   // set when an activity view renders
let _activityStartMeta = null; // { courseId, activityIndex } for the current activity


// Onboarding wizard state (persists across re-renders within a session)
let _onboardingStep = 1;
let _onboardingData = {};

// Activity type → user-facing label
const TYPE_LABELS = {
  explore: 'Research',
  apply: 'Practice',
  create: 'Draft',
  final: 'Deliver'
};
const TYPE_LETTERS = { explore: 'R', apply: 'P', create: 'D', final: 'F' };

// -- Bootstrap ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await runMigrations();
  await seedFromEnv();
  state.preferences = await getPreferences();
  state.courseGroups = await loadCourses();
  state.courses = flattenCourses(state.courseGroups);
  state.allProgress = await getAllProgress();
  bindNav();
  bindUserMenu();
  await updateUserMenu();

  // Restore diagnostic conversation state if it was in progress
  const savedDiag = await getDiagnosticState();
  if (savedDiag) {
    state.diagnostic = { ...state.diagnostic, ...savedDiag };
  }

  // First-run: show onboarding if it hasn't been completed yet
  const onboardingDone = await getOnboardingComplete();
  if (!onboardingDone) {
    state.view = 'onboarding';
    // Restore onboarding conversation state if it was in progress
    const savedOnboarding = await getOnboardingState();
    if (savedOnboarding) {
      Object.assign(_onboardingData, savedOnboarding);
    }
    if (state.preferences.name) _onboardingData.name = state.preferences.name;
  }

  render();
  if (await getDevMode()) {
    trackEvent('session_start', {
      extensionVersion: chrome.runtime.getManifest().version,
      platform: navigator.platform,
    });
  }
});

// -- Session end tracking -----------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    trackEvent('session_end', { durationMs: Date.now() - _sessionStartMs });
    flushNow();
  }
});

async function seedFromEnv() {
  try {
    const { ENV } = await import('../.env.js');
    if (ENV.apiKey && !(await getApiKey())) {
      await saveApiKey(ENV.apiKey);
    }
    const prefs = await getPreferences();
    if (ENV.name && !prefs.name) {
      await savePreferences({ ...prefs, name: ENV.name });
    }
  } catch { /* .env.js not present — expected in production */ }
}

/** Push data to cloud in background. No-op if not logged in. */
function syncInBackground(...syncKeys) {
  Promise.resolve().then(async () => {
    if (!await auth.isLoggedIn()) return;
    for (const key of syncKeys) {
      try { await sync.pushData(key); } catch { /* silent */ }
    }
  });
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });
}

// -- Header user menu ---------------------------------------------------------

async function updateUserMenu() {
  const label = $('#user-menu-label');
  const btn = $('#user-menu-btn');
  const loggedIn = await auth.isLoggedIn();
  const user = loggedIn ? await auth.getCurrentUser() : null;
  label.textContent = loggedIn ? (user?.email || 'Account') : 'Login';

  // Update aria for screen readers
  if (loggedIn) {
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `Account: ${user?.email || 'signed in'}`);
  } else {
    btn.removeAttribute('aria-haspopup');
    btn.removeAttribute('aria-expanded');
    btn.setAttribute('aria-label', 'Login');
  }

  // Pre-render dropdown for signed-in state
  const dropdown = $('#user-dropdown');
  if (loggedIn) {
    dropdown.innerHTML = `
      <p class="user-dropdown-email">${esc(user?.email || '')}</p>
      <p class="user-dropdown-sync" id="dropdown-sync-status"></p>
      <button id="dropdown-sign-out-btn" class="secondary-btn" style="width:100%">Sign Out</button>`;
  }
}

function showLoginModal(onSuccess) {
  showModal(`
  <h2>Sign In</h2>
  <p>Sign in to sync your data with <a href="https://learn.philosophers.group" target="_blank" rel="noopener">1111 Learn</a>.</p>
  <form id="modal-login-form" class="settings-form" aria-label="Learn login">
    <label>
      Email
      <input type="email" name="email" required autocomplete="email">
    </label>
    <label>
      Password
      <input type="password" name="password" required autocomplete="current-password">
    </label>
    <div id="modal-login-feedback" role="status" aria-live="polite"></div>
    <div class="action-bar">
      <button type="button" id="login-cancel-btn" class="secondary-btn">Cancel</button>
      <button type="submit" class="primary-btn">Sign In</button>
    </div>
  </form>`, 'dialog', 'Sign in');

  $('#login-cancel-btn').addEventListener('click', hideModal);

  const form = $('#modal-login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').trim();
    const password = fd.get('password');
    const submitBtn = form.querySelector('button[type="submit"]');
    const fb = $('#modal-login-feedback');

    if (fb) { fb.textContent = ''; fb.className = ''; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      await auth.login(email, password);

      // Replace form with success state
      const modal = document.querySelector('#modal-overlay .modal');
      if (modal) {
        modal.innerHTML = `
          <div class="login-success-state" role="status">
            <p class="login-success-msg">Signed in as ${esc(email)}</p>
            <p class="login-success-hint">Syncing your data...</p>
          </div>`;
      }

      // Check for admin-assigned API key
      if (!await getApiKey()) {
        try {
          const assignedKey = await auth.getAssignedApiKey();
          if (assignedKey) await saveApiKey(assignedKey);
        } catch { /* non-critical */ }
      }

      // Initial sync
      try {
        await sync.syncAll();
        state.allProgress = await getAllProgress();
        state.preferences = await getPreferences();
        const hint = document.querySelector('.login-success-hint');
        if (hint) hint.textContent = 'All synced.';
      } catch {
        const hint = document.querySelector('.login-success-hint');
        if (hint) hint.textContent = 'Signed in. Sync will retry later.';
      }

      await updateUserMenu();
      if (state.view === 'settings') render();

      setTimeout(() => {
        hideModal();
        if (onSuccess) onSuccess();
      }, 1200);
    } catch (err) {
      if (fb) {
        fb.textContent = err.message || 'Invalid email or password';
        fb.className = 'login-error-msg';
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

function bindUserMenu() {
  const btn = $('#user-menu-btn');
  const dropdown = $('#user-dropdown');

  btn.addEventListener('click', async () => {
    const loggedIn = await auth.isLoggedIn();
    if (!loggedIn) {
      showLoginModal(async () => {
        state.preferences = await getPreferences();
        state.allProgress = await getAllProgress();
        state.courseGroups = await loadCourses();
        state.courses = flattenCourses(state.courseGroups);
        const activeCourse = Object.entries(state.allProgress)
          .find(([, p]) => p.status === 'in_progress');
        if (activeCourse) {
          state.activeCourseId = activeCourse[0];
          state.activeCourseGroupId = findCourseGroupId(activeCourse[0]);
          state.progress = activeCourse[1];
          state.view = 'course';
        }
        render();
      });
      return;
    }
    // Toggle dropdown for signed-in users
    const opening = dropdown.hidden;
    dropdown.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    if (opening) {
      const ls = await getLastSync();
      const statusEl = $('#dropdown-sync-status');
      if (statusEl) statusEl.textContent = ls ? `Last synced ${formatTimeAgo(ls)}` : 'Not yet synced';
      bindDropdownActions();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  // Close dropdown on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.hidden) {
      dropdown.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });
}

function bindDropdownActions() {
  const dropdown = $('#user-dropdown');

  const signOutBtn = $('#dropdown-sign-out-btn');
  if (signOutBtn) {
    signOutBtn.onclick = () => {
      dropdown.hidden = true;
      $('#user-menu-btn').setAttribute('aria-expanded', 'false');
      showModal(`
  <h2>Sign Out?</h2>
  <p>This will clear all local data and return you to the welcome screen.</p>
  <div class="action-bar">
    <button id="cancel-signout-btn" class="secondary-btn">Cancel</button>
    <button id="confirm-signout-btn" class="danger-btn">Sign Out</button>
  </div>`, 'alertdialog', 'Confirm sign out');
      $('#cancel-signout-btn').addEventListener('click', hideModal);
      $('#confirm-signout-btn').addEventListener('click', async () => {
        hideModal();
        await auth.logout();
        await chrome.storage.local.clear();
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
        } catch { /* not supported in all contexts */ }
        state.preferences = { name: '' };
        state.allProgress = {};
        state.progress = null;
        state.activeCourseId = null;
        _onboardingStep = 1;
        _onboardingData = {};
        await updateUserMenu();
        announce('Signed out');
        state.view = 'onboarding';
        render();
      });
    };
  }
}

// View depth for determining transition direction
const VIEW_DEPTH = { onboarding: 0, courses: 1, units: 2, course: 3, work: 1, 'work-detail': 2, settings: 1 };
const ANIM_CLASSES = ['view-slide-left', 'view-slide-right', 'view-fade-up'];

function animateMain(anim) {
  const main = $main();
  main.classList.remove(...ANIM_CLASSES);
  void main.offsetWidth; // force reflow to restart
  main.classList.add(anim);
  main.addEventListener('animationend', () => main.classList.remove(anim), { once: true });
}

function navigate(view, data) {
  const prev = state.view;
  state.view = view;
  if (data) Object.assign(state, data);

  if (prev !== view) {
    trackEvent('navigation', { fromView: prev, toView: view });
  }

  const fromDepth = VIEW_DEPTH[prev] ?? 0;
  const toDepth = VIEW_DEPTH[view] ?? 0;
  let anim;
  if (toDepth > fromDepth) anim = 'view-slide-left';
  else if (toDepth < fromDepth) anim = 'view-slide-right';
  else anim = 'view-fade-up';

  animateMain(anim);
  render();
  $main().focus();
}

// -- Render router ------------------------------------------------------------

function render() {
  const isOnboarding = state.view === 'onboarding';
  document.querySelector('nav').hidden = isOnboarding;

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    const active = btn.dataset.nav === state.view ||
      (btn.dataset.nav === 'courses' && (state.view === 'course' || state.view === 'units')) ||
      (btn.dataset.nav === 'work' && state.view === 'work-detail');
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  switch (state.view) {
    case 'onboarding': return renderOnboarding();
    case 'courses': return renderCourses();
    case 'units':   return renderUnits();
    case 'course':  return renderCourse();
    case 'work':    return renderWork();
    case 'work-detail': return renderWorkDetail();
    case 'settings': return renderSettings();
  }
}

// -- Helpers ------------------------------------------------------------------

function findCourseGroupId(courseId) {
  const group = state.courseGroups.find(cg => cg.units?.some(u => u.courseId === courseId));
  return group?.courseId || null;
}

function courseGroupStatus(cg) {
  const statuses = cg.units.map(u => {
    const prog = state.allProgress[u.courseId];
    return prog ? prog.status : 'not_started';
  });
  if (statuses.every(s => s === 'completed')) return 'completed';
  if (statuses.some(s => s !== 'not_started')) return 'in_progress';
  return 'not_started';
}

function checkCourseGroupPrerequisite(cg) {
  if (!cg.dependsOn) return true;
  const dep = state.courseGroups.find(g => g.courseId === cg.dependsOn);
  if (!dep) return false;
  if (dep.units) return courseGroupStatus(dep) === 'completed';
  const prog = state.allProgress[dep.courseId];
  return prog?.status === 'completed';
}

// -- Courses list -------------------------------------------------------------

function renderCourses() {
  const main = $main();
  const cards = state.courseGroups.map((cg) => {
    if (cg.units) {
      const status = courseGroupStatus(cg);
      const locked = !checkCourseGroupPrerequisite(cg);
      const completedCount = cg.units.filter(u => {
        const prog = state.allProgress[u.courseId];
        return prog?.status === 'completed';
      }).length;
      const totalTime = cg.units.reduce((sum, u) => sum + u.learningObjectives.length * 5 + 2, 0);
      const label = locked
        ? `Requires ${state.courseGroups.find(g => g.courseId === cg.dependsOn)?.name || cg.dependsOn}`
        : `${completedCount} of ${cg.units.length} units complete · ~${totalTime} min`;

      return `
        <li>
          <button class="course-card${locked ? ' locked' : ''}"
                  data-course-group="${cg.courseId}"
                  ${locked ? 'disabled' : ''}>
            <span class="course-status" aria-hidden="true">${statusIcon(status)}</span>
            <div class="course-info">
              <strong>${esc(cg.name)}</strong>
              <p>${esc(cg.description)}</p>
              <small>${label}</small>
            </div>
          </button>
        </li>`;
    }
    // Standalone course (no units)
    const prereqMet = checkPrerequisite(cg, state.allProgress);
    const prog = state.allProgress[cg.courseId];
    const status = prog ? prog.status : 'not_started';
    const locked = !prereqMet;

    return `
      <li>
        <button class="course-card${locked ? ' locked' : ''}"
                data-course="${cg.courseId}"
                ${locked ? 'disabled' : ''}>
          <span class="course-status" aria-hidden="true">${state.generating?.courseId === cg.courseId ? '<span class="status-spinner"></span>' : statusIcon(status)}</span>
          <div class="course-info">
            <strong>${esc(cg.name)}</strong>
            <p>${esc(cg.description)}</p>
            <small>${progressLabel(cg, locked)} · ~${cg.learningObjectives.length * 5 + 2} min</small>
          </div>
        </button>
      </li>`;
  }).join('');

  main.innerHTML = `
    <h2>Courses</h2>
    <ul class="course-list" role="list">${cards}</ul>
    <div class="coming-soon-card">More courses added regularly!</div>`;

  main.querySelectorAll('[data-course-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeCourseGroupId = btn.dataset.courseGroup;
      navigate('units');
    });
  });

  main.querySelectorAll('[data-course]').forEach((btn) => {
    btn.addEventListener('click', () => startOrResumeCourse(btn.dataset.course));
  });
}

// -- Units list ---------------------------------------------------------------

function renderUnits() {
  const main = $main();
  const courseGroup = state.courseGroups.find(cg => cg.courseId === state.activeCourseGroupId);
  if (!courseGroup?.units) { navigate('courses'); return; }

  const cards = courseGroup.units.map((u) => {
    const prereqMet = checkPrerequisite(u, state.allProgress);
    const prog = state.allProgress[u.courseId];
    const status = prog ? prog.status : 'not_started';
    const locked = !prereqMet;

    return `
      <li>
        <button class="course-card${locked ? ' locked' : ''}"
                data-course="${u.courseId}"
                ${locked ? 'disabled' : ''}>
          <span class="course-status" aria-hidden="true">${state.generating?.courseId === u.courseId ? '<span class="status-spinner"></span>' : statusIcon(status)}</span>
          <div class="course-info">
            <strong>${esc(u.name)}</strong>
            <p>${esc(u.description)}</p>
            <small>${progressLabel(u, locked)} · ~${u.learningObjectives.length * 5 + 2} min</small>
          </div>
        </button>
      </li>`;
  }).join('');

  main.innerHTML = `
    <div class="units-header">
      <button class="back-btn" aria-label="Back to courses" id="units-back-btn">&larr;</button>
      <h2>${esc(courseGroup.name)}</h2>
    </div>
    <ul class="course-list" role="list">${cards}</ul>`;

  $('#units-back-btn').addEventListener('click', () => navigate('courses'));

  main.querySelectorAll('[data-course]').forEach((btn) => {
    btn.addEventListener('click', () => startOrResumeCourse(btn.dataset.course));
  });
}

function statusIcon(s) {
  if (s === 'completed') return '<span aria-hidden="true">&#10003;</span>';
  if (s === 'in_progress') return '<span aria-hidden="true">&#9654;</span>';
  return '<span aria-hidden="true">&#9675;</span>';
}

function progressLabel(course, locked) {
  if (locked) return 'Requires ' + course.dependsOn;
  if (state.generating?.courseId === course.courseId) return 'Generating…';
  const prog = state.allProgress[course.courseId];
  if (!prog) return 'Not started';
  const workName = prog.learningPlan?.finalWorkProductDescription;
  if (prog.status === 'completed') {
    return workName ? `Built: ${workName}` : 'Completed';
  }
  const total = prog.learningPlan?.activities?.length || '?';
  const step = prog.currentActivityIndex + 1;
  return workName
    ? `Building ${workName} — step ${step} of ${total}`
    : `Activity ${step} of ${total}`;
}

// -- Active course ------------------------------------------------------------

async function startOrResumeCourse(courseId) {
  const course = state.courses.find((c) => c.courseId === courseId);
  state.activeCourseGroupId = findCourseGroupId(courseId);
  let progress = await getCourseProgress(courseId);

  if (!progress) {
    // If already generating this course, just navigate to it
    if (state.generating?.courseId === courseId) {
      state.activeCourseId = courseId;
      state.view = 'course';
      render();
      return;
    }

    // Check API key
    const ready = await orchestrator.isReady();
    if (!ready) {
      showError('No AI provider configured. Sign in or go to Settings to add your API key.');
      return;
    }

    // Run diagnostic unless one already exists for this course
    const hasDiagnosticResult = state.diagnostic.result?.courseId === courseId;
    const skipped = state.diagnostic.skipFor === courseId;
    if (!hasDiagnosticResult && !skipped) {
      state.activeCourseId = courseId;
      state.diagnostic.phase = 'generating';
      state.diagnostic.activity = null;
      state.diagnostic.messages = [];
      state.view = 'course';
      saveDiagnosticState(state.diagnostic);
      render();

      try {
        const activity = await orchestrator.generateDiagnosticActivity(course);
        state.diagnostic.activity = activity;
        state.diagnostic.phase = 'activity';
        saveDiagnosticState(state.diagnostic);
        render();
      } catch (e) {
        handleApiError(e);
      }
      return;
    }

    state.activeCourseId = courseId;
    state.diagnostic.phase = null;
    state.view = 'course';

    const promise = (async () => {
      function showStep(label) {
        const el = document.getElementById('setup-status');
        if (el) el.innerHTML = `<span class="loading-spinner-inline" aria-hidden="true"></span> ${label}`;
      }

      showStep('Analyzing your profile...');

      const profileSummary = await getLearnerProfileSummary();
      const completedNames = Object.entries(state.allProgress)
        .filter(([, p]) => p.status === 'completed')
        .map(([id]) => state.courses.find(c => c.courseId === id)?.name)
        .filter(Boolean);

      showStep('Building your learning plan...');

      const diagnosticResult = hasDiagnosticResult ? state.diagnostic.result.result : null;
      const plan = await orchestrator.createLearningPlan(
        course, state.preferences, profileSummary, completedNames, diagnosticResult
      );

      const newProgress = {
        courseId,
        status: 'in_progress',
        currentActivityIndex: 0,
        learningPlan: {
          activities: plan.activities,
          finalWorkProductDescription: plan.finalWorkProductDescription,
          workProductTool: plan.workProductTool
        },
        activities: [],
        drafts: [],
        startedAt: Date.now(),
        completedAt: null,
        finalWorkProductUrl: null
      };

      showStep('Preparing your first activity...');

      const firstSlot = plan.activities[0];
      const generated = await orchestrator.generateNextActivity(
        course, firstSlot, [], profileSummary, plan
      );
      newProgress.activities.push({
        ...firstSlot,
        instruction: generated.instruction,
        tips: generated.tips
      });

      await saveCourseProgress(courseId, newProgress);
      state.allProgress[courseId] = newProgress;
      syncInBackground(`progress:${courseId}`);
      // Clear diagnostic state now that the plan has been generated
      state.diagnostic.result = null;
      state.diagnostic.skipFor = null;
      clearDiagnosticState();
      trackEvent('course_started', { courseId, totalActivities: plan.activities.length });
      return newProgress;
    })();

    state.generating = { courseId, promise };
    render();

    try {
      progress = await promise;
    } catch (e) {
      state.generating = null;
      handleApiError(e);
      return;
    }

    state.generating = null;
  }

  state.activeCourseId = courseId;
  state.progress = progress;
  state.view = 'course';
  render();
}

async function renderCourse() {
  const main = $main();
  const course = state.courses.find((c) => c.courseId === state.activeCourseId);
  const p = state.progress;
  const planActivities = p?.learningPlan?.activities;

  // ── Header ──
  let progressLabel = '';
  if (planActivities) {
    progressLabel = `Step ${p.currentActivityIndex + 1} of ${planActivities.length}`;
  } else if (state.diagnostic.phase) {
    progressLabel = 'Skills Check';
  }

  let html = `<div class="course-layout">
    <div class="course-header">
      <button class="back-btn" aria-label="${state.activeCourseGroupId ? 'Back to units' : 'Back to courses'}" id="back-btn">&larr;</button>
      <div class="course-header-info">
        <h2>${esc(course.name)}</h2>
        ${progressLabel ? `<span class="progress-label">${esc(progressLabel)}</span>` : ''}
      </div>
      ${p ? '<button class="reset-btn" id="reset-course-btn" aria-label="Reset course" title="Reset course">&#8635;</button>' : ''}
    </div>`;

  // ── Activity track (only when plan exists) ──
  if (planActivities) {
    const activityPips = planActivities.map((_, i) => {
      const cls = i < p.currentActivityIndex ? 'pip pip-done'
                : i === p.currentActivityIndex ? 'pip pip-current'
                : 'pip';
      return `<span class="${cls}" aria-hidden="true"></span>`;
    }).join('');
    html += `<div class="activity-track" role="progressbar" aria-label="Activity ${p.currentActivityIndex + 1} of ${planActivities.length}" aria-valuenow="${p.currentActivityIndex + 1}" aria-valuemin="1" aria-valuemax="${planActivities.length}">${activityPips}</div>`;
  }

  // ── Chat ──
  html += '<div class="chat" role="log" aria-label="Course conversation">';

  // ── Skills Check section ──
  if (state.diagnostic.activity || state.diagnostic.phase === 'generating') {
    html += '<div class="chat-section-heading" role="separator">Skills Check</div>';
  }

  // Diagnostic conversation (rendered from structured messages)
  if (state.diagnostic.activity) {
    html += renderConversationMessages(
      state.diagnostic.messages,
      state.diagnostic.activity.instruction
    );
  }

  // Diagnostic thinking (generating the question)
  if (state.diagnostic.phase === 'generating') {
    html += `<div class="msg msg-response" role="status" aria-live="polite"><span class="loading-spinner-inline" aria-hidden="true"></span> Preparing your skills check...</div>`;
  }

  // Course setup thinking (plan being generated)
  if (!p?.learningPlan && state.generating?.courseId === course.courseId) {
    html += `<div class="msg msg-response" role="status" aria-live="polite" id="setup-status"><span class="loading-spinner-inline" aria-hidden="true"></span> Setting up your course...</div>`;
  }

  // ── Current activity section ──
  const activity = p?.activities?.[p?.currentActivityIndex];
  if (activity) {
    const typeLabel = TYPE_LABELS[activity.type] || activity.type;
    html += `<div class="chat-section-heading" role="separator">Lesson ${p.currentActivityIndex + 1}: ${esc(activity.goal || typeLabel)}</div>`;

    html += instructionMessage(activity.instruction);

    const draftsForActivity = p.drafts.filter((d) => d.activityId === activity.id);
    for (let di = 0; di < draftsForActivity.length; di++) {
      const draft = draftsForActivity[di];
      const isLatest = di === draftsForActivity.length - 1;
      html += draftMessage(draft);
      html += feedbackCard(draft, isLatest);
    }
  } else if (p?.learningPlan) {
    // Activity not generated yet — show thinking
    html += `<div class="msg msg-response" role="status" aria-live="polite"><span class="loading-spinner-inline" aria-hidden="true"></span> Preparing your next activity...</div>`;
  }

  // Course completion summary
  if (p?.status === 'completed') {
    html += completionSummary(course, p);
  }

  // Diagnostic skip (inside chat, after 2 user messages)
  const diagUserMsgCount = (state.diagnostic.messages || []).filter(m => m.role === 'user').length;
  if (state.diagnostic.phase === 'activity' && state.diagnostic.activity && !state.diagnostic.result && diagUserMsgCount >= 2) {
    html += '<button id="skip-diagnostic-btn" class="skip-step-btn">Skip to course</button>';
  }

  // Activity action buttons (inside chat)
  const draftsForActivity = activity ? p.drafts.filter((d) => d.activityId === activity.id) : [];
  const hasDrafts = draftsForActivity.length > 0;
  const lastDraft = hasDrafts ? draftsForActivity[draftsForActivity.length - 1] : null;

  if (activity && p?.status !== 'completed') {
    if (lastDraft && lastDraft.recommendation === 'advance') {
      // Agent asks if user wants to continue
      const remaining = planActivities.length - p.currentActivityIndex - 1;
      html += `<div class="msg msg-response"><p>Great work — you've passed this activity! ${remaining > 0 ? `Ready to move on? You have ${remaining} ${remaining === 1 ? 'lesson' : 'lessons'} left.` : 'This was the final activity!'}</p></div>`;
      if (remaining > 0) {
        html += '<button id="next-activity-btn" class="skip-step-btn" style="background:var(--color-primary);color:var(--color-primary-text);border-color:var(--color-primary);">Continue to next lesson</button>';
      }
    } else if (!hasDrafts) {
      // First recording — show Record button
      html += '<button id="record-draft-btn" class="skip-step-btn" style="background:#dc2626;color:#fff;border-color:#dc2626;">&#9679; Record</button>';
    }
  }

  html += '</div>'; // close chat

  // ── Compose bar (fixed bottom) ──
  if (state.diagnostic.phase === 'activity' && state.diagnostic.activity && !state.diagnostic.result) {
    html += `<div class="chat-compose">
      <div class="compose-input-row">
        <label for="diagnostic-response" class="sr-only">Your response</label>
        <textarea id="diagnostic-response" class="chat-input" rows="1" placeholder="Describe what you know..."></textarea>
        <button id="submit-diagnostic-btn" class="send-btn" aria-label="Send"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 14V9l10-1L3 7V2l13 6z"/></svg></button>
      </div>
    </div>`;
  } else if (activity && p?.status !== 'completed') {
    html += `<div class="chat-compose">
      <div class="compose-input-row">
        <label for="chat-input" class="sr-only">Ask a question</label>
        <textarea id="chat-input" class="chat-input" rows="1" placeholder="Ask a question..."></textarea>
        <button id="send-btn" class="send-btn" aria-label="Send"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 14V9l10-1L3 7V2l13 6z"/></svg></button>
      </div>
    </div>`;
  }

  html += '</div>'; // close course-layout

  main.innerHTML = html;

  // Scroll chat to bottom
  const chatEl = main.querySelector('.chat');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

  // Confetti on first view after course completion
  if (p?.status === 'completed' && !_confettiFired.has(p.courseId)) {
    _confettiFired.add(p.courseId);
    launchConfetti();
  }

  // ── Event handlers ──
  $('#back-btn').addEventListener('click', () => navigate(state.activeCourseGroupId ? 'units' : 'courses'));
  if (p) {
    $('#reset-course-btn')?.addEventListener('click', () => confirmResetCourse(course, p));
  }

  // Diagnostic compose handlers
  const diagInput = $('#diagnostic-response');
  if (diagInput) {
    diagInput.focus();
    diagInput.addEventListener('input', () => {
      diagInput.style.height = 'auto';
      diagInput.style.height = Math.min(diagInput.scrollHeight, 120) + 'px';
    });
    diagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendDiagnosticMessage(course);
      }
    });
    $('#submit-diagnostic-btn')?.addEventListener('click', () => sendDiagnosticMessage(course));
    $('#skip-diagnostic-btn')?.addEventListener('click', () => skipDiagnostic(course));
  }

  // Activity compose handlers
  const chatInput = $('#chat-input');
  if (chatInput && activity) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleComposeSend(course, p, activity);
      }
    });
    $('#send-btn')?.addEventListener('click', () => handleComposeSend(course, p, activity));
  }

  $('#record-draft-btn')?.addEventListener('click', () => recordDraft(activity));

  // Dispute + Re-record buttons on feedback cards
  main.querySelectorAll('.dispute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const draft = p.drafts.find(d => d.id === btn.dataset.draftId);
      if (draft) showDisputeModal(course, p, activity, draft);
    });
  });
  main.querySelectorAll('.rerecord-btn').forEach(btn => {
    btn.addEventListener('click', () => recordDraft(activity));
  });

  const nextBtn = $('#next-activity-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      p.currentActivityIndex++;
      await saveCourseProgress(p.courseId, p);
      syncInBackground(`progress:${p.courseId}`);
      render();
    });
  }

  $('#next-course-btn')?.addEventListener('click', () => navigate('courses'));
  $('#view-portfolio-btn')?.addEventListener('click', () => {
    state.activeWorkCourseId = p.courseId;
    navigate('work-detail');
  });

  // Track activity start time
  if (activity) {
    const actMeta = { courseId: p.courseId, activityIndex: p.currentActivityIndex };
    if (!_activityStartMeta || _activityStartMeta.courseId !== actMeta.courseId || _activityStartMeta.activityIndex !== actMeta.activityIndex) {
      _activityStartMs = Date.now();
      _activityStartMeta = actMeta;
      trackEvent('activity_started', {
        courseId: p.courseId,
        activityIndex: p.currentActivityIndex,
        activityType: activity.type,
        activityGoal: activity.goal || '',
      });
    }
  }

  // ── Async generation (wait while showing in-chat thinking) ──
  if (!p?.learningPlan && state.generating?.courseId === course.courseId) {
    try {
      await state.generating.promise;
    } catch (e) {
      handleApiError(e);
      return;
    }
    state.progress = state.allProgress[course.courseId];
    render();
    return;
  }

  if (p?.learningPlan && !p.activities[p.currentActivityIndex]) {
    const currentSlot = planActivities[p.currentActivityIndex];

    if (state.generating?.courseId === p.courseId) {
      try { await state.generating.promise; } catch (e) { handleApiError(e); return; }
      state.progress = state.allProgress[p.courseId];
      render();
      return;
    }

    const promise = (async () => {
      const profileSummary = await getLearnerProfileSummary();
      const progressSummary = p.activities
        .slice(0, p.currentActivityIndex)
        .map((a) => {
          const drafts = p.drafts.filter(d => d.activityId === a.id);
          const last = drafts[drafts.length - 1];
          return { type: a.type, score: last?.score, keyFeedback: last?.feedback?.slice(0, 100) };
        });

      const generated = await orchestrator.generateNextActivity(
        course, currentSlot, progressSummary, profileSummary, p.learningPlan
      );

      p.activities[p.currentActivityIndex] = {
        ...currentSlot,
        instruction: generated.instruction,
        tips: generated.tips
      };

      await saveCourseProgress(p.courseId, p);
      syncInBackground(`progress:${p.courseId}`);
    })();

    state.generating = { courseId: p.courseId, promise };

    try { await promise; } catch (e) { state.generating = null; handleApiError(e); return; }
    state.generating = null;
    render();
  }
}

function handleComposeSend(course, p, activity) {
  const text = $('#chat-input')?.value?.trim();
  if (!text) return;
  askAboutActivity(course, p, activity, text);
}

async function askAboutActivity(course, p, activity, text) {
  const chat = document.querySelector('.chat');
  const thinkingId = `qa-thinking-${Date.now()}`;

  chat.insertAdjacentHTML('beforeend',
    `<div class="msg msg-user"><p>${esc(text)}</p></div>
     <div class="msg msg-response" id="${thinkingId}" role="status" aria-live="polite">
       <span class="loading-spinner-inline" aria-hidden="true"></span> Thinking...
     </div>`);
  chat.scrollTop = chat.scrollHeight;

  const input = $('#chat-input');
  if (input) { input.value = ''; input.disabled = true; }
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const lastDraft = p.drafts.filter(d => d.activityId === activity.id).pop();
    let context = `Activity: ${activity.instruction}`;
    if (lastDraft) {
      context += `\nScore: ${Math.round((lastDraft.score || 0) * 100)}%`;
      context += `\nFeedback: ${lastDraft.feedback || ''}`;
      context += `\nStrengths: ${(lastDraft.strengths || []).join(', ')}`;
      context += `\nAreas to improve: ${(lastDraft.improvements || []).join(', ')}`;
    }

    const systemPrompt = `You are a learning coach for the course "${course.name}". A learner is working on an activity and has a question. Answer concisely (2-3 sentences). Be helpful, specific, and encouraging.\n\n${context}`;

    const response = await orchestrator.chatWithContext(systemPrompt, [
      { role: 'user', content: text }
    ]);

    const el = document.getElementById(thinkingId);
    if (el) { el.textContent = ''; el.insertAdjacentHTML('beforeend', `<p>${renderMd(response)}</p>`); }
  } catch (e) {
    const el = document.getElementById(thinkingId);
    if (el) { el.textContent = ''; el.insertAdjacentHTML('beforeend', `<p>Sorry, I couldn't answer that. Try again?</p>`); }
  }

  if (input) input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (input) input.focus();
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function showDisputeModal(course, p, activity, draft) {
  showModal(`
    <h2>Dispute Assessment</h2>
    <p>Explain why you think this assessment is wrong. The AI will re-evaluate your work.</p>
    <label for="dispute-input" class="sr-only">Your dispute</label>
    <textarea id="dispute-input" rows="3" class="feedback-textarea" placeholder="e.g. I did complete the task — the result is in the bottom right corner"></textarea>
    <div class="action-bar">
      <button id="cancel-dispute-btn" class="secondary-btn">Cancel</button>
      <button id="submit-dispute-btn" class="primary-btn">Submit</button>
    </div>`, 'dialog', 'Dispute assessment');

  $('#dispute-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitDisputeFromModal(course, p, activity, draft);
    }
  });
  $('#cancel-dispute-btn').addEventListener('click', hideModal);
  $('#submit-dispute-btn').addEventListener('click', () => submitDisputeFromModal(course, p, activity, draft));
}

async function submitDisputeFromModal(course, p, activity, draft) {
  const feedbackText = $('#dispute-input')?.value?.trim();
  if (!feedbackText) return;
  hideModal();

  // Show dispute message + thinking in chat
  const chat = document.querySelector('.chat');
  const thinkingId = `dispute-thinking-${Date.now()}`;
  if (chat) {
    chat.insertAdjacentHTML('beforeend',
      `<div class="msg msg-user"><p><strong>Dispute:</strong> ${esc(feedbackText)}</p></div>
       <div class="msg msg-response" id="${thinkingId}" role="status" aria-live="polite">
         <span class="loading-spinner-inline" aria-hidden="true"></span> Re-evaluating...
       </div>`);
    chat.scrollTop = chat.scrollHeight;
  }

  try {
    const screenshotDataUrl = await getScreenshot(draft.screenshotKey);
    const profileSummary = await getLearnerProfileSummary();
    const priorDrafts = p.drafts.filter(d => d.activityId === activity.id && d.id !== draft.id);
    const previousAssessment = {
      feedback: draft.feedback, strengths: draft.strengths,
      improvements: draft.improvements, score: draft.score,
      recommendation: draft.recommendation, passed: draft.passed || false
    };

    const result = await orchestrator.reassessDraft(
      course, activity, screenshotDataUrl, draft.url,
      priorDrafts, profileSummary, previousAssessment, feedbackText
    );

    // Update draft in place
    const originalScore = draft.score;
    draft.feedback = result.feedback;
    draft.strengths = result.strengths;
    draft.improvements = result.improvements;
    draft.score = result.score;
    draft.recommendation = result.recommendation;
    draft.disputed = true;

    trackEvent('dispute', {
      courseId: course.courseId, activityType: activity.type,
      originalScore, revisedScore: result.score,
      scoreChanged: originalScore !== result.score,
    });

    // Show revised assessment in chat
    const el = document.getElementById(thinkingId);
    if (el) {
      const scorePercent = Math.round((result.score || 0) * 100);
      el.innerHTML = `<p>${esc(result.feedback)}</p><p style="margin-top:4px;font-size:0.85rem;opacity:0.85;">Revised score: ${scorePercent}%</p>`;
    }

    // Handle completion
    const justCompleted = activity.type === 'final' && result.passed && p.status !== 'completed';
    if (justCompleted) {
      p.status = 'completed';
      p.completedAt = Date.now();
      p.finalWorkProductUrl = draft.url;
      await saveWorkProduct({ courseId: p.courseId, courseName: course.name, url: draft.url, completedAt: p.completedAt });
    }

    await saveCourseProgress(p.courseId, p);
    state.allProgress[p.courseId] = p;
    syncInBackground(`progress:${p.courseId}`);
    if (justCompleted) { syncInBackground('work'); updateProfileOnCourseCompletionInBackground(course, p); }
    updateProfileFromFeedbackInBackground(feedbackText, course, activity);

    // Re-render to update feedback card and action buttons
    render();
  } catch (e) {
    const el = document.getElementById(thinkingId);
    if (el) { el.textContent = ''; el.insertAdjacentHTML('beforeend', '<p>Re-evaluation failed. Please try again.</p>'); }
  }
}

function confirmResetCourse(course, progress) {
  showModal(`
    <h2>Reset "${esc(course.name)}"?</h2>
    <p>This will permanently delete all progress, drafts, and feedback for this course. This cannot be undone.</p>
    <div class="action-bar">
      <button id="cancel-reset-btn" class="secondary-btn">Cancel</button>
      <button id="confirm-reset-btn" class="danger-btn">Reset Course</button>
    </div>`, 'alertdialog', 'Confirm reset');

  $('#cancel-reset-btn').addEventListener('click', hideModal);
  $('#confirm-reset-btn').addEventListener('click', async () => {
    hideModal();
    await chrome.storage.local.remove(`progress-${progress.courseId}`);
    delete state.allProgress[progress.courseId];
    state.progress = null;
    state.activeCourseId = null;
    state.view = 'courses';
    announce(`${course.name} has been reset.`);
    render();
  });
}

async function recordDraft(activity) {
  const main = $main();

  // Capture screenshot + URL from active tab (via background service worker)
  let dataUrl = null;
  let pageUrl = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url || /^(chrome|edge|brave|about):/.test(tab.url)) {
      showError('Cannot capture this page. Navigate to a regular webpage and try again.');
      return;
    }
    pageUrl = tab.url;

    // Ensure host permission so captureVisibleTab works (activeTab doesn't persist in side panels)
    const hasAccess = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (!hasAccess) {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (!granted) {
        showError('Screenshot permission was denied. Please allow access and try again.');
        return;
      }
    }

    const resp = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
    if (resp?.error) throw new Error(resp.error);
    dataUrl = resp?.dataUrl || null;
  } catch (e) {
    console.warn('Screenshot capture failed:', e);
    showError(`Screenshot capture failed: ${e.message}`);
    return;
  }

  if (!dataUrl) {
    showError('Could not capture a screenshot. Make sure a webpage is open in the active tab and try again.');
    return;
  }

  // Save screenshot to IndexedDB
  const screenshotKey = `draft-${Date.now()}`;
  await saveScreenshot(screenshotKey, dataUrl);

  // Show in-chat thinking state for AI assessment
  const chat = document.querySelector('.chat');
  const compose = document.querySelector('.chat-compose');
  if (chat) {
    chat.insertAdjacentHTML('beforeend',
      `<div class="msg msg-response" id="record-thinking" role="status" aria-live="polite"><span class="loading-spinner-inline" aria-hidden="true"></span> Evaluating your work...</div>`);
    chat.scrollTop = chat.scrollHeight;
  }
  if (compose) compose.hidden = true;

  try {
    const course = state.courses.find((c) => c.courseId === state.activeCourseId);
    const p = state.progress;
    const profileSummary = await getLearnerProfileSummary();
    const priorDrafts = p.drafts.filter(d => d.activityId === activity.id);

    const result = await orchestrator.assessDraft(
      course, activity, dataUrl, pageUrl, priorDrafts, profileSummary
    );

    const draft = {
      id: `draft-${Date.now()}`,
      activityId: activity.id,
      screenshotKey,
      url: pageUrl,
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements,
      score: result.score,
      recommendation: result.recommendation,
      timestamp: Date.now()
    };

    p.drafts.push(draft);

    const attemptNumber = priorDrafts.length + 1;
    trackEvent('draft_submitted', {
      courseId: p.courseId,
      activityIndex: p.currentActivityIndex,
      activityType: activity.type,
      activityGoal: activity.goal,
      activityInstruction: activity.instruction,
      attemptNumber,
      score: result.score,
      recommendation: result.recommendation,
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements,
    });

    // Advance or complete
    const justCompleted = activity.type === 'final' && result.passed;
    if (justCompleted) {
      p.status = 'completed';
      p.completedAt = Date.now();
      p.finalWorkProductUrl = pageUrl;
      await saveWorkProduct({
        courseId: p.courseId,
        courseName: course.name,
        url: pageUrl,
        completedAt: p.completedAt
      });
      trackEvent('course_completed', {
        courseId: p.courseId,
        totalActivities: p.learningPlan.activities.length,
        elapsedMs: p.completedAt - p.startedAt,
      });
    }

    if (result.recommendation === 'advance') {
      const actDurationMs = _activityStartMs ? Date.now() - _activityStartMs : null;
      trackEvent('activity_completed', {
        courseId: p.courseId, activityType: activity.type,
        activityIndex: p.currentActivityIndex,
        score: result.score, recommendation: result.recommendation,
        draftCount: attemptNumber,
        durationMs: actDurationMs,
      });
      _activityStartMs = null;
      _activityStartMeta = null;
    }

    await saveCourseProgress(p.courseId, p);
    state.allProgress[p.courseId] = p;
    syncInBackground(`progress:${p.courseId}`);
    if (justCompleted) syncInBackground('work');
    render();

    // Update learner profile in background (non-blocking)
    updateProfileInBackground(result, course, activity);
    if (justCompleted) updateProfileOnCourseCompletionInBackground(course, p);
  } catch (e) {
    handleApiError(e);
  }
}

function defaultProfile() {
  return {
    name: state.preferences?.name || '',
    goal: '',
    completedCourses: [],
    activeCourses: [],
    strengths: [],
    weaknesses: [],
    revisionPatterns: '',
    pacing: '',
    preferences: {},
    accessibilityNeeds: [],
    recurringSupport: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/** Merge agent-returned profile with existing profile. */
function mergeProfile(existing, returned) {
  const merged = { ...existing };
  // Merge simple string fields — keep returned if non-empty, else keep existing
  for (const key of ['name', 'goal', 'revisionPatterns', 'pacing']) {
    if (returned[key]) merged[key] = returned[key];
  }
  // ID fields — always union so course records are never lost
  for (const key of ['completedCourses', 'activeCourses']) {
    const combined = [...(existing[key] || []), ...(returned[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  // Content fields — trust the agent's consolidated version if non-empty,
  // otherwise fall back to existing so a bad response can't wipe data
  for (const key of ['strengths', 'weaknesses', 'accessibilityNeeds', 'recurringSupport']) {
    merged[key] = (returned[key]?.length > 0) ? returned[key] : (existing[key] || []);
  }
  // Merge preferences object — returned values override existing keys
  merged.preferences = { ...(existing.preferences || {}), ...(returned.preferences || {}) };
  // Timestamps
  merged.createdAt = existing.createdAt || returned.createdAt;
  merged.updatedAt = returned.updatedAt || Date.now();
  return merged;
}

async function saveProfileResult(existing, result) {
  const merged = mergeProfile(existing, result.profile);
  await saveLearnerProfile(merged);
  await saveLearnerProfileSummary(result.summary);
  syncInBackground('profile', 'profileSummary');
}

// Profile update queue — prevents concurrent updates from overwriting each other
let _profileUpdateQueue = Promise.resolve();

function queueProfileUpdate(fn) {
  _profileUpdateQueue = _profileUpdateQueue.then(fn).catch(e => {
    console.warn('Profile update failed (non-blocking):', e);
  });
  return _profileUpdateQueue;
}

async function ensureProfileExists() {
  let profile = await getLearnerProfile();
  if (!profile) {
    profile = defaultProfile();
    profile.name = state.preferences?.name || '';
    await saveLearnerProfile(profile);
    await saveLearnerProfileSummary('New learner — profile will be built as they learn.');
  }
  return profile;
}

function updateProfileInBackground(assessmentResult, course, activity) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateLearnerProfile(profile, assessmentResult, {
      courseName: course.name,
      activityType: activity.type,
      activityGoal: activity.goal
    });
    await saveProfileResult(profile, result);
    trackEvent('profile_updated', {
      trigger: 'assessment', strengthsCount: result?.profile?.strengths?.length || 0,
      weaknessesCount: result?.profile?.weaknesses?.length || 0,
    });
  });
}

function updateProfileFromFeedbackInBackground(feedbackText, course, activity) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileFromFeedback(profile, feedbackText, {
      courseName: course.name,
      activityType: activity.type,
      activityGoal: activity.goal
    });
    await saveProfileResult(profile, result);
    trackEvent('profile_updated', {
      trigger: 'feedback', strengthsCount: result?.profile?.strengths?.length || 0,
      weaknessesCount: result?.profile?.weaknesses?.length || 0,
    });
  });
}

function updateProfileOnCourseCompletionInBackground(course, progress) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnCourseCompletion(profile, course, progress);
    await saveProfileResult(profile, result);
    trackEvent('profile_updated', {
      trigger: 'course_completion', courseId: course.courseId,
      strengthsCount: result?.profile?.strengths?.length || 0,
      weaknessesCount: result?.profile?.weaknesses?.length || 0,
    });
  });
}

// -- Onboarding ---------------------------------------------------------------

async function renderOnboarding() {
  const main = $main();

  const dots = (active) => [1, 2, 3].map(i =>
    `<span class="dot${i === active ? ' dot-active' : ''}" aria-hidden="true"></span>`
  ).join('');

  if (_onboardingStep === 1) {
    main.innerHTML = `
      <div class="onboarding">
        <h2>Welcome to Learn</h2>
        <p class="onboarding-lead">An agentic learning app that builds around you.</p>
        <div class="onboarding-choice">
          <button id="onboarding-login" class="primary-btn onboarding-choice-btn">Login to Learn</button>
          <button id="onboarding-skip-login" class="onboarding-skip-btn">Continue without logging in...</button>
        </div>
      </div>`;

    $('#onboarding-login').addEventListener('click', () => {
      showLoginModal(async () => {
        state.preferences = await getPreferences();
        state.allProgress = await getAllProgress();
        state.courseGroups = await loadCourses();
        state.courses = flattenCourses(state.courseGroups);
        await saveOnboardingComplete();
        await updateUserMenu();
        _onboardingStep = 1;
        _onboardingData = {};
        const activeCourse = Object.entries(state.allProgress)
          .find(([, p]) => p.status === 'in_progress');
        if (activeCourse) {
          state.activeCourseId = activeCourse[0];
          state.activeCourseGroupId = findCourseGroupId(activeCourse[0]);
          state.progress = activeCourse[1];
          state.view = 'course';
        } else {
          state.view = 'courses';
        }
        render();
      });
    });

    $('#onboarding-skip-login').addEventListener('click', () => {
      showModal(`
  <h2>Continue without logging in?</h2>
  <p>By not logging in, credit for your work will not be given and changes won't be saved to the cloud.</p>
  <div class="action-bar">
    <button id="skip-login-back" class="secondary-btn">Go Back</button>
    <button id="skip-login-continue" class="primary-btn btn-success">Continue</button>
  </div>`, 'alertdialog', 'Continue without login');
      $('#skip-login-back').addEventListener('click', hideModal);
      $('#skip-login-continue').addEventListener('click', () => {
        hideModal();
        _onboardingStep = 2;
        animateMain('view-slide-left');
        renderOnboarding();
      });
    });

  } else if (_onboardingStep === 2) {
    main.innerHTML = `
      <div class="onboarding">
        <div class="onboarding-dots" role="progressbar" aria-label="Step 1 of 3" aria-valuenow="1" aria-valuemin="1" aria-valuemax="4">${dots(1)}</div>
        <span class="onboarding-step-label">Step 1 of 3 — Your Name</span>
        <h2>What's your name?</h2>
        <p class="onboarding-lead">Let's start with your name.</p>
        <label for="onboarding-name" class="sr-only">Your name</label>
        <input type="text" id="onboarding-name" placeholder="Your name" autocomplete="given-name" value="${esc(_onboardingData.name || '')}">
        <div class="action-bar">
          <button id="onboarding-back" class="secondary-btn">Back</button>
          <button id="onboarding-next" class="primary-btn">Continue</button>
        </div>
      </div>`;

    const input = $('#onboarding-name');
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); advanceOnboarding(2); }
    });
    $('#onboarding-back').addEventListener('click', () => { _onboardingStep = 1; animateMain('view-slide-right'); renderOnboarding(); });
    $('#onboarding-next').addEventListener('click', () => advanceOnboarding(2));

  } else if (_onboardingStep === 3) {
    // AI provider step (API key or proxy URL)
    const hasKey = !!(await getApiKey());
    const currentProxy = await getProxyUrl();

    main.innerHTML = `
      <div class="onboarding">
        <div class="onboarding-dots" role="progressbar" aria-label="Step 2 of 3" aria-valuenow="2" aria-valuemin="1" aria-valuemax="4">${dots(2)}</div>
        <span class="onboarding-step-label">Step 2 of 3 — Connect AI</span>
        <h2>Connect your AI.</h2>
        <p class="onboarding-lead">Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to get started — your key stays on your device.</p>
        <label for="onboarding-apikey" class="sr-only">Anthropic API key</label>
        <input type="password" id="onboarding-apikey" placeholder="sk-ant-..." autocomplete="off">
        <details class="proxy-details" ${currentProxy ? 'open' : ''}>
          <summary>Or use a Bedrock proxy</summary>
          <label for="onboarding-proxy" class="sr-only">Proxy URL</label>
          <input type="url" id="onboarding-proxy" placeholder="https://your-proxy.example.com" autocomplete="off" value="${esc(currentProxy || '')}">
        </details>
        <div id="onboarding-key-error" role="alert" aria-live="polite" class="onboarding-error"></div>
        <div class="action-bar">
          <button id="onboarding-back" class="secondary-btn">Back</button>
          <button id="onboarding-next" class="primary-btn">Continue</button>
        </div>
      </div>`;

    const input = $('#onboarding-apikey');
    input.focus();
    if (hasKey) {
      input.value = '••••••••••••••••••••••••••••••••••••••••';
      input.addEventListener('focus', () => {
        if (input.value === '••••••••••••••••••••••••••••••••••••••••') input.value = '';
      });
      input.addEventListener('blur', async () => {
        if (!input.value && await getApiKey()) input.value = '••••••••••••••••••••••••••••••••••••••••';
      });
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveApiKeyAndAdvance(); }
    });
    $('#onboarding-proxy').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveApiKeyAndAdvance(); }
    });
    $('#onboarding-back').addEventListener('click', () => { _onboardingStep = 2; animateMain('view-slide-right'); renderOnboarding(); });
    $('#onboarding-next').addEventListener('click', () => saveApiKeyAndAdvance());

  } else if (_onboardingStep === 4) {
    // Multi-turn chat to get to know the learner
    if (!_onboardingData.messages) _onboardingData.messages = [];
    const initialGreeting = `Hi, ${_onboardingData.name}. What brings you here? What do you want to build, become, or achieve?`;
    const initialMsg = renderConversationMessages(_onboardingData.messages || [], initialGreeting);

    const showContinue = _onboardingData.profileDone;
    const userMsgCount = (_onboardingData.messages || []).filter(m => m.role === 'user').length;
    const hasExchanged = userMsgCount >= 2;

    main.innerHTML = `
      <div class="onboarding" style="padding-bottom: 0;">
        <div class="onboarding-dots" role="progressbar" aria-label="Step 3 of 3" aria-valuenow="3" aria-valuemin="1" aria-valuemax="4">${dots(3)}</div>
        <span class="onboarding-step-label">Step 3 of 3 — About You</span>
        <div class="chat" role="log" aria-label="Getting to know you" id="onboarding-chat">
          ${initialMsg}
          ${hasExchanged && !showContinue ? '<button id="onboarding-skip" class="skip-step-btn">Skip to next step</button>' : ''}
          ${showContinue ? '<button id="onboarding-next-chat" class="skip-step-btn" style="background:var(--color-primary);color:var(--color-primary-text);border-color:var(--color-primary);">Continue to next step</button>' : ''}
        </div>
        <div class="chat-compose" id="onboarding-compose">
          <div class="compose-input-row">
            <label for="onboarding-input" class="sr-only">Your response</label>
            <textarea id="onboarding-input" class="chat-input" rows="1" placeholder="${showContinue ? 'Say more or ask a question...' : 'I want to...'}"></textarea>
            <button id="onboarding-send" class="send-btn" aria-label="Send"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 14V9l10-1L3 7V2l13 6z"/></svg></button>
          </div>
        </div>
      </div>`;

    const chatInput = $('#onboarding-input');
    chatInput.focus();
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendOnboardingMessage(); }
    });
    $('#onboarding-send').addEventListener('click', () => sendOnboardingMessage());

    const advanceOnboardingChat = () => {
      // Save profile in background — don't block navigation
      if (!_onboardingData.profileDone) {
        const msgs = _onboardingData.messages || [];
        const userText = msgs.filter(m => m.role === 'user').map(m => m.content).join(' ');
        if (userText || _onboardingData.name) {
          queueProfileUpdate(async () => {
            const result = await orchestrator.initializeLearnerProfile(
              _onboardingData.name, userText || 'No details provided.'
            );
            result.profile.createdAt = Date.now();
            result.profile.updatedAt = Date.now();
            await saveLearnerProfile(result.profile);
            await saveLearnerProfileSummary(result.summary);
            syncInBackground('profile', 'profileSummary');
          });
        }
      }
      completeOnboarding();
    };

    $('#onboarding-skip')?.addEventListener('click', advanceOnboardingChat);
    $('#onboarding-next-chat')?.addEventListener('click', advanceOnboardingChat);
    // Scroll to bottom if there's conversation history
    if ((_onboardingData.messages || []).length > 0) {
      const main2 = $main();
      main2.scrollTop = main2.scrollHeight;
    }

  }
}

function advanceOnboarding(fromStep) {
  if (fromStep === 2) {
    const name = $('#onboarding-name')?.value?.trim();
    if (!name) { $('#onboarding-name').focus(); return; }
    _onboardingData.name = name;
    _onboardingStep = 3;
  }
  animateMain('view-slide-left');
  renderOnboarding();
}

async function saveApiKeyAndAdvance() {
  const keyInput = $('#onboarding-apikey');
  const proxyInput = $('#onboarding-proxy');
  const rawValue = keyInput?.value?.trim();
  const proxyValue = proxyInput?.value?.trim();
  const PLACEHOLDER = '••••••••••••••••••••••••••••••••••••••••';
  const existingKey = rawValue === PLACEHOLDER ? await getApiKey() : null;
  const key = existingKey || rawValue;

  // Save proxy URL if provided
  if (proxyValue) {
    await saveProxyUrl(proxyValue);
  }

  // Need either an API key or a proxy URL to proceed
  if (!key && !proxyValue) {
    const err = $('#onboarding-key-error');
    if (err) err.textContent = 'Please enter an API key or proxy URL.';
    keyInput?.focus();
    return;
  }
  if (key) await saveApiKey(key);
  _onboardingStep = 4;
  animateMain('view-slide-left');
  renderOnboarding();
}

async function sendOnboardingMessage() {
  const input = $('#onboarding-input');
  const text = input?.value?.trim();
  if (!text) { input?.focus(); return; }

  const chat = $('#onboarding-chat');
  const compose = $('#onboarding-compose');

  // Add user message to chat + conversation history
  _onboardingData.messages.push({ role: 'user', content: text });
  const thinkingId = `onboarding-thinking-${Date.now()}`;
  chat.insertAdjacentHTML('beforeend',
    `<div class="msg msg-user"><p>${esc(text)}</p></div>
     <div class="msg msg-response" id="${thinkingId}" role="status" aria-live="polite">
       <span class="loading-spinner-inline" aria-hidden="true"></span>
       <span>${_onboardingData.messages.length <= 1 ? 'Getting to know you...' : 'Thinking...'}</span>
     </div>`);
  chat.scrollTop = chat.scrollHeight;

  input.value = '';
  input.disabled = true;
  const sendBtn = $('#onboarding-send');
  if (sendBtn) sendBtn.disabled = true;

  try {
    // Build messages with name context folded into the first user message
    const msgs = _onboardingData.messages.map((m, i) =>
      i === 0 && m.role === 'user'
        ? { role: 'user', content: `My name is ${_onboardingData.name}. ${m.content}` }
        : m
    );
    const result = await orchestrator.converse('onboarding-conversation', msgs, 1024);

    // Add assistant response to history
    _onboardingData.messages.push({ role: 'assistant', content: JSON.stringify(result) });

    // Show response
    const thinkingEl = document.getElementById(thinkingId);
    thinkingEl.textContent = '';
    thinkingEl.insertAdjacentHTML('beforeend', `<p>${esc(result.message)}</p>`);

    if (result.done) {
      // Save profile
      const profile = result.profile || {};
      profile.name = _onboardingData.name;
      profile.createdAt = Date.now();
      profile.updatedAt = Date.now();
      await saveLearnerProfile(profile);
      await saveLearnerProfileSummary(result.summary || result.message);
      syncInBackground('profile', 'profileSummary');
      _onboardingData.profileDone = true;
    }
  } catch (e) {
    console.warn('Onboarding conversation failed:', e);
    try {
      const thinkingEl = document.getElementById(thinkingId);
      if (thinkingEl) {
        thinkingEl.textContent = '';
        thinkingEl.insertAdjacentHTML('beforeend', `<p>No worries — let's keep going!</p>`);
      }
    } catch { /* DOM may have changed */ }
    _onboardingData.profileDone = true;
  }

  // Persist conversation state
  saveOnboardingState({ name: _onboardingData.name, messages: _onboardingData.messages, profileDone: _onboardingData.profileDone });

  // Re-render to update compose bar (show Continue if done)
  input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  renderOnboarding();
}

async function completeOnboarding() {
  state.preferences = { ...(state.preferences || {}), name: _onboardingData.name };
  await savePreferences(state.preferences);
  await saveOnboardingComplete();
  await clearOnboardingState();
  _onboardingStep = 1;
  _onboardingData = {};
  state.view = 'courses';
  render();
}

// -- Diagnostic ---------------------------------------------------------------


function showProfileFeedback() {
  showModal(`
    <h2>Add Profile Feedback</h2>
    <p>Share anything that seems inaccurate or missing — your device, experience level, learning style, or anything else. The AI will revise your profile to reflect it.</p>
    <label for="profile-feedback-input" class="sr-only">Profile feedback</label>
    <textarea id="profile-feedback-input" class="feedback-textarea" rows="4" placeholder="e.g. I'm a complete beginner. I use a Chromebook and don't have admin access." aria-label="Profile feedback"></textarea>
    <div class="action-bar">
      <button class="secondary-btn" id="cancel-profile-feedback-btn">Cancel</button>
      <button class="primary-btn" id="submit-profile-feedback-btn">Submit</button>
    </div>`, 'dialog', 'Add profile feedback');

  const input = $('#profile-feedback-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });
  $('#cancel-profile-feedback-btn').addEventListener('click', hideModal);
  $('#submit-profile-feedback-btn').addEventListener('click', submit);

  async function submit() {
    const feedbackText = input.value.trim();
    if (!feedbackText) return;
    hideModal();
    const main = $main();
    main.innerHTML = `
      <div class="loading-container" role="status" aria-live="polite">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Updating your profile...</p>
      </div>`;
    try {
      const profile = await getLearnerProfile() || defaultProfile();
      const result = await orchestrator.updateProfileFromFeedback(profile, feedbackText, {
        courseName: null, activityType: null, activityGoal: null
      });
      await saveProfileResult(profile, result);
      trackEvent('profile_feedback', {
        feedbackLength: feedbackText.length,
        strengthsCount: result?.profile?.strengths?.length || 0,
        weaknessesCount: result?.profile?.weaknesses?.length || 0,
      });
    } catch (e) {
      console.warn('Profile feedback failed:', e);
    }
    renderSettings();
  }
}

async function sendDiagnosticMessage(course) {
  const input = $('#diagnostic-response');
  const text = input?.value?.trim();
  if (!text) { input?.focus(); return; }

  const activity = state.diagnostic.activity;
  const chat = document.querySelector('.chat');
  const compose = document.querySelector('.chat-compose');

  // Add user message to conversation history
  state.diagnostic.messages.push({ role: 'user', content: text });
  const diagThinkingId = `diag-thinking-${Date.now()}`;
  chat.insertAdjacentHTML('beforeend',
    `<div class="msg msg-user"><p>${esc(text)}</p></div>
     <div class="msg msg-response" id="${diagThinkingId}" role="status" aria-live="polite">
       <span class="loading-spinner-inline" aria-hidden="true"></span> ${state.diagnostic.messages.length <= 1 ? 'Assessing your skills...' : 'Thinking...'}
     </div>`);
  chat.scrollTop = chat.scrollHeight;

  input.value = '';
  input.disabled = true;
  const sendBtn = $('#submit-diagnostic-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    // Build context for the conversational diagnostic agent
    const courseContext = `Course: ${course.name}\nDescription: ${course.description || ''}\nObjectives: ${(course.learningObjectives || []).map(o => o.name).join(', ')}`;
    const result = await orchestrator.converse('diagnostic-conversation', [
      { role: 'user', content: courseContext },
      { role: 'assistant', content: JSON.stringify({ message: activity.instruction, done: false }) },
      ...state.diagnostic.messages
    ], 1024);

    // Add assistant response to history
    state.diagnostic.messages.push({ role: 'assistant', content: JSON.stringify(result) });

    // Show response
    const thinkingEl = document.getElementById(diagThinkingId);
    thinkingEl.textContent = '';
    thinkingEl.insertAdjacentHTML('beforeend', `<p>${esc(result.message)}</p>`);

    // Persist conversation state
    saveDiagnosticState(state.diagnostic);

    if (result.done) {
      // Save diagnostic result and start course
      const diagnosticResult = {
        score: result.score || 0,
        feedback: result.feedback || result.message,
        strengths: result.strengths || [],
        improvements: result.improvements || [],
        recommendation: 'advance',
        passed: true
      };
      state.diagnostic.result = { courseId: course.courseId, result: diagnosticResult };

      trackEvent('diagnostic_assessed', {
        courseId: course.courseId,
        activityGoal: activity.goal,
        score: diagnosticResult.score,
        feedback: diagnosticResult.feedback,
        strengths: diagnosticResult.strengths,
        improvements: diagnosticResult.improvements,
        recommendation: diagnosticResult.recommendation,
      });
      updateProfileInBackground(diagnosticResult, course, activity);

      // Auto-start course after brief pause
      state.diagnostic.phase = null;
      state.diagnostic.skipFor = state.activeCourseId;
      startOrResumeCourse(state.activeCourseId);
      return;
    }

    // Not done — re-enable compose for next message
    // Inject skip button after 2 user messages (since we don't re-render)
    const userCount = state.diagnostic.messages.filter(m => m.role === 'user').length;
    const existingSkip = document.getElementById('skip-diagnostic-btn');
    if (userCount >= 2 && !existingSkip) {
      chat.insertAdjacentHTML('beforeend',
        '<button id="skip-diagnostic-btn" class="skip-step-btn">Skip to course</button>');
      $('#skip-diagnostic-btn').addEventListener('click', () => skipDiagnostic(course));
    }

    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
    chat.scrollTop = chat.scrollHeight;
  } catch (e) {
    console.warn('Diagnostic conversation failed:', e);
    try {
      const thinkingEl = document.getElementById(diagThinkingId);
      if (thinkingEl) {
        thinkingEl.textContent = '';
        thinkingEl.insertAdjacentHTML('beforeend', `<p>Let's move on to the course.</p>`);
      }
    } catch { /* DOM may have changed */ }
    // Skip diagnostic and start course
    state.diagnostic.phase = null;
    state.diagnostic.skipFor = state.activeCourseId;
    startOrResumeCourse(state.activeCourseId);
  }
}

function skipDiagnostic(course) {
  state.diagnostic.phase = null;
  state.diagnostic.skipFor = state.activeCourseId;
  startOrResumeCourse(state.activeCourseId);
}

// -- Work ---------------------------------------------------------------------

async function renderWork() {
  const main = $main();
  const cards = [];

  // Gather all courses that have progress (in-progress and completed)
  for (const [courseId, p] of Object.entries(state.allProgress)) {
    if (!p.learningPlan) continue;
    const course = state.courses.find(c => c.courseId === courseId);
    if (!course) continue;
    const workName = p.learningPlan.finalWorkProductDescription || course.name;
    const total = p.learningPlan.activities?.length || 0;
    const completed = Math.min(p.currentActivityIndex + (p.status === 'completed' ? 0 : 0), total);
    // Count completed steps: for completed courses all are done; otherwise it's currentActivityIndex
    const completedSteps = p.status === 'completed' ? total : p.currentActivityIndex;
    const recordingCount = p.drafts?.length || 0;

    // Build segmented progress bar
    const segments = (p.learningPlan.activities || []).map((a, i) => {
      const filled = i < completedSteps;
      const current = i === completedSteps && p.status !== 'completed';
      const cls = filled ? 'seg-filled' : current ? 'seg-current' : 'seg-empty';
      return `<span class="progress-seg ${cls}" title="${TYPE_LABELS[a.type] || a.type}"></span>`;
    }).join('');

    const isCompleted = p.status === 'completed';
    const finalUrl = p.finalWorkProductUrl;

    cards.push(`
      <li>
        <button class="work-card" data-work-course="${esc(courseId)}">
          <strong class="work-card-title">${esc(workName)}</strong>
          <small class="work-card-course">${esc(course.name)}</small>
          <div class="progress-bar-segmented">${segments}</div>
          <div class="work-card-stats">
            <span>${recordingCount} recording${recordingCount !== 1 ? 's' : ''}</span>
            ${isCompleted && finalUrl ? `<a href="${esc(finalUrl)}" target="_blank" rel="noopener" class="work-open-link" onclick="event.stopPropagation()">Open</a>` : ''}
          </div>
        </button>
      </li>`);
  }

  if (cards.length === 0) {
    main.innerHTML = '<h2>Portfolio</h2><p>No work products yet. Start a course to begin.</p>';
    return;
  }

  main.innerHTML = `
    <h2>Portfolio</h2>
    <ul class="work-list" role="list">${cards.join('')}</ul>`;

  main.querySelectorAll('[data-work-course]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeWorkCourseId = btn.dataset.workCourse;
      navigate('work-detail');
    });
  });
}

async function renderWorkDetail() {
  const main = $main();
  const courseId = state.activeWorkCourseId;
  const p = state.allProgress[courseId];
  if (!p || !p.learningPlan) { navigate('work'); return; }
  const course = state.courses.find(c => c.courseId === courseId);
  const workName = p.learningPlan.finalWorkProductDescription || course?.name || 'Work Product';
  const planActivities = p.learningPlan.activities || [];
  const total = planActivities.length;
  const completedSteps = p.status === 'completed' ? total : p.currentActivityIndex;

  // Segmented progress bar with type letters
  const segments = planActivities.map((a, i) => {
    const filled = i < completedSteps;
    const current = i === completedSteps && p.status !== 'completed';
    const cls = filled ? 'seg-filled' : current ? 'seg-current' : 'seg-empty';
    const letter = TYPE_LETTERS[a.type] || '?';
    return `<span class="progress-seg-labeled ${cls}" title="${TYPE_LABELS[a.type] || a.type}">${letter}</span>`;
  }).join('');

  let html = `
    <div class="course-header">
      <button class="back-btn" aria-label="Back to portfolio" id="back-btn">&larr;</button>
      <div class="course-header-info">
        <h2>${esc(workName)}</h2>
        <small class="work-detail-course">${esc(course?.name || '')}</small>
      </div>
    </div>
    <div class="progress-bar-labeled">${segments}</div>
    <div class="build-timeline">`;

  for (let i = 0; i < total; i++) {
    const slot = planActivities[i];
    const activity = p.activities?.[i];
    const typeLabel = TYPE_LABELS[slot.type] || slot.type;
    const isFuture = i > completedSteps;
    const isCurrent = i === completedSteps && p.status !== 'completed';
    const drafts = (p.drafts || []).filter(d => d.activityId === slot.id);

    if (isFuture) {
      html += `<div class="timeline-step timeline-future"><span class="timeline-type">${esc(typeLabel)}</span></div>`;
      continue;
    }

    html += `<div class="timeline-step${isCurrent ? ' timeline-current' : ''}">`;
    html += `<div class="timeline-step-header"><span class="timeline-type">${esc(typeLabel)}</span>`;
    if (slot.goal) html += `<span class="timeline-goal">${esc(slot.goal)}</span>`;
    html += `</div>`;

    if (drafts.length > 0) {
      // Show latest draft
      const latest = drafts[drafts.length - 1];
      const latestScore = Math.round((latest.score || 0) * 100);
      const latestTime = new Date(latest.timestamp).toLocaleString();
      html += `<div class="timeline-draft">
        <span class="timeline-draft-score">${latestScore}%</span>
        <span class="timeline-draft-time">${latestTime}</span>
        ${latest.url ? `<a href="${esc(latest.url)}" target="_blank" rel="noopener" class="timeline-draft-link">View</a>` : ''}
        <button class="timeline-screenshot-btn" data-screenshot-key="${esc(latest.screenshotKey)}" aria-label="Show screenshot">Screenshot</button>
      </div>`;

      // Collapsible earlier attempts
      if (drafts.length > 1) {
        html += `<details class="timeline-history"><summary>${drafts.length - 1} earlier attempt${drafts.length > 2 ? 's' : ''}</summary>`;
        for (let d = 0; d < drafts.length - 1; d++) {
          const dr = drafts[d];
          const sc = Math.round((dr.score || 0) * 100);
          const tm = new Date(dr.timestamp).toLocaleString();
          html += `<div class="timeline-draft timeline-draft-old">
            <span class="timeline-draft-score">${sc}%</span>
            <span class="timeline-draft-time">${tm}</span>
            ${dr.url ? `<a href="${esc(dr.url)}" target="_blank" rel="noopener" class="timeline-draft-link">View</a>` : ''}
            <button class="timeline-screenshot-btn" data-screenshot-key="${esc(dr.screenshotKey)}" aria-label="Show screenshot">Screenshot</button>
          </div>`;
        }
        html += `</details>`;
      }
    }

    html += `</div>`;
  }

  html += `</div>`;
  main.innerHTML = html;

  // Bind events
  $('#back-btn').addEventListener('click', () => navigate('work'));

  // On-demand screenshot loading
  main.querySelectorAll('.timeline-screenshot-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.screenshotKey;
      if (!key) return;
      // Toggle: if next sibling is a screenshot, remove it
      if (btn.nextElementSibling?.classList.contains('timeline-screenshot-img')) {
        btn.nextElementSibling.remove();
        return;
      }
      btn.textContent = 'Loading...';
      const dataUrl = await getScreenshot(key);
      btn.textContent = 'Screenshot';
      if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'timeline-screenshot-img';
        img.alt = 'Draft screenshot';
        btn.after(img);
      }
    });
  });
}

// -- Settings -----------------------------------------------------------------

async function renderSettings() {
  const main = $main();
  const prefs = state.preferences;
  const hasKey = !!(await getApiKey());
  const profileSummary = await getLearnerProfileSummary();
  const loggedIn = await auth.isLoggedIn();
  const currentProxy = await getProxyUrl();

  main.innerHTML = `
    <h2>Settings</h2>

    <div class="settings-section">
      <h3>AI Provider</h3>
      ${loggedIn ? `
        <p class="settings-hint">AI is provided by your 1111 Learn account.</p>
      ` : `
        <p class="settings-hint">Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to enable AI-powered learning.</p>
        <div class="api-key-row">
          <label for="api-key-input" class="sr-only">API Key</label>
          <input type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off" value="${hasKey ? '••••••••••••••••••••••••••••••••••••••••' : ''}">
          <button id="save-key-btn" class="primary-btn">Save</button>
        </div>
        <div id="key-feedback" role="status" aria-live="polite"></div>
        <details class="proxy-details" ${currentProxy ? 'open' : ''}>
          <summary>Or use a Bedrock proxy</summary>
          <p class="settings-hint">Enter a proxy URL that forwards to Amazon Bedrock. If set, this takes priority over the API key.</p>
          <div class="api-key-row">
            <label for="proxy-url-input" class="sr-only">Proxy URL</label>
            <input type="url" id="proxy-url-input" placeholder="https://your-proxy.example.com" autocomplete="off" value="${esc(currentProxy || '')}">
            <button id="save-proxy-btn" class="primary-btn">Save</button>
          </div>
          <div id="proxy-feedback" role="status" aria-live="polite"></div>
        </details>
      `}
    </div>

    <hr>

    <div class="settings-section">
      <h3>Personalization</h3>
      <form id="prefs-form" class="settings-form" aria-label="Personalization">
        <label>
          Name
          <input type="text" name="name" value="${esc(prefs.name || '')}">
        </label>
        <button type="submit" class="primary-btn">Save</button>
        <div id="prefs-feedback" role="status" aria-live="polite"></div>
      </form>
    </div>

    <hr>

    <div class="settings-section">
      <h3>Learner Profile</h3>
      <p class="settings-hint">Updated automatically by the AI as you complete activities.</p>
      <div class="profile-display" aria-label="Learner profile summary">${profileSummary ? esc(profileSummary) : '<em>No profile yet. Complete an activity to build your profile.</em>'}</div>
      <button class="secondary-btn profile-feedback-btn" id="profile-feedback-btn">Add Feedback</button>
    </div>

    `;

  // API key + proxy URL (only interactive when not logged in)
  if (!loggedIn) {
    const keyInput = $('#api-key-input');
    keyInput.addEventListener('focus', () => {
      if (keyInput.value === '••••••••••••••••••••••••••••••••••••••••') keyInput.value = '';
    });
    keyInput.addEventListener('blur', async () => {
      if (!keyInput.value && await getApiKey()) keyInput.value = '••••••••••••••••••••••••••••••••••••••••';
    });

    const saveKey = async () => {
      const key = keyInput.value.trim();
      if (!key || key === '••••••••••••••••••••••••••••••••••••••••') {
        showKeyFeedback('Please enter an API key.', 'error');
        return;
      }
      await saveApiKey(key);
      keyInput.value = '••••••••••••••••••••••••••••••••••••••••';
      showKeyFeedback('Saved!', 'success');
    };

    $('#save-key-btn').addEventListener('click', saveKey);
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveKey(); }
    });

    // Proxy URL
    const proxyInput = $('#proxy-url-input');
    const saveProxy = async () => {
      const url = proxyInput.value.trim();
      await saveProxyUrl(url || null);
      showFormFeedback('proxy-feedback', url ? 'Saved!' : 'Cleared.');
    };
    $('#save-proxy-btn').addEventListener('click', saveProxy);
    proxyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveProxy(); }
    });
  }

  // Personalization
  const prefsForm = $('#prefs-form');
  prefsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.preferences = { name: fd.get('name') };
    await savePreferences(state.preferences);
    syncInBackground('preferences');
    showFormFeedback('prefs-feedback', 'Saved!');
  });

  // Learner profile feedback
  $('#profile-feedback-btn').addEventListener('click', () => showProfileFeedback());

}

function showFormFeedback(id, msg) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = msg;
  el.className = 'form-feedback form-feedback-show';
  setTimeout(() => { el.className = 'form-feedback'; }, 2000);
}

function showKeyFeedback(msg, type) {
  const el = $('#key-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `key-feedback key-feedback-${type}`;
}

// -- Error handling -----------------------------------------------------------

function showError(message) {
  const main = $main();
  main.innerHTML = `
    <div class="error-container" role="alert">
      <p class="error-message">${esc(message)}</p>
      <div class="action-bar">
        <button class="secondary-btn" id="error-back-btn">Back</button>
      </div>
    </div>`;
  $('#error-back-btn').addEventListener('click', () => render());
}

function handleApiError(e) {
  logDev('error', { type: e instanceof ApiError ? e.type : 'unknown', message: e.message || String(e) });
  if (e instanceof ApiError) {
    if (e.type === 'invalid_key') {
      showError('Invalid API key. Go to Settings to update your key.');
    } else if (e.type === 'rate_limit') {
      showErrorWithRetry('Rate limited. Try again in a moment.');
    } else if (e.type === 'network') {
      showErrorWithRetry('Network error. Check your connection.');
    } else if (e.type === 'safety') {
      showError('Content was flagged as unsafe. Please try a different approach.');
    } else {
      showError(e.message);
    }
  } else {
    showError('An unexpected error occurred. Please try again.');
    console.error(e);
  }
}

function showErrorWithRetry(message) {
  const main = $main();
  main.innerHTML = `
    <div class="error-container" role="alert">
      <p class="error-message">${esc(message)}</p>
      <div class="action-bar">
        <button class="secondary-btn" id="error-back-btn">Back</button>
        <button class="primary-btn" id="error-retry-btn">Retry</button>
      </div>
    </div>`;
  $('#error-back-btn').addEventListener('click', () => render());
  $('#error-retry-btn').addEventListener('click', () => render());
}

// -- Helpers ------------------------------------------------------------------

function appMessage(text) {
  return `<div class="msg msg-app"><p>${esc(text)}</p></div>`;
}

/** Render a conversation message array to HTML. Parses assistant JSON for .message field. */
function renderConversationMessages(messages, initialMessage) {
  let html = '';
  if (initialMessage) {
    html += `<div class="msg msg-response"><p>${renderMd(initialMessage)}</p></div>`;
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      html += `<div class="msg msg-user"><p>${esc(msg.content)}</p></div>`;
    } else {
      let text = msg.content;
      try { text = JSON.parse(msg.content).message || text; } catch { /* use raw content */ }
      html += `<div class="msg msg-response"><p>${renderMd(text)}</p></div>`;
    }
  }
  return html;
}

function instructionMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let intro = '';
  const steps = [];

  for (const line of lines) {
    const stepMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (stepMatch) {
      steps.push(stepMatch[2]);
    } else {
      if (steps.length === 0) {
        intro += (intro ? ' ' : '') + line;
      }
    }
  }

  let html = '<div class="msg msg-response instruction-card">';
  if (intro) html += `<p class="instruction-intro">${renderMd(intro)}</p>`;
  if (steps.length > 0) {
    html += '<ol class="instruction-steps">';
    for (const step of steps) {
      html += `<li>${renderMd(step)}</li>`;
    }
    html += '</ol>';
  }
  if (!intro && steps.length === 0) {
    html += `<p>${renderMd(text)}</p>`;
  }
  html += '</div>';
  return html;
}

function draftMessage(draft) {
  const time = new Date(draft.timestamp).toLocaleString();
  const label = draft.url
    ? `<a href="${esc(draft.url)}" target="_blank" rel="noopener" class="draft-link">Draft recorded</a>`
    : 'Draft recorded';
  return `
    <div class="msg msg-draft">
      <svg class="draft-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>
      <div>
        <p class="draft-label">${label}</p>
        <small>${time}</small>
      </div>
    </div>`;
}

function feedbackCard(draft, isLatest = false) {
  const scorePercent = Math.round((draft.score || 0) * 100);
  let recLabel = '';
  if (draft.recommendation === 'advance') recLabel = 'Ready to advance';
  else if (draft.recommendation === 'revise') recLabel = 'Revision recommended';
  else if (draft.recommendation === 'continue') recLabel = 'Acceptable -- revision optional';

  let html = `<div class="msg msg-response feedback-card">
    <p>${renderMd(draft.feedback)}</p>
    <div class="feedback-score">
      <span class="score-badge">${scorePercent}%</span>
      ${recLabel ? `<span class="rec-label rec-${draft.recommendation}">${esc(recLabel)}</span>` : ''}
    </div>`;

  if (draft.strengths && draft.strengths.length > 0) {
    html += `<details class="feedback-details">
      <summary>Strengths</summary>
      <ul>${draft.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </details>`;
  }

  if (draft.improvements && draft.improvements.length > 0) {
    html += `<details class="feedback-details">
      <summary>Areas for improvement</summary>
      <ul>${draft.improvements.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </details>`;
  }

  html += '</div>';

  // Action buttons only on the latest draft, and not when already passed
  if (isLatest && draft.recommendation !== 'advance') {
    html += `<div class="feedback-below-actions">
      <button class="dispute-btn feedback-action-btn" data-draft-id="${esc(draft.id)}" aria-label="Dispute this assessment">Dispute</button>
      <button class="rerecord-btn feedback-action-btn feedback-action-record" data-draft-id="${esc(draft.id)}" aria-label="Re-record your work">&#9679; Re-record</button>
    </div>`;
  }

  return html;
}

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min${mins !== 1 ? 's' : ''}`;
  const hrs = Math.round(ms / 3600000);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''}`;
  const days = Math.round(ms / 86400000);
  return `${Math.max(1, days)} day${days !== 1 ? 's' : ''}`;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  return formatDuration(diff) + ' ago';
}

function completionSummary(course, p) {
  const workName = p.learningPlan?.finalWorkProductDescription || course.name;
  const totalSteps = p.learningPlan?.activities?.length || 0;
  const totalRecordings = p.drafts?.length || 0;
  const elapsed = p.startedAt && p.completedAt ? p.completedAt - p.startedAt : 0;
  const durationLabel = elapsed ? formatDuration(elapsed) : '1 min';
  return `<div class="msg msg-app completion-card">
    <div class="completion-badge" aria-hidden="true">🎉</div>
    <p class="completion-eyebrow">Build Complete</p>
    <strong class="completion-title">${esc(workName)}</strong>
    <div class="completion-stats">
      <span>${totalSteps} step${totalSteps !== 1 ? 's' : ''}</span>
      <span>${totalRecordings} recording${totalRecordings !== 1 ? 's' : ''}</span>
      <span>${durationLabel}</span>
    </div>
    <div class="completion-actions">
      <button class="secondary-btn completion-portfolio-btn" id="view-portfolio-btn">View in Portfolio</button>
      <button class="completion-next-btn" id="next-course-btn">Next Course</button>
    </div>
  </div>`;
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/** Lightweight markdown to HTML. Handles bold, italic, headings, lists, and line breaks. */
function renderMd(text) {
  let escaped = esc(text);
  // Headings (# to ###)
  escaped = escaped.replace(/^### (.+)$/gm, '<strong style="font-size:0.85rem;">$1</strong>');
  escaped = escaped.replace(/^## (.+)$/gm, '<strong style="font-size:0.9rem;">$1</strong>');
  escaped = escaped.replace(/^# (.+)$/gm, '<strong style="font-size:0.95rem;">$1</strong>');
  // Bold + italic
  escaped = escaped.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Unordered lists
  escaped = escaped.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
  escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, '<ul style="margin:4px 0 4px 16px;">$&</ul>');
  // Line breaks (double newline = paragraph break, single = <br>)
  escaped = escaped.replace(/\n\n+/g, '</p><p>');
  escaped = escaped.replace(/\n/g, '<br>');
  // Linkify URLs
  escaped = linkify(escaped);
  return escaped;
}

/** Convert URLs in already-escaped text into clickable links. */
/** Convert URLs in already-escaped text into clickable links. Handles both https://... and bare domain.tld/path URLs. */
function linkify(escaped) {
  // Runs on HTML-escaped text. Match URLs, stopping at whitespace, quotes, or HTML entities.
  return escaped.replace(
    /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s")\]]*)?/gi,
    match => {
      // Strip trailing HTML entities that got swept in (e.g. "&gt;" at end)
      match = match.replace(/&[a-z]+;$/, '');
      // Skip things that look like file extensions (e.g. "style.css") — require a slash or known domain
      if (!match.includes('/') && !match.startsWith('http') && !/\.(com|org|net|io|dev|co|edu|gov|app|me)\b/i.test(match)) return match;
      const href = match.startsWith('http') ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener">${match}</a>`;
    }
  );
}

function announce(msg) {
  let el = $('#sr-announce');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sr-announce';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    document.body.appendChild(el);
  }
  // Clear first so the same message re-triggers announcement
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}
