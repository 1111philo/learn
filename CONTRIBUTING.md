# Contributing to 1111 Learn

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Fork and clone the repository.
2. Copy `.env.example.js` to `.env.js` and fill in your Anthropic API key and name. This file is gitignored and will never be committed. On app load, these values automatically seed storage — but the onboarding wizard still runs on first use. To reset and re-run onboarding, clear extension storage via Chrome's developer tools.
3. Load the extension in Chrome using developer mode (see README.md).
4. Make your changes and test them in the side panel.

## Development workflow

- The UI is a React app built with Vite. Run `npm run dev` for the dev server, or `npm run build` to produce the extension in `dist/`.
- Load the `dist/` directory as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).
- React components live in `src/`. Service modules (storage, orchestrator, auth, sync) live in `js/` and are imported by React.
- Course definitions live in `data/courses.json`.
- Agent system prompts live in `prompts/*.md` -- edit these to change agent behavior without touching code.
- `.env.js` seeds your API key and name into storage on every load (values only written if not already set).
- Use Chrome DevTools on the side panel to inspect state and debug issues.

## Architecture

The app uses an assessment-backward design with AI agents orchestrated through `js/orchestrator.js`:

1. **Onboarding Conversation Agent** -- multi-turn chat that gets to know the learner
2. **Onboarding Profile Agent** -- creates an initial learner profile (fallback when conversation is skipped)
3. **Summative Generation Agent** -- generates a summative assessment (multi-step capture task + rubric + exemplar) from all course learning objectives
4. **Summative Rubric Review Agent** -- multi-turn conversation about the rubric/exemplar; can trigger regeneration
5. **Summative Assessment Agent** -- scores multi-capture screenshots against rubric criteria with ratchet rule (scores only go up)
6. **Gap Analysis Agent** -- identifies per-criterion gaps from baseline attempt
7. **Journey Generation Agent** -- selects, orders, and sizes units with formative activities mapped to rubric criteria
8. **Activity Creation Agent** -- generates formative activity instructions targeting specific rubric criteria
9. **Activity Assessment Agent** -- evaluates screenshots with optional rubric-criteria scoring
10. **Activity Q&A Agent** -- answers learner questions inline
11. **Learner Profile Agent** -- tracks progress after summative attempts, assessments, feedback, and mastery

The course experience has two layers: the course hub (UnitsList) manages summative phases, and unit chats handle formative activities. Multi-turn conversations use `orchestrator.converse()` with prompts in `prompts/`. One-off Q&A uses `orchestrator.chatWithContext()` with inline system prompts.

All agent outputs pass through deterministic validators. Summatives are validated for task/rubric/exemplar structure. Summative assessments enforce the ratchet rule. Journeys are validated for unit/activity/criteria structure. Activities are validated for browser constraints.

See `js/api.js` for the API client and model constants.

## Activity constraints

Activities must:
- Happen entirely in the browser tab (the screenshot only captures the active tab)
- Lead to exactly one visible result on one page, small enough to fit in a single viewport (no scrolling)
- End with "Hit Capture to capture your screen."
- Not reference desktop apps, terminals, or file system operations
- Not use platform-specific keyboard shortcuts
- Take 5 minutes or less
- Target specific rubric criteria (formative activities are generated from gap analysis)
- Use a different activity type from the previous activity (no two consecutive explore, apply, etc.)

## Guidelines

- **Accessibility is required.** Every interactive element must be keyboard-operable and have an accessible name. Test with a screen reader when adding UI.
- **Keep it lightweight.** No frameworks, no heavy dependencies. The app must perform well on Chromebooks and Android tablets.
- **Local-first.** External calls go to the Anthropic API (user's own key) or learn-service (when logged in). No telemetry is collected. All data stays on-device unless the user logs in to sync.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update README.md and CLAUDE.md accordingly.
- **Test prompts.** When editing `prompts/*.md`, test with a real API key to verify the agent returns valid JSON.

## Running tests

Tests use Node's built-in test runner (no dependencies to install):

```bash
npm test
```

Tests validate `manifest.json` structure, `courses.json` data integrity, SQLite storage round-trips, and the output validator functions used by the agent orchestrator. All tests must pass before merging.

## Schema changes

Data is stored in SQLite (via sql.js WASM). When adding or modifying tables/columns, update the schema DDL in `js/db.js` (uses `CREATE TABLE IF NOT EXISTS`). Update the corresponding getter/setter functions in `js/storage.js` and add round-trip tests in `tests/storage.test.js`.

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
