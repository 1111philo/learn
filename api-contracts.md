# 1111 School -- API Contracts

## Overview

The 1111 School backend is a FastAPI application that powers an AI-driven personalized learning platform. It provides endpoints for browsing a course catalog, creating and generating custom courses, completing lesson activities, taking assessments, and managing a learner profile.

**Base URL:** `http://localhost:8000`

**Auth:** All authenticated endpoints require a JWT token via `Authorization: Bearer <token>` header. For SSE endpoints, the token can alternatively be passed as a `?token=<jwt>` query parameter (since `EventSource` cannot send custom headers). Tokens are obtained via the register or login endpoints. Protected endpoints return `401 Unauthorized` if the token is missing, invalid, or expired.

---

## Conventions

- All endpoints return JSON (except the SSE stream endpoint).
- Auth: `get_current_user` dependency injected via `Depends`. Extracts JWT from `Authorization: Bearer` header or `?token=` query param.
- Errors: FastAPI standard format `{"detail": "..."}` with appropriate HTTP status codes.
- UUIDs: String format, 36 characters with dashes (e.g., `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`).
- Timestamps: ISO 8601 with timezone (stored as `DateTime(timezone=True)` in PostgreSQL).
- JSONB fields: Returned as native JSON objects/arrays.
- All list endpoints return JSON arrays at the top level.

### Course Status State Machine

```
draft -> generating -> active -> in_progress -> awaiting_assessment -> assessment_ready -> completed
                   \-> generation_failed (retry -> generating)
```

Valid transitions and their guard conditions:

| From                  | To                    | Guard                    |
|-----------------------|-----------------------|--------------------------|
| `draft`               | `generating`          | Course has objectives    |
| `generating`          | `active`              | All content generated    |
| `generating`          | `generation_failed`   | Always (on error)        |
| `generation_failed`   | `generating`          | Always (user retry)      |
| `active`              | `in_progress`         | Always (auto after gen)  |
| `in_progress`         | `awaiting_assessment` | All lessons completed    |
| `awaiting_assessment` | `assessment_ready`    | Assessment generated     |
| `assessment_ready`    | `completed`           | Assessment passed        |
| `assessment_ready`    | `assessment_ready`    | Always (retry on fail)   |

### Lesson Statuses

- `locked` -- Not yet accessible.
- `unlocked` -- Ready for the learner.
- `completed` -- Lesson activity submitted.

---

## Endpoints

---

### 0. Authentication

#### `POST /api/auth/register`

Register a new user account.

**Auth:** None

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

| Field      | Type   | Required | Constraints                  |
|------------|--------|----------|------------------------------|
| `email`    | string | Yes      | Valid email address          |
| `password` | string | Yes      | Minimum 8 characters         |

**Response:** `200 OK`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "user@example.com"
  }
}
```

| Field        | Type   | Description                    |
|--------------|--------|--------------------------------|
| `token`      | string | JWT access token               |
| `user.id`    | string | UUID of the new user           |
| `user.email` | string | The registered email           |

**Error responses:**
- `409 Conflict` -- `{"detail": "Email already registered"}`
- `422 Unprocessable Entity` -- Validation error (invalid email, short password).

---

#### `POST /api/auth/login`

Authenticate with email and password.

**Auth:** None

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

| Field      | Type   | Required | Description      |
|------------|--------|----------|------------------|
| `email`    | string | Yes      | Email address    |
| `password` | string | Yes      | Password         |

**Response:** `200 OK`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "user@example.com"
  }
}
```

| Field        | Type   | Description                    |
|--------------|--------|--------------------------------|
| `token`      | string | JWT access token               |
| `user.id`    | string | UUID of the user               |
| `user.email` | string | The user's email               |

**Side effects:**
- Updates `last_login_at` on the user record.

**Error responses:**
- `401 Unauthorized` -- `{"detail": "Invalid email or password"}`

---

#### `GET /api/auth/me`

Get the currently authenticated user's info. Used to validate a stored token on page load.

**Auth:** Required

