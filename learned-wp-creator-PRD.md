# 1111 Learn Creator — Product Requirements Document

## WordPress Plugin for AI-Powered Course Content Creation

**Version:** 0.1.0-draft
**Date:** 2026-03-09
**Status:** Draft — awaiting review

---

## 1. Overview

**1111 Learn Creator** is a WordPress plugin that adds a "Learn" custom post type and a "Courses" taxonomy. An administrator enters a course title, description, and learning objectives into a dashboard interface. Two AI agents (powered by the Anthropic Claude API) then generate a structured learning plan and full lesson content, which are saved as WordPress posts within the Learn post type, organized under the appropriate Courses taxonomy term.

This plugin is **content-creation only** — it does not include assessments, learner profiles, progress tracking, or any learner-facing interactive features. Those concerns belong to a future companion plugin (1111 Learn Administrator).

---

## 2. Goals

1. Let a WordPress administrator create a complete, structured course from three inputs: title, description, and learning objectives.
2. Generate pedagogically sound lesson content using AI agents, with prompts stored as editable Markdown files so non-developers can iterate on output quality.
3. Produce standard WordPress posts (custom post type `learn`) organized under a `course` taxonomy — compatible with any theme, page builder, or LMS plugin.
4. Keep the plugin self-contained: no build step, no JavaScript framework, no external dependencies beyond the Anthropic API.
5. Meet WCAG 2.1 AA accessibility standards in all admin UI.

---

## 3. User Personas

### 3.1 Course Creator (WordPress Administrator)
- Has WordPress admin access
- Knows the subject matter and can write learning objectives
- May not be technical — needs a simple, guided interface
- Wants to review and edit generated content before publishing

### 3.2 Plugin Developer (future)
- Edits agent prompts in Markdown files to refine output quality
- Extends the plugin with new agents or post types

---

## 4. Architecture

### 4.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────┐
│                   WordPress Admin                        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         1111 Learn Creator Dashboard              │   │
│  │                                                    │   │
│  │  Title: [___________________________]              │   │
│  │  Description: [_____________________]              │   │
│  │  Learning Objectives:                              │   │
│  │    1. [_____________________________]              │   │
│  │    2. [_____________________________]              │   │
│  │    3. [_____________________________]              │   │
│  │                                                    │   │
│  │  [Generate Course]                                 │   │
│  └──────────────────────────────────────────────────┘   │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐     ┌──────────────────────┐          │
│  │ Course Plan   │────▶│ Lesson Content        │          │
│  │ Agent         │     │ Agent                 │          │
│  │ (Claude API)  │     │ (Claude API)          │          │
│  └──────────────┘     └──────────────────────┘          │
│         │                       │                        │
│         ▼                       ▼                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  WordPress Posts (CPT: learn, Taxonomy: course)   │   │
│  │                                                    │   │
│  │  Course Term: "Web Accessibility Fundamentals"     │   │
│  │    ├── Lesson 1: Research — Identifying Barriers   │   │
│  │    ├── Lesson 2: Practice — Running Audits         │   │
│  │    ├── Lesson 3: Draft — Writing Recommendations   │   │
│  │    └── Lesson 4: Deliver — Final Audit Report      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Custom Post Type: `learn`

| Property | Value |
|----------|-------|
| Post type slug | `learn` |
| Label (singular) | Lesson |
| Label (plural) | Lessons |
| Public | `true` |
| Has archive | `true` |
| Supports | `title`, `editor`, `excerpt`, `thumbnail`, `custom-fields`, `revisions` |
| Show in REST | `true` (Gutenberg compatible) |
| Menu icon | `dashicons-welcome-learn-more` |
| Menu position | 25 (below Comments) |

### 4.3 Custom Taxonomy: `course`

