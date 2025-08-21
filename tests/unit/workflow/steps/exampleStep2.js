/**
 * @fileoverview Example workflow step 2 for testing workflow functionality.
 * 
 * This step demonstrates the continuation of workflow processing from step 1.
 * It processes the enriched data from the previous step and adds additional
 * step-specific information. Used for testing multi-step workflow execution.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Second example workflow step.
 * 
 * Processes data from step 1 and adds step2-specific metadata. Demonstrates
 * sequential data processing and workflow step chaining.
 * 
 * @async
 * @function exampleStep2
 * @param {Object} data - Enhanced data from step 1 containing step1Processed flag
 * @returns {Promise<Object>} Further enhanced data object with step2 processing markers
 */
module.exports = async (data) => {
  console.log('Executing Step 2 with data:', data);
  return { ...data, step2Processed: true, message: 'Hello from Step 2' };
};
