# 1111

An agentic learning app that runs entirely in the Chrome side panel. Built by [11:11 Philosopher's Group](https://github.com/1111philo).

## What it does

1111 guides learners through predefined courses via a chat-like interface. Each course produces one final work product. All data stays on the user's device.

### Key features

- **Course catalog** with prerequisite checking
- **Activity generation** from course learning objectives, adapted to the learner's experience level
- **Draft recording** — captures a screenshot of the active tab, the page URL, and structured self-assessment feedback, stored together as a single draft record
- **Iterative feedback** — each activity builds on prior drafts and feedback so the learner progresses toward a stronger result
- **Final assessment** — the final work product must meet a minimum passing threshold before the course is marked complete
- **Work section** — completed work products are saved as links for easy reference
- **JSON export** — export all saved data (metadata + screenshots) at any time
- **Fully local** — screenshots are stored in IndexedDB; metadata (progress, preferences, draft references, URLs, timestamps, feedback) in `chrome.storage.local`. Nothing is sent to a remote server.
- **Accessible** — keyboard-operable, screen-reader-friendly, respects `prefers-reduced-motion` and `forced-colors`
- **Lightweight** — vanilla JS, no frameworks, no build step; designed for Chromebooks and Android tablets

## Install (developer mode)

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `learn-extension` folder.
5. Click the 1111 extension icon to open the side panel.

## File structure

```
learn-extension/
  manifest.json          Chrome extension manifest (Manifest V3)
  background.js          Opens the side panel on icon click
  sidepanel.html         Main UI entry point
  sidepanel.css          Styles
  js/
    app.js               App shell, routing, views, event handling
    storage.js           chrome.storage.local + IndexedDB abstraction
    courses.js           Course loading and activity generation
    assessment.js        Draft assessment and feedback
  data/
    courses.json         Predefined course definitions
```

## Course JSON structure

Each course in `data/courses.json` has:

| Field               | Type       | Description                                      |
|---------------------|------------|--------------------------------------------------|
| `courseId`           | `string`   | Unique identifier                                |
| `name`              | `string`   | Display title                                    |
| `description`       | `string`   | Summary of purpose and expected value            |
| `dependsOn`         | `string?`  | Optional prerequisite course ID                  |
| `learningObjectives`| `string[]` | Outcome statements the course achieves           |
| `estimatedHours`    | `number`   | Approximate total hours to complete              |

## Permissions

| Permission        | Why                                              |
|-------------------|--------------------------------------------------|
| `sidePanel`       | Run the app in the Chrome side panel             |
| `storage`         | Persist metadata locally                         |
| `unlimitedStorage`| Allow large screenshot storage in IndexedDB      |
| `activeTab`       | Capture screenshots and read the active tab URL  |
| `tabs`            | Query tab information for draft recording        |

## License

Copyright (C) 2026 11:11 Philosopher's Group

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