**Response:** `200 OK`

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "user@example.com"
}
```

| Field   | Type   | Description           |
|---------|--------|-----------------------|
| `id`    | string | UUID of the user      |
| `email` | string | The user's email      |

**Error responses:**
- `401 Unauthorized` -- Missing, invalid, or expired token.

---

### 1. Health

#### `GET /api/health`

Check that the API and database are operational.

**Auth:** None

**Response:** `200 OK`

```json
{
  "status": "ok"
}
```

| Field    | Type   | Description                    |
|----------|--------|--------------------------------|
| `status` | string | Always `"ok"` if healthy       |

**Error responses:**
- `500 Internal Server Error` -- Database unreachable.

---

### 2. Catalog

#### `GET /api/catalog`

List all predefined courses available in the catalog, with optional filtering.

**Auth:** None

**Query parameters:**

| Param    | Type           | Required | Description                                      |
|----------|----------------|----------|--------------------------------------------------|
| `search` | string or null | No       | Case-insensitive substring match on name or description |
| `tag`    | string or null | No       | Exact match on a tag in the course's tags list    |

**Response:** `200 OK` -- JSON array of catalog courses.

```json
[
  {
    "course_id": "intro-to-python",
    "version": "1.0.0",
    "name": "Introduction to Python",
    "description": "Learn the fundamentals of Python programming.",
    "learning_objectives": [
      "Understand variables and data types",
      "Write basic functions"
    ],
    "tags": ["python", "beginner"],
    "estimated_hours": 3.0
  }
]
```

| Field                  | Type         | Description                                  |
|------------------------|--------------|----------------------------------------------|
| `course_id`            | string       | Unique identifier for the predefined course  |
| `version`              | string       | Semantic version of the course definition     |
| `name`                 | string       | Display name                                 |
| `description`          | string       | Course description                           |
| `learning_objectives`  | string[]     | List of learning objectives                  |
| `tags`                 | string[]     | Tags for categorization                      |
| `estimated_hours`      | number       | Estimated hours to complete (float)          |

---

#### `POST /api/catalog/{course_id}/start`

Start a predefined course from the catalog. Creates a new `CourseInstance` with `source_type: "predefined"` in `draft` status.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                        |
|-------------|--------|------------------------------------|
| `course_id` | string | The predefined course's `course_id`|

**Request body:** None

**Response:** `200 OK`

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "draft"
}
```

| Field    | Type   | Description                        |
|----------|--------|------------------------------------|
| `id`     | string | UUID of the new CourseInstance      |
| `status` | string | Always `"draft"` on creation       |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found in catalog"}`

---

### 3. Courses

#### `POST /api/courses`

Create a custom course from a free-text description and learning objectives.

**Auth:** Required

**Request body:**

```json
{
  "description": "A course on modern web accessibility practices",
  "objectives": [
    "Understand WCAG 2.1 guidelines",
    "Implement ARIA attributes correctly",
    "Test for accessibility with screen readers"
  ]
}
```

| Field         | Type     | Required | Constraints                          |
|---------------|----------|----------|--------------------------------------|
| `description` | string   | Yes      | Free-text course description         |
| `objectives`  | string[] | Yes      | Non-empty list (at least 1 item)     |

**Response:** `200 OK`

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "status": "draft"
}
```

| Field    | Type   | Description                        |
|----------|--------|------------------------------------|
| `id`     | string | UUID of the new CourseInstance      |
| `status` | string | Always `"draft"` on creation       |

**Error responses:**
- `422 Unprocessable Entity` -- Validation error (empty objectives, missing fields).

---

#### `POST /api/courses/{course_id}/generate`

Trigger AI generation for a course. **Returns immediately.** Generation runs as a background
`asyncio.Task`. Each lesson is committed to the DB as it completes, and progress events are
broadcast via the SSE stream endpoint.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Request body:** None

**Response:** `200 OK`

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "status": "generating"
}
```

| Field    | Type   | Description                                      |
|----------|--------|--------------------------------------------------|
| `id`     | string | UUID of the CourseInstance                        |
| `status` | string | Always `"generating"` (work continues in background) |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found"}`
- `400 Bad Request` -- Course must be in `draft` or `generation_failed` state.
- `409 Conflict` -- `{"detail": "Generation already in progress"}`

**Behavior details:**
- Validates course state, transitions to `generating`, commits, spawns background task, returns.
- Background task runs in two phases:
  - **Phase 0** — `course_describer` agent runs first, sets `generated_description` (narrative arc) and `lesson_titles` (preset title + summary per objective) on the course, then broadcasts `course_described`.
  - **Phase 1+** — `lesson_planner -> lesson_writer -> activity_creator` for lesson 0; remaining lessons are generated on demand as the learner completes activities.
- Each lesson is committed as it completes (visible to `GET /courses/{id}` immediately).
- If a single objective fails, the error is logged and the pipeline continues with remaining objectives.
- On completion: transitions to `in_progress` if at least one lesson was created, otherwise `generation_failed`.
- If the user has a learner profile, it is passed to agents for personalization.
- Track progress via `GET /courses/{id}/generation-stream` (SSE) or poll `GET /courses/{id}`.

---

#### `GET /api/courses`

List all courses for the authenticated user.

**Auth:** Required

**Query parameters:**

| Param    | Type           | Required | Description                              |
|----------|----------------|----------|------------------------------------------|
| `status` | string or null | No       | Filter by course status (exact match)    |

**Response:** `200 OK` -- JSON array ordered by `created_at` descending.

```json
[
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "source_type": "custom",
    "input_description": "A course on modern web accessibility practices",
    "status": "in_progress",
    "lesson_count": 3,
    "lessons_completed": 1
  }
]
```

