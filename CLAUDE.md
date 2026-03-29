# CLAUDE.md -- 1111 Learn

## Project overview
1111 Learn is a Chrome extension (Manifest V3, side panel) that helps learners build their professional portfolio through AI-guided courses. Five AI agents (3 LLM + 2 hybrid) drive an exemplar-driven learning loop powered by the Claude API. A course defines an exemplar (the mastery-level outcome) and learning objectives; the system creates activities, assesses submissions, enriches a growing knowledge base, and repeats until the learner achieves the exemplar. The user provides their own Anthropic API key via a first-run onboarding wizard, or logs in to use a managed account. All structured data is stored locally in SQLite (via sql.js WASM), persisted to `chrome.storage.local` as a serialized database. Binary assets (screenshots) remain in IndexedDB, referenced by key. When logged in, the server is the source of truth and local storage acts as a read cache.

## Architecture
Five agents drive the learning experience. The **Guide Agent** is the learner's companion throughout — it orients the learner at key moments while `courseEngine.js` orchestrates all other agent calls behind the scenes.

- **Guide Agent** (`MODEL_LIGHT`) -- the learner's companion throughout the course; appears at course start and course completion to orient and celebrate; handles follow-up Q&A via streaming; uses `orchestrator.converseStream('guide', ...)` for real-time streaming; returns plain text (not JSON); system prompt includes the program knowledge base (`data/knowledge-base.md`)
- **Course Owner Agent** (`MODEL_LIGHT`) -- initializes the course knowledge base from the course prompt (exemplar + learning objectives + learner profile); produces structured objectives with evidence descriptors, initial learner position, and empty insights; validated by `validateCourseKB()`
- **Activity Creator Agent** (`MODEL_LIGHT`) -- generates one activity at a time from the enriched course KB + learner profile + prior activity summaries; returns `{ instruction, tips[] }`; validated by `validateActivity()`
- **Activity Assessor Agent** (`MODEL_HEAVY` for screenshots, `MODEL_LIGHT` for text) -- evaluates submissions against the course exemplar and objectives; returns `{ achieved, demonstrates, strengths[], moved, needed, courseKBUpdate }` where `courseKBUpdate` feeds insights and learner position back into the course KB; validated by `validateAssessment()`
- **Learner Profile Owner** -- a hybrid agent: incremental code-level updates after every assessment (`orchestrator.incrementalProfileUpdate()`), plus a full LLM-powered deep update on course completion (`orchestrator.updateProfileOnCompletion()` using `learner-profile-owner.md`); profile feedback also uses the LLM via `learner-profile-update.md`

Agent prompts live in `prompts/*.md` and can be edited independently of code. `orchestrator.converseStream()` streams guide responses token by token. `src/lib/courseEngine.js` is the state machine that orchestrates all agent calls and appends messages to the course conversation. A program knowledge base (`data/knowledge-base.md`) is automatically injected into the guide agent system prompt so it can answer questions about the AI Leaders program.

### Knowledge bases
Three knowledge bases drive personalization:

1. **Course KB** (`course_kbs` table) -- initialized by the Course Owner from the course prompt + learner profile. Contains the exemplar, structured objectives with evidence, learner position, and accumulated insights. Enriched after every assessment via `courseKBUpdate` from the Assessor.
2. **Activity KB** (`activity_kbs` table) -- per-activity record of instruction, tips, and all attempt results. Used for context in subsequent activities.
3. **Learner Profile** (`profile` + `profile_summary` tables) -- built incrementally from assessment results. Tracks active courses, mastered courses, strengths, weaknesses, and preferences. Deep LLM update on course completion.

### Output validation
All agent outputs pass through deterministic validators in `js/validators.js` (imported by `js/orchestrator.js`) before reaching the user:

