---
type: Rule
title: 'Branding: NooblyJS only'
description: This project is NooblyJS / nooblyjs-core (github.com/nooblyjs/nooblyjs-core).
---

# Branding: NooblyJS only

This project is NooblyJS / `nooblyjs-core` (github.com/nooblyjs/nooblyjs-core). Never introduce Shoprite, S-Tech / STECH or "Digital Technologies (Core)" names, logos, Bitbucket URLs or `@shoprite.co.za` addresses — including in code copied from other forks.

Naming conventions:
- Prose and PascalCase identifiers: `NooblyJS` (e.g. `NooblyJSNavigation`, "NooblyJS Core").
- Lowercase identifiers and browser globals: `nooblyjs` (e.g. `nooblyjslogging`, `nooblyjsCaching`).
- Queue names and option keys: `nooblyjs-core-*` (e.g. `nooblyjs-core-working-incoming`, `nooblyjs-core-activities`).
- CSS namespaces: `njsc-` (schedule manager), `njwf-` (workflow manager); injected style IDs `nooblyjs-*-ui-styles`.
- Logo: `/images/nooblyjs-logo.png`; test apps serve their local `nooblyjs-core.png` at that path.
