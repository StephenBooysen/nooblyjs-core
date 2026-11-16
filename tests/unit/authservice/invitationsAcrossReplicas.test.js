'use strict';

const Redis = require('ioredis');
const { EventEmitter } = require('node:events');
const AuthMemory = require('../../../src/authservice/providers/authMemory');
const { createStateStore } = require('../../../src/shared/utils/stateStore');

const redisUrl = process.env.REDIS_URL;
const runRedis = process.env.RUN_REDIS_TESTS === '1' && Boolean(redisUrl);
const describeRedis = runRedis ? describe : describe.skip;

const PASSWORD = 'Correct-Horse-Battery-9';

describeRedis('invitations across replicas (feature 21)', () => {
  const clients = [];
  const replicaWith = () => {
    const client = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    clients.push(client);
    return new AuthMemory({ stateStore: createStateStore({ redisClient: client }) }, new EventEmitter());
  };

  afterAll(async () => {
    for (const client of clients) await client.quit().catch(() => {});
  });

  it('redeems an invitation on a different replica from the one that issued it', async () => {
    const issuer = replicaWith();
    const redeemer = replicaWith();
    const email = `invitee-${Date.now()}@example.test`;

    const invitation = await issuer.createInvitation({ name: 'Ana Example', email });
    expect(invitation.code).toMatch(/^INV-/);

    expect(await redeemer.getInvitation(invitation.code)).toMatchObject({ status: 'approved', email });
    const user = await redeemer.redeemInvitation(invitation.code, PASSWORD);
    expect(user).toBeTruthy();

    // Used once, on any replica.
    await expect(issuer.redeemInvitation(invitation.code, PASSWORD)).rejects.toThrow(/already been used|invalid|expired/i);
  });

  it('lets exactly one of two simultaneous redemptions on two replicas succeed', async () => {
    const issuer = replicaWith();
    const first = replicaWith();
    const second = replicaWith();
    const email = `race-${Date.now()}@example.test`;
    const { code } = await issuer.createInvitation({ name: 'Race Example', email });

    const results = await Promise.allSettled([
      first.redeemInvitation(code, PASSWORD),
      second.redeemInvitation(code, PASSWORD)
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('lists the invitations of every replica from the shared index', async () => {
    const issuerA = replicaWith();
    const issuerB = replicaWith();
    const viewer = replicaWith();
    const stamp = Date.now();
    const a = await issuerA.createInvitation({ name: 'List A', email: `list-a-${stamp}@example.test` });
    const b = await issuerB.createInvitation({ name: 'List B', email: `list-b-${stamp}@example.test` });

    const listed = await viewer.listInvitations();
    const ids = listed.map((inv) => inv.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(listed.every((inv) => !('codeHash' in inv))).toBe(true);
  });

  it('refuses an unknown code on every replica', async () => {
    const replica = replicaWith();
    await expect(replica.getInvitation('INV-00000000000000000000000000000000')).rejects.toThrow(/not found/);
  });
});
