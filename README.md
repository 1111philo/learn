<p align="center">
  <img src="assets/logo.svg" alt="1111" width="80" height="80">
</p>

An agentic learning app that runs entirely in the Chrome side panel. Built by [11:11 Philosopher's Group](https://github.com/1111philo).

## What it does

1111 Learn guides learners through predefined courses using nine AI agents powered by the Claude API. Each course produces one final work product. All data stays on the user's device.

### Key features

- **Conversational onboarding** -- four-step first-run flow (name → API key → multi-turn "about you" chat → data consent) that builds a learner profile through conversation
- **Skills check** -- a multi-turn diagnostic conversation before every new course; the AI asks follow-up questions to gauge depth, then personalizes the learning plan
- **AI-powered learning** -- nine Claude agents handle onboarding, diagnostics, course creation, activity generation, assessment, Q&A, and learner profile updates
- **Course catalog** with prerequisite checking
- **Personalized activity generation** adapted to the learner's profile, prior work, and diagnostic result
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
| Diagnostic (Skills Check) | `claude-haiku-4-5` | Generates the initial skills check question |
| Diagnostic Conversation | `claude-haiku-4-5` | Multi-turn chat to assess prior knowledge through follow-ups |
| Course Creation | `claude-haiku-4-5` | Generates a personalized learning plan informed by the diagnostic result |
| Activity Creation | `claude-haiku-4-5` | Fills in detailed instructions for one activity at a time |
| Activity Assessment | `claude-sonnet-4-6` | Evaluates screenshots with vision + provides structured feedback |
| Activity Q&A | `claude-haiku-4-5` | Answers learner questions about activities and assessments |
| Learner Profile | `claude-haiku-4-5` | Incrementally updates learner profile after assessments, diagnostics, and feedback |

Agent prompts are stored as markdown files in `prompts/` and can be edited without changing code. All activity and assessment outputs are validated before reaching the user.

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