| Property | Value |
|----------|-------|
| Taxonomy slug | `course` |
| Label (singular) | Course |
| Label (plural) | Courses |
| Hierarchical | `false` (flat, like tags — courses don't nest) |
| Public | `true` |
| Show in REST | `true` |
| Associated post type | `learn` |

### 4.4 AI Agents

Two agents handle content generation. Both use the Anthropic Claude API. The admin provides their own API key.

#### Agent 1: Course Plan Agent

**Purpose:** Given a course title, description, and learning objectives, generate a structured lesson plan (lesson titles, types, goals, and sequencing).

**Model:** `claude-haiku-4-5-20251001` (fast, cost-effective)

**Prompt file:** `prompts/course-plan.md`

**Input (user message):**
```json
{
  "course": {
    "title": "Web Accessibility Fundamentals",
    "description": "Learn to identify, evaluate, and address common web accessibility barriers.",
    "learningObjectives": [
      "Identify common accessibility barriers on web pages",
      "Use browser developer tools to run basic accessibility audits",
      "Propose concrete fixes for the accessibility issues you find"
    ]
  }
}
```

**Expected output:**
```json
{
  "lessons": [
    {
      "id": "lesson-1",
      "objectiveIndex": 0,
      "type": "explore",
      "title": "Identifying Common Accessibility Barriers",
      "goal": "Research the most common types of web accessibility barriers and document examples of each"
    },
    {
      "id": "lesson-2",
      "objectiveIndex": 1,
      "type": "apply",
      "title": "Running Your First Accessibility Audit",
      "goal": "Practice using browser accessibility tools to audit a live website"
    },
    {
      "id": "lesson-3",
      "objectiveIndex": 2,
      "type": "create",
      "title": "Writing Actionable Fix Recommendations",
      "goal": "Draft specific, prioritized recommendations for the issues found in your audit"
    },
    {
      "id": "lesson-4",
      "objectiveIndex": 2,
      "type": "final",
      "title": "Complete Accessibility Audit Report",
      "goal": "Compile your research, audit findings, and recommendations into a polished report"
    }
  ],
  "rationale": "Brief explanation of the pedagogical approach and sequencing"
}
```

**Lesson types** (mapped from the existing learn extension):

| Type | Label | Purpose |
|------|-------|---------|
| `explore` | Research | Investigate a topic and synthesize findings |
| `apply` | Practice | Apply a skill hands-on |
| `create` | Draft | Build, revise, or expand on earlier work |
| `final` | Deliver | Polish and finalize the deliverable |

#### Agent 2: Lesson Content Agent

**Purpose:** Given a single lesson from the plan, generate full lesson content (introduction, body sections, key takeaways, further reading).

**Model:** `claude-haiku-4-5-20251001`

**Prompt file:** `prompts/lesson-content.md`

**Input (user message):**
```json
{
  "course": {
    "title": "Web Accessibility Fundamentals",
    "description": "Learn to identify, evaluate, and address...",
    "learningObjectives": ["...", "...", "..."]
  },
  "lesson": {
    "id": "lesson-1",
    "objectiveIndex": 0,
    "type": "explore",
    "title": "Identifying Common Accessibility Barriers",
    "goal": "Research the most common types of web accessibility barriers and document examples of each"
  },
  "lessonIndex": 0,
  "totalLessons": 4,
  "priorLessons": []
}
```

**Expected output:**
```json
{
  "title": "Identifying Common Accessibility Barriers",
  "excerpt": "One-sentence summary for the post excerpt",
  "content": "Full lesson content in HTML (WordPress editor-compatible)",
  "keyTakeaways": [
    "Takeaway 1",
    "Takeaway 2",
    "Takeaway 3"
  ],
  "furtherReading": [
    {
      "title": "Resource title",
      "url": "https://example.com",
      "description": "Why this resource is useful"
    }
  ]
}
```

**Content format:**
- Output is valid HTML suitable for the WordPress block editor
- Uses semantic headings (`<h2>`, `<h3>`), paragraphs, lists, and blockquotes
- No inline styles — relies on theme styling
- Includes practical examples and actionable steps
- Length: 800–1500 words per lesson

### 4.5 Output Validation

Before saving generated content to WordPress, the plugin validates agent output:

**Course Plan validation:**
- `lessons` is a non-empty array
- Each lesson has `id`, `objectiveIndex`, `type`, `title`, `goal`
- `type` is one of: `explore`, `apply`, `create`, `final`
- Last lesson must be type `final`
- `objectiveIndex` values reference valid learning objectives
- No unsafe content patterns

**Lesson Content validation:**
- Has `title` (string), `content` (string), `excerpt` (string)
- `content` is non-empty and contains HTML block elements
- `keyTakeaways` is a non-empty array of strings
- No unsafe content patterns

On validation failure, the agent call is retried once. If retry also fails, the admin is shown an error with the option to retry manually.

---

## 5. Plugin File Structure

```
learned-wp-creator/
├── 1111-learn-creator.php          Main plugin file (plugin header, bootstrap)
├── README.md                       Plugin readme (WordPress-style + GitHub)
├── CLAUDE.md                       AI coding assistant instructions
├── LICENSE                         GPL v2+
├── uninstall.php                   Clean removal of plugin data
│
├── includes/
│   ├── class-post-type.php         Registers CPT and taxonomy
│   ├── class-api-client.php        Anthropic API HTTP client
│   ├── class-orchestrator.php      Agent orchestration and validation
│   ├── class-admin-page.php        Dashboard page registration and rendering
│   └── class-settings.php          Settings page (API key, model config)
│
├── admin/
│   ├── css/
│   │   └── admin.css               Dashboard styles
│   ├── js/
│   │   └── admin.js                Dashboard interactivity (AJAX, form handling)
│   └── views/
│       ├── dashboard.php           Course creation form template
│       ├── settings.php            Settings page template
│       └── generating.php          Generation progress template (partial)
│
├── prompts/
│   ├── course-plan.md              System prompt for Course Plan Agent
│   └── lesson-content.md           System prompt for Lesson Content Agent
│
└── assets/
    └── icon.svg                    Plugin icon / branding
```

---

## 6. Admin Dashboard UI

### 6.1 Top-Level Menu

The plugin adds a top-level admin menu item:

- **Menu title:** 1111 Learn
- **Icon:** `dashicons-welcome-learn-more`
- **Submenu items:**
  - **Dashboard** — Course creation form
  - **All Lessons** — Standard CPT list view (WordPress default)
  - **Courses** — Taxonomy management (WordPress default)
  - **Settings** — API key and model configuration

### 6.2 Dashboard Page — Course Creation Form

**Fields:**

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Course Title | Text input | Required, max 200 chars | Becomes the taxonomy term name |
| Course Description | Textarea | Required, max 1000 chars | Stored as taxonomy term description |
| Learning Objectives | Repeater (text inputs) | Min 2, max 6 items; each max 300 chars | Each objective is a single sentence |

**Interaction flow:**

1. Admin fills in the three fields and clicks **Generate Course**.
2. Form validates client-side. If invalid, inline errors appear next to fields.
3. On valid submission, an AJAX request sends data to the server.
4. The dashboard shows a progress view:
   - Step 1 of 2: "Generating lesson plan..." (spinner + accessible status)
   - Step 2 of 2: "Generating lesson content..." (progress bar: "Lesson 1 of 4")
5. On completion, a success message with links to:
   - View the course archive page
   - Edit individual lessons
   - Return to dashboard to create another course
6. On error, an error message with:
   - What went wrong (API error, validation failure, etc.)
   - A **Retry** button that resumes from the failed step

**Accessibility requirements:**
- All form fields have associated `<label>` elements
- Error messages are announced via `aria-live="polite"` regions
- Progress updates are announced via `aria-live="polite"`
- The Generate button shows a loading state with `aria-busy="true"` and descriptive `aria-label`
- All interactive elements are keyboard-operable
- Focus management: on error, focus moves to the first invalid field; on success, focus moves to the success message
- Color is never the sole indicator of state — icons and text accompany all status changes

### 6.3 Settings Page

**Fields:**

| Field | Type | Notes |
|-------|------|-------|
| Anthropic API Key | Password input | Stored encrypted in `wp_options`. Masked in UI. |
| Plan Agent Model | Select | Default: `claude-haiku-4-5-20251001`. Options include available Claude models. |
| Content Agent Model | Select | Default: `claude-haiku-4-5-20251001`. Options include available Claude models. |
| Max Tokens (Plan) | Number input | Default: 2048. Range: 512–4096. |
| Max Tokens (Content) | Number input | Default: 4096. Range: 1024–8192. |

Settings are saved using the WordPress Settings API with proper nonce verification and capability checks.

---

## 7. Data Model

### 7.1 Taxonomy Term Meta (Course)

When a course is generated, these term meta values are stored on the `course` taxonomy term:

| Meta key | Type | Description |
|----------|------|-------------|
| `_1111_learning_objectives` | `array` | Original learning objectives entered by admin |
| `_1111_course_description` | `string` | Original course description |
| `_1111_generation_date` | `string` | ISO 8601 timestamp of generation |
| `_1111_lesson_plan` | `array` | Raw lesson plan from Course Plan Agent |
| `_1111_rationale` | `string` | Agent's rationale for the plan structure |

### 7.2 Post Meta (Lesson)

Each generated lesson post carries these meta values:

| Meta key | Type | Description |
|----------|------|-------------|
| `_1111_lesson_id` | `string` | Unique lesson ID from plan (e.g., `lesson-1`) |
| `_1111_lesson_type` | `string` | `explore`, `apply`, `create`, or `final` |
| `_1111_lesson_goal` | `string` | One-sentence lesson goal |
| `_1111_objective_index` | `int` | Index of the learning objective this lesson addresses |
| `_1111_lesson_order` | `int` | Sort order within the course (0-based) |
| `_1111_key_takeaways` | `array` | Key takeaways from the lesson |
| `_1111_further_reading` | `array` | Further reading links (title, url, description) |
| `_1111_generated` | `bool` | `true` if AI-generated (vs. manually created) |

### 7.3 Options (wp_options)

| Option key | Description |
|------------|-------------|
| `1111_learn_api_key` | Encrypted Anthropic API key |
| `1111_learn_plan_model` | Model ID for Course Plan Agent |
| `1111_learn_content_model` | Model ID for Lesson Content Agent |
| `1111_learn_plan_max_tokens` | Max tokens for plan generation |
| `1111_learn_content_max_tokens` | Max tokens for content generation |

---

## 8. API Client

### 8.1 Anthropic API Integration

The plugin communicates with the Anthropic Messages API (`https://api.anthropic.com/v1/messages`).

**Request structure:**
```php
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {stored_api_key}
  anthropic-version: 2023-06-01
  content-type: application/json

Body:
{
  "model": "{configured_model}",
  "max_tokens": {configured_max_tokens},
  "system": "{contents_of_prompt_md_file}",
  "messages": [
    {
      "role": "user",
      "content": "{json_encoded_input}"
    }
  ]
}
```

**Error handling:**
- 401: Invalid API key — prompt admin to check settings
- 429: Rate limited — show "Rate limited, please wait and retry" message
- 5xx: Server error — allow retry
- Timeout: 60-second timeout via `wp_remote_post` — allow retry
- Parse error: Agent returned non-JSON — retry once automatically

### 8.2 Security

- API key is stored encrypted in `wp_options` using WordPress's built-in encryption (or `sodium_crypto_secretbox` if available, falling back to `AUTH_KEY`-based encryption)
- API key is never exposed in client-side JavaScript — all API calls happen server-side via AJAX handlers
- All AJAX endpoints verify nonces and `manage_options` capability
- Prompt files are loaded from the plugin directory, never from user input

---

## 9. Generation Pipeline (Server-Side)

### 9.1 AJAX Endpoint: `1111_generate_course`

**Request (POST):**
```json
{
  "action": "1111_generate_course",
  "nonce": "wp_nonce_value",
  "title": "Web Accessibility Fundamentals",
  "description": "Learn to identify, evaluate...",
  "objectives": [
    "Identify common accessibility barriers",
    "Use browser developer tools for audits",
    "Propose concrete fixes"
  ]
}
```

**Pipeline steps:**

1. **Validate input** — check required fields, lengths, sanitize
2. **Create taxonomy term** — add `course` term with title and description
3. **Call Course Plan Agent** — send course data, receive lesson plan
4. **Validate plan output** — schema check, retry once on failure
5. **Store plan metadata** — save raw plan on taxonomy term meta
6. **For each lesson in plan:**
   a. **Call Lesson Content Agent** — send lesson context, receive content
   b. **Validate content output** — schema check, retry once on failure
   c. **Create `learn` post** — title, content, excerpt, meta, taxonomy assignment
   d. **Send progress update** — via streaming response or polling endpoint
7. **Return success** — with links to created content

### 9.2 Progress Reporting

Because lesson generation takes time (4–8 API calls), progress is reported to the admin UI. Two implementation options (choose during development based on hosting compatibility):

**Option A: Server-Sent Events (SSE)**
- Endpoint streams progress events as lessons are generated
- Simpler client code, real-time updates
- Requires server to support long-running requests

**Option B: Polling**
- Generation runs as a background process (via `wp_schedule_single_event` or transient-based state)
- Client polls a status endpoint every 2 seconds
- More compatible with shared hosting environments

The admin JS (`admin/js/admin.js`) handles either approach and updates the progress UI accordingly.

---

## 10. Lesson Post Creation Details

When creating each lesson as a WordPress post:

| Post field | Value |
|------------|-------|
| `post_type` | `learn` |
| `post_title` | Lesson title from agent |
| `post_content` | Full HTML content from agent |
| `post_excerpt` | Excerpt from agent |
| `post_status` | `draft` (admin reviews before publishing) |
| `menu_order` | Lesson index (for ordering) |
| `tax_input` | Assigned to the course taxonomy term |

Posts are created as **drafts** so the admin can review, edit, and publish at their discretion.

---

## 11. Prompt Files

Prompts are stored as Markdown files in the `prompts/` directory. They are loaded at runtime via `file_get_contents()` from the plugin directory.

### 11.1 Why Markdown Files?

- **Editable by non-developers:** Subject-matter experts can tweak prompts without touching PHP
- **Version controlled:** Changes are tracked in git
- **Testable independently:** Prompts can be tested outside WordPress with any Claude client
- **Hot-reloadable:** No cache to clear — changes take effect on next generation

### 11.2 Prompt File Conventions

Each prompt file follows this structure:

```markdown
# Agent Name

## Role
One-sentence role description.

## Input
Description of the JSON input the agent receives.

## Output Format
Exact JSON schema the agent must return. No markdown fencing, no commentary.

## Rules
Numbered list of constraints and requirements.

## Examples
One or two input/output examples.
```

### 11.3 Prompt Files to Create

| File | Agent | Purpose |
|------|-------|---------|
| `prompts/course-plan.md` | Course Plan Agent | Generate lesson plan from course metadata |
| `prompts/lesson-content.md` | Lesson Content Agent | Generate full lesson content for one lesson |

---

## 12. Accessibility Requirements

All admin UI must meet WCAG 2.1 AA. Specific requirements:

1. **Form inputs:** Every input has a visible `<label>` with `for` attribute matching the input `id`.
2. **Error messages:** Inline errors are associated with inputs via `aria-describedby`. Error summary uses `role="alert"`.
3. **Progress updates:** Generation progress is conveyed via `aria-live="polite"` region. Spinners have `aria-label` text.
4. **Focus management:** After form submission, focus moves to the progress/result area. After error, focus moves to the first invalid field.
5. **Keyboard navigation:** All interactive elements (buttons, inputs, links) are reachable and operable via keyboard. Custom controls use appropriate ARIA roles.
6. **Color independence:** Status indicators use icons and text in addition to color (e.g., a checkmark icon + "Complete" text, not just a green dot).
7. **Screen reader announcements:** Dynamic content changes (progress, errors, success) are announced to screen readers.
8. **Sufficient contrast:** All text meets 4.5:1 contrast ratio against its background.
9. **Responsive layout:** Dashboard is usable on smaller screens (min-width: 782px, matching WordPress admin breakpoints).

---

## 13. Security Requirements

1. **Capability checks:** All admin pages and AJAX handlers require `manage_options` capability.
2. **Nonce verification:** All form submissions and AJAX requests are nonce-protected.
3. **Input sanitization:** All user input is sanitized with `sanitize_text_field()`, `sanitize_textarea_field()`, or `wp_kses_post()` as appropriate.
4. **Output escaping:** All output is escaped with `esc_html()`, `esc_attr()`, `esc_url()`, or `wp_kses_post()` as appropriate.
5. **API key storage:** Encrypted at rest in `wp_options`, never exposed in client-side code or debug logs.
6. **No direct file access:** All PHP files check `defined('ABSPATH')` to prevent direct access.
7. **Content sanitization:** Generated lesson content is run through `wp_kses_post()` before saving to strip disallowed HTML.

---

## 14. Non-Goals (Explicitly Out of Scope)

These features are intentionally excluded from 1111 Learn Creator and may be addressed by future plugins:

1. **Assessments** — No quizzes, tests, scoring, or evaluation of learner work
2. **Learner profiles** — No tracking of individual learner progress or preferences
3. **Progress tracking** — No completion tracking, progress bars, or status indicators for learners
4. **Frontend interactive features** — No JavaScript-driven learner interactions on the frontend
5. **User roles / enrollment** — No custom roles, enrollment flows, or access restrictions
6. **Certificates or badges** — No completion rewards
7. **LMS integration** — No direct integration with LearnDash, LifterLMS, etc. (though generated posts are compatible)
8. **Multi-site support** — Single-site only for v1
9. **Internationalization** — English only for v1 (but all strings should use `__()` / `_e()` for future translation readiness)
10. **Telemetry** — No usage tracking or data collection in v1

---

## 15. Future: 1111 Learn Administrator (Companion Plugin)

A planned companion plugin will add:

- Learner-facing course navigation and progress tracking
- Assessment integration (manual and AI-powered)
- Learner profiles and adaptive content
- Enrollment and access control
- Analytics dashboard for administrators
- Integration with the `learn` CPT and `course` taxonomy created by this plugin

The Learn Creator plugin is designed so the Administrator plugin can build on top of its data structures without modifications.

---

## 16. Development Guidelines

1. **No build step.** The plugin ships as-is — no Webpack, no Sass, no npm. Vanilla PHP, JS, and CSS.
2. **WordPress coding standards.** Follow [WordPress PHP Coding Standards](https://developer.wordpress.org/coding-standards/wordpress-coding-standards/php/) and [JavaScript Coding Standards](https://developer.wordpress.org/coding-standards/wordpress-coding-standards/javascript/).
3. **Minimum requirements:** WordPress 6.0+, PHP 8.0+.
4. **Prefix everything.** All functions, classes, hooks, and options use the `_1111_learn_` or `Learn_Creator_` prefix to avoid conflicts.
5. **No Composer dependencies.** The API client uses `wp_remote_post()` — no external HTTP libraries.
6. **Hooks and filters.** Expose key extension points so other plugins can modify behavior:
   - `1111_learn_before_plan_generation` — filter course data before sending to agent
   - `1111_learn_plan_generated` — action after plan is generated
   - `1111_learn_before_lesson_generation` — filter lesson context before sending to agent
   - `1111_learn_lesson_generated` — action after each lesson is created
   - `1111_learn_course_completed` — action after all lessons are created
   - `1111_learn_validate_plan` — filter to add custom plan validation
   - `1111_learn_validate_lesson` — filter to add custom lesson validation
7. **Prompts are data, not code.** Agent prompts live in `prompts/*.md` and are loaded at runtime. They can be edited without touching PHP.

---

## 17. Implementation Phases

### Phase 1: Foundation
- [ ] Plugin bootstrap file with proper headers
- [ ] Register `learn` custom post type
- [ ] Register `course` taxonomy
- [ ] Settings page with API key storage
- [ ] `CLAUDE.md` for the new repo

### Phase 2: API Client and Orchestrator
- [ ] Anthropic API HTTP client class
- [ ] Prompt file loader
- [ ] Orchestrator class with validation logic
- [ ] Course Plan Agent prompt (`prompts/course-plan.md`)
- [ ] Lesson Content Agent prompt (`prompts/lesson-content.md`)

### Phase 3: Admin Dashboard
- [ ] Dashboard page registration and routing
- [ ] Course creation form (title, description, objectives repeater)
- [ ] Client-side validation
- [ ] AJAX handler for course generation
- [ ] Progress reporting UI
- [ ] Success / error states

### Phase 4: Content Generation Pipeline
- [ ] Wire dashboard form to orchestrator
- [ ] Create taxonomy term on generation
- [ ] Generate and validate lesson plan
- [ ] Generate and validate lesson content (per lesson)
- [ ] Create draft posts with meta and taxonomy assignment
- [ ] Handle errors and retries

### Phase 5: Polish
- [ ] Accessibility audit and fixes
- [ ] Security audit (nonces, capabilities, sanitization, escaping)
- [ ] Uninstall cleanup (`uninstall.php`)
- [ ] README.md with install instructions
- [ ] Testing with real API key and various course inputs

---

## 18. Success Criteria

1. An administrator can generate a complete course (4–8 lessons) from title + description + objectives in under 2 minutes.
2. Generated lessons are well-structured, pedagogically sequenced, and ready to publish after light editing.
3. All generated content is saved as standard WordPress posts — viewable in any theme, editable in the block editor.
4. The plugin installs with zero configuration beyond entering an API key.
5. All admin UI passes a WCAG 2.1 AA accessibility audit.
6. Agent prompts can be modified and changes take effect immediately with no code changes.
