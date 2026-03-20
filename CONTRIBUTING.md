# Contributing to 1111 Learn

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Fork and clone the repository.
2. Copy `.env.example.js` to `.env.js` and fill in your Anthropic API key and name. This file is gitignored and will never be committed. On app load, these values automatically seed storage — but the onboarding wizard still runs on first use. To skip onboarding in development, complete it once (or clear `chrome.storage.local` and let the seeded key pre-fill the API key step). To reset and re-run onboarding, clear `chrome.storage.local` and remove the `onboardingComplete` flag.
3. Load the extension in Chrome using developer mode (see README.md).
4. Make your changes and test them in the side panel.

## Development workflow

- There is no build step. Edit the source files directly and reload the extension in `chrome://extensions`.
- All source is vanilla JS (ES modules), CSS, and HTML.
- Course definitions live in `data/courses.json`.
- Agent system prompts live in `prompts/*.md` -- edit these to change agent behavior without touching code.
- `.env.js` seeds your API key and name into storage on every load (values only written if not already set). The onboarding wizard still runs regardless — it is controlled by the `onboardingComplete` storage flag, not by whether a key is present. This lets you develop against a pre-seeded key while still exercising the onboarding flow.
- Enable **Share data with 11:11** in Settings > Data Management to log all agent interactions locally and send anonymous telemetry to `learn-dashboard`. A consent notice explains what is and isn't sent. Export the JSON to inspect agent requests, responses, and errors.

## Architecture

The app uses nine AI agents orchestrated through `js/orchestrator.js`:

1. **Onboarding Conversation Agent** -- multi-turn chat that gets to know the learner and builds their initial profile
2. **Onboarding Profile Agent** -- creates an initial learner profile (fallback when conversation is skipped)
3. **Diagnostic Agent** -- generates a skills check question before every new course
4. **Diagnostic Conversation Agent** -- multi-turn chat that assesses prior knowledge through follow-up questions
5. **Course Creation Agent** -- generates a learning plan skeleton, informed by the diagnostic result
6. **Activity Creation Agent** -- generates detailed instructions per activity
7. **Activity Assessment Agent** -- evaluates screenshots with vision
8. **Activity Q&A Agent** -- answers learner questions about activities and assessments inline
9. **Learner Profile Agent** -- tracks learner progress, patterns, and preferences; updated after assessments, diagnostics, feedback, and course completion

The entire course experience (diagnostic, setup, activities, assessments) happens in a single conversational chat interface. Multi-turn conversations use `orchestrator.converse()` with prompts in `prompts/`. One-off Q&A uses `orchestrator.chatWithContext()` with inline system prompts.

All activity, assessment, and course plan outputs pass through deterministic validators before reaching the user. Validators check for format compliance, safety, and constraints (browser-only, single page, viewport-sized output, ends with "Record"). Course plans are validated for activity count matching learning objective count exactly, no consecutive duplicate activity types, and required fields.

See `js/api.js` for the API client and model constants.

## Activity constraints

Activities must:
- Happen entirely in the browser tab (the screenshot only captures the active tab)
- Lead to exactly one visible result on one page, small enough to fit in a single viewport (no scrolling)
- End with "Hit Record to capture your screen."
- Not reference desktop apps, terminals, or file system operations
- Not use platform-specific keyboard shortcuts
- Take 5 minutes or less
- Map 1:1 to learning objectives (one activity per objective, enforced by `validatePlan()`)
- Use a different activity type from the previous activity (no two consecutive explore, apply, etc.)

## Guidelines

- **Accessibility is required.** Every interactive element must be keyboard-operable and have an accessible name. Test with a screen reader when adding UI.
- **Keep it lightweight.** No frameworks, no heavy dependencies. The app must perform well on Chromebooks and Android tablets.
- **Local-first.** External calls go to the Anthropic API (user's own key) and, when data sharing is enabled, anonymous telemetry to `learn-dashboard`. Screenshots and API keys are never sent, but feedback text the user writes may be included. A consent dialog is shown before enabling data sharing.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update README.md and CLAUDE.md accordingly.
- **Test prompts.** When editing `prompts/*.md`, test with a real API key to verify the agent returns valid JSON.

## Running tests

Tests use Node's built-in test runner (no dependencies to install):

```bash
npm test
```

Tests validate `manifest.json` structure, `courses.json` data integrity, data migrations, and the output validator functions used by the agent orchestrator. All tests must pass before merging.

## Data migrations

When a change modifies the shape of stored data (`chrome.storage.local` keys or IndexedDB), add a migration to `js/migrations.js`:

1. Add a new entry to the `migrations` array with the next integer version.
2. Write an async `run()` function that reads the old format and writes the new format.
3. Ensure the function is **idempotent** — running it twice on the same data must produce the same result.
4. Add a test for the migration in `tests/migrations.test.js`.
5. Update any affected getter/setter functions in `js/storage.js`.
6. Update `mergeProfile()` in `js/app.js` if the learner profile shape changed.

## Submitting changes

1. Create a branch from `staging`.
2. Make focused, well-described commits.
3. Open a pull request **into `staging`** with a clear summary of what changed and why.
4. Once merged to `staging`, a release candidate (RC) build is automatically created as a GitHub pre-release.
5. When ready for production, open a PR from `staging` into `main`.

**`main` is protected** -- direct pushes are blocked. All changes must flow through `staging` via pull request.

## Versioning and releases

Versioning is fully automated across two branches:

### Staging (release candidates)
When commits are pushed to `staging`, a GitHub Actions workflow:
1. Runs tests.
2. Reads `main`'s current version as the base (e.g., `0.6.3`).
3. Counts non-bump commits since `staging` diverged from `main` to determine the RC number (e.g., `0.6.3-RC2`). The RC number resets when `staging` is merged into `main`.
4. Creates a GitHub **pre-release** with the extension zip. RCs are not published to the Chrome Web Store.

### Production (main)
When a PR from `staging` is merged into `main`, a GitHub Actions workflow:
1. Runs tests.
2. Analyzes commits with Claude to determine the final semver bump and generate release notes.
3. Updates `manifest.json` with a clean version (stripping any RC fields from staging).
4. Packages the extension, creates a GitHub Release, and publishes to the Chrome Web Store.

**Do not manually bump the version in `manifest.json`** -- the workflows handle this automatically.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
