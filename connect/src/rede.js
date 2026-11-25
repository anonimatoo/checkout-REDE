import { randomUUID } from 'node:crypto';
import { seal, unseal } from '../../shared/secrets.js';

const endpoints = {
  sandbox: {
    oauth: 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token',
    transactions: 'https://sandbox-erede.useredecloud.com.br/v2/transactions',
  },
  production: {
    oauth: 'https://api.userede.com.br/redelabs/oauth2/token',
  },
};

const messages = new Map([
  ['42', 'A referência já existe na Rede. Consulte a transação.'],
  ['51', 'Produto ou serviço desabilitado para o estabelecimento.'],
  ['57', 'Filiação inválida.'],
  ['78', 'A Rede não encontrou a transação.'],
  ['171', 'Operação não permitida para esta transação.'],
  ['357', 'A soma dos estornos excede o valor da transação.'],
  ['365', 'Estorno parcial indisponível.'],
  ['898', 'A Rede rejeitou o IP de origem da filiação.'],
  ['3036', 'QR Code Pix expirado.'],
  ['3076', 'A Rede reportou ausência da expiração do Pix.'],
  ['3077', 'A Rede reportou valor inválido para a expiração do Pix.'],
  ['3078', 'A Rede reportou formato inválido para a expiração do Pix.'],
  ['3081', 'A Rede reportou tamanho inválido para a expiração do Pix.'],
  ['3084', 'A Rede não gerou a imagem. Consulte a transação.'],
  ['3090', 'Chave Pix inválida.'],
  ['3095', 'Chave Pix desconhecida.'],
  ['3098', 'Serviço Pix não autorizado.'],
]);

export class RedeError extends Error {
  constructor(code, message, httpStatus = null, upstreamCode = null, upstreamStatus = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.upstreamCode = upstreamCode;
    this.upstreamStatus = upstreamStatus;
  }
}

const statusMap = { Pending: 'pending', Approved: 'approved', Canceled: 'canceled' };
const oauthCodes = new Set(['invalid_client','invalid_request','unsupported_grant_type','unauthorized_client',
  'invalid_scope','invalid_grant','access_denied']);
const codeOf = value => typeof value === 'string' && (/^\d{1,4}$/.test(value) || oauthCodes.has(value)) ? value : null;
const validRef = value => typeof value === 'string' && /^[a-fA-F0-9]{16}$/.test(value);
const validTid = value => typeof value === 'string' && /^[A-Za-z0-9]{1,20}$/.test(value);
const time = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
});

export async function boundedJson(response, limit = 131072) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) return null;
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function upstreamFailure(code, status) {
  const message = messages.get(code);
  return new RedeError('REDE_RESPONSE', message ?? 'A Rede retornou uma falha. Consulte o código no manual oficial.', status, code);
}