| Field               | Type          | Description                                         |
|---------------------|---------------|-----------------------------------------------------|
| `id`                | string        | UUID                                                |
| `source_type`       | string        | `"custom"` or `"predefined"`                        |
| `input_description` | string or null| The course description provided at creation         |
| `status`            | string        | Current course status                               |
| `lesson_count`      | number        | Total number of lessons (integer, default 0)        |
| `lessons_completed` | number        | Number of lessons with status `"completed"` (integer, default 0) |

---

#### `GET /api/courses/{course_id}`

Get full course details including all lessons (with activities) and assessments.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Response:** `200 OK`

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "source_type": "custom",
  "input_description": "A course on modern web accessibility practices",
  "input_objectives": [
    "Understand WCAG 2.1 guidelines",
    "Implement ARIA attributes correctly",
    "Test for accessibility with screen readers"
  ],
  "generated_description": "A narrative arc that weaves all objectives into a coherent learning journey...",
  "lesson_titles": [
    {"lesson_title": "Understanding WCAG 2.1", "lesson_summary": "Explore the four POUR principles that underpin all accessibility standards."},
    {"lesson_title": "ARIA in Practice", "lesson_summary": "Apply semantic markup so assistive technologies can interpret your UI."},
    {"lesson_title": "Testing with Screen Readers", "lesson_summary": "Validate your implementation by running NVDA and VoiceOver against real pages."}
  ],
  "status": "in_progress",
  "lessons": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
      "objective_index": 0,
      "lesson_content": "# Understanding WCAG 2.1\n\nThe Web Content Accessibility Guidelines...",
      "status": "unlocked",
      "activity": {
        "id": "d4e5f6a7-b8c9-0123-defa-234567890123",
        "activity_spec": {
          "activity_type": "short_answer",
          "instructions": "Read the following scenario and answer the questions...",
          "prompt": "Explain how WCAG 2.1 Level AA contrast requirements apply to...",
          "scoring_rubric": ["Identifies contrast ratio", "References WCAG guideline", "Provides example"],
          "hints": ["Think about the 4.5:1 ratio", "Consider both text and images"]
        },
        "latest_score": null,
        "latest_feedback": null,
        "mastery_decision": null,
        "attempt_count": 0
      }
    }
  ],
  "assessments": [
    {
      "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
      "status": "pending",
      "score": null,
      "passed": null
    }
  ]
}
```

**Top-level fields:**

| Field                    | Type          | Description                                       |
|--------------------------|---------------|---------------------------------------------------|
| `id`                     | string        | UUID                                              |
| `source_type`            | string        | `"custom"` or `"predefined"`                      |
| `input_description`      | string or null| Description provided at creation                  |
| `input_objectives`       | array         | List of objective strings (JSON array)             |
| `generated_description`  | string or null| Narrative description set by course_describer agent (null before generation) |
| `lesson_titles`          | array or null | Pre-computed `[{"lesson_title": str, "lesson_summary": str}]` one per objective, index-aligned; null before Phase 0 completes |
| `status`                 | string        | Current course status                             |
| `professional_role`      | string or null| Professional identity the learner practices (e.g., "Junior Web Developer") |
| `career_context`         | string or null| Career framing for the course content            |
| `final_portfolio_outcome`| string or null| Description of the final portfolio deliverable    |
| `lessons`                | array         | List of LessonResponse objects (default `[]`)     |
| `assessments`            | array         | List of AssessmentSummary objects (default `[]`)  |

**LessonResponse fields:**

| Field              | Type                | Description                                      |
|--------------------|---------------------|--------------------------------------------------|
| `id`               | string              | UUID                                             |
| `objective_index`  | number (integer)    | Zero-based index into `input_objectives`         |
| `lesson_content`   | string or null      | Markdown lesson body (null before generation)    |
| `status`           | string              | `"locked"`, `"unlocked"`, or `"completed"`       |
| `activity`         | ActivityResponse or null | The lesson's activity (null if no activities exist) |

**ActivityResponse fields:**

| Field              | Type             | Description                                       |
|--------------------|------------------|---------------------------------------------------|
| `id`                    | string           | UUID                                              |
| `activity_spec`         | object or null   | AI-generated activity specification (see below)   |
| `latest_score`          | number or null   | Most recent submission score (float, 0-100)       |
| `latest_feedback`       | object or null   | Feedback object (see below)                       |
| `mastery_decision`      | string or null   | `"not_yet"`, `"meets"`, or `"exceeds"` (null if ungraded) |
| `attempt_count`         | number (integer) | Number of submissions made                        |
| `portfolio_readiness`   | string or null   | `"practice_only"`, `"emerging_portfolio_piece"`, or `"portfolio_ready"` |
| `revision_count`        | number (integer) | Number of revision submissions (default 0)        |
| `portfolio_artifact_id` | string or null   | UUID of the linked portfolio artifact (null if none) |

**activity_spec shape** (when present):

| Field             | Type     | Description                                   |
|-------------------|----------|-----------------------------------------------|
| `activity_type`                  | string        | Type of activity (e.g., `"short_answer"`)     |
| `instructions`                   | string        | Detailed instructions (min 50 chars)          |
| `prompt`                         | string        | The question/task for the learner (min 20 chars) |
| `scoring_rubric`                 | string[]      | 3-6 rubric criteria                           |
| `hints`                          | string[]      | 2-5 hints for the learner                     |
| `artifact_type`                  | string or null| Type of portfolio artifact produced           |
| `employer_skill_signals`         | string[] or null | Skills this activity demonstrates to employers |
| `portfolio_eligible`             | boolean or null | Whether this activity can produce a portfolio artifact |
| `revision_required`              | boolean or null | Whether revision is recommended for quality   |
| `professional_quality_checklist` | string[] or null | Quality criteria for professional output      |

**latest_feedback shape** (when present):

| Field          | Type     | Description                    |
|----------------|----------|--------------------------------|
| `rationale`               | string          | Overall explanation of the score |
| `strengths`               | string[]        | What the learner did well      |
| `improvements`            | string[]        | Areas for improvement          |
| `tips`                    | string[]        | Actionable tips                |
| `portfolio_readiness`     | string or null  | `"practice_only"`, `"emerging_portfolio_piece"`, or `"portfolio_ready"` |
| `employer_relevance_notes`| string or null  | How the work relates to employer expectations |
| `revision_priority`       | string or null  | Priority level for revision    |
| `resume_bullet_seed`      | string or null  | Suggested resume bullet point  |

**AssessmentSummary fields:**

| Field    | Type            | Description                              |
|----------|-----------------|------------------------------------------|
| `id`     | string          | UUID                                     |
| `status` | string          | `"pending"` or `"reviewed"`              |
| `score`  | number or null  | Overall score (float, 0-100)             |
| `passed` | boolean or null | Whether the assessment was passed        |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found"}`

