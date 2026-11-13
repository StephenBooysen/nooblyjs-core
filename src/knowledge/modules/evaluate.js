/**
 * @fileoverview Retrieval evaluation for the knowledge service (feature 05). Runs
 * labelled questions through `retrieve()` and reports how often the right
 * document is in the top k (recall@k) and how high it ranks (mean reciprocal
 * rank). Use it to check that a change to chunking or embedding does not make
 * answers worse.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

/**
 * @param {{retrieve: function(string, Object): Promise<Array<{path: string}>>}} kb Knowledge base
 * @param {Array<{question: string, expectedPath: string, roles?: string[]}>} cases Labelled questions
 * @param {Object} [options]
 * @param {number} [options.k=5] Cut-off for recall
 * @return {Promise<{cases: number, recallAtK: number, meanReciprocalRank: number, results: Array<Object>}>}
 */
async function evaluateRetrieval(kb, cases, { k = 5 } = {}) {
  const results = [];
  for (const c of cases) {
    const hits = await kb.retrieve(c.question, { k, roles: c.roles || ['*'] });
    const rank = hits.findIndex((h) => h.path === c.expectedPath);
    results.push({
      question: c.question,
      expectedPath: c.expectedPath,
      rank: rank === -1 ? null : rank + 1,
      hit: rank !== -1
    });
  }
  const total = results.length;
  const found = results.filter((r) => r.hit).length;
  const reciprocal = results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0);
  return {
    cases: total,
    recallAtK: total ? found / total : 0,
    meanReciprocalRank: total ? reciprocal / total : 0,
    results
  };
}

module.exports = { evaluateRetrieval };
