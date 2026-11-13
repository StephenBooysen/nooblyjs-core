/**
 * @fileoverview Authorization matrix generated from the route declarations
 * (feature 22). Every declared /services/*\/api route is called through the
 * strict permission gate as a `user` and as an `editor`, and the outcome must
 * match what the role grants. Adding a route to routePermissions.js adds a case
 * here with no test edits.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createPermissionGate } = require('../../../src/authservice/middleware/permissionGate');
const { RouteDeclarations } = require('../../../src/authservice/modules/routeDeclarations');
const { ROUTE_PERMISSIONS } = require('../../../src/authservice/config/routePermissions');
const { PUBLIC, ROLE_PERMISSIONS, permissionsForRoles, hasPermission } = require('../../../src/authservice/modules/permissions');

/** Turns a declared pattern into a concrete path: `:name` → `x`, wildcards → `x/y`. */
function concretePath(pattern) {
  return pattern
    .replace(/:[A-Za-z]+\(\*\)/g, 'x/y')
    .replace(/\*/g, 'x/y')
    .replace(/:[A-Za-z]+\??/g, 'x');
}

const PRINCIPALS = { user: ['user'], editor: ['editor'] };

const app = express();
app.use(express.json());
app.use('/services', createPermissionGate({
  resolvePrincipal: async (req) => {
    const who = req.headers['x-principal'];
    return PRINCIPALS[who] ? { principal: who, roles: PRINCIPALS[who] } : null;
  },
  declarations: new RouteDeclarations(),
  strict: () => true
}));
app.all('/services/*', (req, res) => res.json({ reached: true }));

const ENTRIES = Object.entries(ROUTE_PERMISSIONS).map(([key, permission]) => {
  const [method, pattern] = key.split(' ');
  return { key, method: method === 'ALL' ? 'get' : method.toLowerCase(), path: concretePath(pattern), permission };
});

describe('generated authorization matrix (feature 22)', () => {
  it('declares only "service:action" permissions or public', () => {
    for (const { key, permission } of ENTRIES) {
      expect({ key, ok: permission === PUBLIC || /^[a-z]+:[a-z*]+$/.test(permission) }).toEqual({ key, ok: true });
    }
  });

  it('has a grant for every permission a role is meant to hold, and no role holds an undeclared permission', () => {
    const declared = new Set(ENTRIES.map((e) => e.permission));
    for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
      for (const grant of grants) {
        if (grant === '*' || grant.endsWith(':*')) continue;
        expect({ role, grant, known: declared.has(grant) }).toEqual({ role, grant, known: true });
      }
    }
  });

  for (const entry of ENTRIES) {
    for (const role of ['user', 'editor']) {
      const allowed = entry.permission === PUBLIC || hasPermission(permissionsForRoles([role]), entry.permission);
      it(`${entry.key} as ${role} -> ${allowed ? 'reached' : '403'}`, async () => {
        const req = request(app)[entry.method](entry.path).set('x-principal', role);
        const res = await (entry.method === 'post' || entry.method === 'put' || entry.method === 'patch' ? req.send({}) : req);
        if (allowed) {
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('PERMISSION_DENIED');
        }
      });
    }
  }
});
