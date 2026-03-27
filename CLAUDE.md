# CLAUDE.md -- 1111 Learn

## Project overview
1111 Learn is a Chrome extension (Manifest V3, side panel) that helps learners build their professional portfolio through AI-guided courses. Eleven AI agents powered by the Claude API drive an assessment-backward learning experience. A summative assessment is generated first from course learning objectives (with rubric, exemplar, and multi-step capture task). The learner takes it as a diagnostic baseline, a gap analysis drives personalized formative activities, and the learner retakes the summative to demonstrate mastery. The user provides their own Anthropic API key via a first-run onboarding wizard, or logs in to use a managed account. All structured data is stored locally in SQLite (via sql.js WASM), persisted to `chrome.storage.local` as a serialized database. Binary assets (screenshots) remain in IndexedDB, referenced by key. When logged in, the server is the source of truth and local storage acts as a read cache.

## Architecture
Eleven agents drive the learning experience:
- **Onboarding Conversation Agent** (`MODEL_LIGHT`) -- multi-turn chat that gets to know the learner and builds their initial profile
- **Onboarding Profile Agent** (`MODEL_LIGHT`) -- creates an initial learner profile (fallback when conversation is skipped)
- **Summative Generation Agent** (`MODEL_LIGHT`) -- generates the summative assessment (multi-step task + rubric + exemplar + learner-facing `courseIntro` and `summaryForLearner`) from all course learning objectives and unit exemplars/formats
- **Summative Rubric Review Agent** (`MODEL_LIGHT`) -- multi-turn conversation about the rubric/exemplar; the rubric is FIXED and cannot be changed by the learner (discussion only, no regeneration)
- **Summative Assessment Agent** (`MODEL_HEAVY` for screenshots, `MODEL_LIGHT` for text) -- scores submissions (screenshots and/or text responses) against rubric criteria; produces a `summaryForLearner` (concise plain-language read) plus detailed per-criterion scores; enforces ratchet rule (scores only go up)
- **Gap Analysis Agent** (`MODEL_LIGHT`) -- analyzes baseline summative attempt to identify per-criterion gaps and priorities
- **Journey Generation Agent** (`MODEL_LIGHT`) -- selects, orders, and sizes predefined units with formative activities mapped to rubric criteria
- **Activity Creation Agent** (`MODEL_LIGHT`) -- generates one formative activity at a time, targeting specific rubric criteria; receives summative context (exemplar, task, rubric) and unit exemplar/format so activities build toward the exemplar; text-format activities end with "Hit Submit" instead of "Hit Capture"
- **Activity Assessment Agent** (`MODEL_HEAVY` for screenshots, `MODEL_LIGHT` for text) -- evaluates screenshots or text responses of learner work with optional rubric-criteria scoring
- **Activity Q&A Agent** (`MODEL_LIGHT`) -- answers learner questions about activities and assessments inline; uses enriched context including summative exemplar, rubric criteria, and latest assessment scores
- **Learner Profile Agent** (`MODEL_LIGHT`) -- incrementally updates the learner profile after summative attempts, formative assessments, and learner feedback

Agent prompts live in `prompts/*.md` and can be edited independently of code. The `orchestrator.converse()` function supports multi-turn conversations; `orchestrator.chatWithContext()` supports one-off Q&A with inline system prompts.

### Output validation
All agent outputs pass through deterministic validators in `js/validators.js` (imported by `js/orchestrator.js`) before reaching the user. Activities are validated based on their format: screenshot-format activities must end with "Capture", text-format activities must end with "Submit". Both are checked for: max 4 steps, no platform-specific shortcuts, no multi-site instructions, no non-browser apps, and content safety. The `validateActivity` function accepts an optional `{ format }` parameter. Summatives are validated for: task with steps array, rubric with criteria (each having 4 mastery levels), exemplar, `courseIntro`, and `summaryForLearner`. Summative assessments are validated for: criteriaScores, overallScore, mastery, feedback, and `summaryForLearner`; they also enforce the ratchet rule (no criterion score lower than prior attempt). Gap analyses are validated for criterion/level/priority structure. Journeys are validated for: valid unit IDs, activities with types/goals/rubricCriteria. Formative assessments are checked for valid score/recommendation/fields and safety. On failure, the agent call is retried once automatically.