---

#### `PATCH /api/courses/{course_id}/state`

Manually transition the course to a new status. Subject to the state machine guard conditions.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Query parameters:**

| Param          | Type   | Required | Description                          |
|----------------|--------|----------|--------------------------------------|
| `target_state` | string | Yes      | The desired target status            |

**Request body:** None

**Response:** `200 OK`

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "status": "awaiting_assessment"
}
```

| Field    | Type   | Description                                |
|----------|--------|--------------------------------------------|
| `id`     | string | UUID                                       |
| `status` | string | The new status after successful transition |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found"}`
- `400 Bad Request` -- `{"detail": "Cannot transition from 'X' to 'Y'"}` or `{"detail": "Guard 'guard_name' failed for transition 'X' -> 'Y'"}`

---

#### `DELETE /api/courses/{course_id}`

Delete a course and all associated lessons, activities, assessments, and agent logs (cascading delete).

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Request body:** None

**Response:** `200 OK`

```json
{
  "deleted": true
}
```

| Field     | Type    | Description           |
|-----------|---------|-----------------------|
| `deleted` | boolean | Always `true`         |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found"}`

---

#### `GET /api/courses/{course_id}/generation-stream` (SSE)

Stream Server-Sent Events (SSE) for course generation progress. Used in conjunction with
`POST /api/courses/{course_id}/generate` which returns immediately and runs generation in the
background.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Response:** `200 OK` with `Content-Type: text/event-stream`

This is **not** a JSON response. It is an SSE stream. Each event has the format:

```
event: <event_type>
data: <json_payload>

```

**Event types:**

##### `course_described`

Fired once, before any lesson events, when the course describer agent completes Phase 0. Carries the full list of lesson titles/summaries so the frontend can populate the generation stepper immediately.

```
event: course_described
data: {"lesson_previews": [{"index": 0, "title": "Understanding WCAG 2.1", "summary": "Explore the four POUR principles..."}, ...], "narrative_description": "..."}
```

