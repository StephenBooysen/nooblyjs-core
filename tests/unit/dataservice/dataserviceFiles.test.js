/**
 * @fileoverview Unit tests for the file-backed dataservice provider.
 *
 * Covers CRUD and search, input validation (container names, reserved keys,
 * non-object values), corrupt-file handling, settings, serialisation of
 * concurrent writes to the same container file (which previously lost all
 * but the last write), and reads during a write (which could see an empty or
 * half-written file).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('events');

const FileDataProvider = require('../../../src/dataservice/providers/dataservicefiles');
const { testDataDir } = require('../../helpers/testData');

describe('File dataservice provider', () => {
  let dir;
  let provider;
  let events;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('dataservice'), 'nooblyjs-dsfiles-'));
    events = new EventEmitter();
    jest.spyOn(events, 'emit');
    provider = new FileDataProvider({ dataDir: dir }, events);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every record when adds, updates and removes run concurrently', async () => {
    const keys = await Promise.all(Array.from({ length: 25 }, (_, i) => provider.add('c', { i })));
    expect(await provider.count('c')).toBe(25);

    await Promise.all([
      ...keys.slice(0, 10).map((k) => provider.remove('c', k)),
      ...keys.slice(10, 20).map((k, i) => provider.update('c', k, { i, updated: true }))
    ]);
    expect(await provider.count('c')).toBe(15);
    expect((await provider.find('c')).filter((o) => o.updated)).toHaveLength(10);
  });

  it('never shows a reader half a file while a write is going', async () => {
    // A container big enough that writing it takes more than one chunk, rewritten while it is read.
    const big = 'x'.repeat(2000);
    const seed = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, { i, big }]));
    fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify(seed));
    const failures = [];
    let writing = true;
    const writes = (async () => {
      for (let n = 0; n < 15; n++) await provider.update('c', `k${n}`, { n, big });
      writing = false;
    })();
    while (writing) {
      await Promise.all([provider.listAll('c'), provider.getByUuid('c', 'k1'), provider.count('c')])
        .catch((err) => failures.push(err.message));
    }
    await writes;
    expect(failures).toEqual([]);
    expect(await provider.count('c')).toBe(300);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  }, 20000);

  it('keeps writing after a failed write', async () => {
    const original = provider._writeContainerData.bind(provider);
    provider._writeContainerData = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(original);
    await expect(provider.add('c', { a: 1 })).rejects.toThrow('disk full');
    await provider.add('c', { b: 2 });
    expect(await provider.count('c')).toBe(1);
  });

  it('creates containers once', async () => {
    await provider.createContainer('orders');
    expect(fs.existsSync(path.join(dir, 'orders.json'))).toBe(true);
    await expect(provider.createContainer('orders')).rejects.toThrow("Container 'orders' already exists.");
    expect(events.emit).toHaveBeenCalledWith('api-dataservice-createContainer', { containerName: 'orders' });
  });

  it('reads, updates, finds nested values and removes records', async () => {
    const id = await provider.add('people', { name: 'Ada', address: { city: 'London' } });
    await provider.add('people', { name: 'Bob', address: { city: 'Paris' } });

    expect(await provider.getByUuid('people', id)).toEqual({ name: 'Ada', address: { city: 'London' } });
    expect(await provider.getByUuid('people', 'missing')).toBeNull();
    expect(await provider.find('people', 'LOND')).toEqual([{ name: 'Ada', address: { city: 'London' } }]);
    expect(await provider.find('people', '  ')).toHaveLength(2);
    expect(await provider.listAll('people')).toHaveLength(2);

    expect(await provider.update('people', id, { name: 'Ada L' })).toBe(true);
    expect(await provider.update('people', 'missing', {})).toBe(false);
    expect(await provider.remove('people', id)).toBe(true);
    expect(await provider.remove('people', id)).toBe(false);
    expect(await provider.count('people')).toBe(1);
    expect(await provider.count('empty')).toBe(0);
  });

  it('validates container names, keys and values', async () => {
    await expect(provider.createContainer('../escape')).rejects.toThrow('path separators');
    await expect(provider.createContainer('')).rejects.toThrow('non-empty string');
    await expect(provider.add('', {})).rejects.toThrow('Invalid containerName');
    await expect(provider.add('c', null)).rejects.toThrow('Invalid jsonObject');
    await expect(provider.add('c', [1])).rejects.toThrow('Invalid jsonObject');
    await expect(provider.remove('', 'k')).rejects.toThrow('Invalid containerName');
    await expect(provider.remove('c', '')).rejects.toThrow('Invalid objectKey');
    await expect(provider.getByUuid('c', '__proto__')).rejects.toThrow('reserved prototype key');
    await expect(provider.update('c', 'constructor', {})).rejects.toThrow('reserved prototype key');
    await expect(provider.find('', 'x')).rejects.toThrow('Invalid containerName');
    await expect(provider.find('a/b', 'x')).rejects.toThrow('path separators');
    expect(events.emit).toHaveBeenCalledWith('api-dataservice-validation-error', expect.objectContaining({ method: 'add' }));
  });

  it('reports corrupt container files', async () => {
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    await expect(provider.find('broken')).rejects.toThrow();
    await expect(provider.count('broken')).rejects.toThrow();
    await expect(provider.getByUuid('broken', 'k')).rejects.toThrow();
    expect(events.emit).toHaveBeenCalledWith('api-dataservice-error', expect.objectContaining({ operation: 'getByUuid' }));
  });

  it('gets and saves settings and closes', async () => {
    await provider.saveSettings({ autoBackup: true });
    expect((await provider.getSettings()).autoBackup).toBe(true);
    await provider.close();
  });
});
