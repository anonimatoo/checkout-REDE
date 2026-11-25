import { isIP } from 'node:net';
import { measureEgress, NetworkError } from '../../connect/src/network.js';
import { performance } from 'node:perf_hooks';
import { MAX_CENTS, cnpjCharacters, digits, validCnpj, validEmail } from '../../shared/format.js';
import { payment } from './config.js';
import { audit, inTransaction } from './db.js';
import { csv } from './orders.js';

const columns = `name, legal_name, document, merchant_reference, support_email, support_phone, support_whatsapp,
  description, privacy, terms, primary_color, secondary_color, logo, min_cents, max_cents,
  min_installment, max_installments, authorized_cidr::text, host(observed_egress) AS observed_egress,
  egress_checked_at, observed_egress <<= authorized_cidr AS egress_match`;
const getStore = async db => (await db.query(`SELECT ${columns} FROM store_settings WHERE id`)).rows[0];
const validColor = color => /^#[a-f0-9]{6}$/i.test(color);
const text = (value, max) => typeof value === 'string' && !value.includes('\0') && value.trim().length <= max ? value.trim() : null;

function storePublic(row) {
  return {
    name: row.name, description: row.description, privacy: row.privacy, terms: row.terms,
    primaryColor: row.primary_color, secondaryColor: row.secondary_color, hasLogo: Boolean(row.logo),
    supportEmail: row.support_email, supportPhone: row.support_phone, supportWhatsapp: row.support_whatsapp,
    minCents: row.min_cents, maxCents: row.max_cents, minInstallment: row.min_installment,
    maxInstallments: row.max_installments,
  };
}

function storePrivate(row) {
  return {
    ...storePublic(row), legalName: row.legal_name, document: row.document, merchantReference: row.merchant_reference,
    authorizedCidr: row.authorized_cidr ?? '', observedEgress: row.observed_egress, egressMatch: row.egress_match,
    egressCheckedAt: row.egress_checked_at,
  };
}

function image(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 335_000) return null;
  const parsed = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!parsed) return null;
  const data = Buffer.from(parsed[2], 'base64');
  if (data.length < 12 || data.length > 250_000) return null;
  const [format] = parsed.slice(1);
  const signatures = {
    png: data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    jpeg: data.subarray(0, 3).toString('hex') === 'ffd8ff',
    webp: data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP',
  };
  return signatures[format] ? `data:image/${format};base64,${data.toString('base64')}` : null;
}

const fail = (reply, message) => reply.code(400).send({ code: 'SETTINGS_INPUT', message });

export function egressMonitor(db, config, connect) {
  let pending;
  async function check() {
    if (!connect && !config.egressUrl) return null;
    const ip = connect ? await connect.egress() : await measureEgress(config.egressUrl);
    return inTransaction(db, async client => {
      const { rows: [before] } = await client.query(
        'SELECT host(observed_egress) AS ip FROM store_settings WHERE id FOR UPDATE',
      );
      await client.query('UPDATE store_settings SET observed_egress = $1::inet, egress_checked_at = now() WHERE id', [ip]);
      const row = await getStore(client);
      if (before.ip && before.ip !== row.observed_egress) await audit(client, null, 'ip_saida_alterado', row.observed_egress);
      return storePrivate(row);
    });
  }

  return function verifyEgress() {
    pending ??= check().finally(() => { pending = null; });
    return pending;
  };
}

