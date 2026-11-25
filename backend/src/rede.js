import { randomBytes } from 'node:crypto';
import { RedeError } from '../../connect/src/rede.js';
import { NetworkError } from '../../connect/src/network.js';
import { MAX_CENTS } from '../../shared/format.js';
import { audit } from './db.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hardReject = new Set(['51', '57', '898', '3076', '3077', '3078', '3081', '3090', '3095', '3098']);
const terminal = new Set(['rejected', 'expired', 'refunded']);

function publicPix(row, error) {
  return {
    id: row.id, reference: row.reference, cents: row.cents, state: row.state, tid: row.tid,
    qrText: row.state === 'pending' ? row.qr_text : null,
    qrImage: row.state === 'pending' ? row.qr_image : null,
    code: row.upstream_code, refund: row.refund_state, createdAt: row.created_at,
    error: error ? { code: error.code, message: error.message, upstreamStatus: error.upstreamStatus } : null,
  };
}

const expected = error => error instanceof RedeError || error instanceof NetworkError;

export function registerRedeRoutes(app, db, connect, { ownerRead, ownerWrite }) {
  function fail(reply, status, code, message, upstream) {
    return reply.code(status).send({ code, message, ...(upstream ? {
      upstreamCode: upstream.upstreamCode, upstreamStatus: upstream.upstreamStatus,
    } : {}) });
  }

  const setup = (reply, status = 503) => fail(reply, status, 'REDE_CONNECT_REQUIRED',
    'Habilite o cofre e.Rede no CS REDE CONNECT.');
  const guarded = operation => async (request, reply) => {
    if (!connect) return setup(reply);
    const env = request.params.environment ?? 'sandbox';
    if (!['sandbox', 'production'].includes(env)) return fail(reply, 400, 'REDE_ENV', 'Ambiente inválido.');
    try {
      return await operation(env, request, reply);
    } catch (error) {
      if (!expected(error)) throw error;
      const status = error instanceof RedeError && [400, 403, 409].includes(error.httpStatus) ? error.httpStatus : 502;
      return fail(reply, status, error.code, error.message, error);
    }
  };

  app.get('/api/admin/rede/:environment', ownerRead, guarded(async (env, request, reply) => {
    if (!(await connect.health()).redeConfigured) return setup(reply);
    return connect.rede(env, '');
  }));

  app.put('/api/admin/rede/:environment', ownerWrite, guarded(async (env, request) => {
    const result = await connect.rede(env, '', { method: 'PUT', body: request.body ?? {} });
    await audit(db, request.session.id, 'credenciais_rede_verificadas_e_salvas', env);
    return result;
  }));

  app.post('/api/admin/rede/:environment/testar', ownerWrite, guarded(async (env, request) => {
    const result = await connect.rede(env, '/test', { method: 'POST' });
    await audit(db, request.session.id, 'autenticacao_rede_verificada', env);
    return result;
  }));

  app.delete('/api/admin/rede/:environment', ownerWrite, guarded(async (env, request) => {
    const result = await connect.rede(env, '', { method: 'DELETE' });
    await audit(db, request.session.id, 'credenciais_rede_removidas', env);
    return result;
  }));

  app.get('/api/admin/sandbox/pix', ownerRead, async () => {
    const { rows } = await db.query('SELECT * FROM rede_sandbox_pix ORDER BY created_at DESC LIMIT 25');
    return { operations: rows.map(row => publicPix(row)) };
  });

  app.post('/api/admin/sandbox/pix', ownerWrite, guarded(async (env, request, reply) => {
    const id = request.headers['idempotency-key'];
    const { cents } = request.body ?? {};
    if (typeof id !== 'string' || !uuid.test(id) || !Number.isInteger(cents) || cents < 1 || cents > MAX_CENTS) {
      return fail(reply, 400, 'PIX_INPUT', 'Informe um valor válido e uma chave de idempotência.');
    }
    const configuration = await connect.rede(env, '');
    if (!configuration.configured) return fail(reply, 409, 'REDE_NOT_CONFIGURED', 'Configure a integração e.Rede no Sandbox.');
    const reference = randomBytes(8).toString('hex');
    const { rows: [created] } = await db.query(`
      INSERT INTO rede_sandbox_pix(id,admin_id,reference,cents,state) VALUES ($1,$2,$3,$4,'sending')
      ON CONFLICT (id) DO NOTHING RETURNING *
    `, [id, request.session.id, reference, cents]);
    if (!created) {
      const { rows: [stored] } = await db.query('SELECT * FROM rede_sandbox_pix WHERE id=$1', [id]);
      return stored.cents === cents ? publicPix(stored) : fail(reply, 409, 'PIX_IDEMPOTENCY', 'A chave já foi usada com outro valor.');
    }
    let result;
    let failure;
    try {
      result = await connect.rede(env, '/pix/create', { method: 'POST', body: { reference, cents } });
    } catch (error) {
      if (!expected(error)) throw error;
      failure = error;
    }
    const state = result ? result.state : hardReject.has(failure.upstreamCode) ? 'rejected' : 'uncertain';
    const { rows: [updated] } = await db.query(`
      UPDATE rede_sandbox_pix SET state=$2,tid=$3,qr_text=$4,qr_image=$5,upstream_code=$6,checked_at=now(),version=version+1
      WHERE id=$1 AND state='sending' RETURNING *
    `, [id, state, result?.tid, result?.text, result?.image, result?.code ?? failure?.upstreamCode]);
    await audit(db, request.session.id, 'sandbox_pix_solicitado', reference);
    if (updated) return reply.code(201).send(publicPix(updated, failure));
    const { rows: [current] } = await db.query('SELECT * FROM rede_sandbox_pix WHERE id=$1', [id]);
    return publicPix(current);
  }));

  app.post('/api/admin/sandbox/pix/:id/:action', ownerWrite, guarded(async (env, request, reply) => {
    const { id, action } = request.params;
    if (!uuid.test(id) || !['consultar', 'estornar'].includes(action)) return fail(reply, 400, 'PIX_INPUT', 'Operação inválida.');
    const { rows: [stored] } = await db.query('SELECT * FROM rede_sandbox_pix WHERE id=$1', [id]);
    if (!stored) return fail(reply, 404, 'PIX_MISSING', 'Operação Sandbox não encontrada.');
    const { reference, cents, tid } = stored;
    if (action === 'estornar') {
      if (request.body?.confirm !== true) return fail(reply, 400, 'PIX_CONFIRM', 'Confirme o estorno total da transação Sandbox.');
      const claim = await db.query(`
        UPDATE rede_sandbox_pix SET refund_state='sending',checked_at=now(),version=version+1
        WHERE id=$1 AND state='approved' AND refund_state IS NULL AND tid IS NOT NULL RETURNING id
      `, [id]);
      if (!claim.rowCount) return fail(reply, 409, 'PIX_REFUND_STATE', 'A transação não pode ser estornada neste estado.');
      let result;
      let failure;
      try {
        result = await connect.rede(env, '/pix/refund', { method: 'POST', body: { reference, cents, tid } });
      } catch (error) {
        if (!expected(error)) throw error;
        failure = error;
      }
      const { rows: [updated] } = await db.query(`
        UPDATE rede_sandbox_pix SET refund_state=$2,upstream_code=$3,checked_at=now(),version=version+1 WHERE id=$1 RETURNING *
      `, [id, result ? 'accepted' : 'uncertain', result?.code ?? failure?.upstreamCode]);
      await audit(db, request.session.id, 'sandbox_pix_estorno_solicitado', reference);
      return publicPix(updated, failure);
    }
    if (terminal.has(stored.state)) return publicPix(stored);
    const result = await connect.rede(env, '/pix/query', { method: 'POST', body: { reference, cents, tid } });
    if (tid && result.tid && result.tid !== tid) return fail(reply, 502, 'PIX_MISMATCH', 'A Rede retornou outro identificador.');
    const { rows: [updated] } = await db.query(`
      UPDATE rede_sandbox_pix SET state=$2,tid=coalesce($3,tid),
        qr_text=CASE WHEN $2='pending' THEN coalesce($4,qr_text) ELSE NULL END,
        qr_image=CASE WHEN $2='pending' THEN coalesce($5,qr_image) ELSE NULL END,
        upstream_code=$6,checked_at=now(),version=version+1,
        refund_state=CASE WHEN $2='refunded' THEN 'accepted' ELSE refund_state END
      WHERE id=$1 AND version=$7 AND (state NOT IN ('approved','canceled') OR $2 IN ('approved','canceled','refunded'))
      RETURNING *
    `, [id, result.state, result.tid, result.text, result.image, result.code, stored.version]);
    if (updated) return publicPix(updated);
    const { rows: [current] } = await db.query('SELECT * FROM rede_sandbox_pix WHERE id=$1', [id]);
    return publicPix(current);
  }));
}
