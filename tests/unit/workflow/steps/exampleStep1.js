/**
 * @fileoverview Example workflow step 1 for testing workflow functionality.
 * 
 * This step demonstrates the basic structure of a workflow step. It processes
 * input data, adds step-specific information, and passes the data to the next step.
 * Used for testing workflow execution, data flow, and step chaining.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * First example workflow step.
 * 
 * Processes input data and adds step1-specific metadata. Demonstrates
 * data transformation and enrichment within a workflow step.
 * 
 * @async
 * @function exampleStep1
 * @param {Object} data - Input data from previous step or workflow initialization
 * @returns {Promise<Object>} Enhanced data object with step1 processing markers
 */
module.exports = async (data) => {
  console.log('Executing Step 1 with data:', data);
  return { ...data, step1Processed: true, message: 'Hello from Step 1' };
};
