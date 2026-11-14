/**
 * @fileoverview Evaluation for the knowledge service (feature 05). Runs labelled
 * questions through `retrieve()` and reports how often the right document is in
 * the top k (recall@k) and how high it ranks (mean reciprocal rank). With answers
 * on, it also asks each question and checks that the answer cites the expected
 * document (citation accuracy). Use it to check that a change to chunking,
 * embeddings or the model does not make answers worse.
 *
 * Cases can be written as YAML:
 *
 *   - question: How do I rotate the settings secret?
 *     expectedPath: docs/settings.md
 *   - question: What happens after the last retry?
 *     expectedPath: docs/queues.md
 *     roles: [support]
 *
 * `evaluateRetrieval()` works on any object with a `retrieve(question, { k, roles })`
 * method that returns hits with a `path`. The scoring itself is shared with the
 * searching service's evaluate route (`src/shared/utils/rankingEval.js`).
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const yaml = require('js-yaml');
const { evaluateRanking } = require('../../shared/utils/rankingEval');

const MAX_CASES = 500;

/**
 * Parses and checks evaluation cases from YAML. Accepts a list, or an object with
 * a `cases` list.
 * @param {string} text YAML
 * @return {Array<{question: string, expectedPath: string, roles?: string[]}>}
 * @throws {Error} When the YAML is invalid or a case lacks a question or expected path
 */
function parseEvalCases(text) {
  let doc;
  try {
    doc = yaml.load(String(text), { schema: yaml.CORE_SCHEMA });
  } catch (err) {
    throw new Error(`evaluation cases are not valid YAML: ${err.reason || 'parse error'}`);
  }
  const list = Array.isArray(doc) ? doc : doc?.cases;
  if (!Array.isArray(list)) throw new Error('evaluation cases must be a YAML list');
  if (list.length > MAX_CASES) throw new Error(`at most ${MAX_CASES} evaluation cases`);
  return list.map((c, i) => {
    if (!c || typeof c.question !== 'string' || !c.question.trim() || typeof c.expectedPath !== 'string' || !c.expectedPath) {
      throw new Error(`evaluation case ${i + 1} needs a question and an expectedPath`);
    }
    const out = { question: c.question, expectedPath: c.expectedPath };
    if (Array.isArray(c.roles)) out.roles = c.roles.map(String);
    return out;
  });
}

/**
 * @param {{retrieve: function(string, Object): Promise<Array<{path: string}>>}} kb Knowledge base
 * @param {Array<{question: string, expectedPath: string, roles?: string[]}>} cases Labelled questions
 * @param {Object} [options]
 * @param {number} [options.k=5] Cut-off for recall
 * @return {Promise<{cases: number, recallAtK: number, meanReciprocalRank: number, results: Array<Object>}>}
 */
async function evaluateRetrieval(kb, cases, { k = 5 } = {}) {
  const report = await evaluateRanking(
    cases,
    async (c) => (await kb.retrieve(c.question, { k, roles: c.roles || ['*'] })).map((h) => h.path),
    (c) => c.expectedPath
  );
  report.results = report.results.map((r, i) => ({ question: cases[i].question, expectedPath: cases[i].expectedPath, ...r }));
  return report;
}

/**
 * Asks each question and checks whether the answer cites the expected document.
 * @param {{ask: function(string, Object): Promise<{citations: Array<{path: string}>, confidence: string}>}} kb Knowledge base
 * @param {Array<{question: string, expectedPath: string, roles?: string[]}>} cases
 * @param {Object} [options]
 * @param {number} [options.k=5] Chunks given to the model
 * @return {Promise<{citationAccuracy: number, answerResults: Array<{question: string, expectedPath: string, cited: boolean, confidence: string, citedPaths: string[]}>}>}
 */
async function evaluateAnswers(kb, cases, { k = 5 } = {}) {
  const answerResults = [];
  for (const c of cases) {
    const answer = await kb.ask(c.question, { k, roles: c.roles || ['*'] });
    const citedPaths = [...new Set((answer.citations || []).map((x) => x.path))];
    answerResults.push({
      question: c.question,
      expectedPath: c.expectedPath,
      cited: citedPaths.includes(c.expectedPath),
      confidence: answer.confidence,
      citedPaths
    });
  }
  const total = answerResults.length;
  return {
    citationAccuracy: total ? answerResults.filter((r) => r.cited).length / total : 0,
    answerResults
  };
}

module.exports = { evaluateRetrieval, evaluateAnswers, parseEvalCases, MAX_CASES };
