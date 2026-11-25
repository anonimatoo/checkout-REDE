import { randomUUID } from 'node:crypto';
import { audit, inTransaction } from './db.js';
import { digest, hashPassword, matches, token, validPassword, validToken, verifyPassword } from './security.js';
import { lockSetup, ownerExists } from './team.js';
import { validEmail } from '../../shared/format.js';

const cookieOptions = secure => ({
  httpOnly: true, secure, sameSite: 'strict', path: '/',
});

function invalidCredentials(reply) {
  return reply.code(401).send({ code: 'INVALID_LOGIN', message: 'E-mail ou senha incorretos.' });
}

export function requireOrigin(config) {
  return async (request, reply) => {
    if (request.headers.origin !== config.origin) {
      return reply.code(403).send({ code: 'ORIGIN', message: 'Origem da solicitação inválida.' });
    }
  };
}

export async function registerAuth(app, db, config) {
  const cookie = config.secure ? '__Host-csrede-session' : 'csrede-session';
  const loginDuration = 60 * 60 * 8;
  const origin = requireOrigin(config);
  const dummyHash = await hashPassword(token());
  let checks = 0;

  async function limited(request, reply, scope) {
    const { rows: [attempt] } = await db.query(`
      INSERT INTO auth_limits (key, count, expires_at)
      VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT (key) DO UPDATE
      SET count = CASE WHEN auth_limits.expires_at <= now() THEN 1 ELSE least(auth_limits.count + 1, 1000) END,
          expires_at = CASE WHEN auth_limits.expires_at <= now() THEN excluded.expires_at ELSE auth_limits.expires_at END
      RETURNING count
    `, [digest(scope + ':' + request.ip)]);
    if (attempt.count <= 10) return false;
    reply.header('Retry-After', '900').code(429)
      .send({ code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos para tentar novamente.' });
    return true;
  }

  function beginVerification(reply) {
    if (checks < 3) {
      checks++;
      return true;
    }
    reply.header('Retry-After', '5').code(429)
      .send({ code: 'AUTH_BUSY', message: 'Aguarde alguns segundos e tente novamente.' });
    return false;
  }

  async function findSession(request) {
    const raw = request.cookies[cookie];
    if (!validToken(raw)) return null;
    const { rows: [session] } = await db.query(`
      SELECT a.id, a.email, a.role, s.digest, s.csrf, s.expires_at FROM admin_sessions s
      JOIN administrators a ON a.id = s.admin_id
      WHERE s.digest = $1 AND s.expires_at > now() AND a.disabled_at IS NULL
    `, [digest(raw)]);
    return session ?? null;
  }

  const signedIn = async (request, reply) => {
    request.session = await findSession(request);
    if (!request.session) return reply.code(401).send({ code: 'SESSION', message: 'Entre no painel para continuar.' });
  };
  const csrf = async (request, reply) => {
    if (!matches(request.headers['x-csrf-token'], request.session.csrf)) {
      return reply.code(403).send({ code: 'CSRF', message: 'Atualize a página e tente novamente.' });
    }
  };
  const authRead = { preHandler: signedIn };
  const authWrite = { preHandler: [origin, signedIn, csrf] };
  function requireRole(...roles) {
    return async (request, reply) => {
      if (!roles.includes(request.session.role)) {
        return reply.code(403).send({ code: 'PERMISSION', message: 'Seu perfil não tem permissão para esta operação.' });
      }
    };
  }
  const owner = requireRole('owner');
  const ownerRead = { preHandler: [signedIn, owner] };
  const ownerWrite = { preHandler: [...authWrite.preHandler, owner] };
  const orderWrite = { preHandler: [...authWrite.preHandler, requireRole('owner', 'operator')] };
  app.decorateRequest('session', null);

  app.get('/api/auth/session', async request => {
    const session = await findSession(request);
    return { user: session ? { email: session.email, role: session.role, csrf: session.csrf, expiresAt: session.expires_at } : null };
  });

  app.post('/api/auth/login', { preHandler: origin }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = request.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length > 128) return invalidCredentials(reply);
    if (await limited(request, reply, 'login')) return reply;


    const { rows: [admin] } = await db.query(
      'SELECT id, role, password_hash FROM administrators WHERE email = $1 AND disabled_at IS NULL', [email],
    );
    let valid;
    if (!beginVerification(reply)) return reply;
    try {
      valid = await verifyPassword(password, admin?.password_hash ?? dummyHash);
    } finally {
      checks--;
    }
    if (!admin?.password_hash || !valid) {
      await audit(db, admin?.id ?? null, 'login_recusado');
      return invalidCredentials(reply);
    }

    const session = token();
    const csrfToken = token();
    const created = await inTransaction(db, async client => {
      const current = await client.query('SELECT id FROM administrators WHERE id = $1 AND password_hash = $2 AND disabled_at IS NULL FOR UPDATE',
        [admin.id, admin.password_hash]);
      if (!current.rowCount) return false;
      await client.query('DELETE FROM auth_limits WHERE key = $1', [digest('login:' + request.ip)]);
      await client.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND expires_at <= now()', [admin.id]);
      await client.query(`
        INSERT INTO admin_sessions (digest, admin_id, csrf, expires_at)
        VALUES ($1, $2, $3, now() + make_interval(secs => $4))
      `, [digest(session), admin.id, csrfToken, loginDuration]);
      await audit(client, admin.id, 'login_realizado');
      return true;
    });
    if (!created) return invalidCredentials(reply);
    reply.setCookie(cookie, session, { ...cookieOptions(config.secure), maxAge: loginDuration });
    return { user: { email, role: admin.role, csrf: csrfToken } };
  });

  app.post('/api/auth/logout', authWrite, async (request, reply) => {
    await inTransaction(db, async client => {
      await client.query('DELETE FROM admin_sessions WHERE digest = $1', [request.session.digest]);
      await audit(client, request.session.id, 'sessao_encerrada');
    });
    reply.clearCookie(cookie, cookieOptions(config.secure));
    return { ok: true };
  });

  async function changePassword(client, id, passwordHash, action) {
    await client.query('UPDATE administrators SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
    await client.query('DELETE FROM admin_sessions WHERE admin_id = $1', [id]);
    await client.query('DELETE FROM reset_tokens WHERE admin_id = $1', [id]);
    await audit(client, id, action);
  }

  const passwordError = reply => reply.code(400).send({
    code: 'PASSWORD_FORMAT', message: 'A nova senha precisa ter de 12 a 128 caracteres.',
  });

  app.post('/api/auth/password', authWrite, async (request, reply) => {
    const { current, password } = request.body ?? {};
    if (!validPassword(password)) return passwordError(reply);
    if (typeof current !== 'string' || current.length > 128) return invalidCredentials(reply);
    if (await limited(request, reply, 'password')) return reply;

    if (!beginVerification(reply)) return reply;
    let changed;
    try {
      changed = await inTransaction(db, async client => {
        const { rows: [admin] } = await client.query(`
          SELECT password_hash FROM administrators WHERE id = $1 AND disabled_at IS NULL FOR UPDATE
        `, [request.session.id]);
        if (!admin?.password_hash || !(await verifyPassword(current, admin.password_hash))) return false;
        await changePassword(client, request.session.id, await hashPassword(password), 'senha_alterada');
        return true;
      });
    } finally {
      checks--;
    }
    if (!changed) return invalidCredentials(reply);
    reply.clearCookie(cookie, cookieOptions(config.secure));
    return { ok: true };
  });

  app.post('/api/auth/recovery', { preHandler: origin }, async (request, reply) => {
    const { secret, password } = request.body ?? {};
    if (!validPassword(password)) return passwordError(reply);
    const expired = () => reply.code(400).send({ code: 'RESET_TOKEN', message: 'Link de recuperação inválido ou expirado.' });
    if (!validToken(secret)) return expired();
    if (await limited(request, reply, 'recovery')) return reply;
    const hash = digest(secret);
    const { rows: [reset] } = await db.query(
      'SELECT admin_id FROM reset_tokens WHERE digest = $1 AND expires_at > now()', [hash],
    );
    if (!reset) return expired();

    if (!beginVerification(reply)) return reply;
    let restored;
    try {
      restored = await inTransaction(db, async client => {
        const { rows: [account] } = await client.query(
          'SELECT password_hash FROM administrators WHERE id = $1 AND disabled_at IS NULL FOR UPDATE', [reset.admin_id],
        );
        if (!account) return false;
        const active = await client.query('SELECT 1 FROM reset_tokens WHERE digest = $1 AND expires_at > now()', [hash]);
        if (!active.rowCount) return false;
        await changePassword(client, reset.admin_id, await hashPassword(password), account.password_hash ? 'senha_recuperada' : 'conta_ativada');
        return true;
      });
    } finally {
      checks--;
    }
    if (!restored) return expired();
    reply.clearCookie(cookie, cookieOptions(config.secure));
    return { ok: true };
  });

  app.get('/api/auth/setup', async () => ({ initialized: await ownerExists(db) }));

  app.post('/api/auth/setup', { preHandler: origin }, async (request, reply) => {
    const { secret, password } = request.body ?? {};
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    if (!validPassword(password) || !validEmail(email) || !validToken(secret)) {
      return reply.code(400).send({ code: 'SETUP_INPUT', message: 'Confira o e-mail, a senha e o link de instalação.' });
    }
    if (await limited(request, reply, 'setup')) return reply;
    const unavailable = () => reply.code(409).send({ code: 'SETUP_UNAVAILABLE',
      message: 'O link venceu, foi substituído ou a instalação já está configurada.' });
    const tokenHash = digest(secret);
    const activeToken = client => client.query(
      'SELECT 1 FROM admin_setup_token WHERE digest = $1 AND expires_at > now()', [tokenHash],
    );
    if (!(await activeToken(db)).rowCount) return unavailable();
    if (!beginVerification(reply)) return reply;
    let passwordHash;
    try {
      passwordHash = await hashPassword(password);
    } finally {
      checks--;
    }
    const created = await inTransaction(db, async client => {
      await lockSetup(client);
      if (await ownerExists(client) || !(await activeToken(client)).rowCount) return false;
      const id = randomUUID();
      await client.query(
        'INSERT INTO administrators (id, singleton, email, password_hash) VALUES ($1, true, $2, $3)',
        [id, email, passwordHash],
      );
      await client.query('DELETE FROM admin_setup_token');
      await audit(client, id, 'conta_criada_assistente');
      return true;
    });
    if (!created) return unavailable();
    return reply.code(201).send({ ok: true });
  });

  return { authRead, ownerRead, ownerWrite, orderWrite };
}
