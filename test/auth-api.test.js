import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHoopsLiveObsHandler } from '../lib/hoopslive-obs/routes.js';
import { createCountdownStore } from '../lib/hoopslive-obs/countdown.js';

const TOKEN = 'test-hoopslive-token-abc';
const SECRET = 'overlay-secret-xyz';

describe('hoopslive obs HTTP auth + API', () => {
  /** @type {http.Server} */
  let server;
  /** @type {number} */
  let port;

  before(async () => {
    process.env.HOOPSLIVE_OBS_TOKEN = TOKEN;
    process.env.OBS_PATH_SECRET = SECRET;
    delete process.env.HOOPSLIVE_OBS_PUBLIC_PATH_SECRET;
    process.env.HOOPSLIVE_OBS_CORS_ORIGIN = 'https://example.test';
    delete process.env.HOOPSLIVE_OBS_IP_ALLOWLIST;

    const handler = createHoopsLiveObsHandler({ store: createCountdownStore(120) });
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (await handler.handle(req, res, url)) return;
      res.writeHead(404);
      res.end('no');
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function request(method, path, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(raw);
            } catch {
              /* text */
            }
            resolve({ status: res.statusCode, headers: res.headers, raw, json });
          });
        },
      );
      req.on('error', reject);
      if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  it('GET countdown without token → 401', async () => {
    const res = await request('GET', '/api/hoopslive/obs/countdown');
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'Unauthorized');
  });

  it('POST countdown without token → 401', async () => {
    const res = await request('POST', '/api/hoopslive/obs/countdown', {
      headers: { 'Content-Type': 'application/json' },
      body: { action: 'toggle' },
    });
    assert.equal(res.status, 401);
  });

  it('POST with ?k= only is still 401 (mutations refuse query)', async () => {
    const res = await request('POST', `/api/hoopslive/obs/countdown?k=${TOKEN}`, {
      headers: { 'Content-Type': 'application/json' },
      body: { action: 'toggle' },
    });
    assert.equal(res.status, 401);
  });

  it('GET with Bearer works', async () => {
    const res = await request('GET', '/api/hoopslive/obs/countdown', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.remainingSec, 'number');
    assert.equal(typeof res.json.durationSec, 'number');
    assert.equal(typeof res.json.running, 'boolean');
  });

  it('POST with X-HoopsLive-Token set/add/toggle', async () => {
    let res = await request('POST', '/api/hoopslive/obs/countdown', {
      headers: { 'Content-Type': 'application/json', 'X-HoopsLive-Token': TOKEN },
      body: { action: 'set', durationSec: 42 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.durationSec, 42);
    assert.equal(res.json.remainingSec, 42);

    res = await request('POST', '/api/hoopslive/obs/countdown', {
      headers: { 'Content-Type': 'application/json', 'X-HoopsLive-Token': TOKEN },
      body: { action: 'add', seconds: 8 },
    });
    assert.equal(res.json.remainingSec, 50);

    res = await request('POST', '/api/hoopslive/obs/countdown', {
      headers: { 'Content-Type': 'application/json', 'X-HoopsLive-Token': TOKEN },
      body: { action: 'toggle' },
    });
    assert.equal(res.json.running, true);
  });

  it('GET with ?k= works for overlay reads', async () => {
    const res = await request('GET', `/api/hoopslive/obs/countdown?k=${TOKEN}`);
    assert.equal(res.status, 200);
  });

  it('wrong overlay secret → 404', async () => {
    const res = await request('GET', '/hl-obs/wrong-secret/scenes/start.html');
    assert.equal(res.status, 404);
  });

  it('correct overlay secret serves start.html', async () => {
    const res = await request('GET', `/hl-obs/${SECRET}/scenes/start.html`);
    assert.equal(res.status, 200);
    assert.match(res.raw, /HoopsLive/);
  });

  it('overlay directory listing denied', async () => {
    const res = await request('GET', `/hl-obs/${SECRET}/scenes/`);
    assert.equal(res.status, 404);
  });

  it('CORS header present when configured', async () => {
    const res = await request('GET', '/api/hoopslive/obs/countdown', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.test');
  });
});
