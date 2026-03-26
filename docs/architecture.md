# Architecture

1111 Learn is a Chrome extension (Manifest V3) that runs in the side panel. The UI is a React 18 app built with Vite. Service modules are vanilla JS (ES modules) in `js/`, imported by React components in `src/`.

## Agents

Eleven agents drive the learning experience. Each loads a system prompt from `prompts/*.md` and returns structured JSON validated by `js/validators.js`.

| Agent | Prompt | Model | Purpose |
|-------|--------|-------|---------|
| Onboarding Conversation | [`onboarding-conversation.md`](../prompts/onboarding-conversation.md) | Light | Multi-turn chat that builds a learner profile from screenshots |
| Onboarding Profile | [`onboarding-profile.md`](../prompts/onboarding-profile.md) | Light | Creates a profile from name + statement (fallback when conversation is skipped) |
| Summative Generation | [`summative-generation.md`](../prompts/summative-generation.md) | Light | Generates the summative assessment: task, rubric, exemplar, and learner-facing intro/summary |
| Summative Rubric Review | [`summative-conversation.md`](../prompts/summative-conversation.md) | Light | Multi-turn conversation about the rubric; can trigger summative regeneration |
| Summative Assessment | [`summative-assessment.md`](../prompts/summative-assessment.md) | Heavy + vision | Scores summative screenshots against rubric criteria; produces learner summary |
| Gap Analysis | [`gap-analysis.md`](../prompts/gap-analysis.md) | Light | Identifies per-criterion gaps from baseline summative attempt |
| Journey Generation | [`course-creation.md`](../prompts/course-creation.md) | Light | Selects, orders, and sizes units with formative activities mapped to rubric criteria |
| Activity Creation | [`activity-creation.md`](../prompts/activity-creation.md) | Light | Generates one formative activity targeting specific rubric criteria |
| Activity Assessment | [`activity-assessment.md`](../prompts/activity-assessment.md) | Heavy + vision | Evaluates formative screenshots with structured feedback and optional rubric scoring |
| Activity Q&A | *inline* | Light | Answers learner questions with enriched context (exemplar, rubric, latest scores) |
| Learner Profile | [`learner-profile-update.md`](../prompts/learner-profile-update.md) | Light | Updates learner profile after assessments, feedback, and mastery |

`MODEL_LIGHT` = `claude-haiku-4-5`. `MODEL_HEAVY` = `claude-sonnet-4-6`. See [`js/api.js`](../js/api.js) for model constants.

For the full invocation sequence with inputs and outputs, see [Agent Lifecycle](agent-lifecycle.md).

## Orchestration

[`js/orchestrator.js`](../js/orchestrator.js) is the central layer between agents and the app:

- **`converse(promptName, messages)`** -- multi-turn conversations (onboarding, rubric review). Loads a prompt file, sends message history, returns parsed JSON.
- **`chatWithContext(systemPrompt, messages)`** -- one-off Q&A with an inline system prompt. Returns raw text.
- **Agent-specific functions** -- `generateSummative()`, `assessSummativeAttempt()`, `analyzeGaps()`, `generateJourney()`, `generateNextActivity()`, `assessDraft()`, `reassessDraft()`, and profile update functions. Each assembles context, calls the API, parses JSON, and runs validation.
- **Routing** -- if logged in, calls go to the learn-service Bedrock proxy; otherwise, they use the user's Anthropic API key directly.
- **Retry** -- validation failures retry once automatically. Transient API errors (503, 529, 500) retry after 3 seconds.

## Output validation

All agent outputs pass through deterministic validators in [`js/validators.js`](../js/validators.js) before reaching the user:

| Validator | Checks |
|-----------|--------|
| `validateSummative` | Task with steps array, rubric with 4 mastery levels per criterion, exemplar, `courseIntro`, `summaryForLearner`, content safety |
| `validateSummativeAssessment` | All criteria scored, ratchet rule (scores only go up), `summaryForLearner`, content safety |
| `validateGapAnalysis` | Criterion/level/priority structure |
| `validateJourney` | Valid unit IDs, activities with types/goals/rubricCriteria |
| `validateActivity` | Ends with "Capture", max 4 steps, browser-only, no platform shortcuts, no multi-site, produces visible work, content safety |
| `validateAssessment` | Score 0-1, valid recommendation, feedback/strengths/improvements arrays, content safety |

## Content hierarchy

```
Course (courses.json)
  └── Summative Assessment (generated per course)
        ├── Task (multi-step capture)
        ├── Rubric (criteria with 4 mastery levels)
        └── Exemplar (what mastery looks like)
  └── Units (predefined in courses.json, selected/ordered by journey agent)
        └── Formative Activities (generated per unit, targeting rubric criteria)
              └── Drafts (screenshot captures with AI assessment)
```

[`data/courses.json`](../data/courses.json) defines courses, each containing a `units` array. Each unit has a `unitId`, `learningObjectives`, and an optional `dependsOn` prerequisite. The journey agent selects which units to include, their order, and how many activities per unit.

## Storage

### SQLite (structured data)

All structured data lives in an in-memory SQLite database powered by [sql.js](https://github.com/sql-js/sql.js) (WASM). The database is serialized and persisted to `chrome.storage.local` under `_sqliteDb` (debounced, plus on `visibilitychange`).

- [`js/db.js`](../js/db.js) -- database lifecycle: init, schema creation, persistence, column migrations
- [`js/storage.js`](../js/storage.js) -- query API: getters/setters for all data types

Key tables: `summatives`, `summative_attempts`, `gap_analysis`, `journeys`, `units`, `activities`, `drafts`, `conversations`, `messages`, `profile`, `preferences`, `work_products`, `auth`, `pending_state`.

Activity IDs are scoped to their unit in the DB (`unitId::activityId`) to prevent cross-unit collisions. In-progress state (rubric review messages, summative captures) is persisted to `pending_state` so it survives panel reloads.

### IndexedDB (binary assets)

Screenshots are stored in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` and `summative_attempts` tables. This keeps the SQLite database small while allowing large binary storage.

## File structure

```
manifest.json            Chrome extension manifest (MV3)
background.js            Opens the side panel on icon click
sidepanel.html           Vite entry point
sidepanel.css            Global styles
vite.config.js           Vite build config
lib/                     Vendored sql.js (WASM)
js/                      Service modules (vanilla JS)
  db.js                  SQLite lifecycle
  storage.js             Query layer + IndexedDB
  courses.js             Course loading + prerequisites
  api.js                 Anthropic API client
  orchestrator.js        Agent orchestration
  validators.js          Output validators
  auth.js                Auth for learn-service
  sync.js                Cloud data sync
src/                     React app
  main.jsx               Entry: db init, React mount
  App.jsx                Routes
  contexts/              AppContext, AuthContext, ModalContext
  hooks/                 useViewTransition, useAutoResize
  lib/                   unitEngine, profileQueue, syncDebounce, helpers, constants
  components/            AppShell, chat/*, modals/*
  pages/                 CoursesList, UnitsList, UnitChat, Portfolio, Settings, onboarding/*
prompts/                 Agent system prompts (markdown)
data/courses.json        Course definitions
tests/                   Node test runner (manifest, courses, validators, storage)
docs/                    Documentation
dist/                    Build output (Chrome extension)
```
