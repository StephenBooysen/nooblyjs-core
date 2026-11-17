/**
 * @fileoverview Vector (semantic) search example app.
 *
 * Boots the searching service with the `vector` provider, indexes a small
 * knowledge base and demonstrates the three search modes side by side, then
 * leaves the service dashboard running at
 * http://localhost:9000/services/searching/
 *
 * Run it:
 *   node tests/app/searching/app-searching-vector.js
 *
 * It works with no configuration at all. Set OPENAI_API_KEY (or run Ollama
 * locally and set OLLAMA_HOST) to switch it onto real embeddings — see
 * `buildEmbeddingConfig()` below, which is also the worked example of how a
 * consuming system passes AI credentials in.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-08-27
 */

'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { EventEmitter } = require('events');

const app = express();

// Security headers: applied before other middleware so every response is
// covered. CSP is disabled here to match the main apps (app.js / app-noauth.js)
// because the service dashboards use inline styles/scripts; enable a tuned CSP
// per deployment.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

const options = {
  logDir: path.join(__dirname, '../../../.application/', 'logs'),
  dataDir: path.join(__dirname, '../../../.application/', 'data'),
  'express-app': app,
  security: {
    apiKeyAuth: { requireApiKey: false, apiKeys: [] },
    servicesAuth: { requireLogin: false }
  }
};

const eventEmitter = new EventEmitter();
const serviceRegistry = require('../../../index');
serviceRegistry.initialize(app, eventEmitter, options);

const logger = serviceRegistry.logger('file');

// ─── Credentials ────────────────────────────────────────────────────────────
//
// The searching service never reads an API key. It is handed something that
// can already embed, and the consuming system owns the secret. Three ways to
// do that, in order of how much the app takes on:
//
//   1. NOTHING       — the built-in `hash` backend. Offline, deterministic,
//                      free, no key. Matches vocabulary, not meaning, so it is
//                      for development and tests, not production quality.
//
//   2. A FUNCTION    — you supply `embedding.embed`. The closure holds the
//                      key; the search service only ever sees a function.
//                      This is the whole integration surface, and it works
//                      with any provider, including ones this framework has
//                      never heard of.
//
//   3. THE AI SERVICE — the app constructs `serviceRegistry.aiservice(...)`
//                      with its key (as it already does for prompting) and
//                      injects the instance. Not yet available: it needs
//                      `embed()` on the AI providers, which is Phase 2 of the
//                      feature plan. Shown here as the shape it will take.
//
/**
 * Choose an embedding configuration.
 *
 * Selection is an explicit opt-in via `EMBED_BACKEND`, not a sniff of whatever
 * keys happen to be in the environment. An example that quietly picks up an
 * ambient `OPENAI_API_KEY` and starts spending money — or fails behind a
 * corporate TLS proxy, which is what happens on a managed laptop — is a bad
 * example.
 *
 *   EMBED_BACKEND=demo    (default)  offline concept stand-in, see demoEmbed()
 *   EMBED_BACKEND=hash               the built-in offline backend
 *   EMBED_BACKEND=openai             needs OPENAI_API_KEY
 *   EMBED_BACKEND=ollama             needs a local Ollama; OLLAMA_HOST optional
 *
 * @return {{label: string, config: Object}} A label for logging, and the
 *   `embedding` block to hand the searching service.
 */
