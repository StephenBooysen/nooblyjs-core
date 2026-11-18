/**
 * @fileoverview Unit tests for the TensorFlow LSTM AI provider.
 *
 * Covers:
 *   tokenise()          — pure text processing
 *   prepare() / prepare_() — vocab building and sequence creation
 *   build() / buildModel_() — model graph construction (TF mocked)
 *   train()             — synchronous bulk pipeline (TF mocked)
 *   addData()           — progressive data add / update
 *   removeData()        — document removal
 *   getData()           — data store inspection
 *   getTrainingStatus() — pipeline state
 *   scheduleTraining_() — debounce + state machine
 *   prompt()            — generation (TF mocked)
 *   settings            — getSettings / saveSettings
 *   listModels()        — metadata
 *
 * @author NooblyJS Team
 */

'use strict';

// The TensorFlow provider depends on the optional native package
// `@tensorflow/tfjs-node`, which is not part of the default dependency set
// (it requires a platform-specific native build). When it is not installed we
// skip this suite cleanly rather than failing the whole test run.
let tfAvailable = true;
try {
  require.resolve('@tensorflow/tfjs-node');
} catch (_) {
  tfAvailable = false;
}

// describeTf runs the suite only when the optional dependency is present.
const describeTf = tfAvailable ? describe : describe.skip;

// ─── Mock TensorFlow ──────────────────────────────────────────────────────────
let mockModel;

if (tfAvailable) {
  jest.mock('@tensorflow/tfjs-node', () => {
    const mockProbs = new Float32Array(10).fill(0.05);
    mockProbs[4] = 0.55; // index 4 will be picked deterministically

    mockModel = {
      add:     jest.fn(),
      compile: jest.fn(),
      dispose: jest.fn(),
      fit: jest.fn().mockResolvedValue({
        epoch:   [0, 1, 2, 3, 4],
        history: { loss: [2.0, 1.5, 1.1, 0.9, 0.7], acc: [0.1, 0.3, 0.4, 0.5, 0.6] },
      }),
      predict: jest.fn().mockReturnValue({
        data:    jest.fn().mockResolvedValue(mockProbs),
        dispose: jest.fn(),
      }),
      save: jest.fn().mockResolvedValue({}),
    };

    return {
      version: { tfjs: '4.22.0-mock' },
    sequential: jest.fn(() => mockModel),
    layers: {
      embedding: jest.fn(() => ({})),
      lstm:      jest.fn(() => ({})),
      dropout:   jest.fn(() => ({})),
      dense:     jest.fn(() => ({})),
    },
    train:    { adam: jest.fn(() => 'adam-optimizer') },
    tensor2d: jest.fn(() => ({ dispose: jest.fn() })),
    tensor1d: jest.fn(() => ({ dispose: jest.fn() })),
    loadLayersModel: jest.fn().mockRejectedValue(new Error('No saved model')),
  };
  });
}

const path = require('node:path');
const EventEmitter = require('events');
// Only load the provider (which requires the native TF package) when available.
const AITensorFlow = tfAvailable
  ? require('../../../src/aiservice/provider/aitensorflow')
  : null;

const SAMPLE_TEXT = 'the cat sat on the mat the cat ran away';

// Each call gets a unique path so loadState_() always starts from a clean slate.
let _testId = 0;
function makeProvider(opts = {}) {
  const eventEmitter = new EventEmitter();
  jest.spyOn(eventEmitter, 'emit');
  const provider = new AITensorFlow({
    sequenceLength:  4,
    embeddingDim:    8,
    lstmUnits:       16,
    epochs:          5,
    batchSize:       2,
    trainDebounceMs: 50,
    modelPath: path.join('/tmp', `tf-test-${Date.now()}-${++_testId}`),
    ...opts,
  }, eventEmitter);
  provider.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { provider, eventEmitter };
}

