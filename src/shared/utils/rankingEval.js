/**
 * @fileoverview Scores a ranked retrieval against labelled cases: how often the
 * expected item is in the top k (recall@k) and how high it ranks (mean
 * reciprocal rank). Shared by the knowledge service (`evaluate()`) and the
 * searching service's evaluate route, so both report the same numbers.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

/**
 * @param {Array<Object>} cases Labelled cases, passed to `rank` one at a time
 * @param {function(Object): Promise<string[]>} rank Returns the keys of the top hits for a case, best first
 * @param {function(Object): string} expectedOf The key the case should find
 * @return {Promise<{cases: number, recallAtK: number, meanReciprocalRank: number, results: Array<{rank: ?number, hit: boolean}>}>}
 *   `results` keeps the order of `cases`; each entry has the rank (1-based) or null
 * @example
 * const report = await evaluateRanking(cases, async (c) => (await search(c.query)).map((h) => h.id), (c) => c.expectedId);
 */
async function evaluateRanking(cases, rank, expectedOf) {
  const results = [];
  for (const c of cases) {
    const keys = await rank(c);
    // An item can appear more than once (several chunks); its rank is the first.
    const index = keys.indexOf(expectedOf(c));
    results.push({ rank: index === -1 ? null : index + 1, hit: index !== -1 });
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

module.exports = { evaluateRanking };