export function createRedeApi(fetcher = fetch) {
  async function request(url, options) {
    try {
      const response = await fetcher(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(8_000),
      });
      return { ok: response.ok, status: response.status, data: await boundedJson(response) };
    } catch (error) {
      const timeout = ['TimeoutError', 'AbortError'].includes(error.name) || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
      throw new RedeError(timeout ? 'REDE_TIMEOUT' : 'REDE_UNREACHABLE',
        timeout ? 'A consulta à Rede atingiu o tempo limite.' : 'Não foi possível conectar à Rede por HTTPS.');
    }
  }

  return {
    async authenticate(environment, credentials) {
      const { clientId, clientSecret } = credentials;
      const auth = Buffer.from(clientId + ':' + clientSecret, 'utf8').toString('base64');
      const result = await request(endpoints[environment].oauth, {
        method: 'POST', headers: { authorization: 'Basic ' + auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      const value = result.data?.access_token;
      if (result.ok && typeof value === 'string' && /^\S{1,8192}$/.test(value) &&
          String(result.data.token_type).toLowerCase() === 'bearer') return value;
      const denied = [400, 401, 403].includes(result.status);
      throw new RedeError(denied ? 'REDE_AUTH_DENIED' : 'REDE_AUTH_RESPONSE',
        denied ? 'A Rede rejeitou a autenticação. Confira o projeto, o ambiente e as chaves.'
          : 'A Rede não retornou um token OAuth utilizável.',
        result.status, codeOf(result.data?.error ?? result.data?.returnCode));
    },
    async pix(access, operation, input) {
      const { reference, cents, tid } = input;
      if (!validRef(reference) || !Number.isInteger(cents) || cents < 1 || cents > 999999999 ||
          (operation === 'refund' && !validTid(tid))) {
        throw new RedeError('REDE_INPUT', 'Referência e valor inválidos.');
      }
      const base = endpoints.sandbox.transactions;
      const headers = { authorization: 'Bearer ' + access, 'content-type': 'application/json', accept: 'application/json' };
      if (operation === 'refund') {
        const result = await request(base + '/' + tid + '/refunds',
          { method: 'POST', headers, body: JSON.stringify({ amount: cents }) });
        const code = codeOf(result.data?.returnCode);
        if (!result.ok || code !== '359') throw upstreamFailure(code, result.status);
        return { code, state: 'accepted' };
      }
      const creating = operation === 'create';
      const result = await request(creating ? base : base + '?reference=' + reference, creating
        ? { method: 'POST', headers, body: JSON.stringify({
          kind: 'pix', reference, amount: cents,
          qrCode: { dateTimeExpiration: time.format(Date.now() + 30 * 60000).replace(' ', 'T') },
        }) }
        : { method: 'GET', headers });
      const item = creating ? result.data : result.data?.authorization ?? result.data?.qrCodeResponse;
      const code = codeOf(item?.returnCode ?? result.data?.returnCode);
      if (!result.ok || code !== '00') {
        if (!creating && code === '3036') return { code, state: 'expired' };
        throw upstreamFailure(code, result.status);
      }
      if (item.reference !== reference || Number(item.amount) !== cents || !validTid(item.tid) ||
          (!creating && String(item.kind).toLowerCase() !== 'pix')) {
        throw new RedeError('REDE_MISMATCH', 'A resposta da Rede não corresponde à referência, ao valor ou à modalidade esperada.');
      }
      const qr = creating ? item.qrCodeResponse : result.data.qrCodeResponse;
      const text = typeof qr?.qrCodeData === 'string' && qr.qrCodeData.length <= 2000 && /^000201[\x20-\x7e]+$/.test(qr.qrCodeData)
        ? qr.qrCodeData : null;
      const image = typeof qr?.qrCodeImage === 'string' && qr.qrCodeImage.length <= 50000 &&
        /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(qr.qrCodeImage) ? qr.qrCodeImage : null;
      let state = creating ? 'pending' : Object.hasOwn(statusMap, item.status) ? statusMap[item.status] : 'uncertain';
      if (!creating && state === 'approved' && Number(result.data.capture?.amount) !== cents) state = 'uncertain';
      if (!creating && state === 'canceled' && Array.isArray(result.data.refunds)) {
        const returned = result.data.refunds.filter(refund => refund.status === 'Done')
          .reduce((sum, refund) => sum + (Number(refund.amount) || 0), 0);
        if (returned === cents) state = 'refunded';
      }
      return { code, state, tid: item.tid, text, image };
    },
  };
}

const environmentOf = value => value === 'sandbox' || value === 'production';
function credentialsOf(body) {
  if (typeof body?.clientId !== 'string' || typeof body.clientSecret !== 'string') return null;
  const clientId = body.clientId.trim();
  const clientSecret = body.clientSecret.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId) || !/^[\x21-\x7e]{1,512}$/.test(clientSecret)) return null;
  return { clientId, clientSecret };
}

