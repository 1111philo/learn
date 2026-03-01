# Tech Debt and Deferred Decisions

Tracked shortcuts, known gaps, and decisions to revisit.

---

## Architectural TODOs

### Migrate agents to PydanticAI `deps` + `@agent.system_prompt` decorator
Currently, learner profile and other dynamic context are injected into the user prompt as a
formatted string. PydanticAI supports a `deps` parameter and `@agent.system_prompt` decorator
that would move profile data into the system prompt (higher instruction-following weight) and
set us up for tool use (tools receive `deps` as context).

**Why deferred:** The current approach works and is simpler. We'll need `deps` when we add tool
use, so this is a natural refactor at that point.

### Store full lesson plan metadata on Lesson record
The lesson planner returns a `LessonPlanOutput` with `lesson_title`, `key_concepts`,
`lesson_outline`, `mastery_criteria`, and `suggested_activity`. Currently only the written
`lesson_content` (from the writer) is stored on the Lesson record. The plan output is used to
drive downstream agents and then discarded.

**What to store:** Add a `lesson_plan` JSONB column to the Lesson model containing the full plan
output. At minimum, `lesson_title` should be a first-class column — it's needed for UI navigation
and richer SSE catchup events.

**Why deferred:** The generation pipeline works end-to-end without it. This is a data model
migration + generation code change.

### Add `activity_type` to `activity_created` SSE event
The `activity_created` SSE broadcast currently only includes `objective_index` and `activity_id`.
The API contract specifies an `activity_type` field. The data is available from the
`ActivitySpecOutput` — just needs to be included in the broadcast.

---

## Decisions to Revisit

### Silent transition error swallowing
In several places (activity submission, assessment submission), automatic state transitions are
wrapped in bare `except Exception: pass`. The rationale: the primary operation (grading) succeeded,
so don't fail the request over a side-effect transition. The user can manually advance via
`PATCH /courses/{id}/state`.

**Risk:** Courses can get stuck in intermediate states with no error surfaced to the user.
**Consider:** At minimum, log a warning. Possibly surface a `"warnings"` field in the response
so the client knows a transition was skipped.

### Submissions JSONB default inconsistency
Activity submissions default to `[]` (empty list). Assessment submissions default to `None`
(nullable). These should be consistent — either both default to `[]` or both are nullable.

---

## Authentication — Future Improvements

### Refresh token rotation
Short-lived access tokens (15 min) + single-use rotating refresh tokens (30 days) for seamless
long-lived sessions. Current 7-day JWT with re-login is sufficient for POC.

### OAuth / social login
Google, GitHub sign-in. Additive; `password_hash` is already nullable to support passwordless
OAuth users.

### Password reset
Email-based reset flow. Requires email service (SES, Resend, etc).

### Rate limiting
On login/register to prevent brute force. Can use `slowapi` or similar.

### Email verification
Confirm email ownership before account activation.

### SSE reconnect storm on expired token
The browser `EventSource` API auto-reconnects on error but does not expose HTTP status codes.
When a JWT expires, SSE endpoints return 401, `EventSource` treats it as a retryable error, and
reconnects in a loop every ~3 seconds. The `onerror` handler cannot distinguish auth failure from
a transient network issue.

**Current mitigation:** The 7-day token makes mid-session expiry unlikely, and the next REST
API call (page navigation, polling) triggers the 401 redirect to `/login`, which tears down the
page and closes the `EventSource`.

**Fix:** Replace `EventSource` with `fetch()` + `ReadableStream` for SSE connections. This gives
access to `Response.status` before reading the stream, allowing the client to detect 401 and
close cleanly instead of retrying. Downside: loses `EventSource`'s built-in reconnection for
legitimate transient failures (would need manual reconnect logic). Becomes necessary when access
tokens are short-lived (refresh token rotation).

---

## Infrastructure Gaps

### No startup sweep for stuck `generating` courses
If the server crashes during generation, courses are left in `generating` state permanently.
There is no lifespan hook to detect and transition these to `generation_failed` on startup.

### Predefined course JSON uses camelCase
Catalog JSON files follow frontend camelCase conventions (`courseId`, `learningObjectives`,
`estimatedHours`). The catalog loader manually maps these to snake_case. If we rebuild the catalog,
consider using snake_case natively or adding a Pydantic model with aliases.