| Field                          | Type            | Description                                                                 |
|--------------------------------|-----------------|-----------------------------------------------------------------------------|
| `lesson_previews`              | array           | One entry per objective, in order                                           |
| `lesson_previews[].index`      | number (integer)| Zero-based objective index                                                  |
| `lesson_previews[].title`      | string          | Pre-set lesson title (used as the lesson's final title)                     |
| `lesson_previews[].summary`    | string          | One-sentence preview shown in the generation stepper                        |
| `narrative_description`        | string          | The full narrative description stored in `course.generated_description`     |

Also sent as a **catchup event** when a client connects to the stream after Phase 0 has completed (i.e., `course.lesson_titles` is set in the DB).

##### `lesson_planned`

Fired when a lesson plan is completed for an objective.

```
event: lesson_planned
data: {"objective_index": 0, "lesson_title": "Understanding WCAG 2.1"}
```

| Field             | Type            | Description                            |
|-------------------|-----------------|----------------------------------------|
| `objective_index` | number (integer)| Zero-based index of the objective      |
| `lesson_title`    | string          | Title from the lesson plan             |

##### `lesson_written`

Fired when lesson content has been written and the Lesson record committed to DB.

```
event: lesson_written
data: {"objective_index": 0}
```

| Field             | Type            | Description                            |
|-------------------|-----------------|----------------------------------------|
| `objective_index` | number (integer)| Zero-based index of the objective      |

##### `activity_created`

Fired when an activity has been created for a lesson.

```
event: activity_created
data: {"objective_index": 0, "activity_id": "d4e5f6a7-b8c9-0123-defa-234567890123", "activity_type": "short_answer"}
```

| Field             | Type            | Description                            |
|-------------------|-----------------|----------------------------------------|
| `objective_index` | number (integer)| Zero-based index of the objective      |
| `activity_id`     | string          | UUID of the created Activity           |
| `activity_type`   | string          | Type of activity generated             |

##### `generation_complete`

Fired when generation finishes (success or partial). Always the last event in the stream.

```
event: generation_complete
data: {"course_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901", "lesson_count": 3}
```

| Field          | Type            | Description                            |
|----------------|-----------------|----------------------------------------|
| `course_id`    | string          | UUID of the CourseInstance              |
| `lesson_count` | number (integer)| Total lessons successfully generated   |

##### `generation_error`

Fired when a single objective fails. Generation continues with remaining objectives.

```
event: generation_error
data: {"objective_index": 2, "error": "Failed to generate lesson for objective 2"}
```

| Field             | Type            | Description                            |
|-------------------|-----------------|----------------------------------------|
| `objective_index` | number (integer)| Index of the failed objective (-1 for fatal errors) |
| `error`           | string          | Human-readable error message           |

**Reconnection behavior:**
- If the client connects after generation is already complete, the server sends all events as catchup (starting with `course_described` if Phase 0 finished) followed by a `generation_complete` event, then closes the stream.
- If the client connects while generation is in-flight, the server sends `course_described` first (if Phase 0 finished), then catchup events for already-completed lesson steps, then streams live events as they occur.
- Standard SSE reconnection: the client should reconnect automatically on disconnect; the server replays relevant events.

---

### 4. Activities

#### `POST /api/activities/{activity_id}/submit`

Submit a response to a lesson activity. The submission is graded by an AI reviewer agent. On successful submission, the lesson is marked as `completed` and the next lesson is unlocked. If all lessons are completed, the course transitions to `awaiting_assessment`.

**Auth:** Required

**Path parameters:**

| Param         | Type   | Description              |
|---------------|--------|--------------------------|
| `activity_id` | string | UUID of the Activity     |

**Request body:**

```json
{
  "text": "WCAG 2.1 Level AA requires a contrast ratio of at least 4.5:1 for normal text..."
}
```

| Field  | Type   | Required | Constraints         |
|--------|--------|----------|---------------------|
| `text` | string | Yes      | Minimum 1 character |

**Response:** `200 OK`

```json
{
  "score": 78,
  "mastery_decision": "meets",
  "rationale": "The response demonstrates a solid understanding of WCAG contrast requirements...",
  "strengths": [
    "Correctly identified the 4.5:1 contrast ratio",
    "Provided a practical example"
  ],
  "improvements": [
    "Could elaborate on Level AAA requirements",
    "Missing mention of non-text contrast"
  ],
  "tips": [
    "Use browser dev tools to check contrast ratios",
    "Review the WCAG 2.1 quick reference for non-text requirements"
  ]
}
```

| Field              | Type            | Description                                       |
|--------------------|-----------------|---------------------------------------------------|
| `score`            | number (integer)| Score from 0 to 100                               |
| `mastery_decision` | string          | `"not_yet"`, `"meets"`, or `"exceeds"`            |
| `rationale`        | string          | Detailed explanation (min 50 chars)               |
| `strengths`        | string[]        | 2-5 identified strengths                          |
| `improvements`     | string[]        | 2-5 areas for improvement                         |
| `tips`             | string[]        | 2-6 actionable tips                               |

**Side effects:**
- Appends submission to `activity.submissions` array (each entry: `{"text": "...", "submitted_at": "ISO8601"}`).
- Updates `latest_score`, `latest_feedback`, `mastery_decision`, and increments `attempt_count`.
- Marks the lesson as `completed` (if not already).
- Unlocks the next locked lesson (by `objective_index` order).
- If all lessons are completed, auto-transitions the course to `awaiting_assessment`.

**Error responses:**
- `404 Not Found` -- `{"detail": "Activity not found"}` (also returned if user does not own the course).
- `422 Unprocessable Entity` -- Validation error (empty text).

---

### 5. Assessments

#### `POST /api/assessments/{course_id}/generate`

Generate a final assessment for a course. An AI agent creates assessment questions based on the course objectives and the learner's activity performance. The course transitions to `assessment_ready`.

**Auth:** Required

**Path parameters:**

| Param       | Type   | Description                 |
|-------------|--------|-----------------------------|
| `course_id` | string | UUID of the CourseInstance   |

**Request body:** None

**Response:** `200 OK`

```json
{
  "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
  "status": "pending",
  "score": null,
  "passed": null,
  "feedback": null,
  "assessment_spec": {
    "assessment_title": "Web Accessibility Final Assessment",
    "items": [
      {
        "objective": "Understand WCAG 2.1 guidelines",
        "prompt": "Explain the four POUR principles of WCAG 2.1 and provide an example of each.",
        "rubric": [
          "Names all four principles",
          "Provides accurate examples",
          "Demonstrates understanding beyond memorization"
        ]
      }
    ]
  }
}
```

| Field             | Type           | Description                                  |
|-------------------|----------------|----------------------------------------------|
| `id`              | string         | UUID of the new Assessment                   |
| `status`          | string         | Always `"pending"` on creation               |
| `score`           | number or null | Always `null` on creation                    |
| `passed`          | boolean or null| Always `null` on creation                    |
| `feedback`        | object or null | Always `null` on creation                    |
| `assessment_spec` | object or null | AI-generated assessment specification        |

**assessment_spec shape:**

| Field              | Type     | Description                                    |
|--------------------|----------|------------------------------------------------|
| `assessment_title` | string   | Title for the assessment                       |
| `items`            | array    | 1-6 assessment items                           |

**assessment_spec.items[] shape:**

| Field       | Type     | Description                              |
|-------------|----------|------------------------------------------|
| `objective` | string   | The learning objective being assessed    |
| `prompt`    | string   | The assessment question/task             |
| `rubric`    | string[] | 3-6 rubric criteria for grading          |

**Error responses:**
- `404 Not Found` -- `{"detail": "Course not found"}`
- `400 Bad Request` -- `{"detail": "Course is in 'X' state, not ready for assessment"}` (course must be in `awaiting_assessment` or `assessment_ready` status).

---

#### `POST /api/assessments/{assessment_id}/submit`

Submit responses to an assessment. An AI agent grades each response against the rubric and decides pass/fail. If the learner passes, the course transitions to `completed`.

**Auth:** Required

**Path parameters:**

| Param           | Type   | Description              |
|-----------------|--------|--------------------------|
| `assessment_id` | string | UUID of the Assessment   |

**Request body:**

```json
{
  "responses": [
    {
      "objective": "Understand WCAG 2.1 guidelines",
      "text": "The four POUR principles are Perceivable, Operable, Understandable, and Robust..."
    }
  ]
}
```

| Field                    | Type     | Required | Description                          |
|--------------------------|----------|----------|--------------------------------------|
| `responses`              | array    | Yes      | Array of assessment item responses   |
| `responses[].objective`  | string   | Yes      | The objective being addressed        |
| `responses[].text`       | string   | Yes      | The learner's response text          |

**Response:** `200 OK`

```json
{
  "id": "e5f6a7b8-c9d0-1234-efab-345678901234",
  "status": "reviewed",
  "score": 85.0,
  "passed": true,
  "feedback": {
    "overall_score": 85,
    "objective_scores": [
      {
        "objective": "Understand WCAG 2.1 guidelines",
        "score": 85,
        "feedback": "Strong understanding of the POUR principles demonstrated."
      }
    ],
    "pass_decision": "pass",
    "next_steps": [
      "Explore WCAG 2.2 additions",
      "Practice with real-world auditing tools"
    ]
  },
  "assessment_spec": {
    "assessment_title": "Web Accessibility Final Assessment",
    "items": [
      {
        "objective": "Understand WCAG 2.1 guidelines",
        "prompt": "Explain the four POUR principles...",
        "rubric": ["Names all four principles", "Provides accurate examples", "Demonstrates understanding"]
      }
    ]
  }
}
```

| Field             | Type            | Description                                   |
|-------------------|-----------------|-----------------------------------------------|
| `id`              | string          | UUID                                          |
| `status`          | string          | `"reviewed"` after grading                    |
| `score`           | number or null  | Overall score (float, 0-100)                  |
| `passed`          | boolean or null | `true` if pass_decision is `"pass"`           |
| `feedback`        | object or null  | Detailed grading feedback (see below)         |
| `assessment_spec` | object or null  | The original assessment specification         |

**feedback shape:**

| Field              | Type     | Description                                    |
|--------------------|----------|------------------------------------------------|
| `overall_score`    | number   | Integer score 0-100                            |
| `objective_scores` | array    | Per-objective score and feedback               |
| `pass_decision`    | string   | `"pass"` or `"fail"`                           |
| `next_steps`       | string[] | Recommended next learning steps (at least 1)   |

**feedback.objective_scores[] shape:**

| Field       | Type            | Description                              |
|-------------|-----------------|------------------------------------------|
| `objective` | string          | The learning objective                   |
| `score`     | number (integer)| Score 0-100 for this objective           |
| `feedback`  | string          | Specific feedback for this objective     |

**Side effects:**
- Stores submissions on the assessment record.
- Updates assessment `score`, `passed`, `feedback`, and sets status to `"reviewed"`.
- If `passed` is `true`, transitions the course to `completed`.

**Error responses:**
- `404 Not Found` -- `{"detail": "Assessment not found"}` (also returned if user does not own the course).
- `422 Unprocessable Entity` -- Validation error.

---

### 6. Profile

#### `GET /api/profile`

Get the authenticated user's learner profile. If no profile exists, one is created with default values.

**Auth:** Required

**Request body:** None

**Response:** `200 OK`

```json
{
  "display_name": null,
  "experience_level": null,
  "learning_goals": [],
  "interests": [],
  "learning_style": null,
  "tone_preference": null,
  "skill_signals": {
    "strengths": [],
    "gaps": []
  },
  "version": 1,
  "career_interests": [],
  "target_roles": [],
  "portfolio_goals": []
}
```

| Field              | Type           | Description                                         |
|--------------------|----------------|-----------------------------------------------------|
| `display_name`     | string or null | User's display name                                 |
| `experience_level` | string or null | Self-reported experience level (max 50 chars)       |
| `learning_goals`   | array          | List of learning goal strings (default `[]`)        |
| `interests`        | array          | List of interest strings (default `[]`)             |
| `learning_style`   | string or null | Preferred learning style (max 50 chars)             |
| `tone_preference`  | string or null | Preferred tone for content (max 50 chars)           |
| `skill_signals`    | object         | AI-populated skill data (default `{"strengths": [], "gaps": []}`) |
| `version`          | number (integer)| Profile version, incremented on each update         |
| `career_interests` | array          | Career interest areas (default `[]`)                |
| `target_roles`     | array          | Target job roles (default `[]`)                     |
| `portfolio_goals`  | array          | Portfolio building goals (default `[]`)             |

---

#### `PUT /api/profile`

Update the authenticated user's learner profile. Only fields included in the request body are updated (partial update via `exclude_unset`). The profile `version` is incremented by 1 on each call. If no profile exists, one is created first.

**Auth:** Required

**Request body** (all fields optional):

```json
{
  "display_name": "Alex",
  "experience_level": "intermediate",
  "learning_goals": ["Master web accessibility", "Learn React testing"],
  "interests": ["frontend", "a11y"],
  "learning_style": "visual",
  "tone_preference": "casual"
}
```

| Field              | Type                | Required | Description                          |
|--------------------|---------------------|----------|--------------------------------------|
| `display_name`     | string or null      | No       | Display name                         |
| `experience_level` | string or null      | No       | Experience level                     |
| `learning_goals`   | string[] or null    | No       | Learning goals list                  |
| `interests`        | string[] or null    | No       | Interests list                       |
| `learning_style`   | string or null      | No       | Preferred learning style             |
| `tone_preference`  | string or null      | No       | Preferred content tone               |
| `career_interests` | string[] or null    | No       | Career interest areas                |
| `target_roles`     | string[] or null    | No       | Target job roles                     |
| `portfolio_goals`  | string[] or null    | No       | Portfolio building goals             |

**Response:** `200 OK` -- Same shape as `GET /api/profile` with updated values.

```json
{
  "display_name": "Alex",
  "experience_level": "intermediate",
  "learning_goals": ["Master web accessibility", "Learn React testing"],
  "interests": ["frontend", "a11y"],
  "learning_style": "visual",
  "tone_preference": "casual",
  "skill_signals": {
    "strengths": [],
    "gaps": []
  },
  "version": 2,
  "career_interests": ["frontend development"],
  "target_roles": ["Junior Web Developer"],
  "portfolio_goals": ["Build accessible web apps"]
}
```

**Error responses:**
- `422 Unprocessable Entity` -- Validation error.

---

### 7. Portfolio

#### `GET /api/portfolio`

List all portfolio artifacts for the authenticated user, ordered by most recently updated.

**Auth:** Required

**Response:** `200 OK` -- JSON array of portfolio artifacts.

```json
[
  {
    "id": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "title": "WCAG Audit Checklist",
    "artifact_type": "checklist",
    "status": "portfolio_ready",
    "skills": ["accessibility", "WCAG 2.1", "auditing"],
    "course_instance_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  }
]
```

| Field                | Type     | Description                                      |
|----------------------|----------|--------------------------------------------------|
| `id`                 | string   | UUID                                             |
| `title`              | string   | Artifact title                                   |
| `artifact_type`      | string   | Type of artifact (e.g., checklist, draft, plan)  |
| `status`             | string   | `"draft"`, `"revised"`, `"portfolio_ready"`, or `"tool_ready"` |
| `skills`             | string[] | Skills demonstrated by this artifact             |
| `course_instance_id` | string   | UUID of the course that produced this artifact   |

---

#### `GET /api/portfolio/summary`

Get portfolio summary with aggregate stats.

**Auth:** Required

**Response:** `200 OK`

```json
{
  "artifacts": [...],
  "total": 5,
  "by_status": {
    "draft": 1,
    "portfolio_ready": 3,
    "tool_ready": 1
  }
}
```

| Field       | Type               | Description                              |
|-------------|--------------------|------------------------------------------|
| `artifacts` | array              | Same shape as `GET /api/portfolio`       |
| `total`     | number (integer)   | Total number of artifacts                |
| `by_status` | object             | Count of artifacts per status            |

---

#### `GET /api/portfolio/{artifact_id}`

Get full details for a single portfolio artifact.

**Auth:** Required

**Path parameters:**

| Param         | Type   | Description              |
|---------------|--------|--------------------------|
| `artifact_id` | string | UUID of the artifact     |

**Response:** `200 OK`

```json
{
  "id": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "course_instance_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "lesson_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "artifact_type": "checklist",
  "title": "WCAG Audit Checklist",
  "content_pointer": "Full text of the artifact...",
  "status": "portfolio_ready",
  "skills": ["accessibility", "WCAG 2.1"],
  "audience": "QA teams",
  "employer_use_case": "Demonstrates ability to create practical audit tools",
  "resume_bullet_seed": "Created a WCAG 2.1 audit checklist covering 15 criteria",
  "created_at": "2026-03-06T10:00:00Z",
  "updated_at": "2026-03-06T12:00:00Z"
}
```

| Field                | Type            | Description                                      |
|----------------------|-----------------|--------------------------------------------------|
| `id`                 | string          | UUID                                             |
| `course_instance_id` | string          | UUID of the parent course                        |
| `lesson_id`          | string or null  | UUID of the lesson (null for capstone artifacts) |
| `artifact_type`      | string          | Type of artifact                                 |
| `title`              | string          | Artifact title                                   |
| `content_pointer`    | string or null  | Full content text                                |
| `status`             | string          | Current artifact status                          |
| `skills`             | string[]        | Skills demonstrated                              |
| `audience`           | string or null  | Intended audience                                |
| `employer_use_case`  | string or null  | Employer relevance description                   |
| `resume_bullet_seed` | string or null  | Suggested resume bullet point                    |
| `created_at`         | string          | ISO 8601 timestamp                               |
| `updated_at`         | string          | ISO 8601 timestamp                               |

**Error responses:**
- `404 Not Found` -- `{"detail": "Artifact not found"}`

---

#### `PATCH /api/portfolio/{artifact_id}`

Update an artifact's title or status.

**Auth:** Required

**Path parameters:**

| Param         | Type   | Description              |
|---------------|--------|--------------------------|
| `artifact_id` | string | UUID of the artifact     |

**Request body** (all fields optional):

```json
{
  "title": "Updated Title",
  "status": "tool_ready"
}
```

| Field    | Type           | Required | Description                                    |
|----------|----------------|----------|------------------------------------------------|
| `title`  | string or null | No       | New artifact title                             |
| `status` | string or null | No       | New status (must be one of: draft, revised, portfolio_ready, tool_ready) |

**Response:** `200 OK` -- Same shape as `GET /api/portfolio/{artifact_id}`.

**Error responses:**
- `404 Not Found` -- `{"detail": "Artifact not found"}`
- `400 Bad Request` -- `{"detail": "Invalid status. Must be one of: {...}"}`

---

## Common Error Responses

All error responses follow FastAPI's standard format:

```json
{
  "detail": "Human-readable error message"
}
```

For validation errors (422), the format includes field-level details:

```json
{
  "detail": [
    {
      "type": "value_error",
      "loc": ["body", "objectives"],
      "msg": "Value error, At least one learning objective is required",
      "input": [],
      "ctx": {"error": "At least one learning objective is required"}
    }
  ]
}
```

### Standard HTTP Status Codes Used

| Code | Meaning                  | When                                              |
|------|--------------------------|---------------------------------------------------|
| 200  | OK                       | Successful request                                |
| 400  | Bad Request              | Invalid state transition, business logic error    |
| 401  | Unauthorized             | Missing, invalid, or expired JWT token            |
| 404  | Not Found                | Resource not found or not owned by current user   |
| 409  | Conflict                 | Duplicate resource (e.g., email already registered) |
| 422  | Unprocessable Entity     | Request body validation failure                   |
| 500  | Internal Server Error    | Unhandled server error                            |
