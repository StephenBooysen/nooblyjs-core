'use strict';

const express = require('express');
const request = require('supertest');
const Redis = require('ioredis');
const { EventEmitter } = require('node:events');
const authRoutes = require('../../../src/authservice/routes');
const { createStateStore, MemoryStateStore } = require('../../../src/shared/utils/stateStore');

const redisUrl = process.env.REDIS_URL;
const runRedis = process.env.RUN_REDIS_TESTS === '1' && Boolean(redisUrl);
const describeRedis = runRedis ? describe : describe.skip;

/** An auth provider that accepts one password. */
const auth = {
  authenticateUser: async (email, password) => {
    if (password !== 'correct-horse') throw new Error('Invalid credentials');
    return { user: { email }, session: { token: 'token' } };
  },
  validateSession: async () => { throw new Error('no session'); }
};

/** One replica: its own Express app and its own state store. */
function replica(stateStore) {
  const app = express();
  app.use(express.json());
  authRoutes({ 'express-app': app, stateStore }, new EventEmitter(), auth, {});
  return app;
}

const login = (app, email, password) => request(app)
  .post('/services/authservice/api/login')
  .send({ email, password });

describe('login lockout is shared across replicas (feature 21)', () => {
  const saved = { ...process.env };

  beforeAll(() => {
    // Keep the per-IP limiter out of the way: this test is about the account lock.
    process.env.LOGIN_RATE_LIMIT_MAX = '1000';
    process.env.LOGIN_LOCK_THRESHOLD = '5';
  });

  afterAll(() => {
    process.env = saved;
  });

  describeRedis('with a shared Redis state store', () => {
    const clients = [];
    const connect = () => {
      const client = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
      clients.push(client);
      return createStateStore({ redisClient: client });
    };

    afterAll(async () => {
      for (const client of clients) await client.quit().catch(() => {});
    });

    it('locks an account after five failures spread across two replicas', async () => {
      const email = `shared-${Date.now()}@example.test`;
      const replicaA = replica(connect());
      const replicaB = replica(connect());

      for (let i = 0; i < 3; i += 1) await login(replicaA, email, 'wrong').expect(401);
      for (let i = 0; i < 2; i += 1) await login(replicaB, email, 'wrong').expect(401);

      // The sixth attempt is refused on either replica, even with the right password.
      await login(replicaB, email, 'wrong').expect(429);
      await login(replicaA, email, 'correct-horse').expect(429);
    });

    it('does not lock a different account', async () => {
      const locked = `locked-${Date.now()}@example.test`;
      const other = `other-${Date.now()}@example.test`;
      const app = replica(connect());
      for (let i = 0; i < 5; i += 1) await login(app, locked, 'wrong');
      await login(app, locked, 'correct-horse').expect(429);
      await login(app, other, 'correct-horse').expect(200);
    });
  });

  describe('with per-process memory (one replica only)', () => {
    it('counts failures per replica, so the lock needs five on one replica', async () => {
      const email = `memory-${Date.now()}@example.test`;
      const replicaA = replica(new MemoryStateStore());
      const replicaB = replica(new MemoryStateStore());

      for (let i = 0; i < 3; i += 1) await login(replicaA, email, 'wrong').expect(401);
      for (let i = 0; i < 2; i += 1) await login(replicaB, email, 'wrong').expect(401);

      // Neither replica has seen five failures, so neither has locked the account.
      await login(replicaB, email, 'wrong').expect(401);
      await login(replicaA, email, 'correct-horse').expect(200);
    });
  });
});
