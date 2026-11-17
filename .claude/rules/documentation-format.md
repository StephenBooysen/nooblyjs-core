---
type: Rule
title: Documentation follows the Open Knowledge Format (OKF)
description: All project documentation follows the Open Knowledge Format, v0.2 (https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).
---

# Documentation follows the Open Knowledge Format (OKF)

All project documentation follows the Open Knowledge Format, v0.2
(https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).
Read the spec before writing or restructuring a document.

## Rules for every concept document (`*.md`, except reserved names)

- Start the file with a YAML frontmatter block between `---` lines.
- Set `type` to a short, descriptive, non-empty string (e.g. `Guide`, `Reference`,
  `Rule`, `Skill`, `Feature Spec`, `Release Notes`). It is the only required key.
- Recommended keys: `title`, `description` (one sentence), `tags` (list). Add `resource`
  only when the doc describes a concrete asset with a canonical URI.
- Keep the body as structured markdown (headings, lists, tables, fenced code).
- Draw every diagram (architecture, flow, sequence, layers, dependencies, state, layout)
  as a ```` ```mermaid ```` block, never as ASCII or box-drawing art. Directory trees,
  command listings and code samples are not diagrams and stay as plain text.
- Use relative markdown links between concepts.
- Extra producer-defined keys are allowed; do not invent fields the spec does not
  need.

## Reserved filenames

- `index.md` lists a directory's contents (`* [Title](relative-url) - description`),
  with no frontmatter (the bundle-root `index.md` may carry `okf_version`).
- `log.md` records dated changes, newest first, with `## YYYY-MM-DD` headings.
- No other concept document may be named `index.md` or `log.md`.

## Scope and exceptions

- Applies to every markdown document in the repo except the exclusions below: `.claude/`
  (rules, skills, steering, learning), `src/**/*.md`, `examples/`, `tests/fixtures/`.
- Root docs (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `CLAUDE.md`) are excluded:
  they render on GitHub and stay as they are.
- `public/index.md` is excluded: it is a site page source in a page-builder format, not
  documentation, and it uses a reserved filename.
- Generated output under `.temp/` and `node_modules/` is out of scope.
- Folders that hold test data or generated scaffolding (`tests/fixtures/knowledge/docs/`,
  `src/cli/templates/`) get frontmatter but no `index.md`, so that the knowledge tests and
  generated apps see no extra files.
- Tool-consumed files are not documentation: `SKILL.md` keeps the frontmatter its
  skill loader requires (`name`, `description`). Add `type` alongside those keys.

## Why

OKF is the house format so that people and agents read the same, diffable, portable
knowledge. Conformance means: every concept file has parseable frontmatter with a
non-empty `type`.
