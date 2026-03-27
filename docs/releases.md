# Releases, CI/CD, and Permissions

## Branch workflow

All changes flow: **feature branches → staging → main**.

`main` is protected: direct pushes are blocked, PRs require approval and passing status checks. By convention, `main` only accepts PRs from `staging`. Branch protection is configured via `scripts/setup-branch-protection.sh`.

## Staging (release candidates)

Every push to `staging` triggers `.github/workflows/staging.yml`:

1. Runs tests (`npm test`)
2. Reads `main`'s current version from `manifest.json` (e.g., `0.6.3`)
3. Counts non-bump commits on `staging` since it diverged from `main` to determine the RC number
4. Updates `manifest.json` with a 4-segment `version` (e.g., `0.6.3.2`) and `version_name` (e.g., `0.6.3-RC2`)
5. Packages the extension and creates a GitHub **pre-release** with the zip attached

RC builds are **not** published to the Chrome Web Store. The RC number resets automatically when `staging` is merged into `main`.

## Production (main)

When a PR from `staging` is merged into `main`, `.github/workflows/release.yml`:

1. Runs tests (`npm test`)
2. Collects commits since the last production release tag
3. Calls Claude (Haiku) to determine the semver bump and generate release notes
4. Updates `manifest.json` with a clean 3-segment version, strips any `version_name` from staging
5. Packages the extension into a zip (excluding dev files)
6. Commits the version bump and creates a GitHub Release with the zip attached
7. Uploads the zip to the Chrome Web Store and publishes it

**Do not manually bump the version in `manifest.json`** -- the workflows handle this automatically.

## Required secrets

Maintainers must add these to repository settings:

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Claude-powered version analysis in release workflow |
| `GOOGLE_CLIENT_ID` | OAuth2 for Chrome Web Store API |
| `GOOGLE_CLIENT_SECRET` | OAuth2 for Chrome Web Store API |
| `GOOGLE_REFRESH_TOKEN` | OAuth2 for Chrome Web Store API |
| `CWS_EXTENSION_ID` | The extension's Chrome Web Store ID |

See [Chrome Web Store API docs](https://developer.chrome.com/docs/webstore/using-api) for setting up OAuth2 credentials.

## Chrome extension permissions

| Permission | Why |
|-----------|-----|
| `sidePanel` | Run the app in the Chrome side panel |
| `storage` | Persist metadata locally |
| `unlimitedStorage` | Allow large screenshot storage in IndexedDB |
| `activeTab` | Capture screenshots and read the active tab URL |
| `tabs` | Query tab information for draft recording |

### Host permissions

| Host | Why |
|------|-----|
| `https://api.anthropic.com/*` | Claude API calls with the user's own key |
| `https://learn.philosophers.group/*` | Cloud sync and authentication (optional) |

## Course JSON structure

Each course in `data/courses.json` has a `courseId`, `name`, `description`, and a `units` array. Each unit has:

| Field | Type | Description |
|-------|------|-------------|
| `unitId` | `string` | Unique identifier |
| `name` | `string` | Display title |
| `description` | `string` | One sentence explaining why the learner benefits |
| `dependsOn` | `string?` | Optional prerequisite unit ID |
| `format` | `"text" \| "screenshot"` | How learners submit work for this unit |
| `exemplar` | `string` | Description of mastery-level outcome (example, not content to copy) |
| `learningObjectives` | `string[]` | Outcome statements the unit achieves |
