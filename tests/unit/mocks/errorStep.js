/**
 * @fileoverview Mock error step for workflow testing.
 * 
 * This mock step is designed to always throw an error to test error handling
 * capabilities within workflow execution. Used for testing error propagation,
 * recovery mechanisms, and failure reporting in workflow systems.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Mock workflow step that always throws an error.
 * 
 * This step is intentionally designed to fail for testing error handling
 * in workflow execution systems.
 * 
 * @async
 * @function errorStep
 * @param {Object} data - Input data from previous workflow step
 * @throws {Error} Always throws a simulated step error
 * @returns {Promise<never>} Never resolves, always throws
 */
module.exports = async (data) => {
  throw new Error('Simulated step error');
};