- **`validateActivity`** -- instruction string present, tips array present, ends with "Capture" or "Submit", max 5 steps (4 content + final), no platform-specific shortcuts, no multi-site instructions, no non-browser apps, no DevTools, must produce visible work, content safety
- **`validateAssessment`** -- `achieved` boolean, `demonstrates` string, `strengths` array, `needed` string, `courseKBUpdate` object with `insights` array and `learnerPosition` string, content safety
- **`validateCourseKB`** -- exemplar, objectives array (each with objective + evidence), learnerPosition, insights array, activitiesCompleted number, status string, content safety

On failure, the agent call is retried once automatically.

### Onboarding
On first run, a full-screen onboarding wizard (with animated geometric background) presents three steps: Welcome (login or continue) → Name → API Key. There is no separate "about you" conversation -- the learner profile builds naturally from course activities and assessments. The header and nav are hidden during onboarding. Completion is tracked via an `onboardingComplete` flag in the `settings` table. If the user is already logged in on startup, onboarding is skipped entirely and the flag is stamped automatically. In development, `.env.js` seeds the key into storage but onboarding still runs.

### Exemplar-driven learning loop
The entire learning experience takes place in a **single continuous chat per course** with three phases:

1. **Course intro** (`course_intro`): The Course Owner generates the course KB from the course prompt. The Guide welcomes the learner. The Activity Creator generates the first activity. "Start" begins learning.
2. **Learning** (`learning`): Activities flow inline in the chat. The learner submits work (screenshot or text). The Assessor evaluates against the exemplar and enriches the course KB with new insights and an updated learner position. If the exemplar is not yet achieved, the Activity Creator generates the next activity from the enriched KB -- each successive activity is more precisely tuned to the learner. This loop repeats until the learner achieves the exemplar.
3. **Completed** (`completed`): The Guide celebrates. A deep LLM profile update captures everything the learner demonstrated. A "Next Course" action returns to the courses list.

`src/pages/CourseChat.jsx` renders the entire course experience. `src/lib/courseEngine.js` manages all phase transitions and agent calls.

### Conversational UX
Everything in a course happens in one continuous chat. The course header has a **progress bar** showing the learner's position. All loading states appear as in-chat thinking indicators. The compose bar is fixed at the bottom with: Capture button (left), text area (center), Submit and Send buttons (right). Capture and text submission are always available. **Action buttons** appear inline in the chat, labeled with the next step. All messages are persisted in the `course_messages` table so the conversation survives panel reloads.

### Learner profile updates
The profile updates incrementally after every assessment (code-level, no LLM call) and deeply on course completion (LLM call). Profile feedback from settings also triggers an LLM update. All updates run through a sequential queue in `src/lib/profileQueue.js` to prevent concurrent updates from overwriting each other. `ensureProfileExists()` guarantees a profile exists before any update. `mergeProfile()` in `src/lib/profileQueue.js` unions array fields (`activeCourses`, `masteredCourses`), merges preferences so agent responses can never accidentally lose accumulated data.