// ─── tokenise ────────────────────────────────────────────────────────────────
describeTf('AITensorFlow.tokenise()', () => {
  let provider;
  beforeEach(() => ({ provider } = makeProvider()));

  it('splits on whitespace and lowercases', () => {
    expect(provider.tokenise('Hello World')).toEqual(['hello', 'world']);
  });

  it('separates punctuation into its own token', () => {
    const tokens = provider.tokenise('hello, world!');
    expect(tokens).toContain(',');
    expect(tokens).toContain('!');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('filters empty strings', () => {
    const tokens = provider.tokenise('  spaces  everywhere  ');
    expect(tokens.every(t => t.length > 0)).toBe(true);
  });

  it('handles an empty string', () => {
    expect(provider.tokenise('')).toEqual([]);
  });
});

// ─── prepare_ / prepare ──────────────────────────────────────────────────────
describeTf('AITensorFlow.prepare_()', () => {
  let provider;
  beforeEach(() => ({ provider } = makeProvider()));

  it('includes all special tokens', () => {
    const { vocabulary } = provider.prepare_(SAMPLE_TEXT);
    expect(vocabulary.has('<PAD>')).toBe(true);
    expect(vocabulary.has('<UNK>')).toBe(true);
    expect(vocabulary.has('<START>')).toBe(true);
    expect(vocabulary.has('<END>')).toBe(true);
  });

  it('assigns <PAD>=0, <UNK>=1', () => {
    const { vocabulary } = provider.prepare_(SAMPLE_TEXT);
    expect(vocabulary.get('<PAD>')).toBe(0);
    expect(vocabulary.get('<UNK>')).toBe(1);
  });

  it('does NOT mutate this.vocabulary', () => {
    const sizeBefore = provider.vocabulary.size;
    provider.prepare_(SAMPLE_TEXT);
    expect(provider.vocabulary.size).toBe(sizeBefore);
  });

  it('produces reverseVocabulary as exact inverse of vocabulary', () => {
    const { vocabulary, reverseVocabulary } = provider.prepare_(SAMPLE_TEXT);
    for (const [word, idx] of vocabulary) {
      expect(reverseVocabulary.get(idx)).toBe(word);
    }
  });

  it('each xs row has sequenceLength elements', () => {
    const { xs } = provider.prepare_(SAMPLE_TEXT);
    for (const row of xs) {
      expect(row.length).toBe(4);
    }
  });

  it('xs.length equals encoded.length - sequenceLength', () => {
    const tokens = provider.tokenise(SAMPLE_TEXT);
    const encodedLen = tokens.length + 2; // +2 for <START> <END>
    const { xs } = provider.prepare_(SAMPLE_TEXT);
    expect(xs.length).toBe(encodedLen - provider.sequenceLength);
  });

  it('accepts an array of strings', () => {
    const { xs } = provider.prepare_(['the cat sat', 'the dog ran']);
    expect(xs.length).toBeGreaterThan(0);
  });
});

describeTf('AITensorFlow.prepare()', () => {
  it('mutates this.vocabulary and this.reverseVocabulary', () => {
    const { provider } = makeProvider();
    provider.prepare(SAMPLE_TEXT);
    expect(provider.vocabulary.size).toBeGreaterThan(4);
    expect(provider.reverseVocabulary.size).toBe(provider.vocabulary.size);
  });
});

// ─── buildModel_ / build ─────────────────────────────────────────────────────
describeTf('AITensorFlow.buildModel_()', () => {
  let provider;
  let tf;

  beforeEach(() => {
    ({ provider } = makeProvider());
    tf = require('@tensorflow/tfjs-node');
    jest.clearAllMocks();
  });

  it('creates a new sequential model each call', () => {
    provider.buildModel_(20);
    provider.buildModel_(20);
    expect(tf.sequential).toHaveBeenCalledTimes(2);
  });

  it('does NOT assign to this.model', () => {
    provider.buildModel_(20);
    expect(provider.model).toBeNull();
  });

  it('adds embedding, lstm, dropout, dense layers', () => {
    provider.buildModel_(20);
    expect(mockModel.add).toHaveBeenCalledTimes(4);
    expect(tf.layers.embedding).toHaveBeenCalledWith(expect.objectContaining({ inputDim: 20 }));
    expect(tf.layers.lstm).toHaveBeenCalledWith(expect.objectContaining({ units: 16 }));
    expect(tf.layers.dropout).toHaveBeenCalledWith(expect.objectContaining({ rate: 0.2 }));
    expect(tf.layers.dense).toHaveBeenCalledWith(expect.objectContaining({ units: 20, activation: 'softmax' }));
  });

  it('compiles with sparseCategoricalCrossentropy', () => {
    provider.buildModel_(20);
    expect(mockModel.compile).toHaveBeenCalledWith(
      expect.objectContaining({ loss: 'sparseCategoricalCrossentropy' })
    );
  });
});

describeTf('AITensorFlow.build()', () => {
  it('assigns the returned model to this.model', () => {
    const { provider } = makeProvider();
    jest.clearAllMocks();
    provider.build({ vocabSize: 15 });
    expect(provider.model).toBeTruthy();
  });
});

// ─── train ────────────────────────────────────────────────────────────────────
describeTf('AITensorFlow.train()', () => {
  let provider;
  beforeEach(() => {
    ({ provider } = makeProvider());
    jest.clearAllMocks();
  });

  it('returns epochs, finalLoss, vocabSize, sequences', async () => {
    const summary = await provider.train(SAMPLE_TEXT);
    expect(summary).toHaveProperty('epochs');
    expect(summary).toHaveProperty('finalLoss');
    expect(summary).toHaveProperty('vocabSize');
    expect(summary).toHaveProperty('sequences');
  });

  it('throws when corpus is too short to form sequences', async () => {
    await expect(provider.train('hi')).rejects.toThrow(/Not enough training data/);
  });

  it('stores texts in dataStore under bulk- keys', async () => {
    await provider.train(['alpha bravo charlie delta echo foxtrot', 'one two three four five six seven']);
    expect(provider.dataStore.size).toBeGreaterThan(0);
  });

  it('calls model.fit with the configured epochs', async () => {
    await provider.train(SAMPLE_TEXT, { epochs: 3 });
    expect(mockModel.fit).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ epochs: 3 })
    );
  });
});

