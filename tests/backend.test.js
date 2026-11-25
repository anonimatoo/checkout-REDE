import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../backend/src/app.js';
import { loadConfig } from '../backend/src/config.js';
import { migrate, openPool } from '../backend/src/db.js';
import { csv } from '../backend/src/orders.js';
import { digest, hashPassword, seal, token, unseal, verifyPassword } from '../backend/src/security.js';

test('protege senhas, tokens e exportações CSV', async () => {
  const password = 'uma senha temporária de teste';
  const encoded = await hashPassword(password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('uma senha errada', encoded), false);
  const key = randomBytes(32);
  const sensitive = token();
  const sealed = seal(sensitive, key, 'order-1');
  assert.equal(unseal(sealed, key, 'order-1'), sensitive);
  assert.throws(() => unseal(sealed, key, 'order-2'));
  assert.match(csv([['=1+1', 'texto;"']]), /"'=1\+1";"texto;"""/);
});

const testDatabase = process.env.TEST_DATABASE_URL;
test('autenticação, criação idempotente, link protegido, configuração e cancelamento via PostgreSQL', {
  skip: !testDatabase && 'Configure TEST_DATABASE_URL com um banco dedicado.',
}, async t => {
  const key = randomBytes(32).toString('base64');
  const config = loadConfig({ DATABASE_URL: testDatabase, LINK_ENCRYPTION_KEY: key, APP_ORIGIN: 'https://checkout.example' });
  const pool = openPool(testDatabase);
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await pool.query('CREATE SCHEMA ' + schema);
  const connection = new URL(testDatabase);
  connection.searchParams.set('options', '-c search_path=' + schema);
  const db = openPool(connection.href);
  t.after(async () => {
    await db.end();
    await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
    await pool.end();
  });
  await migrate(db);
  await migrate(db);
  const app = await buildApp(config, db, { frontend: false });
  t.after(() => app.close());
  const headers = { origin: config.origin };
  const email = 'lojista@example.org';
  const password = 'uma senha comprida de teste';
  const admin = randomUUID();
  await db.query('INSERT INTO administrators (id, singleton, email, password_hash) VALUES ($1,true,$2,$3)',
    [admin, email, await hashPassword(password)]);

  assert.equal((await app.inject('/api/admin/pedidos')).statusCode, 401);
  const badOrigin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://external.example' }, payload: { email, password } });
  assert.equal(badOrigin.statusCode, 403);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });
  assert.equal(login.statusCode, 200, login.body);
  assert.match(login.headers['set-cookie'], /__Host-csrede-session=.+HttpOnly; Secure; SameSite=Strict/);
  const cookie = login.headers['set-cookie'].split(';')[0];
  const csrf = login.json().user.csrf;
  const session = { ...headers, cookie };
  const signed = { ...session, 'x-csrf-token': csrf };
  const payload = { cents: 259900, maxInstallments: 3, reference: '=2+3', description: 'Pedido teste', days: 7 };
  const create = (payload, key = randomUUID(), auth = signed) => app.inject({ method: 'POST', url: '/api/admin/pedidos',
    headers: { ...auth, 'idempotency-key': key }, payload });
  assert.equal((await create(payload, randomUUID(), session)).statusCode, 403);
  assert.equal((await create({ ...payload, cents: 99 })).statusCode, 400);
  assert.equal((await create({ ...payload, cents: 1000, maxInstallments: 3 })).statusCode, 400);

  const orderKey = randomUUID();
  const results = await Promise.all([create(payload, orderKey), create(payload, orderKey)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 201], results.map(result => result.body).join(' '));
  const [first, repeat] = results.map(result => result.json());
  assert.equal(first.id, repeat.id);
  assert.equal(first.url, repeat.url);
  assert.equal((await create({ ...payload, cents: 260000 }, orderKey)).statusCode, 409);
  const publicPath = '/api' + new URL(first.url).pathname.replace('/pedido/', '/pedidos/');
  const order = await app.inject(publicPath + '?cents=1');
  assert.equal(order.json().cents, 259900);
  assert.equal(order.json().maxInstallments, 3);
  assert.equal(order.json().status, 'open');
  assert.equal(order.json().id, undefined);
  assert.match(order.headers['cache-control'], /no-store/);
  assert.equal((await app.inject(publicPath + 'a')).statusCode, 404);

  const report = await app.inject({ url: '/api/admin/pedidos?format=csv', headers: { cookie } });
  assert.match(report.body, /"'=2\+3"/);
  const resumo = await app.inject({ url: '/api/admin/resumo?period=30dias', headers: { cookie } });
  assert.deepEqual(resumo.json(), { total: 1, volume: '259900', open: 1, expired: 0, canceled: 0 });

  const ip = await app.inject({ method: 'PUT', url: '/api/admin/ip', headers: signed, payload: { cidr: '203.0.113.10' } });
  assert.equal(ip.json().store.authorizedCidr, '203.0.113.10/32', ip.body);
  const invalidIp = await app.inject({ method: 'PUT', url: '/api/admin/ip', headers: signed, payload: { cidr: '203.0.113.10/200' } });
  assert.equal(invalidIp.statusCode, 400, invalidIp.body);
  const diagnostics = await app.inject({ method: 'POST', url: '/api/admin/diagnostico', headers: signed, payload: {} });
  assert.ok(diagnostics.json().tests.some(check => check.name === 'PostgreSQL' && check.status === 'Aprovado'));
  assert.ok(diagnostics.json().tests.some(check => check.name === 'Ambientes maxiPago!' && check.status === 'Não suportado'));

  const cancelPath = '/api/admin/pedidos/' + first.id + '/cancelar';
  assert.equal((await app.inject({ method: 'POST', url: cancelPath, headers: signed, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: cancelPath, headers: signed, payload: { confirm: true } })).statusCode, 200);
  assert.equal((await app.inject(publicPath)).json().status, 'canceled');
  assert.equal((await app.inject({ method: 'POST', url: cancelPath, headers: signed, payload: { confirm: true } })).statusCode, 409);

  const secret = token();
  await db.query("INSERT INTO reset_tokens (digest, admin_id, expires_at) VALUES ($1,$2,now() + interval '5 minutes')", [digest(secret), admin]);
  const recovery = () => app.inject({ method: 'POST', url: '/api/auth/recovery', headers, payload: { secret, password: password + '!' } });
  assert.equal((await recovery()).statusCode, 200);
  assert.equal((await recovery()).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/admin/pedidos', headers: { cookie } })).statusCode, 401);
});
