# Contributing to Tabs on Hold

Contributions are welcome. Bug reports, documentation improvements, accessibility fixes, and focused code changes all help make Tabs on Hold better.

## Report a bug or suggest an improvement

[Open an issue](https://github.com/sajjadalis/tabs-on-hold/issues) and describe what you expected, what happened, and how to reproduce it. For bugs, include your Chrome version and extension version.

Check existing issues first. For a substantial feature or design change, discuss the idea in an issue before starting so the scope is clear.

Review screenshots before sharing them. Do not post private URLs, personal browser data, or backup files in public issues.

## Make a change

1. Fork the repository and create a branch for your change.
2. Follow [Development](docs/development.md) for requirements, installation, and local commands.
3. Keep the change focused and follow the existing TypeScript, React, and Prettier patterns.
4. Update the relevant documentation when behavior or user workflows change.
5. Run the checks appropriate to your change, then open a pull request.

Use npm and the checked-in lockfile. Add dependencies only when the change needs them. Leave release versions and generated build files out of your pull request unless the work specifically requires them.

## Protect saved libraries

Preserve existing saved tabs, sessions, and screenshot previews. Keep related database writes atomic, and keep asynchronous image processing outside write transactions.

Use isolated browser profiles and synthetic data for tests. Do not use personal browser libraries, private backups, or other personal data as test fixtures. See the [backup format](docs/backup-format.md) before changing import or export behavior.

## Validate your change

For application changes, run TypeScript checks, relevant unit tests, and the production build. Changes to capture, restore, storage, backups, or substantial extension UI also need the isolated browser suite after building.

For documentation changes, check formatting and links and build the documentation site. The exact commands and browser setup are in [Development](docs/development.md#checks).

Add regression coverage for bugs and important failure paths. Prefer checks that demonstrate the behavior users depend on.

## Open a pull request

Explain the problem, the resulting behavior, and the checks you ran. Include screenshots for visible UI changes where they help reviewers understand the result. Mention any remaining limitations or related issues.

Keep discussion respectful and constructive. Contributions are made under the repository’s [MIT License](LICENSE).