// ─── addData / removeData / getData / getTrainingStatus ───────────────────────
describeTf('Progressive data management', () => {
  let provider;

  beforeEach(() => {
    ({ provider } = makeProvider());
    // Cancel any debounce timers that would fire during tests
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (provider.trainDebounceTimer) {
      clearTimeout(provider.trainDebounceTimer);
    }
  });

  it('addData stores the document and returns metadata', async () => {
    const result = await provider.addData('doc1', 'hello world test data');
    expect(result.key).toBe('doc1');
    expect(result.isUpdate).toBe(false);
    expect(result.totalDocuments).toBe(1);
  });

  it('addData with same key marks isUpdate=true', async () => {
    await provider.addData('doc1', 'first version');
    const result = await provider.addData('doc1', 'second version');
    expect(result.isUpdate).toBe(true);
    expect(result.totalDocuments).toBe(1); // same key, not added
  });

  it('addData replaces text for existing key', async () => {
    await provider.addData('doc1', 'original text');
    await provider.addData('doc1', 'updated text');
    const docs = await provider.getData();
    expect(docs['doc1']).toBe('updated text');
  });

  it('removeData returns true and removes document', async () => {
    await provider.addData('doc1', 'some text');
    const removed = await provider.removeData('doc1');
    expect(removed).toBe(true);
    const docs = await provider.getData();
    expect(docs['doc1']).toBeUndefined();
  });

  it('removeData returns false for non-existent key', async () => {
    const result = await provider.removeData('no-such-key');
    expect(result).toBe(false);
  });

  it('getData returns all documents as plain object', async () => {
    await provider.addData('a', 'text a');
    await provider.addData('b', 'text b');
    const docs = await provider.getData();
    expect(docs).toEqual({ a: 'text a', b: 'text b' });
  });

  it('addData throws on empty key', async () => {
    await expect(provider.addData('', 'text')).rejects.toThrow(/key must be/);
  });

  it('addData throws on empty text', async () => {
    await expect(provider.addData('k', '')).rejects.toThrow(/text must be/);
  });

  it('getTrainingStatus reflects dataStore size', async () => {
    await provider.addData('doc1', 'some content here');
    const status = provider.getTrainingStatus();
    expect(status.dataCount).toBe(1);
    expect(status.totalTextLength).toBeGreaterThan(0);
  });

  it('getTrainingStatus.modelReady is false before any train', () => {
    const status = provider.getTrainingStatus();
    expect(status.modelReady).toBe(false);
  });

  it('scheduleTraining_ transitions status to scheduled', async () => {
    await provider.addData('doc1', 'some text here now');
    expect(provider.trainingStatus).toBe('scheduled');
  });

  it('scheduleTraining_ sets needsRetrain when already training', async () => {
    provider.trainingStatus = 'training';
    provider.scheduleTraining_();
    expect(provider.needsRetrain).toBe(true);
    provider.trainingStatus = 'idle';
  });
});

