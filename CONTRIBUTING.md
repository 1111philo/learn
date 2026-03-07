# Contributing to 1111

Thank you for your interest in contributing. This project is maintained by [11:11 Philosopher's Group](https://github.com/1111philo).

## Getting started

1. Fork and clone the repository.
2. Load the extension in Chrome using developer mode (see README.md).
3. Make your changes and test them in the side panel.

## Development workflow

- There is no build step. Edit the source files directly and reload the extension in `chrome://extensions`.
- All source is vanilla JS (ES modules), CSS, and HTML.
- Course definitions live in `data/courses.json`.

## Guidelines

- **Accessibility is required.** Every interactive element must be keyboard-operable and have an accessible name. Test with a screen reader when adding UI.
- **Keep it lightweight.** No frameworks, no heavy dependencies. The app must perform well on Chromebooks and Android tablets.
- **Local-first.** Do not add code that sends user data (screenshots, URLs, draft records) to a remote server unless behind an explicit, user-controlled opt-in.
- **Update documentation.** If your change adds, removes, or renames a feature, file, or permission, update README.md and CLAUDE.md accordingly.

## Submitting changes

1. Create a branch from `main`.
2. Make focused, well-described commits.
3. Open a pull request with a clear summary of what changed and why.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
