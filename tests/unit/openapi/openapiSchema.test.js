/**
 * @fileoverview Validates the merged OpenAPI document (feature 10) against the
 * official OpenAPI 3.1 JSON Schema, and every schema inside it against JSON
 * Schema 2020-12. Also regenerates the typed TypeScript client from the whole
 * document and compiles it with `tsc --strict`, so a documentation change that
 * would break the generated client fails CI.
 *
 * `oas-3.1-schema-2022-10-07.json` is the published schema from
 * https://spec.openapis.org/oas/3.1/schema/2022-10-07 (Apache-2.0, OpenAPI
 * Initiative), kept in the repo so the test runs offline. Ajv resolves its
 * `$dynamicRef: "#meta"` incorrectly (it checks Schema Objects as if they were
 * Parameter Objects), so the test points that reference at the plain Schema
 * Object definition; the second test then checks each Schema Object properly.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const { EventEmitter } = require('events');
const Ajv2020 = require('ajv/dist/2020').default;
const registry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { generateTypeScriptClient } = require('../../../src/cli/tsClient');
const oasSchema = require('./oas-3.1-schema-2022-10-07.json');

/** Every Schema Object in the document, with where it was found. */
function schemaObjects(doc) {
  const out = [];
  const take = (schema, where) => { if (schema && typeof schema === 'object' && !schema.$ref) out.push({ schema, where }); };
  for (const [name, schema] of Object.entries(doc.components?.schemas || {})) take(schema, `components.schemas.${name}`);
  for (const [name, param] of Object.entries(doc.components?.parameters || {})) take(param.schema, `components.parameters.${name}`);
  for (const [p, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!op || typeof op !== 'object') continue;
      for (const param of op.parameters || []) take(param.schema, `${method} ${p} parameter ${param.name}`);
      for (const [type, media] of Object.entries(op.requestBody?.content || {})) take(media.schema, `${method} ${p} body ${type}`);
      for (const [code, res] of Object.entries(op.responses || {})) {
        for (const [type, media] of Object.entries(res.content || {})) take(media.schema, `${method} ${p} ${code} ${type}`);
      }
    }
  }
  return out;
}

describe('merged OpenAPI document against the OpenAPI 3.1 schema (feature 10)', () => {
  let doc;

  beforeAll(() => {
    const dir = testDataDir('openapi-schema');
    const app = express();
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], security: { servicesAuth: { requireLogin: false } } });
    registry.logger('memory'); registry.cache('memory'); registry.fetching('node');
    registry.filing('local', { baseDir: path.join(dir, 'files') }); registry.queue('memory');
    registry.scheduling('memory'); registry.searching('memory'); registry.measuring('memory');
    registry.notifying('memory'); registry.working('memory'); registry.workflow('memory');
    registry.settings('file', { filepath: path.join(dir, 'settings.json'), secret: 'x'.repeat(32) });
    registry.aiservice('mock', {}); registry.authservice('memory', {}); registry.dataService('memory');
    registry.knowledge('default', { container: 'openapi-schema-kb', persist: false, dependencies: { aiservice: registry.aiservice('mock', {}) } });
    doc = registry.buildOpenApi();
  });

  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  it('is a valid OpenAPI 3.1 document', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false, logger: false });
    const schema = JSON.parse(JSON.stringify(oasSchema).replace(/"\$dynamicRef":"#meta"/g, '"$ref":"#/$defs/schema"'));
    const validate = ajv.compile(schema);
    const valid = validate(doc);
    const errors = (validate.errors || []).slice(0, 10).map((e) => `${e.instancePath} ${e.message}`);
    expect({ valid, errors }).toEqual({ valid: true, errors: [] });
  });

  it('contains only valid JSON Schema 2020-12 schemas', () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false, logger: false });
    const found = schemaObjects(doc);
    expect(found.length).toBeGreaterThan(100);
    const invalid = found
      .filter(({ schema }) => !ajv.validateSchema(schema))
      .map(({ where }) => where);
    expect(invalid).toEqual([]);
  });

  it('regenerates a typed client for every service that compiles under tsc --strict', () => {
    const dir = testDataDir(`openapi-client-${process.pid}`);
    const file = path.join(dir, 'client.ts');
    fs.writeFileSync(file, generateTypeScriptClient(doc));
    const source = fs.readFileSync(file, 'utf8');
    for (const group of ['caching', 'queueing', 'scheduling', 'authservice', 'knowledge']) {
      expect(source).toMatch(new RegExp(`readonly ${group}\\b|${group}:`, 'i'));
    }
    const tsc = require.resolve('typescript/bin/tsc');
    const compiled = spawnSync(process.execPath, [
      tsc, '--strict', '--noEmit', '--target', 'ES2020', '--module', 'commonjs', '--lib', 'ES2020', file
    ], { encoding: 'utf8' });
    expect((compiled.stdout + compiled.stderr).split('\n').slice(0, 10).join('\n')).toBe('');
    expect(compiled.status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it('rejects a document with a broken operation, so the check is real', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false, logger: false });
    const schema = JSON.parse(JSON.stringify(oasSchema).replace(/"\$dynamicRef":"#meta"/g, '"$ref":"#/$defs/schema"'));
    const validate = ajv.compile(schema);
    const broken = JSON.parse(JSON.stringify(doc));
    const [firstPath] = Object.keys(broken.paths);
    const [firstMethod] = Object.keys(broken.paths[firstPath]);
    broken.paths[firstPath][firstMethod].parameters = [{ name: 'x' }];
    expect(validate(broken)).toBe(false);
  });
});