export function registerStore(app, db, config, { authRead, ownerRead, ownerWrite }, verifyEgress, connect) {
  const hasProbe = Boolean(connect || config.egressUrl);
  app.get('/api/health', async (request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/api/loja', async () => ({ store: storePublic(await getStore(db)), payment }));

  app.get('/api/loja/logo', async (request, reply) => {
    const { rows: [row] } = await db.query('SELECT logo FROM store_settings WHERE id');
    if (!row.logo) return reply.code(404).send();
    const [head, bytes] = row.logo.split(',');
    return reply.type(head.slice(5, -7)).send(Buffer.from(bytes, 'base64'));
  });

  app.get('/api/admin/provedor', authRead, async () => ({ payment, connectConfigured: Boolean(connect) }));

  app.get('/api/admin/configuracao', ownerRead, async () => ({
    store: storePrivate(await getStore(db)), payment, egressConfigured: hasProbe, connectConfigured: Boolean(connect),
  }));

  app.put('/api/admin/loja', ownerWrite, async (request, reply) => {
    const input = request.body ?? {};
    const name = text(input.name, 80);
    const legal = text(input.legalName, 160);
    const reference = text(input.merchantReference, 50);
    const description = text(input.description, 300);
    const privacy = text(input.privacy, 8_000);
    const terms = text(input.terms, 8_000);
    const email = text(input.supportEmail, 254);
    const phone = text(input.supportPhone, 20);
    const whatsapp = text(input.supportWhatsapp, 20);
    const rawDocument = text(input.document, 18);
    const { primaryColor, secondaryColor } = input;
    const logo = input.logo === undefined ? undefined : image(input.logo);
    const validPhone = value => !value || /^[0-9 ()-]+$/.test(value) && /^\d{10,11}$/.test(digits(value));
    if (!name || [legal, reference, description, privacy, terms, email, phone, whatsapp, rawDocument].includes(null) ||
        email && !validEmail(email) || rawDocument && !validCnpj(rawDocument) || !validPhone(phone) || !validPhone(whatsapp) ||
        !validColor(primaryColor) || !validColor(secondaryColor) || logo === null) {
      return fail(reply, 'Confira os dados do estabelecimento. Use um logotipo PNG, JPEG ou WebP de até 250 KB.');
    }
    await inTransaction(db, async client => {
      await client.query(`
        UPDATE store_settings SET name = $1, legal_name = $2, document = $3, merchant_reference = $4,
          support_email = $5, support_phone = $6, support_whatsapp = $7, description = $8, privacy = $9,
          terms = $10, primary_color = $11, secondary_color = $12, logo = coalesce($13, logo) WHERE id
      `, [name, legal, cnpjCharacters(rawDocument), reference, email, digits(phone), digits(whatsapp),
        description, privacy, terms, primaryColor, secondaryColor, logo ?? null]);
      await audit(client, request.session.id, 'loja_atualizada');
    });
    return { store: storePrivate(await getStore(db)) };
  });

  app.put('/api/admin/limites', ownerWrite, async (request, reply) => {
    const { minCents, maxCents, minInstallment, maxInstallments } = request.body ?? {};
    if (![minCents, maxCents, minInstallment, maxInstallments].every(Number.isInteger) ||
        minCents < 1 || maxCents > MAX_CENTS || minCents > maxCents ||
        minInstallment < 1 || minInstallment > maxCents || maxInstallments < 1 || maxInstallments > 12) {
      return fail(reply, 'Informe valores e quantidade de parcelas dentro dos limites permitidos.');
    }
    await inTransaction(db, async client => {
      await client.query(`UPDATE store_settings SET min_cents = $1, max_cents = $2, min_installment = $3,
        max_installments = $4 WHERE id`, [minCents, maxCents, minInstallment, maxInstallments]);
      await audit(client, request.session.id, 'limites_atualizados');
    });
    return { store: storePrivate(await getStore(db)) };
  });

  app.get('/api/admin/ip', ownerRead, async request => ({
    store: storePrivate(await getStore(db)), clientIp: request.ip, probeConfigured: hasProbe, probeSource: connect ? 'connect' : 'checkout',
  }));

  app.put('/api/admin/ip', ownerWrite, async (request, reply) => {
    const cidr = text(request.body?.cidr, 49);
    if (cidr === null || cidr && !/^[^/\s]+(?:\/\d{1,3})?$/.test(cidr)) {
      return fail(reply, 'Informe um endereço IP ou bloco CIDR válido.');
    }
    let canonical = null;
    if (cidr) {
      const [ip, prefix] = cidr.split('/');
      const version = isIP(ip);
      if (!version) return fail(reply, 'Informe um endereço IPv4 ou IPv6 válido.');
      try {
        const { rows: [row] } = await db.query('SELECT ($1::cidr)::text AS network',
          [ip + '/' + (prefix ?? (version === 4 ? '32' : '128'))]);
        canonical = row.network;
      } catch (error) {
        if (error.code !== '22P02') throw error;
        return fail(reply, 'Confira o endereço e o prefixo do bloco CIDR.');
      }
    }
    await inTransaction(db, async client => {
      await client.query('UPDATE store_settings SET authorized_cidr = $1::cidr WHERE id', [canonical]);
      await audit(client, request.session.id, 'ip_cadastrado_atualizado', canonical ?? '');
    });
    return { store: storePrivate(await getStore(db)) };
  });

  app.post('/api/admin/ip/verificar', ownerWrite, async (request, reply) => {
    if (!hasProbe) return fail(reply, 'Configure o serviço de detecção do IP de saída na instalação.');
    try {
      return { store: await verifyEgress() };
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      return reply.code(error.code === 'PROBE_NOT_CONFIGURED' ? 409 : 502)
        .send({ code: error.code, message: error.message, upstreamStatus: error.status ?? null });
    }
  });

  app.get('/api/admin/auditoria', ownerRead, async (request, reply) => {
    const { rows } = await db.query(`SELECT action, subject, created_at FROM audit_events
      ORDER BY id DESC LIMIT 100`);
    if (request.query.format === 'csv') {
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="auditoria.csv"')
        .send(csv([['Evento', 'Referência', 'Data (UTC)'],
          ...rows.map(row => [row.action, row.subject, row.created_at.toISOString()])]));
    }
    return { events: rows };
  });

  app.post('/api/admin/diagnostico', ownerWrite, async () => {
    const checkedAt = new Date().toISOString();
    const tests = [];
    const add = (name, status, detail, ms = null, code = '') => tests.push({ name, status, detail, ms, code, checkedAt });
    add('API do checkout', 'Aprovado', 'A API respondeu à solicitação autenticada.');
    add('HTTPS da origem', config.secure ? 'Não verificado' : 'Não configurado',
      config.secure ? 'Origem configurada para HTTPS. A verificação do certificado é feita externamente.'
        : 'Origem local configurada para HTTP.');
    const startDb = performance.now();
    try {
      await db.query('SELECT 1');
      add('PostgreSQL', 'Aprovado', 'O banco respondeu à consulta.', Math.round(performance.now() - startDb));
    } catch {
      add('PostgreSQL', 'Falhou', 'Verifique a conexão e a disponibilidade do banco.', Math.round(performance.now() - startDb), 'DB_UNAVAILABLE');
    }
    if (connect) {
      const start = performance.now();
      try {
        await connect.health();
        add('CS REDE CONNECT', 'Aprovado', 'O serviço intermediário respondeu à consulta autenticada.', Math.round(performance.now() - start));
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        add('CS REDE CONNECT', 'Falhou', error.message, Math.round(performance.now() - start), error.code);
      }
    } else add('CS REDE CONNECT', 'Não configurado', 'Configure a origem e o token do serviço intermediário.');
    if (hasProbe) {
      const startIp = performance.now();
      try {
        const store = await verifyEgress();
        add('IP público de saída', 'Aprovado', store.observedEgress, Math.round(performance.now() - startIp));
        add('Comparação do CIDR', store.egressMatch === null ? 'Não configurado' : store.egressMatch ? 'Aprovado' : 'Falhou',
          store.egressMatch === null ? 'Cadastre um IP ou bloco CIDR.' : store.authorizedCidr);
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        const detail = error.status ? error.message + ' HTTP ' + error.status + '.' : error.message;
        add('IP público de saída', error.code === 'PROBE_NOT_CONFIGURED' ? 'Não configurado' : 'Falhou',
          detail, Math.round(performance.now() - startIp), error.code);
      }
    } else add('IP público de saída', 'Não configurado', 'Defina o serviço de detecção de IP na instalação.');
    add('Ambientes maxiPago!', 'Não suportado', 'O provedor anunciou a desativação da plataforma.', null, 'PROVIDER_RETIRED');
    add('Ambientes Itaú Checkout', 'Não configurado', 'Aguardando acesso ao contrato técnico e ao projeto Sandbox.', null, 'PROVIDER_ONBOARDING');
    for (const name of ['Credenciais e autenticação', 'DNS e HTTPS do gateway', 'Autorização de IP', 'Tokenização e 3DS', 'Operações financeiras e webhooks']) {
      add(name, 'Não verificado', 'A verificação depende da habilitação de um provedor homologado.');
    }
    return { checkedAt, tests };
  });
}