### Storage (SQLite)
All structured data is stored in an in-memory SQLite database powered by sql.js (WASM). The database is serialized to a `Uint8Array` and persisted to `chrome.storage.local` under `_sqliteDb` (debounced, plus on `visibilitychange`). `js/db.js` manages initialization, schema creation, persistence, and column migrations (via try/catch ALTER TABLE). `js/storage.js` provides the query API used by the rest of the app. Screenshots remain in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` table. Text responses are stored directly in the `text_response` column of the `drafts` table.

**Tables:** `settings`, `preferences`, `profile`, `profile_summary`, `course_kbs`, `activity_kbs`, `activities`, `drafts`, `work_products`, `auth`, `pending_state`, `course_messages`.

The `course_messages` table stores the unified conversation per course (role, content, msg_type, phase, metadata JSON, timestamp). The `course_kbs` table stores the evolving course knowledge base keyed by course_id. The `activity_kbs` table stores per-activity knowledge (instruction, tips, attempt history) keyed by activity_id. Activities are identified as `{courseId}-act-{number}`. Drafts store assessment results inline: `achieved`, `demonstrates`, `moved`, `needed`, `strengths`.

### Cloud sync
Optional login via `learn-service` (separate repo) enables cross-device data persistence. Login is never required -- the extension works fully offline/locally. When logged in, the server is the source of truth: data is written to the server after every local save, and pulled from the server on startup/login. Local storage acts as a read cache for fast access.

- **Auth:** `js/auth.js` handles login/logout/token refresh via JWT access tokens (15 min) + refresh tokens (30 day, rotated on use). Tokens are stored in the SQLite `auth` table. On login, the auth user's name is synced into local preferences. If logged in, the onboarding wizard is skipped. The Personalization section in Settings is hidden when logged in (name comes from the service).
- **Remote storage:** `js/sync.js` is a thin client for `/v1/sync` endpoints on `learn-service`. `sync.save(key)` PUTs local data to the server (handles version conflicts by retrying with the server's version). `sync.loadAll()` GETs all data from the server and replaces local storage, removing any local data the server doesn't have. Version numbers are tracked in memory (not persisted) and rebuilt each session.
- **AI provider routing:** `js/orchestrator.js` routes API calls based on priority: (1) logged in → learn-service Bedrock proxy `/v1/ai/messages` via JWT auth, (2) Anthropic API key → direct Anthropic API. Logged-in users need no API key.
- **API key provisioning:** On login, if no local API key exists, the extension checks for an admin-assigned key via `/v1/me/api-key` and auto-installs it.
- **Startup:** On bootstrap, if logged in, `sync.loadAll()` runs before reading local data. This ensures the extension reflects the server state. Falls back to local cache if offline.
- **Settings UI:** When signed out, the Personalization section shows a name field and the AI Provider section shows the API key input. When signed in, Personalization is hidden (name comes from the service) and the API key section shows a note that AI is provided by the 1111 Learn account. Sign Out is in the header user dropdown, not the Settings page.

## Content hierarchy
Courses are defined as markdown files in `data/courses/` (e.g., `foundations.md`). Each course prompt contains a title (H1), description (first paragraph), exemplar (H2 section), and learning objectives (H2 section with bullet list). `js/courseOwner.js` loads and parses these files at runtime via `loadCourses()`. Adding a new course means adding a `.md` file and registering it in the `courseFiles` array in `courseOwner.js`.

The Course Owner agent transforms the course prompt into a structured course KB with objectives broken down into evidence descriptors. Activities are generated dynamically from the KB -- there are no predefined units, journeys, or rubrics.

## Key conventions
- The UI is a React app (React 18, React Router, Vite). Source lives in `src/` — pages, components, contexts, hooks, lib modules.
- Service modules (`js/db.js`, `js/storage.js`, `js/orchestrator.js`, `js/auth.js`, `js/sync.js`, `js/api.js`, `js/validators.js`, `js/courseOwner.js`) are vanilla JS (ES modules) and stay outside `src/`. React components import from them.
- Vite builds to `dist/` which is the loadable extension directory. CI zips `dist/` for releases.
- The entry point is `sidepanel.html` → `src/main.jsx` (initializes SQLite, then mounts React).
- Storage is abstracted in `js/storage.js` (SQLite via sql.js for structured data, IndexedDB for screenshots). `js/db.js` manages the SQLite lifecycle.
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `chrome.runtime.getURL`.
- Activities must happen entirely in the browser tab (screenshot capture only sees the active tab). Text submission is always available as an alternative.
- Activities end with "Hit Capture to capture your screen." or "Hit Submit to submit your response."
- Keyboard shortcuts: Enter submits single-line inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs.
- URLs in activity instructions are automatically linkified.
- Views: `onboarding`, `courses`, `course` (single continuous chat), `work` (course-level portfolio cards), `work-detail` (activity timeline), `settings`.
- Work section shows portfolio cards; tapping opens a detail view with the full activity and draft timeline.
- View transitions: navigating deeper slides left, going back slides right, lateral navigation fades up. List items stagger in. All animations respect `prefers-reduced-motion`.

## CI/CD
Two GitHub Actions workflows handle versioning and releases across two branches:

### Staging workflow (`.github/workflows/staging.yml`)
Runs on every push to `staging`:
1. Runs tests (`npm test`)
2. Reads `main`'s current version from `manifest.json` (e.g., `0.6.3`)
3. Counts non-bump commits on `staging` since it diverged from `main` to determine the RC number
4. Updates `manifest.json` with 4-segment `version` (e.g., `0.6.3.2`) and `version_name` (e.g., `0.6.3-RC2`)
5. Packages the extension and creates a GitHub **pre-release** (not published to Chrome Web Store)
6. The RC number resets automatically when `staging` is merged into `main` (since the merge-base moves forward)

### Release workflow (`.github/workflows/release.yml`)
Runs on every push to `main` (which should only happen via PR from `staging`):
1. Runs tests (`npm test`)
2. Collects commits since the last production release tag
3. Calls Claude (Haiku) to determine the semver bump and generate release notes
4. Updates `manifest.json` with clean 3-segment version, strips any `version_name` from staging
5. Packages the extension into a zip (excluding dev files)
6. Commits the version bump and creates a GitHub Release with the zip attached
7. Uploads the zip to the Chrome Web Store and publishes it

### Branch protection
`main` is protected: direct pushes are blocked, PRs require approval and passing status checks. By convention, `main` only accepts PRs from `staging`. Branch protection is configured via `scripts/setup-branch-protection.sh`.

### Required secrets
- `ANTHROPIC_API_KEY` -- for Claude-powered version analysis
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` -- OAuth2 credentials for Chrome Web Store API
- `CWS_EXTENSION_ID` -- the extension's Chrome Web Store ID

