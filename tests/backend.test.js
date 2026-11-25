import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildConnect } from '../connect/src/app.js';
import { issueSetup } from '../backend/src/team.js';
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
const databaseRequired = { skip: !testDatabase && 'Configure TEST_DATABASE_URL com um banco dedicado.' };

async function testApp(t, env = {}) {
  const key = randomBytes(32).toString('base64');
  const config = loadConfig({ DATABASE_URL: testDatabase, LINK_ENCRYPTION_KEY: key, APP_ORIGIN: 'https://checkout.example', ...env });
  const pool = openPool(testDatabase);
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await pool.query('CREATE SCHEMA ' + schema);
  const connection = new URL(testDatabase);
  connection.searchParams.set('options', '-c search_path=' + schema);
  const db = openPool(connection.href);
  let app;
  t.after(async () => {
    await app?.close();
    await db.end();
    await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
    await pool.end();
  });
  await migrate(db);
  await migrate(db);
  app = await buildApp(config, db, { frontend: false });
  return { db, app, config };
}

test('autenticação, idempotência de pedidos, filtros, exportações e cancelamento via PostgreSQL', databaseRequired, async t => {
  const { db, app, config } = await testApp(t);
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
  const workbook = await app.inject({ url: '/api/admin/pedidos?format=xlsx&min=259900', headers: { cookie } });
  assert.equal(workbook.statusCode, 200, workbook.body.slice(0, 160));
  assert.match(workbook.headers['content-disposition'], /pedidos\.xlsx/);
  const cells = unzipSync(workbook.rawPayload);
  const sheet = strFromU8(cells['xl/worksheets/sheet1.xml']);
  const strings = cells['xl/sharedStrings.xml'] ? strFromU8(cells['xl/sharedStrings.xml']) : sheet;
  assert.match(strings, /=2\+3/);
  assert.doesNotMatch(sheet, /<f[\s>]/);
  const byId = await app.inject({ url: '/api/admin/pedidos?id=' + first.id, headers: { cookie } });
  assert.equal(byId.json().orders[0].id, first.id);
  const byReference = await app.inject({ url: '/api/admin/pedidos?id=' + encodeURIComponent(first.reference), headers: { cookie } });
  assert.equal(byReference.json().orders[0].id, first.id);
  const invalidRange = await app.inject({ url: '/api/admin/pedidos?min=2&max=1', headers: { cookie } });
  assert.equal(invalidRange.statusCode, 400);
  const excluded = await app.inject({ url: '/api/admin/pedidos?max=259899', headers: { cookie } });
  assert.equal(excluded.json().orders.length, 0);
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

test('assistente de uso único, convites, perfis e isolamento entre instalações', databaseRequired, async t => {
  const { db, app, config } = await testApp(t);
  const other = await testApp(t);
  const origin = { origin: config.origin };
  const email = 'dono@example.org';
  const password = 'senha de teste para primeiro acesso';
  const submit = (secret, headers = origin) => app.inject({ method: 'POST', url: '/api/auth/setup',
    headers, payload: { secret, email, password } });
  const expired = await issueSetup(db);
  const secret = await issueSetup(db);
  assert.deepEqual((await app.inject('/api/auth/setup')).json(), { initialized: false });
  assert.equal((await submit(secret, { origin: 'https://other.example' })).statusCode, 403);
  assert.equal((await submit(expired)).statusCode, 409);
  const results = await Promise.all([submit(secret), submit(secret)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
  assert.deepEqual((await app.inject('/api/auth/setup')).json(), { initialized: true });
  assert.deepEqual((await other.app.inject('/api/auth/setup')).json(), { initialized: false });

  async function signIn(address, expectedRole) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin, payload: { email: address, password } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.role, expectedRole);
    return { ...origin, cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().user.csrf };
  }
  const owner = await signIn(email, 'owner');
  assert.equal((await other.app.inject({ url: '/api/admin/pedidos', headers: owner })).statusCode, 401);
  const invalidRole = await app.inject({ method: 'POST', url: '/api/admin/equipe',
    headers: owner, payload: { email: 'outro@example.org', role: 'owner' } });
  assert.equal(invalidRole.statusCode, 400);

  async function activate(address, role) {
    const invite = await app.inject({ method: 'POST', url: '/api/admin/equipe', headers: owner, payload: { email: address, role } });
    assert.equal(invite.statusCode, 200, invite.body);
    const inviteSecret = new URL(invite.json().url).hash.slice(1);
    const recover = () => app.inject({ method: 'POST', url: '/api/auth/recovery',
      headers: origin, payload: { secret: inviteSecret, password } });
    assert.equal((await recover()).statusCode, 200);
    assert.equal((await recover()).statusCode, 400);
    return signIn(address, role);
  }
  const operator = await activate('operador@example.org', 'operator');
  const viewer = await activate('consulta@example.org', 'viewer');
  const create = auth => app.inject({ method: 'POST', url: '/api/admin/pedidos',
    headers: { ...auth, 'idempotency-key': randomUUID() }, payload: { cents: 20000, maxInstallments: 1, days: 1 } });
  assert.equal((await create(viewer)).statusCode, 403);
  const order = await create(operator);
  assert.equal(order.statusCode, 201, order.body);
  assert.equal((await app.inject({ url: '/api/admin/configuracao', headers: operator })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/admin/pedidos', headers: owner })).json().orders[0].id, order.json().id);
  assert.equal((await app.inject({ url: '/api/admin/pedidos', headers: viewer })).json().orders[0].url, null);
  const accounts = await app.inject({ url: '/api/admin/equipe', headers: owner });
  assert.equal(accounts.json().accounts.length, 3);
  const member = accounts.json().accounts.find(account => account.role === 'operator');
  const change = await app.inject({ method: 'PATCH', url: '/api/admin/equipe/' + member.id,
    headers: owner, payload: { role: 'viewer', disabled: false } });
  assert.equal(change.statusCode, 200, change.body);
  assert.equal((await app.inject({ url: '/api/admin/pedidos', headers: operator })).statusCode, 401);
  const formerOperator = await signIn(member.email, 'viewer');
  assert.equal((await create(formerOperator)).statusCode, 403);
  const block = await app.inject({ method: 'PATCH', url: '/api/admin/equipe/' + member.id,
    headers: owner, payload: { role: 'viewer', disabled: true } });
  assert.equal(block.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/admin/pedidos', headers: formerOperator })).statusCode, 401);
});

test('checkout consulta o processo Connect e audita mudança de saída com PostgreSQL', databaseRequired, async t => {
  const connectSecret = token();
  let measuredIp = '198.51.100.10';
  const connector = buildConnect({ token: connectSecret, egressUrl: new URL('https://probe.example/') }, {
    fetcher: async () => new Response(measuredIp),
  });
  t.after(() => connector.close());
  const connectUrl = await connector.listen({ host: '127.0.0.1', port: 0 });
  const { app, db, config } = await testApp(t, { CONNECT_URL: connectUrl, CONNECT_TOKEN: connectSecret });
  const password = 'senha de teste para diagnóstico';
  const email = 'infra@example.org';
  await db.query('INSERT INTO administrators (id, singleton, email, password_hash) VALUES ($1,true,$2,$3)',
    [randomUUID(), email, await hashPassword(password)]);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: config.origin }, payload: { email, password } });
  const headers = { origin: config.origin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().user.csrf };
  const base = { method: 'POST', headers, payload: {} };
  const applyCidr = await app.inject({ method: 'PUT', url: '/api/admin/ip', headers, payload: { cidr: '198.51.100.10/32' } });
  assert.equal(applyCidr.statusCode, 200);
  const first = await app.inject({ ...base, url: '/api/admin/ip/verificar' });
  assert.equal(first.json().store.egressMatch, true);
  measuredIp = '198.51.100.11';
  const second = await app.inject({ ...base, url: '/api/admin/ip/verificar' });
  assert.equal(second.json().store.egressMatch, false);
  const audit = await app.inject({ url: '/api/admin/auditoria', headers });
  assert.ok(audit.json().events.some(event => event.action === 'ip_saida_alterado' && event.subject === measuredIp));
  const diagnosis = await app.inject({ ...base, url: '/api/admin/diagnostico' });
  assert.ok(diagnosis.json().tests.some(check => check.name === 'CS REDE CONNECT' && check.status === 'Aprovado'));
  assert.ok(diagnosis.json().tests.some(check => check.name === 'Comparação do CIDR' && check.status === 'Falhou'));
  assert.ok(diagnosis.json().tests.some(check => check.code === 'PROVIDER_ONBOARDING'));
  assert.ok(!diagnosis.body.includes(connectSecret));
});

test('Connect valida e cifra credenciais e concilia Pix Sandbox uma vez por operação', databaseRequired, async t => {
  const connectSecret = token();
  const secret = 'sandbox-teste-que-nao-pode-vazar';
  let database, reference, cents;
  let state = 'Pending', sends = 0, refunds = 0, timeout = false;
  const tid = '40402611250909140013';
  const connector = buildConnect({ token: connectSecret, redeKey: randomBytes(32) }, {
    db: { query: (...args) => database.query(...args) },
    fetcher: async (url, options) => {
      const json = (object, status = 200) => Response.json(object, { status });
      const target = new URL(url);
      if (target.pathname.endsWith('/oauth2/token')) {
        const sandbox = target.hostname === 'rl7-sandbox-api.useredecloud.com.br';
        assert.equal(options.body, 'grant_type=client_credentials');
        assert.equal(options.method, 'POST');
        const expected = Buffer.from(sandbox ? 'pv-sandbox:' + secret : 'pv-production:producao-isolada').toString('base64');
        if (options.headers.authorization !== 'Basic ' + expected) return json({ error: 'invalid_client' }, 401);
        return json({ access_token: sandbox ? 'access-sandbox' : 'access-production', token_type: 'Bearer' });
      }
      assert.equal(target.origin, 'https://sandbox-erede.useredecloud.com.br');
      assert.equal(options.headers.authorization, 'Bearer access-sandbox');
      if (options.method === 'POST' && target.pathname === '/v2/transactions') {
        sends++;
        const input = JSON.parse(options.body);
        reference = input.reference;
        cents = input.amount;
        assert.equal(input.kind, 'pix');
        assert.match(input.qrCode.dateTimeExpiration, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
        if (timeout) throw new DOMException('Fixture de timeout', 'TimeoutError');
        return json({ reference, amount: cents, tid, returnCode: '00', qrCodeResponse: { qrCodeData: '000201010212fixture' } });
      }
      if (options.method === 'GET') {
        assert.equal(target.searchParams.get('reference'), reference);
        const entry = { reference, tid, kind: 'Pix', amount: cents, returnCode: '00', status: state };
        return state === 'Pending' ? json({ qrCodeResponse: entry }) : json({
          authorization: entry, capture: { amount: cents },
          ...(state === 'Canceled' ? { refunds: [{ status: 'Done', amount: cents }] } : {}),
        });
      }
      assert.equal(target.pathname, '/v2/transactions/' + tid + '/refunds');
      assert.deepEqual(JSON.parse(options.body), { amount: cents });
      refunds++;
      state = 'Canceled';
      return json({ returnCode: '359' });
    },
  });
  t.after(() => connector.close());
  const connectUrl = await connector.listen({ host: '127.0.0.1', port: 0 });
  const { app, db, config } = await testApp(t, { CONNECT_URL: connectUrl, CONNECT_TOKEN: connectSecret });
  database = db;
  const email = 'rede@example.org', password = 'senha de teste equipe financeira';
  await db.query('INSERT INTO administrators (id, singleton, email, password_hash) VALUES ($1,true,$2,$3)',
    [randomUUID(), email, await hashPassword(password)]);
  const origin = { origin: config.origin };
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin, payload: { email, password } });
  const signed = { ...origin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().user.csrf };
  const send = (method, path, payload, headers = signed) => app.inject({ method, url: '/api/admin/' + path, headers, payload });

  assert.equal((await send('GET', 'rede/sandbox', undefined, origin)).statusCode, 401);
  const saved = await send('PUT', 'rede/sandbox', { clientId: 'pv-sandbox', clientSecret: secret });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.match(saved.json().account, /••••dbox/);
  assert.ok(!saved.body.includes(secret));
  const { rows: [stored] } = await db.query("SELECT encrypted FROM rede_credentials WHERE environment='sandbox'");
  assert.ok(stored.encrypted.length > secret.length && !stored.encrypted.includes(secret));
  const bad = await send('PUT', 'rede/sandbox', { clientId: 'pv-sandbox', clientSecret: 'errado' });
  assert.equal(bad.statusCode, 502, bad.body);
  assert.equal(bad.json().upstreamStatus, 401);
  assert.equal((await send('POST', 'rede/sandbox/testar')).statusCode, 200);
  assert.equal((await send('GET', 'rede/production')).json().configured, false);
  assert.equal((await send('PUT', 'rede/production', { clientId: 'pv-production', clientSecret: 'producao-isolada' })).statusCode, 200);
  const live = await connector.inject({ method: 'POST', url: '/v1/rede/production/pix/create',
    headers: { authorization: 'Bearer ' + connectSecret }, payload: {} });
  assert.equal(live.statusCode, 403);

  const id = randomUUID();
  const create = (key, value = 2399) => send('POST', 'sandbox/pix', { cents: value }, { ...signed, 'idempotency-key': key });
  const responses = await Promise.all([create(id), create(id)]);
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 201], responses.map(response => response.body).join(' '));
  assert.equal(sends, 1);
  assert.equal(responses.find(response => response.statusCode === 201).json().state, 'pending');
  assert.equal((await create(id, 1234)).statusCode, 409);
  const path = 'sandbox/pix/' + id;
  state = 'Approved';
  const paid = await send('POST', path + '/consultar', {});
  assert.equal(paid.json().state, 'approved', paid.body);
  assert.equal(paid.json().qrText, null);
  assert.equal((await send('POST', path + '/estornar', {})).statusCode, 400);
  const refunded = await send('POST', path + '/estornar', { confirm: true });
  assert.equal(refunded.json().refund, 'accepted', refunded.body);
  assert.equal((await send('POST', path + '/estornar', { confirm: true })).statusCode, 409);
  assert.equal((await send('POST', path + '/consultar', {})).json().state, 'refunded');
  assert.equal(refunds, 1);
  timeout = true;
  const second = randomUUID();
  assert.equal((await create(second)).json().state, 'uncertain');
  assert.equal((await create(second)).json().state, 'uncertain');
  assert.equal(sends, 2);
  assert.equal((await send('GET', 'pedidos')).json().orders.length, 0);
  assert.equal((await send('DELETE', 'rede/sandbox')).json().configured, false);
  assert.equal((await send('GET', 'rede/production')).json().configured, true);
});
