'use strict';

/**
 * Runs the dataservice contract against a real MongoDB. Skipped unless
 * RUN_MONGODB_TESTS=1 and MONGODB_URL (for example mongodb://127.0.0.1:27017)
 * are set. Start one with: docker run -d -p 27017:27017 mongo:7
 * Each run uses its own database and drops it afterwards.
 */
const { EventEmitter } = require('events');
const { runDataserviceContract } = require('./dataservice.contract');

const enabled = process.env.RUN_MONGODB_TESTS === '1' && Boolean(process.env.MONGODB_URL);
const describeMongo = enabled ? describe : describe.skip;

describeMongo('mongodb dataservice provider', () => {
  const createDataservice = require('../../src/dataservice');
  const database = `nooblyjs_contract_${process.pid}`;
  runDataserviceContract(
    'mongodb',
    () => createDataservice('mongodb', { connectionString: process.env.MONGODB_URL, database, dependencies: {} }, new EventEmitter()),
    async (ds) => {
      const provider = ds.provider;
      try {
        await provider.ensureConnection_?.();
        await provider.db_?.dropDatabase?.();
      } catch (_err) {
        // The database may not exist yet.
      }
      await provider.close?.();
    }
  );
});
