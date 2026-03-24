# CLAUDE.md -- 1111 Learn

## Project overview
1111 Learn is a Chrome extension (Manifest V3, side panel) that helps learners build their professional portfolio through AI-guided courses. Nine AI agents powered by the Claude API drive the experience. Courses contain units; each unit has a diagnostic (skills check) and a sequence of activities. The user provides their own Anthropic API key via a first-run onboarding wizard, or logs in to use a managed account. All structured data is stored locally in SQLite (via sql.js WASM), persisted to `chrome.storage.local` as a serialized database. Binary assets (screenshots) remain in IndexedDB, referenced by key. When logged in, the server is the source of truth and local storage acts as a read cache.

## Architecture
Nine agents drive the learning experience:
- **Onboarding Conversation Agent** (`MODEL_LIGHT`) -- multi-turn chat that gets to know the learner and builds their initial profile
- **Onboarding Profile Agent** (`MODEL_LIGHT`) -- creates an initial learner profile (fallback when conversation is skipped)
- **Diagnostic Conversation Agent** (`MODEL_LIGHT`) -- opens and drives the skills check conversation; receives the learner profile, unit objectives, and course scope to calibrate depth; for optional units where the profile shows familiarity, can complete the assessment immediately without asking questions
- **Diagnostic Assessment Agent** (`MODEL_LIGHT`) -- evaluates learner text responses during the diagnostic and re-evaluates on dispute
- **Course Creation Agent** (`MODEL_LIGHT`) -- generates a personalized learning plan skeleton, informed by the diagnostic result
- **Activity Creation Agent** (`MODEL_LIGHT`) -- fills in one activity at a time as the learner reaches it
- **Activity Assessment Agent** (`MODEL_HEAVY` + vision) -- evaluates screenshots of learner work
- **Activity Q&A Agent** (`MODEL_LIGHT`) -- answers learner questions about activities and assessments inline
- **Learner Profile Agent** (`MODEL_LIGHT`) -- incrementally updates the learner profile after assessments, diagnostic results, and learner feedback

Agent prompts live in `prompts/*.md` and can be edited independently of code. The `orchestrator.converse()` function supports multi-turn conversations; `orchestrator.chatWithContext()` supports one-off Q&A with inline system prompts.

### Output validation
All activity, assessment, and course plan outputs pass through deterministic validators in `js/validators.js` (imported by `js/orchestrator.js`) before reaching the user. Activities are checked for: ending with "Capture", max 4 steps, no platform-specific shortcuts, no multi-site instructions, no non-browser apps, viewport-sized output, and content safety. Course plans are validated for: activity count matching learning objective count exactly, no consecutive duplicate activity types, last activity being type "final", and required fields. Assessments are checked for valid score/recommendation/fields and safety. On failure, the agent call is retried once automatically.

### Onboarding
On first run, a full-screen onboarding wizard (with animated geometric background) presents: login or continue → name → API key → "about you" conversation. The header and nav are hidden during onboarding to prevent users from navigating away. The "about you" step is a multi-turn chat: the Onboarding Conversation Agent asks follow-up questions until it has a good picture of the learner, then creates their profile. The user can skip at any time. Conversation state is persisted to the SQLite `pending_state` table so it survives panel reload. Completion is tracked via an `onboardingComplete` flag in the `settings` table. If the user is already logged in on startup, onboarding is skipped entirely and the flag is stamped automatically. In development, `.env.js` seeds the key into storage but onboarding still runs.

### Diagnostic skills check
Before every new unit, the Diagnostic Conversation Agent opens a skills check inside the unit chat. It receives the unit objectives, the learner profile, and the course scope (required/optional, sibling units). For optional units where the profile already covers the material, the agent can complete the assessment immediately (setting `done: true` in its first message) and suggest a more valuable unit. For required units, it asks 2-3 follow-up questions to gauge depth. The result is passed to the Course Creation Agent to adjust activity depth (not count -- activity count is always locked to one per learning objective). The user can skip the diagnostic at any time. During the diagnostic, conversation state is persisted to the SQLite `pending_state` table. Once the course plan is created, the diagnostic conversation (instruction, messages, and result) is saved into the `progress.diagnostic` field of the unit progress object so it remains visible in the chat history.

