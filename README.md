<p align="center">
  <img src="assets/logo.svg" alt="1111" width="80" height="80">
</p>

# 1111 Learn

An agentic learning app that runs entirely in the Chrome side panel. Ten AI agents guide learners through courses using assessment-backward design -- you take a summative first, learn from your gaps, then retake to demonstrate mastery. A Guide Agent orients you at every checkpoint.

Built by [11:11 Philosopher's Group](https://github.com/1111philo) in collaboration with [UIC Tech Solutions](https://it.uic.edu/), [UIC TS Open Source Fund](https://osf.it.uic.edu/), [Louisiana Tech](https://www.latech.edu/), and the [ULL Louisiana Educate Program](https://louisiana.edu/educate).

## How it works

1. **Get oriented** -- a Guide Agent introduces the course and your diagnostic assessment
2. **Take a diagnostic** -- the AI generates a multi-step task from unit exemplars and learning objectives; you submit screenshots or text
3. **See your results** -- a gap analysis identifies what you need to learn, mapped to rubric criteria
4. **Learn through activities** -- personalized activities target your weak spots, guided by unit exemplars
5. **Retake and demonstrate mastery** -- scores can only go up (ratchet rule); when all criteria hit "meets" or above, you're done

The Guide Agent orients you at every checkpoint — course intro, after diagnostic results, before your learning path, and before retakes. Everything happens in the browser. Screenshots and text responses are assessed by AI and stored locally. No data leaves your device unless you opt into cloud sync.

## Quick start

```bash
git clone https://github.com/1111philo/learn-extension.git
cd learn-extension
npm install
npm run build
```

Then load `dist/` as an unpacked extension in Chrome (`chrome://extensions` > Developer mode > Load unpacked). Click the extension icon to open the side panel and complete the onboarding wizard.

You'll need an [Anthropic API key](https://console.anthropic.com/) or a 1111 Learn account.

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Architecture](docs/architecture.md) | Agents, storage, content hierarchy, data flow |
| [Agent Lifecycle](docs/agent-lifecycle.md) | Full Phase 0-10 walkthrough: every agent call, its inputs, outputs, and validation |
| [Cloud Sync](docs/cloud-sync.md) | Auth, remote storage, AI provider routing |
| [Releases](docs/releases.md) | CI/CD, versioning, branch protection, permissions, secrets |
| [Contributing](CONTRIBUTING.md) | Dev setup, workflow, guidelines, how to submit changes |
| [Privacy Policy](PRIVACY.md) | What's stored, what's synced, your rights |

## Project structure

```
js/          Service modules (vanilla JS) -- storage, orchestration, auth, sync, validation
src/         React 18 app -- pages, components, contexts, hooks
prompts/     Agent system prompts (markdown) -- edit these to change agent behavior
data/        Course definitions (courses.json)
tests/       Node built-in test runner -- manifest, courses, validators, storage
dist/        Build output (loadable as Chrome extension)
```

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

Key things to know:
- Branch from `staging`, PR into `staging`. Production releases flow from `staging` to `main`.
- Agent prompts are in `prompts/*.md` -- you can change agent behavior without touching code.
- Run `npm test` before submitting. All tests must pass.
- Accessibility is non-negotiable.

## License

Copyright (C) 2026 11:11 Philosopher's Group

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
