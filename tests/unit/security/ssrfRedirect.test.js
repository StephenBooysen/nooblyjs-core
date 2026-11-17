'use strict';

/**
 * @fileoverview Regression tests for the SSRF redirect bypass. The guard used
 * to check only the URL the caller asked for; the HTTP clients then followed
 * redirects to private addresses unchecked.
 */

const http = require('node:http');
const { followRedirects } = require('../../../src/fetching/modules/ssrfGuard');
const FetchingNode = require('../../../src/fetching/providers/fetchingnode');
const FetchingAxios = require('../../../src/fetching/providers/fetchingaxios');

describe('SSRF guard — redirects are validated hop by hop', () => {
  describe('followRedirects', () => {
    it('refuses a redirect to a private address', async () => {
      const send = jest.fn(async (url) => (
        url === 'http://localhost/start'
          ? { status: 302, location: 'http://127.0.0.1/admin', response: null }
          : { status: 200, location: null, response: 'secret' }
      ));
      await expect(
        followRedirects('http://localhost/start', { method: 'GET', hasBody: false, send },
          { allowedHosts: ['localhost'] })
      ).rejects.toThrow(/allow-list/);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('returns the final URL when every hop is allowed', async () => {
      const send = async (url) => (
        url === 'http://localhost/a'
          ? { status: 301, location: '/b', response: null }
          : { status: 200, location: null, response: 'ok' }
      );
      const result = await followRedirects('http://localhost/a',
        { method: 'GET', hasBody: false, send }, { allowedHosts: ['localhost'] });
      expect(result.url).toBe('http://localhost/b');
      expect(result.response).toBe('ok');
    });

    it('turns a POST into a GET without a body on 303, keeps it on 307', async () => {
      const seen = [];
      const send = async (url, opts) => {
        seen.push({ url, ...opts });
        if (url.endsWith('/one')) return { status: 303, location: '/two', response: null };
        if (url.endsWith('/two')) return { status: 307, location: '/three', response: null };
        return { status: 200, location: null, response: 'done' };
      };
      await followRedirects('http://localhost/one',
        { method: 'POST', hasBody: true, send }, { allowedHosts: ['localhost'] });
      expect(seen[1]).toMatchObject({ method: 'GET', keepBody: false });
      expect(seen[2]).toMatchObject({ method: 'GET', keepBody: false });
    });

    it('stops after the redirect limit', async () => {
      const send = async () => ({ status: 302, location: '/loop', response: null });
      await expect(
        followRedirects('http://localhost/', { method: 'GET', hasBody: false, send },
          { allowedHosts: ['localhost'] }, 2)
      ).rejects.toThrow(/Too many redirects/);
    });
  });

  describe('providers against a live server', () => {
    let server;
    let base;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/redirect-to-private') {
          // Redirects to a loopback address; the host allow-list must refuse it.
          res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/secret` });
          return res.end();
        }
        if (req.url === '/redirect-local') {
          res.writeHead(302, { Location: '/landing' });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(req.url === '/landing' ? 'landed' : 'secret');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://localhost:${server.address().port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    const ssrf = { allowedHosts: ['localhost'] };

    it.each([
      ['node', FetchingNode],
      ['axios', FetchingAxios]
    ])('%s provider refuses a redirect from an allowed host to a private one', async (_name, Provider) => {
      const provider = new Provider({ ssrf, cacheTime: 0, timeout: 2000 }, null);
      await expect(provider.fetch(`${base}/redirect-to-private`)).rejects.toThrow();
      await provider.destroy?.();
    });

    it.each([
      ['node', FetchingNode],
      ['axios', FetchingAxios]
    ])('%s provider follows a redirect that stays on an allowed host', async (_name, Provider) => {
      const provider = new Provider({ ssrf, cacheTime: 0, timeout: 2000 }, null);
      const response = await provider.fetch(`${base}/redirect-local`);
      const body = typeof response.text === 'function' ? await response.text() : response.data;
      expect(body).toBe('landed');
      await provider.destroy?.();
    });
  });
});