## File structure
```
manifest.json            Chrome extension manifest (MV3)
background.js            Opens the side panel on icon click
sidepanel.html           Vite entry point (mounts React)
sidepanel.css            Global styles
vite.config.js           Vite build config
lib/
  sql-wasm.js            Vendored sql.js (SQLite WASM engine)
  sql-wasm.wasm          SQLite WASM binary
js/                      Service modules (vanilla JS, imported by React)
  db.js                  SQLite database lifecycle (init, query, persist)
  storage.js             SQLite query layer + IndexedDB for screenshots
  courseOwner.js          Course prompt loading, parsing, KB updates
  api.js                 AI API client (Anthropic direct + Bedrock proxy support)
  orchestrator.js        Agent orchestration (prompt loading, context assembly, model routing)
  validators.js          Pure validation functions (used by orchestrator + tests)
  auth.js                Authentication module for learn-service (login, logout, token refresh)
  sync.js                Cloud data sync (push/pull with optimistic locking)
src/                     React app
  main.jsx               Entry point: db init, React mount
  App.jsx                Routes + redirect logic
  contexts/
    AppContext.jsx        Course/progress/preferences state (useReducer)
    AuthContext.jsx       Auth state wrapping js/auth.js
    ModalContext.jsx      Modal show/hide + portal
  hooks/
    useViewTransition.js  Route-change animations
    useAutoResize.js      Textarea auto-resize
  lib/
    syncDebounce.js       Debounced cloud sync
    profileQueue.js       Sequential profile update queue + merge logic
    courseEngine.js       Exemplar-driven learning loop (all phase transitions, agent calls, message appending)
    helpers.js            esc, renderMd, linkify
    constants.js          VIEW_DEPTH, COURSE_PHASES, MSG_TYPES
    confetti.js           Confetti burst on course completion
  components/
    AppShell.jsx          Header + nav + main wrapper + transitions
    PasswordField.jsx     Show/hide toggle input
    OnboardingCanvas.jsx  Animated geometric mesh
    modals/
      LoginModal.jsx      Email/password login form
      ConfirmModal.jsx    Generic confirm dialog
      ResponseModal.jsx   Submission modal (screenshot, text, or both)
    chat/
      ChatArea.jsx        Scrollable container, auto-scroll
      ComposeBar.jsx      Capture + textarea + submit + send
      ActionButton.jsx    Inline action button (labeled next-step CTA)
      ProgressBar.jsx     Course progress bar
      ThinkingSpinner.jsx Inline loading indicator
      UserMessage.jsx     User chat bubble
      AssistantMessage.jsx AI response with markdown
      InstructionMessage.jsx Activity instruction + tips + linkified URLs
      DraftMessage.jsx    Draft captured indicator
      FeedbackCard.jsx    Assessment feedback (achieved, demonstrates, strengths, needed)
  pages/
    CoursesList.jsx       Course cards with phase status
    CourseChat.jsx        Unified course chat (guide + activities + feedback)
    Portfolio.jsx         Course-level portfolio cards
    PortfolioDetail.jsx   Course portfolio: activity timeline
    Settings.jsx          API key, name, profile feedback
    onboarding/
      OnboardingFlow.jsx  3-step wizard with canvas backdrop
      WelcomeStep.jsx     Login or continue
      NameStep.jsx        Name input
      ApiKeyStep.jsx      API key input
prompts/                 Agent system prompts (markdown)
  guide.md               Guide agent prompt
  course-owner.md        Course Owner agent prompt
  activity-creation.md   Activity Creator agent prompt
  activity-assessment.md Activity Assessor agent prompt
  learner-profile-owner.md  Deep profile update prompt (course completion)
  learner-profile-update.md Profile feedback update prompt
data/
  courses/               Course prompt files (markdown)
    foundations.md        Foundations course
  knowledge-base.md      Program knowledge base (injected into guide prompt)
assets/                  Icons and images
tests/
  manifest.test.js       Manifest validation tests
  courses.test.js        Course prompt validation tests
  validators.test.js     Output validator unit tests
  storage.test.js        SQLite storage round-trip tests
dist/                    Build output (gitignored, loadable as extension)
PRIVACY.md               Privacy policy
.github/
  workflows/
    release.yml          Production release (npm ci + build + zip dist/)
    staging.yml          Release candidate (npm ci + build + zip dist/)
```

