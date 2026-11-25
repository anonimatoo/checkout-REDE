import { randomUUID } from 'node:crypto';
import { audit, inTransaction } from './db.js';
import { digest, token } from './security.js';
import { validEmail } from '../../shared/format.js';

const roles = new Set(['operator', 'viewer']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const setupLock = 52464901;

export function lockSetup(db) {
  return db.query('SELECT pg_advisory_xact_lock($1)', [setupLock]);
}

export async function ownerExists(db) {
  return Boolean((await db.query('SELECT 1 FROM administrators WHERE singleton IS TRUE')).rowCount);
}

export async function issueSetup(db) {
  const secret = token();
  await inTransaction(db, async client => {
    await lockSetup(client);
    if (await ownerExists(client)) throw new Error('A instalação já tem uma conta proprietária.');
    await client.query(`
      INSERT INTO admin_setup_token (digest, expires_at) VALUES ($1, now() + interval '30 minutes')
      ON CONFLICT (id) DO UPDATE SET digest = excluded.digest, expires_at = excluded.expires_at
    `, [digest(secret)]);
  });
  return secret;
}

export async function issueReset(db, id, secret, minutes) {
  await db.query('DELETE FROM reset_tokens WHERE admin_id = $1', [id]);
  await db.query(`
    INSERT INTO reset_tokens (digest, admin_id, expires_at)
    VALUES ($1, $2, now() + make_interval(mins => $3))
  `, [digest(secret), id, minutes]);
}

export function registerTeam(app, db, config, { ownerRead, ownerWrite }) {
  app.get('/api/admin/equipe', ownerRead, async () => {
    const { rows } = await db.query(`
      SELECT id, email, role, disabled_at IS NOT NULL AS disabled, password_hash IS NULL AS pending
      FROM administrators ORDER BY singleton DESC NULLS LAST, email
    `);
    return { accounts: rows };
  });

  app.post('/api/admin/equipe', ownerWrite, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const role = request.body?.role;
    if (!validEmail(email) || !roles.has(role)) {
      return reply.code(400).send({ code: 'TEAM_INPUT', message: 'Informe um e-mail e um perfil válidos.' });
    }
    const secret = token();
    const account = await inTransaction(db, async client => {
      await client.query(`
        INSERT INTO administrators (id, email, role)
        VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING
      `, [randomUUID(), email, role]);
      const { rows: [member] } = await client.query(`
        SELECT id, role FROM administrators WHERE email = $1 AND role <> 'owner'
          AND disabled_at IS NULL AND password_hash IS NULL FOR UPDATE
      `, [email]);
      if (!member || member.role !== role) return null;
      await issueReset(client, member.id, secret, 1440);
      await audit(client, request.session.id, 'convite_emitido', member.id);
      return member;
    });
    if (!account) return reply.code(409).send({ code: 'TEAM_EXISTS',
      message: 'Esta conta já existe. Consulte o perfil e o status na lista.' });
    return { url: config.origin + '/admin/recuperar#' + secret, expiresInHours: 24 };
  });

  app.patch('/api/admin/equipe/:id', ownerWrite, async (request, reply) => {
    const { role, disabled } = request.body ?? {};
    if (!uuid.test(request.params.id) || !roles.has(role) || typeof disabled !== 'boolean') {
      return reply.code(400).send({ code: 'TEAM_INPUT', message: 'Informe um perfil e um status válidos.' });
    }
    const updated = await inTransaction(db, async client => {
      const { rows: [member] } = await client.query(`
        UPDATE administrators SET role = $2,
          disabled_at = CASE WHEN $3 THEN coalesce(disabled_at, now()) ELSE NULL END
        WHERE id = $1 AND role <> 'owner' RETURNING id
      `, [request.params.id, role, disabled]);
      if (!member) return false;
      await client.query('DELETE FROM admin_sessions WHERE admin_id = $1', [member.id]);
      if (disabled) await client.query('DELETE FROM reset_tokens WHERE admin_id = $1', [member.id]);
      await audit(client, request.session.id, 'perfil_atualizado', member.id);
      return true;
    });
    if (!updated) return reply.code(404).send({ code: 'TEAM_ACCOUNT', message: 'Conta de equipe indisponível.' });
    return { ok: true };
  });
}
