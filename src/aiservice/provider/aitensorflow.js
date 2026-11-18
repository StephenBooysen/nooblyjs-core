/**
 * @fileoverview TensorFlow AI Provider — Hot-Swappable Progressive LSTM
 *
 * Architecture:
 *   - Data store   : persistent Map<key, text> on disk — add/update/remove by key
 *   - Live model   : always available for prompt() calls
 *   - Background   : when data changes, a new model trains on ALL data; when ready
 *                    it atomically replaces the live model (hot-swap)
 *   - Mid-call safety: prompt() captures local model/vocab refs at call start, so
 *                    a swap that happens mid-generation never disrupts that call
 *
 * Flow:
 *   addData(key, text)  → persist → debounce → background train → hot-swap
 *   prompt(text)        → always uses the current live model
 *
 * @author NooblyJS Team
 * @changed 2026-06-25
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');

const AIServiceBase = require('./aibase');

// Lazy-loaded so the module can be imported even when tfjs-node isn't installed.
let tf = null;
function getTf() {
  if (!tf) {
    // util.isNullOrUndefined was removed in Node 18+ but @tensorflow/tfjs-node@4.x
    // still calls it inside the native Reshape kernel. Restore it before first require.
    const util = require('util');
    if (!util.isNullOrUndefined) {
      util.isNullOrUndefined = v => v == null;
    }
    tf = require('@tensorflow/tfjs-node');
  }
  return tf;
}

const PAD_TOKEN   = '<PAD>';
const UNK_TOKEN   = '<UNK>';
const START_TOKEN = '<START>';
const END_TOKEN   = '<END>';
const SPECIAL_TOKENS = [PAD_TOKEN, UNK_TOKEN, START_TOKEN, END_TOKEN];

/**
 * TensorFlow LSTM language model provider with progressive data loading
 * and hot-swap background retraining.
 * @class
 * @extends {AIServiceBase}
 */
class AITensorFlow extends AIServiceBase {

  /**
   * @param {Object} options
   * @param {number} [options.sequenceLength=10]   Context window (tokens).
   * @param {number} [options.embeddingDim=64]     Word embedding dimensions.
   * @param {number} [options.lstmUnits=128]       LSTM hidden units.
   * @param {number} [options.epochs=50]           Training epochs per cycle.
   * @param {number} [options.batchSize=32]        Training batch size.
   * @param {number} [options.trainDebounceMs=3000] Wait after last addData before training starts.
   * @param {string} [options.modelPath]           Directory for model + data store files.
   * @param {EventEmitter} eventEmitter
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.sequenceLength   = options.sequenceLength   || 10;
    this.embeddingDim     = options.embeddingDim     || 64;
    this.lstmUnits        = options.lstmUnits        || 128;
    this.defaultEpochs    = options.epochs           || 50;
    this.defaultBatchSize = options.batchSize        || 32;
    this.trainDebounceMs  = options.trainDebounceMs  || 3000;

    this.modelPath = options.modelPath
      || path.join(process.cwd(), '.application', 'data', 'tensorflow-model');

    /** @type {Map<string, string>} key → training text */
    this.dataStore = new Map();

    /** @type {Map<string, number>} word → index (active model's vocab) */
    this.vocabulary = new Map();
    /** @type {Map<number, string>} index → word (active model's vocab) */
    this.reverseVocabulary = new Map();

    /** @type {import('@tensorflow/tfjs-node').Sequential|null} Live model */
    this.model = null;

    // Background training state machine.
    this.trainingStatus   = 'idle'; // 'idle' | 'scheduled' | 'training'
    this.needsRetrain     = false;
    this.trainDebounceTimer = null;