## Documentation
Detailed docs live in `docs/` and are linked from `README.md`:
- `docs/architecture.md` -- agents overview, knowledge bases, storage, content hierarchy, data flow, file structure
- `docs/agent-lifecycle.md` -- full walkthrough of the exemplar-driven learning loop with every agent call, inputs, outputs, and validation
- `docs/cloud-sync.md` -- auth, remote storage, AI provider routing
- `docs/releases.md` -- CI/CD, versioning, branch protection, permissions, secrets, course prompt format
- `CONTRIBUTING.md` -- dev setup, workflow, guidelines, submitting changes

## Rules for every change
1. Update `README.md` if you add, remove, or rename any user-facing feature.
2. Update the relevant doc in `docs/` if you change architecture, agents, storage, sync, or CI/CD.
3. Update `CONTRIBUTING.md` if you change the development workflow.
4. Keep this `CLAUDE.md` in sync with the actual architecture. It is the authoritative reference for AI assistants.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
6. When editing agent prompts, test with a real API key to verify JSON output format.
7. Never commit API keys or secrets.
8. Activities must be completable entirely in the browser -- never reference desktop apps, terminals, or file system operations.
9. Do not manually bump the version in `manifest.json` -- the CI/CD workflows handle versioning automatically. During RC builds, `manifest.json` gains a 4-segment `version` and a `version_name` field; these are stripped on production release.
10. Run `npm test` before submitting PRs. Tests must pass in CI on both `staging` and `main`.
11. **Data schema changes:** If you add, remove, rename, or restructure any SQLite table or column, update the `CREATE TABLE` DDL and `MIGRATIONS` array in `js/db.js`. Update any affected getter/setter functions in `js/storage.js` to handle the new shape. Update `mergeProfile()` in `src/lib/profileQueue.js` if the learner profile shape changed.
12. **Privacy:** Never commit API keys or secrets. No telemetry is collected. Screenshots and user data stay on-device (or on the user's learn-service account if logged in).
