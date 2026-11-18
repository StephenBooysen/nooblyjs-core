/**
 * @fileoverview TensorFlow AI provider demo — progressive hot-swap training.
 *
 * Demonstrates:
 *   1. Instantiate the provider.
 *   2. Add documents one at a time with unique keys.
 *   3. Use prompt() at any point — the live model is always available.
 *   4. Watch the model retrain in the background and hot-swap.
 *   5. Update an existing document (same key) and watch another cycle.
 *
 * Run: node tests/app/aiservice/app-ai-tensorflow.js
 *
 * @author NooblyJS Team
 */

'use strict';

const path = require('node:path');
const EventEmitter = require('events');
const AITensorFlow = require('../../../src/aiservice/provider/aitensorflow');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function banner(msg) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(msg);
  console.log('─'.repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner('TensorFlow LSTM — Progressive Hot-Swap Demo');

  const eventEmitter = new EventEmitter();
  const dataDir = path.join(__dirname, '.application', 'data');

  const ai = new AITensorFlow({
    sequenceLength:  8,
    embeddingDim:    32,
    lstmUnits:       64,
    epochs:          60,
    batchSize:       16,
    trainDebounceMs: 1000,   // 1 s debounce so the demo moves quickly
    modelPath: path.join(dataDir, 'tensorflow-model-progressive'),
  }, eventEmitter);

  // ── Event listeners ────────────────────────────────────────────────────────
  eventEmitter.on('ai:tensorflow:training:start', ({ dataCount }) => {
    console.log(`\n[event] Training started  (${dataCount} document${dataCount > 1 ? 's' : ''})`);
  });
  eventEmitter.on('ai:tensorflow:model:updated', ({ vocabSize, sequences, dataCount }) => {
    console.log(`[event] Model hot-swapped  vocab=${vocabSize}  seqs=${sequences}  docs=${dataCount}`);
  });

  // ── Step 1: add first document ────────────────────────────────────────────
  banner('Step 1 — Add first document');
  await ai.addData('animals', [
    'the cat sat on the mat. the cat was happy.',
    'the dog ran in the park. the dog was fast.',
    'the cat and the dog played together in the park.',
    'the cat jumped over the dog and sat on the mat.',
  ].join(' '));

  console.log('Status after addData:', ai.getTrainingStatus());

  // ── Step 2: use prompt() while training is still running ─────────────────
  banner('Step 2 — prompt() while model is being trained');
  try {
    const r = await ai.prompt('the cat', { maxTokens: 15 });
    console.log('Response:', r.content);
  } catch (err) {
    // Expected on first run before any model exists
    console.log('(no model yet —', err.message, ')');
  }

  // ── Step 3: wait for first training cycle to finish ───────────────────────
  banner('Step 3 — waiting for first training cycle...');
  await waitForIdle(ai, 120_000);
  console.log('Status after training:', ai.getTrainingStatus());

  let result = await ai.prompt('the cat', { maxTokens: 20, temperature: 0.7 });
  console.log(`\nPrompt  : "the cat"\nGenerated: ${result.content}`);

  // ── Step 4: add a second document while model is live ─────────────────────
  banner('Step 4 — add second document (technology)');
  await ai.addData('technology', [
    'technology makes life easier for people.',
    'computers process data very quickly.',
    'software runs on computers and devices.',
    'digital systems store and retrieve information.',
    'networks connect computers around the world.',
  ].join(' '));

  console.log('Status:', ai.getTrainingStatus());
  // Model is still usable during retraining
  result = await ai.prompt('the dog', { maxTokens: 15, temperature: 0.6 });
  console.log(`\nPrompt (old model): "the dog"\nGenerated: ${result.content}`);

  // ── Step 5: wait for second training cycle ────────────────────────────────
  banner('Step 5 — waiting for retrain with two documents...');
  await waitForIdle(ai, 120_000);
  console.log('Status after retrain:', ai.getTrainingStatus());

  result = await ai.prompt('technology', { maxTokens: 20, temperature: 0.5 });
  console.log(`\nPrompt  : "technology"\nGenerated: ${result.content}`);

  // ── Step 6: update an existing document ───────────────────────────────────
  banner('Step 6 — update "animals" document (same key, new text)');
  await ai.addData('animals', [
    'the lion roared on the savanna. the lion was powerful.',
    'the eagle soared over the mountains. the eagle was free.',
    'the whale swam deep in the ocean. the whale was massive.',
    'the lion and the eagle watched the whale from above.',
  ].join(' '));

  await waitForIdle(ai, 120_000);
  console.log('Status after update:', ai.getTrainingStatus());

  result = await ai.prompt('the lion', { maxTokens: 20, temperature: 0.7 });
  console.log(`\nPrompt  : "the lion"\nGenerated: ${result.content}`);

  // ── Step 7: inspect data store ────────────────────────────────────────────
  banner('Step 7 — data store contents');
  const docs = await ai.getData();
  for (const [key, text] of Object.entries(docs)) {
    console.log(`  [${key}] ${text.slice(0, 60)}...`);
  }

  // ── Step 8: remove a document ─────────────────────────────────────────────
  banner('Step 8 — remove "technology" document');
  const removed = await ai.removeData('technology');
  console.log('Removed:', removed);
  await waitForIdle(ai, 120_000);

  const models = await ai.listModels();
  console.log('\nModel info:', JSON.stringify(models[0], null, 2));
  console.log('\nModel persisted — next run will reload from disk and can prompt() immediately.');
}

/**
 * Waits until ai.getTrainingStatus().status === 'idle', polling every 500ms.
 * @param {AITensorFlow} ai
 * @param {number} timeoutMs
 */
async function waitForIdle(ai, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = ai.getTrainingStatus();
    if (status === 'idle') return;
    process.stdout.write('.');
    await sleep(500);
  }
  throw new Error('Timed out waiting for training to finish');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
