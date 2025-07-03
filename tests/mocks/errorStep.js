/**
 * @fileoverview Mock error step for workflow testing.
 */

module.exports = async (data) => {
  throw new Error('Simulated step error');
};
