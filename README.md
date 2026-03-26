<p align="center">
  <img src="assets/logo.svg" alt="1111" width="80" height="80">
</p>

An agentic learning app that runs entirely in the Chrome side panel. Built by [11:11 Philosopher's Group](https://github.com/1111philo).

## What it does

1111 Learn guides learners through predefined courses using eleven AI agents powered by the Claude API. Each course produces one final work product. All data stays on the user's device.

### Key features

- **Conversational onboarding** -- four-step first-run flow (name → API key → multi-turn "about you" chat → data consent) that builds a learner profile through conversation
- **Assessment-backward design** -- a summative assessment is generated first, the learner takes it as a baseline, a gap analysis drives personalized formative activities, and the learner retakes the summative to demonstrate mastery
- **AI-powered learning** -- eleven Claude agents handle onboarding, summative generation/review/assessment, gap analysis, journey creation, activity generation/assessment, Q&A, and learner profile updates
- **Course catalog** with prerequisite checking
- **Personalized activity generation** adapted to the learner's profile, prior work, gap analysis, and summative exemplar
- **AI assessment with vision** -- the Assessment Agent analyzes screenshots of your work and provides structured feedback with strengths, improvements, score, and a recommendation
- **Output validation** -- deterministic validators check every agent response for safety, format compliance, and activity constraints (browser-only, single page, viewport-sized output, activity-to-objective count match) before showing it to the learner
- **Learner profile** -- tracks your strengths, weaknesses, preferences, and learning patterns across courses; updated after assessments, diagnostic results, feedback, and course completion
- **Activity Q&A** -- ask questions about any activity or assessment and get contextual answers from the AI coach
- **Draft recording** -- captures a screenshot of the active tab, the page URL, and AI-generated feedback
- **Iterative feedback** -- each activity builds on prior drafts and feedback
- **Final assessment** -- the final work product must meet a minimum passing threshold
- **Portfolio** -- work cards show progress bars and recording counts; tap into a Build Detail view with full draft timeline and on-demand screenshots
- **Build narrative** -- activity type labels (Research, Practice, Draft, Deliver) and a completion summary card celebrate your process
- **Keyboard shortcuts** -- Enter submits inputs, Cmd/Ctrl+Enter submits textareas, Escape dismisses dialogs
- **Fully local** -- data stored in SQLite (via sql.js WASM), screenshots in IndexedDB. No data leaves your device unless you sign in to sync.
- **Cloud sync** (optional) -- sign in via learn-service to sync your profile, preferences, progress, screenshots, and portfolio across devices. Login is never required; everything works without an account. Admins can pre-assign API keys that auto-install on login.
- **Accessible** -- keyboard-operable, screen-reader-friendly, focus-trapped modals, aria-live announcements, respects `prefers-reduced-motion` and `forced-colors`
- **React + Vite** -- React 18 UI with Vite build, vanilla JS service modules for storage, orchestration, and sync

## Install (developer mode)

1. Clone this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run build` to build the extension into `dist/`.
4. Open `chrome://extensions` in Chrome.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the `dist/` folder.
7. Click the 1111 extension icon to open the side panel.
8. Complete the onboarding wizard: sign in or enter your name, your Anthropic API key, and chat with the AI about your goals (or skip).

## File structure

```
manifest.json            Chrome extension manifest (Manifest V3)
background.js            Opens the side panel on icon click
sidepanel.html           Vite entry point (mounts React)
sidepanel.css            Global styles
vite.config.js           Vite build configuration
js/                      Service modules (vanilla JS, imported by React)
  db.js                  SQLite database lifecycle
  storage.js             SQLite query layer + IndexedDB for screenshots
  courses.js             Course loading and prerequisite checking
  api.js                 Anthropic API client
  orchestrator.js        Agent orchestration
  validators.js          Pure validation functions
  auth.js                Authentication module for learn-service
  sync.js                Cloud data sync
src/                     React app (pages, components, contexts, hooks, lib)
  main.jsx               Entry point
  App.jsx                Routes
  contexts/              AppContext, AuthContext, ModalContext
  pages/                 CoursesList, UnitChat, Settings, Portfolio, onboarding/*
  components/            AppShell, PasswordField, chat/*, modals/*
  lib/                   unitEngine, profileQueue, syncDebounce, helpers
prompts/                 Agent system prompts (markdown)
data/courses.json        Predefined course definitions
assets/                  Icons and images
tests/                   Service-layer tests (manifest, courses, validators, storage)
dist/                    Build output (loadable as extension)
```

## Releases

Releases follow a two-branch workflow: **feature branches → staging → main**.

### Staging (release candidates)

Every push to `staging` triggers the staging workflow:

1. Tests run (`npm test`).
2. The current version from `main`'s `manifest.json` is read as the base version (e.g., `0.6.3`).
3. Non-bump commits on `staging` since it diverged from `main` are counted to determine the RC number.
4. `manifest.json` is updated with a 4-segment numeric `version` (e.g., `0.6.3.2`) and a human-readable `version_name` (e.g., `0.6.3-RC2`).
5. The extension is packaged and a **GitHub pre-release** is created with the zip attached.
6. RC builds are **not** published to the Chrome Web Store.

The RC number resets automatically when `staging` is merged into `main` (the merge-base moves forward, so the commit count restarts).

### Production (main)

When a PR from `staging` is merged into `main`, the release workflow:

1. Tests run (`npm test`).
2. Commits are analyzed by Claude to determine the final semver version and generate release notes.
3. `manifest.json` is updated with a clean 3-segment `version`; any `version_name` from staging is removed.
4. The extension is packaged into a zip.
5. A GitHub Release is created with the zip attached.
6. The zip is uploaded to the Chrome Web Store and published automatically.

`main` is protected: direct pushes are blocked, and all changes must come via pull request from `staging`.

### Required secrets

Maintainers must add these secrets to the repository settings:
- `ANTHROPIC_API_KEY` -- for Claude-powered version analysis
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` -- OAuth2 credentials for Chrome Web Store API (see [Chrome Web Store API docs](https://developer.chrome.com/docs/webstore/using-api))
- `CWS_EXTENSION_ID` -- the extension's Chrome Web Store ID

## Agent architecture

| Agent | Model | Purpose |
|-------|-------|---------|
| Onboarding Conversation | `claude-haiku-4-5` | Multi-turn chat to get to know the learner and build their profile |
| Onboarding Profile | `claude-haiku-4-5` | Creates an initial learner profile (fallback when conversation is skipped) |
| Summative Generation | `claude-haiku-4-5` | Generates the summative assessment (task + rubric + exemplar + learner-facing intro/summary) |
| Summative Rubric Review | `claude-haiku-4-5` | Multi-turn conversation about the rubric/exemplar; can trigger regeneration |
| Summative Assessment | `claude-sonnet-4-6` | Evaluates summative screenshots with vision; produces per-criterion scores + learner summary |
| Gap Analysis | `claude-haiku-4-5` | Analyzes baseline summative to identify per-criterion gaps and priorities |
| Journey Generation | `claude-haiku-4-5` | Selects, orders, and sizes units with formative activities mapped to rubric criteria |
| Activity Creation | `claude-haiku-4-5` | Generates one formative activity at a time, building toward the summative exemplar |
| Activity Assessment | `claude-sonnet-4-6` | Evaluates formative screenshots with vision + provides structured feedback |
| Activity Q&A | `claude-haiku-4-5` | Answers learner questions about activities and assessments with enriched context |
| Learner Profile | `claude-haiku-4-5` | Incrementally updates learner profile after summative attempts, formative assessments, and feedback |

Agent prompts are stored as markdown files in `prompts/` and can be edited without changing code. All activity and assessment outputs are validated before reaching the user.

### Agent lifecycle: course start to completion

This is the order agents are invoked as a learner moves through a course, what data each receives, and what it produces.

#### Phase 0: Onboarding (one-time, before any course)

**1. Onboarding Conversation Agent** (`onboarding-conversation.md`, `MODEL_LIGHT`)
- *Trigger:* "About You" step in onboarding wizard
- *Input:* Multi-turn message history with learner screenshots (vision)
- *Output:* `{ message, done, profile?, summary? }` — when done, includes full learner profile inferred from screenshots
- *Fallback:* If skipped, **Onboarding Profile Agent** (`onboarding-profile.md`) creates a profile from `{ name, statement }`

#### Phase 1: Summative Generation

**2. Summative Generation Agent** (`summative-generation.md`, `MODEL_LIGHT`)
- *Trigger:* Learner starts a course (`unitEngine.initCourse`)
- *Input:* `courseName`, `courseDescription`, `learningObjectives` (flattened from all units), `learnerProfile`, `personalizationNotes` (if regenerated)
- *Output:* `{ courseIntro, summaryForLearner, task, rubric, exemplar }`
- *Validation:* `validateSummative()` — task/steps, rubric with 4 mastery levels per criterion, exemplar, courseIntro, summaryForLearner

The learner sees `courseIntro` (explains the process) and `summaryForLearner` (introduces the exemplar in plain language). The rubric and detailed data surface through conversation.

#### Phase 2: Rubric Review

**3. Summative Rubric Review Agent** (`summative-conversation.md`, `MODEL_LIGHT`)
- *Trigger:* Learner reviews rubric/exemplar (`unitEngine.sendRubricReviewMessage`)
- *Input:* Full summative (task, rubric, exemplar), courseName, learningObjectives, learnerProfile, conversation history
- *Output:* `{ message, done, regenerate?, regenerationNotes? }`
- *Side effect:* If `regenerate: true`, re-runs Agent #2 with `personalizationNotes`

#### Phase 3: Summative Attempt (baseline or retake)

**4. Summative Assessment Agent** (`summative-assessment.md`, `MODEL_HEAVY` + vision)
- *Trigger:* Learner submits all step screenshots (`unitEngine.submitSummativeAttempt`)
- *Input:* `courseName`, `task`, `rubric`, `attemptNumber`, `isBaseline`, `priorAttemptScores`, `learnerProfile`, base64 screenshot images (one per step)
- *Output:* `{ criteriaScores[], overallScore, mastery, feedback, nextSteps[], summaryForLearner }`
- *Validation:* `validateSummativeAssessment()` — all criteria scored, ratchet rule (scores only go up), summaryForLearner required

The learner sees `summaryForLearner` as the primary feedback. Detailed per-criterion breakdown is available on request.

**5. Learner Profile Agent** (`learner-profile-update.md`, `MODEL_LIGHT`, background)
- *Trigger:* Fires automatically after every summative attempt
- *Input:* `currentProfile`, `summativeAttempt` (courseId, scores, mastery), `context.event` (`summative_baseline` | `summative_retake` | `summative_mastery`)
- *Output:* Updated `{ profile, summary }`

#### Phase 4: Gap Analysis + Journey

**6. Gap Analysis Agent** (`gap-analysis.md`, `MODEL_LIGHT`)
- *Trigger:* Runs after baseline attempt (`unitEngine.generateGapAndJourney`)
- *Input:* `courseName`, `rubric`, `baselineScores`, `overallScore`, `learnerProfile`
- *Output:* `{ gaps[], suggestedFocus[] }` — prioritized per-criterion gaps
- *Validation:* `validateGapAnalysis()`

**7. Journey Generation Agent** (`course-creation.md`, `MODEL_LIGHT`)
- *Trigger:* Runs immediately after gap analysis
- *Input:* `courseName`, `units[]` (from courses.json), `gapAnalysis`, `rubric`, `learnerProfile`, `completedFormatives` (populated on remediation after failed retake)
- *Output:* `{ units[{ unitId, activities[{ id, type, goal, rubricCriteria[] }] }], workProductTool, workProductDescription, rationale }`
- *Validation:* `validateJourney()`

#### Phase 5: Formative Learning (per unit, per activity)

**8. Activity Creation Agent** (`activity-creation.md`, `MODEL_LIGHT`, repeated per activity)
- *Trigger:* Learner enters a unit or advances (`unitEngine.generateFirstActivity` / `generateNextActivity`)
- *Input:* Unit info, activity `type`/`goal` from journey plan, `rubricCriteria`, `gapObservation`, `workProduct`/`workProductTool`, `priorActivities` summary, `learnerProfile`, **summative context** (`exemplar`, `task.description`, full `rubric`)
- *Output:* `{ instruction, tips[] }`
- *Validation:* `validateActivity()` — ends with "Capture", max 4 steps, browser-only, single page, produces visible work

**9. Activity Assessment Agent** (`activity-assessment.md`, `MODEL_HEAVY` + vision, repeated per capture)
- *Trigger:* Learner hits "Capture" (`unitEngine.recordDraft`)
- *Input:* Unit/activity info, `rubricCriteria`, `pageUrl`, `priorDrafts`, `learnerProfile`, base64 screenshot
- *Output:* `{ feedback, strengths[], improvements[], score, recommendation, passed, rubricCriteriaScores? }`
- *Validation:* `validateAssessment()`

**10. Learner Profile Agent** (`learner-profile-update.md`, `MODEL_LIGHT`, background)
- *Trigger:* After every formative assessment and after disputes
- *Input:* `currentProfile`, assessment result or learner feedback, activity context

**11. Activity Q&A** (inline system prompt via `chatWithContext`, `MODEL_LIGHT`)
- *Trigger:* Learner asks a question via compose bar (`unitEngine.askAboutActivity`)
- *Input:* Activity instruction, rubric criteria, summative exemplar, latest draft feedback + rubric criteria scores, learner profile, Q&A history
- *Output:* Plain text response

**12. Reassessment** (same `activity-assessment.md`, `MODEL_HEAVY` + vision)
- *Trigger:* Learner disputes a score (`unitEngine.submitDispute`)
- *Input:* 3-message conversation: original context + screenshot, assistant's prior assessment, learner's dispute text

#### Phase 6: Summative Retake

Repeats **Agent #4** (Summative Assessment) and **Agent #5** (Profile Update). Ratchet rule enforced.
- If mastery achieved → course complete → **Agent #13** below
- If not mastery → re-runs **Agent #6** (Gap Analysis) + **Agent #7** (Journey) with `completedFormatives` to avoid repeating activities → back to Phase 5

#### Phase 7: Course Mastery

**13. Learner Profile Agent — Mastery Update** (`learner-profile-update.md`, `MODEL_LIGHT`)
- *Trigger:* Summative returns `mastery: true`
- *Input:* `currentProfile`, `courseCompletion` (courseId, rubric scores, formative summaries), `context.event: 'course_mastery'`
- *Output:* Updated profile with courseId in `masteredCourses`, comprehensive strength updates, contradicted weaknesses removed

### Data flow summary

The **learner profile summary** threads through every agent call as context. The **summative rubric** flows into gap analysis → journey → activity creation (as `rubricCriteria`) → formative assessment (as `rubricCriteriaScores`). The **exemplar** flows from summative generation → activity creation → Q&A context, ensuring all formative work builds toward the same mastery target.

## Course JSON structure

Each course in `data/courses.json` has:

| Field               | Type       | Description                                      |
|---------------------|------------|--------------------------------------------------|
| `courseId`           | `string`   | Unique identifier                                |
| `name`              | `string`   | Display title                                    |
| `description`       | `string`   | One sentence explaining why the learner benefits |
| `dependsOn`         | `string?`  | Optional prerequisite course ID                  |
| `learningObjectives`| `string[]` | Outcome statements the course achieves           |

## Permissions

| Permission        | Why                                              |
|-------------------|--------------------------------------------------|
| `sidePanel`       | Run the app in the Chrome side panel             |
| `storage`         | Persist metadata locally                         |
| `unlimitedStorage`| Allow large screenshot storage in IndexedDB      |
| `activeTab`       | Capture screenshots and read the active tab URL  |
| `tabs`            | Query tab information for draft recording        |

### Host permissions

| Host                        | Why                                    |
|-----------------------------|----------------------------------------|
| `https://api.anthropic.com/*` | Send requests to the Claude API with the user's own key |
| `https://learn.philosophers.group/*` | Cloud sync and authentication (optional, only when signed in) |

## Privacy

1111 Learn is local-first. All learning data stays on your device by default. See our full [Privacy Policy](PRIVACY.md) for details.

- **Local by default**: course progress, screenshots, learner profile, and API key never leave your device.
- **Cloud sync** (optional): signing in via learn-service syncs your profile, preferences, progress, and portfolio to the cloud. Screenshots are never synced. Telemetry is managed by the cloud service when signed in.

API calls to Anthropic use your own key and are governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy).

## License

Copyright (C) 2026 11:11 Philosopher's Group

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
