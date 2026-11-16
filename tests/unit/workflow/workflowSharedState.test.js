'use strict';

/**
 * @fileoverview Workflow state in clustered mode (feature 21): the snapshot is
 * saved to the shared store after each change and loaded by a replacement
 * instance. Writers are last-writer-wins; this covers a restart or handover.
 */

const { EventEmitter } = require('node:events');
const createWorkflowService = require('../../../src/workflow');
const { MemoryStateStore } = require('../../../src/shared/utils/stateStore');

const workingDouble = {
  execute: async () => ({ success: true, output: null })
};

describe('workflow state in clustered mode (feature 21)', () => {
  let store;
  const make = (options = {}) => createWorkflowService('memory', {
    autoStartScheduler: false,
    stateStore: store,
    stateKey: 'workflow:state:test',
    ...options,
    dependencies: { working: workingDouble }
  }, new EventEmitter());

  beforeEach(() => { store = new MemoryStateStore(); });

  it('saves the snapshot after a change and a new instance loads it', async () => {
    const first = make();
    await first.createWorkflow({ name: 'nightly', group: 'ops', steps: ['a.js'] });
    await first.ready();

    const replacement = make();
    await replacement.ready();
    expect(replacement.getWorkflow('nightly')).toMatchObject({ group: 'ops' });
    first.shutdown();
    replacement.shutdown();
  });

  it('starts empty when the shared store has no snapshot', async () => {
    const svc = make();
    await svc.ready();
    expect(svc.listWorkflows()).toEqual([]);
    svc.shutdown();
  });

  it('prefers an explicit state option over the shared snapshot', async () => {
    const first = make();
    await first.createWorkflow({ name: 'stored', steps: ['a.js'] });
    await first.ready();
    const explicit = make({ state: first.exportState({ includeExecutions: false }) });
    await explicit.ready();
    expect(explicit.getWorkflow('stored')).toBeTruthy();
    first.shutdown();
    explicit.shutdown();
  });

  it('keeps working without a shared store', async () => {
    const svc = createWorkflowService('memory', { autoStartScheduler: false, dependencies: { working: workingDouble } }, new EventEmitter());
    await svc.createWorkflow({ name: 'local', steps: ['a.js'] });
    await expect(svc.ready()).resolves.toBeUndefined();
    svc.shutdown();
  });
});