### Onboarding
On first run, a full-screen onboarding wizard (with animated geometric background) presents: login or continue → name → API key → "about you" conversation. The header and nav are hidden during onboarding to prevent users from navigating away. The "about you" step is a multi-turn chat: the Onboarding Conversation Agent asks follow-up questions until it has a good picture of the learner, then creates their profile. The user can skip at any time. Conversation state is persisted to the SQLite `pending_state` table so it survives panel reload. Completion is tracked via an `onboardingComplete` flag in the `settings` table. If the user is already logged in on startup, onboarding is skipped entirely and the flag is stamped automatically. In development, `.env.js` seeds the key into storage but onboarding still runs.

### Assessment-backward design
The entire learning journey is designed backward from a summative assessment. The flow per course is:
1. **Summative setup**: The Summative Generation Agent creates a multi-step task, rubric (one criterion per objective group, each with 4 mastery levels), exemplar, and learner-facing messages from all course learning objectives and unit exemplars/formats. Each step specifies its format ("screenshot" or "text").
2. **Rubric review**: The learner sees the `courseIntro` and `summaryForLearner`, then can discuss the rubric/exemplar with the Summative Rubric Review Agent. The rubric is FIXED — the learner can ask questions but cannot change it. They can skip this step.
3. **Baseline attempt**: The learner attempts the summative — each step requires either a screenshot capture or a text response, as specified by the step's `format`. The Summative Assessment Agent scores all submissions against the rubric, producing per-criterion scores and a `summaryForLearner`. The detailed breakdown is available through Q&A.
4. **Gap analysis + journey**: The Gap Analysis Agent identifies per-criterion gaps. The Journey Generation Agent selects, orders, and sizes predefined units with formative activities mapped to rubric criteria.
5. **Formative learning**: The learner works through formative activities in each unit. Screenshot-format units use capture; text-format units accept typed responses submitted via the compose bar. Each formative targets specific rubric criteria and is guided by the unit's exemplar.
6. **Summative retake**: The learner retakes the summative. Scores can only go up (ratchet rule). If mastery is achieved, the course is complete. If not, remediation formative activities are generated for weak criteria, and the cycle repeats.

The UnitsList page (`src/pages/UnitsList.jsx`) serves as the course hub, managing all summative phases. The UnitChat page handles formative activities within units.

### Conversational UX
Formative activities happen in a chat interface per unit. All loading states appear as in-chat thinking indicators (not full-screen spinners). The course header and compose bar are fixed (top and bottom); the chat scrolls between them. For text-format units, the compose bar has a Submit button (checkmark) in addition to the Send button (arrow) — Submit submits the response for assessment, Send asks a Q&A question. For screenshot-format units, the compose bar is Q&A only and the Capture button appears separately. Users can ask questions about any activity or assessment at any time via the compose bar, powered by the Activity Q&A Agent. Q&A messages are persisted in `activity.messages[]` (each with `role`, `content`, `timestamp`) so they survive panel reloads and appear in the correct chronological position in the chat history alongside drafts and feedback. Completed activities remain visible above the current activity in the chat.

### Learner profile updates
The profile updates after summative attempts, formative assessments, learner feedback, and course mastery. All updates run through a sequential queue in `src/lib/profileQueue.js` to prevent concurrent updates from overwriting each other. `ensureProfileExists()` guarantees a profile exists before any update. On summative mastery, `updateProfileOnMasteryInBackground()` sends the full course context so the profile reflects all skills demonstrated. A code-level `mergeProfile()` in `src/lib/profileQueue.js` unions array fields (`completedUnits`, `masteredCourses`), merges preferences and `rubricProgress` (per-course per-criterion levels) so agent responses can never accidentally lose accumulated data.

