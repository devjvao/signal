# Commit Message Rules

All commits must follow the Conventional Commits specification.

## Format

<type>(<scope>): <short summary>

### Examples

* feat(api): add health check endpoint
* feat(web): create initial button component
* fix(auth): handle expired JWT tokens
* refactor(database): simplify repository layer
* docs(readme): update local development instructions
* chore(ci): add GitHub Actions workflow

## Allowed Types

* feat: New functionality or user-facing capability
* fix: Bug fixes
* refactor: Code changes that neither add features nor fix bugs
* perf: Performance improvements
* docs: Documentation changes
* test: Adding or updating tests
* build: Changes to build tooling or dependencies
* ci: Changes to CI/CD pipelines
* chore: Maintenance tasks, configuration, or housekeeping
* style: Formatting changes with no behavioral impact

## Summary Rules

* Use lowercase.
* Use imperative mood (e.g., "add", "update", "remove", "refactor").
* Keep the summary under 72 characters when possible.
* Do not end the summary with a period.
* Focus on the outcome of the change, not the implementation details.

## Commit Body Rules

When a commit affects multiple areas, include a body using bullet points.

Example:

feat(signal): bootstrap project structure

* add Docker Compose configuration for local PostgreSQL
* create signal-api with Gin, SQLC, and golang-migrate
* implement health check endpoint
* create signal-web with React, TypeScript, Vite, and Tailwind
* add initial shadcn/ui Button component
* add project documentation
* update CLAUDE.md prompt logging rules

## Commit Splitting

Prefer multiple focused commits over a single large commit.

Good:

* feat(api): add health check endpoint
* feat(web): create button component
* docs(readme): add project setup instructions
* chore(docker): add local PostgreSQL container

Avoid combining unrelated changes into a single commit whenever possible.

## Pull Request Descriptions

When generating PR descriptions:

* Start with a short summary paragraph.
* Follow with a "Changes" section.
* Use bullet points.
* Group changes by area (API, Web, Database, Infrastructure, Documentation).
* Do not use long prose paragraphs to describe multiple changes.

## Authorship

Do not add `Co-authored-by` trailers or any attribution to Claude or AI models in commits or PR descriptions.

The code is reviewed and owned by the human developer. AI is used as a development tool, not as a co-author.