export function registerRede(app, db, key, fetcher = fetch) {
  const gateway = createRedeApi(fetcher);
  const find = async env => (await db.query('SELECT * FROM rede_credentials WHERE environment = $1', [env])).rows[0];
  const scope = (env, revision) => 'erede:v2:' + env + ':' + revision;
  const verify = async (env, item) => gateway.authenticate(env,
    JSON.parse(unseal(item.encrypted, key, scope(env, item.revision))));
  const expose = record => record ? {
    configured: true, verifiedAt: record.verified_at, account: record.account_hint,
  } : { configured: false };
  function configError(reply, code, message, status = 400) {
    return reply.code(status).send({ code, message });
  }
  const guarded = operation => async (request, reply) => {
    const env = request.params.environment;
    if (!environmentOf(env)) return configError(reply, 'REDE_ENV', 'Ambiente inválido.');
    try {
      return await operation(env, request, reply);
    } catch (error) {
      if (!(error instanceof RedeError)) throw error;
      return reply.code(error.code === 'REDE_INPUT' ? 400 : 502).send({
        code: error.code, message: error.message, upstreamCode: error.upstreamCode, upstreamStatus: error.httpStatus,
      });
    }
  };
  app.get('/v1/rede/:environment', guarded(async env => expose(await find(env))));
  app.put('/v1/rede/:environment', guarded(async (env, request, reply) => {
    const credentials = credentialsOf(request.body);
    if (!credentials) return configError(reply, 'REDE_INPUT', 'Informe o Client ID e o Client Secret.');
    const former = await find(env);
    await gateway.authenticate(env, credentials);
    const revision = randomUUID();
    const encrypted = seal(JSON.stringify(credentials), key, scope(env, revision));
    const account = credentials.clientId.length > 4 ? '••••' + credentials.clientId.slice(-4) : '••••';
    const { rows: [record] } = former ? await db.query(`
      UPDATE rede_credentials SET account_hint=$2, encrypted=$3, revision=$4, verified_at=now()
      WHERE environment=$1 AND revision=$5 RETURNING account_hint, verified_at
    `, [env, account, encrypted, revision, former.revision]) : await db.query(`
      INSERT INTO rede_credentials (environment,account_hint,encrypted,revision,verified_at)
      VALUES ($1,$2,$3,$4,now()) ON CONFLICT (environment) DO NOTHING RETURNING account_hint, verified_at
    `, [env, account, encrypted, revision]);
    return record ? expose(record) : configError(reply, 'REDE_CONFIG_CHANGED', 'A configuração mudou durante o teste. Atualize o painel.', 409);
  }));
  app.post('/v1/rede/:environment/test', guarded(async (env, request, reply) => {
    const stored = await find(env);
    if (!stored) return configError(reply, 'REDE_NOT_CONFIGURED', 'Cadastre as credenciais deste ambiente.', 409);
    await verify(env, stored);
    const { rows: [current] } = await db.query(`
      UPDATE rede_credentials SET verified_at=now()
      WHERE environment=$1 AND revision=$2 RETURNING account_hint, verified_at
    `, [env, stored.revision]);
    return current ? expose(current) : configError(reply, 'REDE_CONFIG_CHANGED', 'A configuração mudou durante o teste.', 409);
  }));
  app.delete('/v1/rede/:environment', guarded(async env => {
    await db.query('DELETE FROM rede_credentials WHERE environment=$1', [env]);
    return { configured: false };
  }));

  app.post('/v1/rede/:environment/pix/:operation', guarded(async (env, request, reply) => {
    if (env !== 'sandbox') return configError(reply, 'REDE_PRODUCTION_DISABLED', 'Operações financeiras disponíveis apenas no Sandbox.', 403);
    const { operation } = request.params;
    if (!['create', 'query', 'refund'].includes(operation)) return configError(reply, 'REDE_INPUT', 'Operação inválida.');
    const stored = await find(env);
    if (!stored) return configError(reply, 'REDE_NOT_CONFIGURED', 'Cadastre as credenciais Sandbox.', 409);
    return gateway.pix(await verify(env, stored), operation, request.body ?? {});
  }));
}