// ─── prompt ───────────────────────────────────────────────────────────────────
describeTf('AITensorFlow.prompt()', () => {
  let provider;
  let eventEmitter;

  beforeEach(async () => {
    ({ provider, eventEmitter } = makeProvider());
    jest.clearAllMocks();
    await provider.train(SAMPLE_TEXT);
  });

  it('throws with helpful message when model not ready', async () => {
    const { provider: fresh } = makeProvider();
    await expect(fresh.prompt('hello')).rejects.toThrow(/not ready/i);
  });

  it('includes training status in error message when scheduled/training', async () => {
    const { provider: fresh } = makeProvider();
    fresh.model = null;
    fresh.trainingStatus = 'training';
    await expect(fresh.prompt('hello')).rejects.toThrow(/training/i);
    fresh.trainingStatus = 'idle';
  });

  it('returns content, model, provider, usage', async () => {
    const result = await provider.prompt('the cat', { maxTokens: 5 });
    expect(result).toHaveProperty('content');
    expect(result.model).toBe('tensorflow-lstm');
    expect(result.provider).toBe('tensorflow');
    expect(result.usage).toHaveProperty('promptTokens');
    expect(result.usage).toHaveProperty('completionTokens');
    expect(result.usage).toHaveProperty('totalTokens');
  });

  it('respects maxTokens', async () => {
    const result = await provider.prompt('the cat', { maxTokens: 3 });
    expect(result.usage.completionTokens).toBeLessThanOrEqual(3);
  });

  it('emits ai:prompt:complete with provider=tensorflow', async () => {
    await provider.prompt('the cat', { maxTokens: 2 });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'ai:prompt:complete',
      expect.objectContaining({ model: 'tensorflow-lstm', provider: 'tensorflow' })
    );
  });
});

// ─── settings ────────────────────────────────────────────────────────────────
describeTf('AITensorFlow settings', () => {
  let provider;
  beforeEach(() => ({ provider } = makeProvider()));

  it('getSettings returns description and list', async () => {
    const s = await provider.getSettings();
    expect(s).toHaveProperty('desciption');
    expect(Array.isArray(s.list)).toBe(true);
  });

  it('saveSettings updates a recognised key', async () => {
    await provider.saveSettings({ epochs: 200 });
    const s = await provider.getSettings();
    expect(s.epochs).toBe(200);
  });

  it('saveSettings ignores unknown keys', async () => {
    await provider.saveSettings({ unknownKey: 'x' });
    const s = await provider.getSettings();
    expect(s.unknownKey).toBeUndefined();
  });
});

// ─── listModels ───────────────────────────────────────────────────────────────
describeTf('AITensorFlow.listModels()', () => {
  it('reports trained=false before any training', async () => {
    const { provider } = makeProvider();
    const models = await provider.listModels();
    expect(models[0].trained).toBe(false);
    expect(models[0].dataDocuments).toBe(0);
  });

  it('reports trained=true and correct counts after training', async () => {
    const { provider } = makeProvider();
    jest.clearAllMocks();
    await provider.train(SAMPLE_TEXT);
    const models = await provider.listModels();
    expect(models[0].trained).toBe(true);
    expect(models[0].vocabSize).toBeGreaterThan(4);
    expect(models[0].dataDocuments).toBeGreaterThan(0);
  });
});
