/**
 * @fileoverview Example workflow step 2.
 */

module.exports = async (data) => {
  console.log('Executing Step 2 with data:', data);
  return { ...data, step2Processed: true, message: 'Hello from Step 2' };
};
