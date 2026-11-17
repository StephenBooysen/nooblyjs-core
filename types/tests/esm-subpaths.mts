// Compiled by types/tsconfig.esm.json: the named ESM exports of each subpath type-check.
import { FsStore, SEGMENT, parseMarkdown } from '../../esm/store.mjs';
import { createTestRegistry, installMatchers } from '../../esm/testing.mjs';
import { route, compileRoute } from '../../esm/route-pattern.mjs';
import { createShell, UI_DIR } from '../../esm/shell.mjs';

const store = new FsStore('/tmp/example');
const doc = parseMarkdown<{ title: string }>('---\ntitle: x\n---\nbody');
const title: string = doc.data.title;
void store; void SEGMENT; void title; void UI_DIR; void createShell;
void route('/services/:name(*)'); void compileRoute('/a/:b?');
void createTestRegistry; void installMatchers;
