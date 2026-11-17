// Compiled by types/tsconfig.json: the named ESM exports resolve to the registry's methods.
import registry, { aiservice, cache, knowledge } from '../../esm/index.mjs';

const ai = aiservice('mock', { apiKey: 'k' });
const text: Promise<unknown> = ai.prompt('hi');
void text;
const c = cache('memory');
void c;
void knowledge;
void registry;