### Storage (SQLite)
All structured data is stored in an in-memory SQLite database powered by sql.js (WASM). The database is serialized to a `Uint8Array` and persisted to `chrome.storage.local` under `_sqliteDb` (debounced, plus on `visibilitychange`). `js/db.js` manages initialization, schema creation, persistence, and column migrations (via try/catch ALTER TABLE). `js/storage.js` provides the query API used by the rest of the app. Screenshots remain in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` table. Text responses are stored directly in the `text_response` column of the `drafts` table (no IndexedDB needed). The schema normalizes data into proper relational tables: `summatives`, `summative_attempts`, `gap_analysis`, `journeys`, `units`, `conversations`, `messages`, `activities`, `drafts`, `profile`, `preferences`, `work_products`, etc. Activity IDs are scoped to their unit in the DB (`unitId::activityId`) to prevent cross-unit collisions, and stripped back to the original ID when read. Units have `journey_order` and `rubric_criteria` columns; activities have `rubric_criteria`; drafts have `rubric_criteria_scores` and `text_response`. Summatives have `course_intro` and `summary_for_learner` columns; summative_attempts have `summary_for_learner` and `text_responses`.

### Cloud sync
Optional login via `learn-service` (separate repo) enables cross-device data persistence. Login is never required -- the extension works fully offline/locally. When logged in, the server is the source of truth: data is written to the server after every local save, and pulled from the server on startup/login. Local storage acts as a read cache for fast access.

- **Auth:** `js/auth.js` handles login/logout/token refresh via JWT access tokens (15 min) + refresh tokens (30 day, rotated on use). Tokens are stored in the SQLite `auth` table. On login, the auth user's name is synced into local preferences. If logged in, the onboarding wizard is skipped. The Personalization section in Settings is hidden when logged in (name comes from the service).
- **Remote storage:** `js/sync.js` is a thin client for `/v1/sync` endpoints on `learn-service`. `sync.save(key)` PUTs local data to the server (handles version conflicts by retrying with the server's version). `sync.loadAll()` GETs all data from the server and replaces local storage, removing any local data the server doesn't have. Version numbers are tracked in memory (not persisted) and rebuilt each session.
- **AI provider routing:** `js/orchestrator.js` routes API calls based on priority: (1) logged in → learn-service Bedrock proxy `/v1/ai/messages` via JWT auth, (2) Anthropic API key → direct Anthropic API. Logged-in users need no API key.
- **API key provisioning:** On login, if no local API key exists, the extension checks for an admin-assigned key via `/v1/me/api-key` and auto-installs it.
- **Startup:** On bootstrap, if logged in, `sync.loadAll()` runs before reading local data. This ensures the extension reflects the server state. Falls back to local cache if offline.
- **Settings UI:** When signed out, the Personalization section shows a name field and the AI Provider section shows the API key input. When signed in, Personalization is hidden (name comes from the service) and the API key section shows a note that AI is provided by the 1111 Learn account. Sign Out is in the header user dropdown, not the Settings page.

## Content hierarchy
Courses → Summative Assessment → Units → Formative Activities. `data/courses.json` defines courses, each containing a `units` array. Each unit has a `unitId`, `learningObjectives`, `format` ("text" or "screenshot"), `exemplar` (mastery-level outcome description), and an optional `dependsOn` prerequisite. The `format` determines how learners submit work: "screenshot" requires browser tab captures, "text" accepts typed responses. The `exemplar` is an example of an outcome — learners should match its quality and depth while meeting objectives in their own way. The summative assessment is generated per course from all learning objectives and unit exemplars/formats. The journey generation agent selects, orders, and sizes units (hybrid: predefined in `courses.json` but journey can skip/reorder/adjust activity count). Course-level data is stored in `summatives`, `summative_attempts`, `gap_analysis`, and `journeys` tables (synced as `summative:{courseId}`, `summative-attempts:{courseId}`, `gap:{courseId}`, `journey:{courseId}`). Unit-level progress is tracked in `units`, `activities`, `drafts` tables (synced as `progress:{unitId}`). `js/courses.js` provides `flattenCourses()` to extract all playable units.

## Key conventions
- The UI is a React app (React 18, React Router, Vite). Source lives in `src/` — pages, components, contexts, hooks, lib modules.
- Service modules (`js/db.js`, `js/storage.js`, `js/orchestrator.js`, `js/auth.js`, `js/sync.js`, `js/api.js`, `js/validators.js`, `js/courses.js`) are vanilla JS (ES modules) and stay outside `src/`. React components import from them.
- Vite builds to `dist/` which is the loadable extension directory. CI zips `dist/` for releases.
- The entry point is `sidepanel.html` → `src/main.jsx` (initializes SQLite, then mounts React).
- Storage is abstracted in `js/storage.js` (SQLite via sql.js for structured data, IndexedDB for screenshots). `js/db.js` manages the SQLite lifecycle.
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `chrome.runtime.getURL`.
- Activities must happen entirely in the browser tab (screenshot capture only sees the active tab). Text-format activities allow typed responses instead.
- Screenshot-format activities end with "Hit Capture to capture your screen." Text-format activities end with "Hit Submit to submit your response."
- Keyboard shortcuts: Enter submits single-line inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs.
- URLs in activity instructions are automatically linkified.
- Views: `onboarding`, `courses`, `units` (course hub: summative phases + unit cards), `unit` (formative activities chat), `work` (course-level portfolio cards), `work-detail` (summative + formative timeline), `settings`.
- Activity types map to user labels: `explore`→Research, `apply`→Practice, `create`→Draft, `final`→Deliver.
- Work section shows portfolio cards with segmented progress bars; tapping opens a Build Detail view with full draft timeline and on-demand screenshot loading from IndexedDB.
- Completion summary card shows stats (steps, captures, elapsed time) when a course finishes. Time is displayed as minutes, hours, or days depending on duration.
- View transitions: navigating deeper slides left, going back slides right, lateral navigation fades up. List items stagger in. All animations respect `prefers-reduced-motion`.
- Unit cards show estimated time computed as `learningObjectives.length * 5 + 2` minutes (5 min per activity + 2 min for the diagnostic). Course-level cards sum the time across all units.

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
  courses.js             Course loading, flattening (units), and prerequisite checking
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
    unitEngine.js         Course + unit lifecycle (summative, gap, journey, formative activities, capture, dispute, Q&A)
    helpers.js            esc, renderMd, linkify, formatDuration
    constants.js          TYPE_LABELS, TYPE_LETTERS, VIEW_DEPTH, COURSE_PHASES, MASTERY_LEVELS
    confetti.js           Confetti animation
  components/
    AppShell.jsx          Header + nav + main wrapper + transitions
    PasswordField.jsx     Show/hide toggle input
    OnboardingCanvas.jsx  Animated geometric mesh
    modals/
      LoginModal.jsx      Email/password login form
      DisputeModal.jsx    Dispute assessment textarea
      ConfirmModal.jsx    Generic confirm dialog
      ProfileFeedbackModal (inline in Settings.jsx)
    chat/
      ChatArea.jsx        Scrollable container, auto-scroll
      ComposeBar.jsx      Textarea + send button
      ThinkingSpinner.jsx Inline loading indicator
      UserMessage.jsx     User chat bubble
      AssistantMessage.jsx AI response with markdown
      InstructionMessage.jsx Activity steps + linkified URLs + rubric criteria badges
      DraftMessage.jsx    Draft captured indicator
      FeedbackCard.jsx    Score, strengths/improvements, rubric criteria scores, actions
      CompletionSummary.jsx Stats + confetti trigger
      SummativeCard.jsx   Summative task, exemplar, rubric display with expandable criteria
      RubricFeedback.jsx  Per-criterion score display with mastery level indicators
      CaptureStep.jsx     Multi-step summative capture UI
  pages/
    CoursesList.jsx       Course cards with phase status
    UnitsList.jsx         Course hub: summative phases + unit cards in journey order
    UnitChat.jsx          Formative activities chat: instruction + capture + assess + Q&A
    Portfolio.jsx         Course-level portfolio cards
    PortfolioDetail.jsx   Course portfolio: summative attempts + formative build timeline
    Settings.jsx          API key, name, profile feedback
    onboarding/
      OnboardingFlow.jsx  4-step wizard with canvas backdrop
      WelcomeStep.jsx     Login or continue
      NameStep.jsx        Name input
      ApiKeyStep.jsx      API key input
      AboutYouStep.jsx    Multi-turn conversation
prompts/                 Agent system prompts (markdown)
data/
  courses.json           Predefined course definitions
assets/                  Icons and images
tests/
  manifest.test.js       Manifest validation tests
  courses.test.js        Course data validation tests
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
- `docs/architecture.md` -- agents overview, storage, content hierarchy, data flow, file structure
- `docs/agent-lifecycle.md` -- full Phase 0-7 walkthrough of every agent call with inputs, outputs, and validation
- `docs/cloud-sync.md` -- auth, remote storage, AI provider routing
- `docs/releases.md` -- CI/CD, versioning, branch protection, permissions, secrets, course JSON structure
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
