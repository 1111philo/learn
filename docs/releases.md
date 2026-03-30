# Releases, CI/CD, and Permissions

## Branch workflow

All changes flow: **feature branches → staging → main**.

`main` is protected: direct pushes are blocked, PRs require approval and passing status checks. By convention, `main` only accepts PRs from `staging`. Branch protection is configured via `scripts/setup-branch-protection.sh`.

## Staging (release candidates)

Every push to `staging` triggers `.github/workflows/staging.yml`. Both staging and production workflows build all platform variants in parallel:

| Job | Runner | Artifact |
|-----|--------|----------|
| `build-chrome` | ubuntu-latest | Chrome extension `.zip` |
| `build-android` | ubuntu-latest | Android `.apk` (debug) |
| `build-ios` | macos-latest | iOS simulator `.zip` (unsigned) |
| `build-electron-mac` | macos-latest | macOS `.dmg` |
| `build-electron-win` | windows-latest | Windows `-setup.exe` |

Staging workflow steps:
1. **Prepare**: runs tests, determines RC version (4-segment `version` + `version_name`), generates release notes via Claude (Haiku)
2. **Build**: 5 parallel jobs produce platform-specific artifacts
3. **Release**: commits the RC version bump, creates a GitHub **pre-release** with all artifacts attached

RC builds are **not** published to the Chrome Web Store. The RC number resets automatically when `staging` is merged into `main`.

## Production (main)

When a PR from `staging` is merged into `main`, `.github/workflows/release.yml`:

1. **Prepare**: runs tests, collects commits since last release, calls Claude (Haiku) for semver bump and release notes
2. **Build**: 5 parallel jobs produce platform-specific artifacts (same matrix as staging)
3. **Release**: commits the version bump, creates a GitHub Release with all artifacts, publishes Chrome extension to Web Store

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
| `unlimitedStorage` | Allow large image storage in IndexedDB |

### Host permissions

| Host | Why |
|------|-----|
| `https://api.anthropic.com/*` | Claude API calls with the user's own key |
| `https://learn.philosophers.group/*` | Cloud sync and authentication (optional) |

## Course prompt format

Courses are defined as markdown files in `data/courses/` (e.g., `foundations.md`). Each file follows this structure:

```markdown
# Course Title

One-line course description.

## Exemplar
A description of what the mastery-level outcome looks like.
Multiple lines are fine.

## Learning Objectives
- Can do X
- Can explain Y
- Can identify Z
```

To add a new course, create a `.md` file in `data/courses/` and add its ID (filename without extension) to the `courseFiles` array in [`js/courseOwner.js`](../js/courseOwner.js).
