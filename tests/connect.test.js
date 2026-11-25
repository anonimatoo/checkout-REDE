import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../backend/src/config.js';
import { token } from '../backend/src/security.js';
import { buildConnect, loadConnectConfig } from '../connect/src/app.js';
import { measureEgress, probeUrl } from '../connect/src/network.js';

test('Connect permite transporte HTTP somente em escopo local ou rede privada explícita', async () => {
  const secret = token();
  const env = { DATABASE_URL: 'postgres://localhost/test', LINK_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
    APP_ORIGIN: 'https://checkout.example', NODE_ENV: 'production', CONNECT_TOKEN: secret };
  assert.throws(() => loadConfig({ ...env, CONNECT_URL: 'http://connect:3400' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, CONNECT_URL: 'http://externo.example' }), /HTTPS/);
  assert.equal(loadConfig({ ...env, CONNECT_URL: 'http://connect:3400', CONNECT_PRIVATE_HTTP: 'true' }).connectUrl.hostname, 'connect');
  assert.throws(() => loadConfig({ ...env, CONNECT_URL: 'https://a:b@connect.example/' }), /HTTPS/);
  await assert.rejects(() => loadConnectConfig({ CONNECT_TOKEN: secret, CONNECT_HOST: '0.0.0.0' }), /TLS/);
  assert.throws(() => probeUrl('http://probe.example'), /HTTPS/);
});

test('Connect acerta autenticação e mede IP com respostas sanitizadas', async t => {
  const secret = token();
  let response = () => new Response('2001:db8::1\n');
  const app = buildConnect({ token: secret, egressUrl: new URL('https://probe.example/') }, {
    fetcher: async () => response(),
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/v1/network')).statusCode, 401);
  const headers = { authorization: 'Bearer ' + secret };
  assert.equal((await app.inject({ url: '/v1/health', headers })).json().status, 'ok');
  const first = await app.inject({ url: '/v1/network', headers });
  assert.equal(first.json().ip, '2001:db8::1');
  assert.equal(first.headers['cache-control'], 'no-store');
  response = () => new Response('198.51.100.10');
  assert.equal((await app.inject({ url: '/v1/network', headers })).json().changed, true);
  response = () => new Response('segredo upstream', { status: 403 });
  const failure = await app.inject({ url: '/v1/network', headers });
  assert.equal(failure.statusCode, 502);
  assert.deepEqual(failure.json(), { code: 'PROBE_HTTP', httpStatus: 403 });
  assert.ok(!failure.body.includes('segredo'));
  response = () => new Response('a'.repeat(129));
  assert.equal((await app.inject({ url: '/v1/network', headers })).json().code, 'PROBE_RESPONSE');
});

test('conserva códigos de diagnóstico DNS e rejeita respostas IP inválidas', async () => {
  const url = new URL('https://probe.example');
  await assert.rejects(measureEgress(url, async () => {
    throw new TypeError('request', { cause: { code: 'ENOTFOUND' } });
  }), { code: 'PROBE_DNS' });
  await assert.rejects(measureEgress(url, async () => new Response('fe80::1%eth0')), { code: 'PROBE_RESPONSE' });
});