### Conversational UX
The entire course experience — diagnostic, course setup, activities, assessments — happens in a single chat interface per course. All loading states appear as in-chat thinking indicators (not full-screen spinners). The course header and compose bar are fixed (top and bottom); the chat scrolls between them. Users can ask questions about any activity or assessment at any time via the compose bar, powered by the Activity Q&A Agent. Q&A messages are persisted in `activity.messages[]` (each with `role`, `content`, `timestamp`) so they survive panel reloads and appear in the correct chronological position in the chat history alongside drafts and feedback. Completed activities remain visible above the current activity in the chat, creating a full scrollable history of the course. The Q&A agent receives the learner's name, profile summary, and full conversation history for context.

### Learner profile updates
The profile updates after assessments, diagnostic results, learner feedback, and course completion. All updates run through a sequential queue in `src/lib/profileQueue.js` to prevent concurrent updates from overwriting each other. `ensureProfileExists()` guarantees a profile exists before any update. On course completion, `updateProfileOnUnitCompletion()` sends the full course context (objectives, per-activity scores) so the profile reflects all skills learned. A code-level `mergeProfile()` in `src/lib/profileQueue.js` unions array fields and merges preferences so agent responses can never accidentally lose accumulated data.

### Storage (SQLite)
All structured data is stored in an in-memory SQLite database powered by sql.js (WASM). The database is serialized to a `Uint8Array` and persisted to `chrome.storage.local` under `_sqliteDb` (debounced, plus on `visibilitychange`). `js/db.js` manages initialization, schema creation, and persistence. `js/storage.js` provides the query API used by the rest of the app — same function signatures as the original chrome.storage.local implementation. Screenshots remain in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` table. The schema normalizes data into proper relational tables: `units`, `conversations`, `messages`, `activities`, `drafts`, `diagnostics`, `learning_plans`, `profile`, `preferences`, `work_products`, etc. Activity IDs are scoped to their unit in the DB (`unitId::activityId`) to prevent cross-unit collisions, and stripped back to the original ID when read.

### Cloud sync
Optional login via `learn-service` (separate repo) enables cross-device data persistence. Login is never required -- the extension works fully offline/locally. When logged in, the server is the source of truth: data is written to the server after every local save, and pulled from the server on startup/login. Local storage acts as a read cache for fast access.

- **Auth:** `js/auth.js` handles login/logout/token refresh via JWT access tokens (15 min) + refresh tokens (30 day, rotated on use). Tokens are stored in the SQLite `auth` table. On login, the auth user's name is synced into local preferences. If logged in, the onboarding wizard is skipped. The Personalization section in Settings is hidden when logged in (name comes from the service).
- **Remote storage:** `js/sync.js` is a thin client for `/v1/sync` endpoints on `learn-service`. `sync.save(key)` PUTs local data to the server (handles version conflicts by retrying with the server's version). `sync.loadAll()` GETs all data from the server and replaces local storage, removing any local data the server doesn't have. Version numbers are tracked in memory (not persisted) and rebuilt each session.
- **AI provider routing:** `js/orchestrator.js` routes API calls based on priority: (1) logged in → learn-service Bedrock proxy `/v1/ai/messages` via JWT auth, (2) Anthropic API key → direct Anthropic API. Logged-in users need no API key.
- **API key provisioning:** On login, if no local API key exists, the extension checks for an admin-assigned key via `/v1/me/api-key` and auto-installs it.
- **Startup:** On bootstrap, if logged in, `sync.loadAll()` runs before reading local data. This ensures the extension reflects the server state. Falls back to local cache if offline.
- **Settings UI:** When signed out, the Personalization section shows a name field and the AI Provider section shows the API key input. When signed in, Personalization is hidden (name comes from the service) and the API key section shows a note that AI is provided by the 1111 Learn account. Sign Out is in the header user dropdown, not the Settings page.

## Content hierarchy
Courses → Units → Diagnostic + Activities. `data/courses.json` defines courses, each containing a `units` array. Each unit has a `unitId`, `learningObjectives` that drive activity generation, and an optional `dependsOn` prerequisite (referencing another unit's `unitId`). Progress is tracked per unit in the SQLite `units` table (with related data in `activities`, `conversations`, `messages`, `drafts`, `diagnostics`, `learning_plans`) and synced as `unit:{unitId}`. `js/courses.js` provides `flattenCourses()` to extract all playable units into a flat list stored in `state.units`.

## Key conventions
- The UI is a React app (React 18, React Router, Vite). Source lives in `src/` — pages, components, contexts, hooks, lib modules.
- Service modules (`js/db.js`, `js/storage.js`, `js/orchestrator.js`, `js/auth.js`, `js/sync.js`, `js/api.js`, `js/validators.js`, `js/courses.js`) are vanilla JS (ES modules) and stay outside `src/`. React components import from them.
- Vite builds to `dist/` which is the loadable extension directory. CI zips `dist/` for releases.
- The entry point is `sidepanel.html` → `src/main.jsx` (initializes SQLite, then mounts React).
- Storage is abstracted in `js/storage.js` (SQLite via sql.js for structured data, IndexedDB for screenshots). `js/db.js` manages the SQLite lifecycle.
- API calls go through `js/api.js`; agent orchestration through `js/orchestrator.js`.
- Agent system prompts are in `prompts/` as markdown files, loaded at runtime via `chrome.runtime.getURL`.
- Activities must happen entirely in the browser tab (screenshot capture only sees the active tab).
- All activities end with "Hit Capture to capture your screen."
- Keyboard shortcuts: Enter submits single-line inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs.
- URLs in activity instructions are automatically linkified.
- Views: `onboarding`, `courses`, `units` (units within a course group), `course` (includes diagnostic + activities in one chat), `work` (portfolio cards), `work-detail` (build timeline), `settings`.
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
    unitEngine.js         Async unit lifecycle (diagnostic, plan, activity, recording, dispute, Q&A)
    helpers.js            esc, renderMd, linkify, formatDuration
    constants.js          TYPE_LABELS, TYPE_LETTERS, VIEW_DEPTH
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
      InstructionMessage.jsx Activity steps + linkified URLs
      DraftMessage.jsx    Draft captured indicator
      FeedbackCard.jsx    Score, strengths/improvements, actions
      CompletionSummary.jsx Stats + confetti trigger
  pages/
    CoursesList.jsx       Course group cards
    UnitsList.jsx         Units within a course
    UnitChat.jsx          Full chat: diagnostic + activities + drafts + Q&A
    Portfolio.jsx         Work product cards
    PortfolioDetail.jsx   Build timeline
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

## Rules for every change
1. Update README.md if you add, remove, or rename any user-facing feature, file, permission, or install step.
2. Update CONTRIBUTING.md if you change the development workflow.
3. Keep this CLAUDE.md in sync with the actual file structure and architecture.
4. If you add a new course field, update the "Course JSON structure" section in README.md.
5. Accessibility is non-negotiable: every interactive element must be keyboard-operable and have an accessible name.
6. When editing agent prompts, test with a real API key to verify JSON output format.
7. Never commit API keys or secrets.
8. Activities must be completable entirely in the browser -- never reference desktop apps, terminals, or file system operations.
9. Do not manually bump the version in `manifest.json` -- the CI/CD workflows handle versioning automatically. During RC builds, `manifest.json` gains a 4-segment `version` and a `version_name` field; these are stripped on production release.
10. Run `npm test` before submitting PRs. Tests must pass in CI on both `staging` and `main`.
11. **Data schema changes:** If you add, remove, rename, or restructure any SQLite table or column, update the schema DDL in `js/db.js` (uses `CREATE TABLE IF NOT EXISTS` so new tables are added on next launch). Update any affected getter/setter functions in `js/storage.js` to handle the new shape. Update `mergeProfile()` in `src/lib/profileQueue.js` if the learner profile shape changed.
12. **Privacy:** Never commit API keys or secrets. No telemetry is collected. Screenshots and user data stay on-device (or on the user's learn-service account if logged in).