function buildEmbeddingConfig() {
  const backend = (process.env.EMBED_BACKEND || 'demo').toLowerCase();

  // ── 2a. OpenAI, credentials held by this app ──────────────────────────────
  if (backend === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('EMBED_BACKEND=openai requires OPENAI_API_KEY to be set');
    }
    const OpenAI = require('openai');
    // The key is read here, in the consuming app, and captured by the closure.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
    const dimensions = Number(process.env.OPENAI_EMBED_DIMS || 384);

    return {
      label: `openai:${model}@${dimensions}`,
      config: {
        model,
        dimensions,
        batchSize: 128,
        embed: async (texts) => {
          const response = await client.embeddings.create({ model, input: texts, dimensions });
          return response.data.map(item => item.embedding);
        }
      }
    };
  }

  // ── 2b. Ollama, no credentials at all — a local model ─────────────────────
  if (backend === 'ollama') {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

    return {
      label: `ollama:${model}`,
      config: {
        model,
        dimensions: Number(process.env.OLLAMA_EMBED_DIMS || 768),
        batchSize: 16,
        embed: async (texts) => {
          const response = await fetch(`${host}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: texts })
          });
          if (!response.ok) {
            // Give the client a status it can decide to retry on.
            throw Object.assign(new Error(`Ollama ${response.status}`), { status: response.status });
          }
          return (await response.json()).embeddings;
        }
      }
    };
  }

  // ── 1b. The built-in offline backend ──────────────────────────────────────
  //
  // Honest about what this is: `hash` buckets words, so it matches shared
  // vocabulary, not meaning. Ask it "how do I reset my password" against a
  // document titled "Credential recovery procedure" and it scores near zero —
  // then ranks whatever random bucket collisions it found. Good for
  // deterministic tests and for exercising the indexing pipeline; not a
  // demonstration of semantic search.
  if (backend === 'hash') {
    return {
      label: 'hash (offline — matches vocabulary, NOT meaning)',
      config: { backend: 'hash', dimensions: 384 }
    };
  }

  // ── 1a. Default: a concept stand-in, so the demo shows real behaviour ─────
  if (backend !== 'demo') {
    throw new Error(`Unknown EMBED_BACKEND "${backend}" — expected demo, hash, openai or ollama`);
  }
  return {
    label: 'demo concept embedder (offline, illustrative only)',
    config: { model: 'demo-concepts-v1', dimensions: DEMO_CONCEPTS.length + 1, embed: demoEmbed }
  };
}

/**
 * Concept axes for the demo embedder.
 *
 * A real model learns a space in which "password reset" and "credential
 * recovery" land close together. This hand-writes that outcome for one small
 * vocabulary so the example can show genuine semantic behaviour with no
 * network and no key.
 *
 * It is a teaching stand-in, not a model: it generalises to nothing outside
 * this list. Use `EMBED_BACKEND=openai` or `=ollama` for the real thing.
 */
const DEMO_CONCEPTS = [
  { name: 'access', words: ['password', 'credential', 'sign in', 'signin', 'login', 'log in', 'authentication', 'authenticator', 'factor', 'enrol', 'account', 'identity', 'workstation', 'reset'] },
  { name: 'money', words: ['expense', 'receipt', 'reimbursement', 'claim', 'money', 'spend', 'card', 'payment', 'billing', 'repaid', 'travel', 'trip', 'approval', 'r5000'] },
  { name: 'space', words: ['room', 'meeting', 'booking', 'reserve', 'calendar', 'desk', 'office'] },
  { name: 'time-off', words: ['leave', 'holiday', 'vacation', 'annual', 'carry-over', 'absence'] }
];

/**
 * Embed text onto concept axes, weighted by how many of a concept's words it
 * mentions, then L2-normalised by the client.
 *
 * @param {Array<string>} texts
 * @return {Promise<Array<Array<number>>>}
 */
async function demoEmbed(texts) {
  return texts.map((text) => {
    const lower = String(text).toLowerCase();
    const vector = new Array(DEMO_CONCEPTS.length + 1).fill(0);
    let total = 0;
    DEMO_CONCEPTS.forEach((concept, axis) => {
      const hits = concept.words.filter(word => lower.includes(word)).length;
      if (hits > 0) { vector[axis] = 1 + Math.log(hits); total += hits; }
    });
    // Text about nothing we know lands on its own axis, so it stays orthogonal
    // to every real concept rather than drifting toward one.
    if (total === 0) vector[DEMO_CONCEPTS.length] = 1;
    return vector;
  });
}

// ── 3. What the AI-service route will look like once Phase 2 lands ──────────
// The app builds the AI service with its key exactly as it does for prompting,
// and passes the *instance* through dependencies. The key never crosses into
// the searching service.
//
//   const aiservice = serviceRegistry.aiservice('openai-compatible', {
//     apiKey: process.env.OPENAI_API_KEY
//   });
//
//   const searching = serviceRegistry.searching('vector', {
//     fields: ['title', 'body'],
//     embedding: { backend: 'aiservice', model: 'text-embedding-3-small', dimensions: 384 },
//     dependencies: { logging: logger, caching: cache, aiservice }
//   });

const embedding = buildEmbeddingConfig();

// A cache is optional but worth wiring: embeddings are keyed by content hash,
// so re-indexing an unchanged document costs nothing and never calls the API.
const cache = serviceRegistry.cache('memory');

const searching = serviceRegistry.searching('vector', {
  fields: ['title', 'body'],
  storeFields: ['title', 'category'],
  mode: 'hybrid',
  snippet: true,
  embedding: embedding.config,
  dependencies: { logging: logger, caching: cache }
});

/** A small knowledge base. Note how little vocabulary the topics share. */
const DOCUMENTS = [
  {
    id: 'kb-001',
    category: 'IT',
    title: 'Credential recovery procedure',
    body: 'Staff who can no longer sign in to their workstation should raise a credential request with the service desk. Identity is confirmed against the employee record before a new one is issued.'
  },
  {
    id: 'kb-002',
    category: 'IT',
    title: 'Multi-factor enrolment',
    body: 'All colleagues must enrol a second authentication factor. Use the authenticator app on a company phone; SMS is being retired.'
  },
  {
    id: 'kb-003',
    category: 'Finance',
    title: 'Expense claim policy',
    body: 'Submit receipts within thirty days of travel for reimbursement. Claims over R5000 need line-manager approval before payment is released.'
  },
  {
    id: 'kb-004',
    category: 'Finance',
    title: 'Corporate card rules',
    body: 'The company card may be used for travel and client entertainment. Personal spend must be repaid in the same billing cycle.'
  },
  {
    id: 'kb-005',
    category: 'Facilities',
    title: 'Meeting room booking',
    body: 'Reserve rooms through the calendar system. Rooms held for more than fifteen minutes without anyone arriving are released automatically.'
  },
  {
    id: 'kb-006',
    category: 'HR',
    title: 'Annual leave requests',
    body: 'Leave is requested through the self-service portal and approved by your line manager. Carry-over is capped at five days per year.'
  }
];

/** Render one result line. */
const line = (result) => {
  const badge = { lexical: 'keyword ', semantic: 'semantic', both: 'both    ' }[result.matchedBy];
  return `    ${badge}  ${result.score.toFixed(4)}  ${result.title}`;
};

/**
 * Run one query in all three modes so the difference is visible.
 *
 * @param {string} query
 * @return {Promise<void>}
 */
async function compareModes(query) {
  console.log(`\n  query: ${query.includes('"') ? query : `"${query}"`}`);
  for (const mode of ['keyword', 'semantic', 'hybrid']) {
    const results = await searching.search(query, { mode, maxResults: 3 });
    console.log(`  ${mode}:`);
    if (results.length === 0) console.log('    — nothing —');
    else results.forEach(result => console.log(line(result)));
  }
}

const PORT = process.env.PORT || 9000;

app.get('/', (req, res) => res.redirect('/services/searching/'));

app.listen(PORT, async () => {
  logger.info(`Vector search example listening on http://localhost:${PORT}`);

  console.log('\n' + '─'.repeat(72));
  console.log(`  Embedding backend: ${embedding.label}`);
  console.log('─'.repeat(72));

  // Indexing is lexically synchronous; embeddings are queued and batched.
  await searching.addAll(DOCUMENTS);
  console.log(`\n  indexed ${DOCUMENTS.length} documents`);
  console.log(`  pending embeddings: ${searching.getStats().pendingEmbeddings}`);

  // Wait for the queue. In a server you would usually not bother — documents
  // are already keyword-searchable and become semantically searchable shortly.
  await searching.flushEmbeddings();

  const stats = searching.getStats();
  console.log(`  embedded ${stats.embeddedDocuments} documents `
    + `into ${stats.vectorCount} vectors (${stats.dimensions}d)`);

  if (stats.lastEmbedError) {
    console.log(`\n  ⚠ embedding failed: ${stats.lastEmbedError}`);
    console.log('    Documents are still keyword-searchable — that path never touches the');
    console.log('    network — but semantic and hybrid modes have nothing to score against.');
    console.log('    Re-run with EMBED_BACKEND=hash to see the feature work offline.');
  }

  // "password" and "reset" appear in no document. Keyword search cannot find
  // anything; the vector branch retrieves the credential documents anyway.
  await compareModes('how do I reset my password');

  // "money back after a work trip" shares almost no words with the expenses
  // policy that answers it.
  await compareModes('getting money back after a work trip');

  // A quoted phrase is an instruction, and it still hard-filters a
  // semantically similar document that does not contain it.
  await compareModes('"line-manager approval"');

  console.log('\n  more like "Credential recovery procedure":');
  try {
    const related = await searching.similar('kb-001', { k: 3 });
    if (related.length === 0) console.log('    — nothing —');
    related.forEach(result => console.log(`    ${result.score.toFixed(4)}  ${result.title}`));
  } catch (error) {
    // similar() throws rather than returning [] so "not embedded yet" is never
    // mistaken for "nothing is similar".
    console.log(`    unavailable: ${error.message}`);
  }

  console.log('\n  semantic status:');
  const status = searching.semanticStatus();
  console.log(`    backend=${status.backend} model=${status.model} dims=${status.dimensions}`);
  console.log(`    mode=${status.defaultMode} fusion=${status.fusion} `
    + `cacheHits=${status.embedderStats.cacheHits} apiCalls=${status.embedderStats.calls}`);

  console.log(`\n  dashboard: http://localhost:${PORT}/services/searching/`);
  console.log('─'.repeat(72) + '\n');
});