    this.settings = {
      desciption: 'Progressive TensorFlow.js LSTM — add data with keys, model trains in background.',
      list: [
        { setting: 'sequenceLength',  type: 'int',    values: ['10'] },
        { setting: 'embeddingDim',    type: 'int',    values: ['64'] },
        { setting: 'lstmUnits',       type: 'int',    values: ['128'] },
        { setting: 'epochs',          type: 'int',    values: ['50'] },
        { setting: 'batchSize',       type: 'int',    values: ['32'] },
        { setting: 'trainDebounceMs', type: 'int',    values: ['3000'] },
      ],
      sequenceLength:   this.sequenceLength,
      embeddingDim:     this.embeddingDim,
      lstmUnits:        this.lstmUnits,
      epochs:           this.defaultEpochs,
      batchSize:        this.defaultBatchSize,
      trainDebounceMs:  this.trainDebounceMs,
    };

    // Restore saved model + data store from disk (non-blocking).
    this.loadState_().catch(() => {
      this.logger?.info(`[${this.constructor.name}] No saved state — call addData() to begin`);
    });
  }

  // ─── Settings ────────────────────────────────────────────────────────────────

  async getSettings() {
    return this.settings;
  }

  async saveSettings(settings) {
    for (const entry of this.settings.list) {
      if (settings[entry.setting] != null) {
        this.settings[entry.setting] = settings[entry.setting];
        this.logger?.info(`[${this.constructor.name}] Setting updated`, {
          setting: entry.setting,
          value: settings[entry.setting],
        });
      }
    }
  }

  // ─── Progressive data management ─────────────────────────────────────────────

  /**
   * Adds or replaces a training document identified by a unique key.
   * Triggers a background retrain after a debounce window so rapid consecutive
   * calls are batched into a single training cycle.
   *
   * @param {string} key    Unique identifier (e.g. 'chapter-1', 'faq-intro').
   * @param {string} text   The training text for this document.
   * @return {Promise<Object>} { key, isUpdate, totalDocuments, trainingStatus }
   *
   * @example
   * await ai.addData('intro', 'The cat sat on the mat. The cat was happy.');
   * await ai.addData('tech',  'Software runs on computers and devices.');
   */
  async addData(key, text) {
    if (!key || typeof key !== 'string') throw new Error('key must be a non-empty string');
    if (!text || typeof text !== 'string') throw new Error('text must be a non-empty string');

    const isUpdate = this.dataStore.has(key);
    this.dataStore.set(key, text);
    await this.saveDataStore_();
    this.scheduleTraining_();

    this.logger?.info(`[${this.constructor.name}] Data ${isUpdate ? 'updated' : 'added'}`, {
      key,
      length: text.length,
      totalDocuments: this.dataStore.size,
      trainingStatus: this.trainingStatus,
    });

    return { key, isUpdate, totalDocuments: this.dataStore.size, trainingStatus: this.trainingStatus };
  }

  /**
   * Removes a training document by key and schedules a retrain.
   *
   * @param {string} key
   * @return {Promise<boolean>} true if the key existed and was removed.
   *
   * @example
   * await ai.removeData('intro');
   */
  async removeData(key) {
    if (!this.dataStore.has(key)) return false;

    this.dataStore.delete(key);
    await this.saveDataStore_();

    if (this.dataStore.size > 0) {
      this.scheduleTraining_();
    } else {
      this.logger?.info(`[${this.constructor.name}] All data removed — model unchanged until new data is added`);
    }

    return true;
  }

  /**
   * Returns all training documents currently in the data store.
   *
   * @return {Promise<Object>} Plain object { key: text, ... }
   *
   * @example
   * const docs = await ai.getData();
   * console.log(Object.keys(docs)); // ['intro', 'tech']
   */
  async getData() {
    return Object.fromEntries(this.dataStore);
  }

  /**
   * Returns the current training pipeline state.
   *
   * @return {Object} { status, dataCount, totalTextLength, modelReady, vocabSize }
   *
   * @example
   * const status = ai.getTrainingStatus();
   * if (status.status === 'training') console.log('Model is being updated...');
   */
  getTrainingStatus() {
    const totalTextLength = [...this.dataStore.values()]
      .reduce((sum, t) => sum + t.length, 0);

    return {
      status: this.trainingStatus,           // 'idle' | 'scheduled' | 'training'
      dataCount: this.dataStore.size,
      totalTextLength,
      modelReady: !!this.model,
      vocabSize: this.vocabulary.size,
    };
  }

  // ─── Tokenise / Prepare ───────────────────────────────────────────────────────

  /**
   * Tokenises text into lowercase word tokens.
   * Punctuation is separated so "hello," becomes ["hello", ","].
   *
   * @param {string} text
   * @return {string[]}
   */
  tokenise(text) {
    return text
      .toLowerCase()
      .replace(/([.,!?;:"])/g, ' $1 ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  /**
   * Pure version: builds vocabulary and sequences from texts without mutating
   * instance state. Used by background training so the active vocab is untouched
   * until the hot-swap.
   *
   * @param {string|string[]} texts
   * @return {{ xs, ys, vocabSize, vocabulary, reverseVocabulary }}
   * @private
   */
  prepare_(texts) {
    const corpus = Array.isArray(texts) ? texts : [texts];

    const allTokens = [];
    for (const text of corpus) {
      allTokens.push(START_TOKEN, ...this.tokenise(text), END_TOKEN);
    }

    const vocabulary = new Map();
    const reverseVocabulary = new Map();

    SPECIAL_TOKENS.forEach((token, idx) => {
      vocabulary.set(token, idx);
      reverseVocabulary.set(idx, token);
    });

    const counts = new Map();
    for (const token of allTokens) {
      if (!SPECIAL_TOKENS.includes(token)) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    let idx = SPECIAL_TOKENS.length;
    for (const [word] of sorted) {
      vocabulary.set(word, idx);
      reverseVocabulary.set(idx, word);
      idx++;
    }

    const unkIdx = vocabulary.get(UNK_TOKEN) || 1;
    const encode = tokens => tokens.map(t => vocabulary.has(t) ? vocabulary.get(t) : unkIdx);
    const encoded = encode(allTokens);

    const xs = [];
    const ys = [];
    for (let i = 0; i <= encoded.length - this.sequenceLength - 1; i++) {
      xs.push(encoded.slice(i, i + this.sequenceLength));
      ys.push(encoded[i + this.sequenceLength]);
    }

    return { xs, ys, vocabSize: vocabulary.size, vocabulary, reverseVocabulary };
  }

  /**
   * Public prepare: builds sequences AND updates instance vocabulary.
   * Used by the manual train() path.
   *
   * @param {string|string[]} texts
   * @return {{ xs, ys, vocabSize }}
   */
  prepare(texts) {
    const result = this.prepare_(texts);
    this.vocabulary = result.vocabulary;
    this.reverseVocabulary = result.reverseVocabulary;
    return result;
  }

  // ─── Model construction ───────────────────────────────────────────────────────

  /**
   * Creates a new compiled LSTM model graph without assigning it to this.model.
   * Used by background training to avoid touching the live model.
   *
   * @param {number} vocabSize
   * @return {import('@tensorflow/tfjs-node').Sequential}
   * @private
   */
  buildModel_(vocabSize) {
    const tfLib = getTf();
    const model = tfLib.sequential();

    model.add(tfLib.layers.embedding({
      inputDim: vocabSize,
      outputDim: this.embeddingDim,
      inputLength: this.sequenceLength,
      maskZero: true,
    }));

    model.add(tfLib.layers.lstm({
      units: this.lstmUnits,
      returnSequences: false,
      dropout: 0.2,
      // Override default 'orthogonal' recurrentInitializer — its Reshape op calls
      // util.isNullOrUndefined which was removed in Node 18+ (tfjs-node bug on Node 24).
      recurrentInitializer: 'glorotUniform',
    }));

    model.add(tfLib.layers.dropout({ rate: 0.2 }));

    model.add(tfLib.layers.dense({
      units: vocabSize,
      activation: 'softmax',
    }));

    model.compile({
      optimizer: tfLib.train.adam(0.001),
      loss: 'sparseCategoricalCrossentropy',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Builds and assigns this.model. Used by the manual train() path.
   *
   * @param {Object} config
   * @param {number} config.vocabSize
   * @return {import('@tensorflow/tfjs-node').Sequential}
   */
  build({ vocabSize }) {
    this.model = this.buildModel_(vocabSize);
    return this.model;
  }

  // ─── Background training (hot-swap) ──────────────────────────────────────────

  /**
   * Debounces training runs. Called after every data change.
   * - If already training: sets needsRetrain so a new cycle starts right after.
   * - Otherwise: waits trainDebounceMs then fires runBackgroundTraining_().
   * @private
   */
  scheduleTraining_() {
    if (this.trainingStatus === 'training') {
      this.needsRetrain = true;
      this.logger?.info(`[${this.constructor.name}] Data changed during training — queued for next cycle`);
      return;
    }

    if (this.trainDebounceTimer) {
      clearTimeout(this.trainDebounceTimer);
    }

    this.trainingStatus = 'scheduled';
    this.trainDebounceTimer = setTimeout(() => {
      this.trainDebounceTimer = null;
      this.runBackgroundTraining_().catch(err => {
        this.logger?.error(`[${this.constructor.name}] Background training failed`, { error: err.message });
        this.trainingStatus = 'idle';
      });
    }, this.trainDebounceMs);

    this.logger?.info(`[${this.constructor.name}] Training scheduled`, {
      debounceMs: this.trainDebounceMs,
      dataCount: this.dataStore.size,
    });
  }

  /**
   * Trains a new model on all current data, then hot-swaps it into the live slot.
   * The live model keeps serving prompt() calls throughout this entire process.
   * @private
   */
  async runBackgroundTraining_() {
    if (this.dataStore.size === 0) {
      this.trainingStatus = 'idle';
      return;
    }

    this.trainingStatus = 'training';
    this.needsRetrain = false;

    const allTexts = [...this.dataStore.values()];

    this.logger?.info(`[${this.constructor.name}] Background training started`, {
      dataCount: this.dataStore.size,
    });

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('ai:tensorflow:training:start', { dataCount: this.dataStore.size });
    }

    // prepare_() is pure — builds new vocab without touching this.vocabulary
    const { xs, ys, vocabSize, vocabulary, reverseVocabulary } = this.prepare_(allTexts);

    if (xs.length === 0) {
      this.logger?.warn(`[${this.constructor.name}] Not enough data for sequences — add more text`);
      this.trainingStatus = 'idle';
      return;
    }

    const tfLib = getTf();
    // Build a fresh model — does NOT touch this.model
    const newModel = this.buildModel_(vocabSize);

    const epochs     = this.settings.epochs    || this.defaultEpochs;
    const batchSize  = this.settings.batchSize || this.defaultBatchSize;

    const xTensor = tfLib.tensor2d(xs, [xs.length, this.sequenceLength], 'int32');
    // sparseCategoricalCrossentropy loss kernel requires float32 labels on Node 18+
    const yTensor = tfLib.tensor1d(ys, 'float32');

    try {
      await newModel.fit(xTensor, yTensor, {
        epochs,
        batchSize,
        validationSplit: xs.length > 100 ? 0.1 : 0,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if ((epoch + 1) % 10 === 0 || epoch === 0) {
              this.logger?.info(`[${this.constructor.name}] Training epoch ${epoch + 1}/${epochs}`, {
                loss: logs.loss?.toFixed(4),
                accuracy: logs.acc?.toFixed(4),
              });
            }
          },
        },
      });

      // ── Hot-swap ─────────────────────────────────────────────────────────
      // All three assignments are synchronous. JS is single-threaded so no
      // concurrent prompt() call can observe a partially-swapped state between
      // these lines. Any prompt() already in-flight captured its own local
      // references at call start (see prompt() implementation) so is unaffected.
      const oldModel = this.model;
      this.model = newModel;
      this.vocabulary = vocabulary;
      this.reverseVocabulary = reverseVocabulary;
      // ─────────────────────────────────────────────────────────────────────

      // Brief delay before disposing the old model so any in-flight predict()
      // tensor reads have time to complete before the underlying memory is freed.
      if (oldModel) {
        setTimeout(() => { try { oldModel.dispose(); } catch (_) {} }, 1000);
      }

      await this.saveModel_();

      this.logger?.info(`[${this.constructor.name}] Model hot-swapped`, {
        vocabSize,
        sequences: xs.length,
        dataCount: this.dataStore.size,
      });

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:tensorflow:model:updated', {
          vocabSize,
          sequences: xs.length,
          dataCount: this.dataStore.size,
        });
      }

    } finally {
      xTensor.dispose();
      yTensor.dispose();
      this.trainingStatus = 'idle';

      // If data changed while we were training, kick off another cycle immediately.
      if (this.needsRetrain) {
        this.needsRetrain = false;
        this.logger?.info(`[${this.constructor.name}] Data changed during training — starting next cycle`);
        this.scheduleTraining_();
      }
    }
  }

  // ─── Manual bulk train ────────────────────────────────────────────────────────

  /**
   * Convenience method: stores all texts in the data store then triggers a
   * background training cycle. Each text gets an auto-generated key
   * (bulk-<timestamp>-<n>) unless you pass them via addData() for named keys.
   *
   * @param {string|string[]} texts
   * @param {Object} [options]
   * @param {number} [options.epochs]
   * @param {number} [options.batchSize]
   * @return {Promise<Object>} Training summary { epochs, finalLoss, vocabSize, sequences }
   *
   * @example
   * await ai.learn('The cat sat on the mat. The cat was happy.');
   *
   * @example
   * await ai.learn(['Chapter one...', 'Chapter two...'], { epochs: 100 });
   */
  async learn(texts, options = {}) {
    return this.train(texts, options);
  }

  /**
   * Full synchronous train pipeline (runs in-process, blocks the caller).
   * Useful for one-shot training or testing. For progressive use, prefer addData().
   *
   * @param {string|string[]} texts
   * @param {Object} [options]
   * @return {Promise<Object>} { epochs, finalLoss, vocabSize, sequences }
   */
  async train(texts, options = {}) {
    const corpus = Array.isArray(texts) ? texts : [texts];
    const epochsOpt    = options.epochs    || this.settings.epochs    || this.defaultEpochs;
    const batchSizeOpt = options.batchSize || this.settings.batchSize || this.defaultBatchSize;

    // Store in dataStore under auto-generated keys so background retrain cycles
    // include this corpus too.
    const bulkKey = `bulk-${Date.now()}`;
    corpus.forEach((text, i) => this.dataStore.set(`${bulkKey}-${i}`, text));
    await this.saveDataStore_();

    this.logger?.info(`[${this.constructor.name}] Preparing training data`);
    const { xs, ys, vocabSize } = this.prepare(corpus);

    if (xs.length === 0) {
      throw new Error(
        `Not enough training data to build sequences. Need at least ${this.sequenceLength + 1} tokens.`
      );
    }

    this.logger?.info(`[${this.constructor.name}] Building model`, {
      vocabSize, sequences: xs.length, sequenceLength: this.sequenceLength,
    });

    this.build({ vocabSize });

    const tfLib = getTf();
    const xTensor = tfLib.tensor2d(xs, [xs.length, this.sequenceLength], 'int32');
    const yTensor = tfLib.tensor1d(ys, 'float32');

    let finalLoss = null;

    try {
      const history = await this.model.fit(xTensor, yTensor, {
        epochs: epochsOpt,
        batchSize: batchSizeOpt,
        validationSplit: xs.length > 100 ? 0.1 : 0,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            finalLoss = logs.loss;
            if ((epoch + 1) % 10 === 0 || epoch === 0) {
              this.logger?.info(`[${this.constructor.name}] Epoch ${epoch + 1}/${epochsOpt}`, {
                loss: logs.loss?.toFixed(4),
                accuracy: logs.acc?.toFixed(4),
              });
            }
          },
        },
      });

      await this.saveModel_();

      const summary = { epochs: history.epoch.length, finalLoss, vocabSize, sequences: xs.length };
      this.logger?.info(`[${this.constructor.name}] Training complete`, summary);
      return summary;

    } finally {
      xTensor.dispose();
      yTensor.dispose();
    }
  }

  // ─── Prompt ───────────────────────────────────────────────────────────────────

  /**
   * Generates text from a prompt using the current live model.
   * Captures a local snapshot of the model and vocabulary at call start so a
   * hot-swap that occurs mid-generation does not disrupt this call.
   *
   * @param {string} promptText Seed text.
   * @param {Object} [options]
   * @param {number} [options.maxTokens=100]   Max tokens to generate.
   * @param {number} [options.temperature=0.7] Sampling temperature.
   * @return {Promise<Object>} { content, model, provider, usage }
   *
   * @example
   * const result = await ai.prompt('The cat', { maxTokens: 30 });
   * console.log(result.content);
   */
  async prompt(promptText, options = {}) {
    if (!this.model) {
      const status = this.trainingStatus;
      throw new Error(
        status === 'training' || status === 'scheduled'
          ? `Model is ${status} — try again once training completes. Check getTrainingStatus().`
          : 'Model not ready. Add training data via addData() first.'
      );
    }

    const maxTokens  = options.maxTokens  || 100;
    const temperature = options.temperature || 0.7;
    const tfLib = getTf();

    // Capture a consistent snapshot for this call's entire generation loop.
    // If a hot-swap happens while we're generating, this call is unaffected.
    const model           = this.model;
    const reverseVocab    = this.reverseVocabulary;

    const promptTokens = this.tokenise(promptText);
    let encoded = this.encode_(promptTokens);
    const generated = [];

    for (let i = 0; i < maxTokens; i++) {
      const padded = new Array(this.sequenceLength).fill(0);
      const seq = encoded.slice(-this.sequenceLength);
      for (let j = 0; j < seq.length; j++) {
        padded[this.sequenceLength - seq.length + j] = seq[j];
      }

      const inputTensor = tfLib.tensor2d([padded], [1, this.sequenceLength], 'int32');
      const predTensor  = model.predict(inputTensor);
      const probs       = await predTensor.data();

      inputTensor.dispose();
      predTensor.dispose();

      const nextIdx  = this.sampleWithTemperature_(Array.from(probs), temperature);
      const nextWord = reverseVocab.get(nextIdx) || UNK_TOKEN;

      if (nextWord === END_TOKEN) break;
      if (nextWord !== START_TOKEN && nextWord !== PAD_TOKEN) {
        generated.push(nextWord);
      }

      encoded = [...encoded.slice(-(this.sequenceLength - 1)), nextIdx];
    }

    const content = generated
      .join(' ')
      .replace(/ ([.,!?;:"])/g, '$1');

    const result = {
      content,
      model: 'tensorflow-lstm',
      provider: 'tensorflow',
      usage: {
        promptTokens: promptTokens.length,
        completionTokens: generated.length,
        totalTokens: promptTokens.length + generated.length,
      },
    };

    this.emitPromptComplete_(promptText, result, options);
    return result;
  }

  /**
   * @return {Promise<Array>}
   */
  async listModels() {
    return [{
      id: 'tensorflow-lstm',
      name: 'TensorFlow LSTM Language Model',
      description: 'Locally-trained word LSTM — no external API required',
      trained:        !!this.model,
      trainingStatus: this.trainingStatus,
      vocabSize:      this.vocabulary.size,
      sequenceLength: this.sequenceLength,
      dataDocuments:  this.dataStore.size,
    }];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Maps tokens to indices using the current vocabulary.
   * @param {string[]} tokens
   * @return {number[]}
   * @private
   */
  encode_(tokens) {
    const unkIdx = this.vocabulary.get(UNK_TOKEN) || 1;
    return tokens.map(t => this.vocabulary.has(t) ? this.vocabulary.get(t) : unkIdx);
  }

  /**
   * Multinomial sampling with temperature.
   * @param {number[]} probs
   * @param {number} temperature
   * @return {number}
   * @private
   */
  sampleWithTemperature_(probs, temperature) {
    const logits   = probs.map(p => Math.log(p + 1e-10) / temperature);
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map(l => Math.exp(l - maxLogit));
    const sum      = expLogits.reduce((a, b) => a + b, 0);
    const scaled   = expLogits.map(e => e / sum);

    let rand = Math.random();
    for (let i = 0; i < scaled.length; i++) {
      rand -= scaled[i];
      if (rand <= 0) return i;
    }
    return scaled.length - 1;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  /**
   * Saves the data store to disk.
   * @private
   */
  async saveDataStore_() {
    fs.mkdirSync(this.modelPath, { recursive: true });
    const payload = { documents: Object.fromEntries(this.dataStore) };
    await fsp.writeFile(
      path.join(this.modelPath, 'datastore.json'),
      JSON.stringify(payload, null, 2)
    );
  }

  /**
   * Loads the data store from disk.
   * @private
   */
  async loadDataStore_() {
    const p = path.join(this.modelPath, 'datastore.json');
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(await fsp.readFile(p, 'utf8'));
    this.dataStore = new Map(Object.entries(raw.documents || {}));
    this.logger?.info(`[${this.constructor.name}] Data store loaded`, {
      documents: this.dataStore.size,
    });
  }

  /**
   * Saves model weights + vocabulary to modelPath.
   * @private
   */
  async saveModel_() {
    if (!this.model) return;
    fs.mkdirSync(this.modelPath, { recursive: true });
    await this.model.save(`file://${this.modelPath}`);

    const vocabData = {
      vocabulary: Object.fromEntries(this.vocabulary),
      sequenceLength: this.sequenceLength,
    };
    await fsp.writeFile(
      path.join(this.modelPath, 'vocabulary.json'),
      JSON.stringify(vocabData)
    );
    this.logger?.info(`[${this.constructor.name}] Model saved`, { path: this.modelPath });
  }

  /**
   * Loads model weights + vocabulary + data store from disk.
   * @private
   */
  async loadState_() {
    await this.loadDataStore_();

    const modelJson = path.join(this.modelPath, 'model.json');
    const vocabJson = path.join(this.modelPath, 'vocabulary.json');

    if (!fs.existsSync(modelJson) || !fs.existsSync(vocabJson)) return;

    const tfLib = getTf();
    this.model = await tfLib.loadLayersModel(`file://${modelJson}`);

    const vocabData = JSON.parse(await fsp.readFile(vocabJson, 'utf8'));
    this.vocabulary = new Map(
      Object.entries(vocabData.vocabulary).map(([k, v]) => [k, Number(v)])
    );
    this.reverseVocabulary = new Map(
      Object.entries(vocabData.vocabulary).map(([k, v]) => [Number(v), k])
    );
    this.sequenceLength = vocabData.sequenceLength;

    this.logger?.info(`[${this.constructor.name}] State loaded from disk`, {
      vocabSize: this.vocabulary.size,
      sequenceLength: this.sequenceLength,
      documents: this.dataStore.size,
    });
  }
}

module.exports = AITensorFlow;
