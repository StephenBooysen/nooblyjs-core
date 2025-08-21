/**
 * @fileoverview Example workflow step 1.
 */

module.exports = async (data) => {
  console.log('Executing Step 1 with data:', data);
  return { ...data, step1Processed: true, message: 'Hello from Step 1' };
};
