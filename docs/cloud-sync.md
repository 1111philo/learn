# Cloud Sync

Login is never required -- the extension works fully offline/locally. Optional login via [learn-service](https://github.com/1111philo/learn-service) enables cross-device data persistence.

When logged in, the server is the source of truth. Data is written to the server after every local save and pulled on startup/login. Local storage acts as a read cache.

## Authentication

[`js/auth.js`](../js/auth.js) handles login/logout/token refresh:

- **JWT tokens:** 15-minute access tokens + 30-day refresh tokens (rotated on use)
- **Storage:** Tokens are stored in the SQLite `auth` table
- **Onboarding:** If logged in, the onboarding wizard is skipped; the auth user's name syncs into local preferences
- **Settings UI:** When signed in, the Personalization section is hidden (name comes from the service) and the API key section shows that AI is provided by the account

## Remote storage

[`js/sync.js`](../js/sync.js) is a thin client for `/v1/sync` endpoints on learn-service:

- **`sync.save(key)`** -- PUTs local data to the server. Handles version conflicts by retrying with the server's version.
- **`sync.loadAll()`** -- GETs all data from the server and replaces local storage, removing any local data the server doesn't have.
- **Versioning:** Version numbers are tracked in memory (not persisted) and rebuilt each session.

### Sync keys

| Key pattern | Data |
|------------|------|
| `summative:{courseId}` | Summative assessment (task, rubric, exemplar) |
| `summative-attempts:{courseId}` | All summative attempts |
| `gap:{courseId}` | Gap analysis |
| `journey:{courseId}` | Learning journey plan + phase |
| `progress:{unitId}` | Unit progress (activities, drafts) |
| `profile` | Learner profile |
| `preferences` | User preferences |

Screenshots are never synced -- they remain in local IndexedDB only.

## AI provider routing

[`js/orchestrator.js`](../js/orchestrator.js) routes API calls based on priority:

1. **Logged in** → learn-service Bedrock proxy `/v1/ai/messages` via JWT auth
2. **Anthropic API key** → direct Anthropic API

Logged-in users need no API key.

## API key provisioning

On login, if no local API key exists, the extension checks for an admin-assigned key via `/v1/me/api-key` and auto-installs it. This allows organizations to provision keys for users without them needing to manage their own.

## Startup sequence

1. If logged in, `sync.loadAll()` runs before reading local data
2. This ensures the extension reflects the server state
3. Falls back to local cache if offline
