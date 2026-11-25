import writeExcelFile from 'write-excel-file/node';
import { randomUUID } from 'node:crypto';
import { MAX_CENTS } from '../../shared/format.js';
import { audit, inTransaction } from './db.js';
import { digest, seal, token, unseal, validToken } from './security.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const labels = { open: 'Aberto', expired: 'Expirado', canceled: 'Cancelado' };
const state = "CASE WHEN canceled_at IS NOT NULL THEN 'canceled' WHEN expires_at <= now() THEN 'expired' ELSE 'open' END";

const periods = {
  hoje: [0, 1], ontem: [-1, 0], '7dias': [-6, 1], '30dias': [-29, 1],
};

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateFilter(query, offset) {
  const { period, start, end } = query;
  const tz = "'America/Sao_Paulo'";
  const day = `(now() AT TIME ZONE ${tz})::date`;
  if (Object.hasOwn(periods, period)) {
    const [a, b] = periods[period];
    return { sql: ` AND created_at >= ((${day} + (${a}))::timestamp AT TIME ZONE ${tz})
      AND created_at < ((${day} + ${b})::timestamp AT TIME ZONE ${tz})`, args: [] };
  }
  if (period === 'mes') {
    const month = `date_trunc('month', now() AT TIME ZONE ${tz})`;
    return { sql: ` AND created_at >= (${month} AT TIME ZONE ${tz})
      AND created_at < ((${month} + interval '1 month') AT TIME ZONE ${tz})`, args: [] };
  }
  if (period === 'personalizado') {
    if (!isDate(start) || !isDate(end) || start > end) return null;
    return { sql: ` AND created_at >= ($${offset}::date::timestamp AT TIME ZONE ${tz})
      AND created_at < (($${offset + 1}::date + 1)::timestamp AT TIME ZONE ${tz})`, args: [start, end] };
  }
  return { sql: '', args: [] };
}

function orderFilter(query) {
  const conditions = [];
  const args = [];
  const add = (column, operator, value) => {
    args.push(value);
    conditions.push(`${column} ${operator} $${args.length}`);
  };
  const { status, min, max } = query;
  if (status) {
    if (!Object.hasOwn(labels, status)) return null;
    add('(' + state + ')', '=', status);
  }
  const valid = value => typeof value === 'string' && /^\d{1,9}$/.test(value) && Number(value) <= MAX_CENTS;
  if ((min !== undefined && !valid(min)) || (max !== undefined && !valid(max)) ||
    (min !== undefined && max !== undefined && Number(min) > Number(max))) return null;
  if (min !== undefined) add('amount_cents', '>=', Number(min));
  if (max !== undefined) add('amount_cents', '<=', Number(max));
  const range = dateFilter(query, args.length + 1);
  if (!range) return null;
  return { sql: 'WHERE true' + conditions.map(condition => ' AND ' + condition).join('') + range.sql,
    args: [...args, ...range.args] };
}

function asOrder(row) {
  return {
    id: row.id, reference: row.reference, description: row.description, cents: row.amount_cents,
    maxInstallments: row.max_installments, minInstallment: row.min_installment,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
  };
}

function serialized(row, config, showLink = true) {
  const url = showLink && row.status === 'open' ? config.origin + '/pedido/' + unseal(row.token_sealed, config.key, row.id) : null;
  return { ...asOrder(row), url };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

function badInput(reply, message) {
  return reply.code(400).send({ code: 'ORDER_INPUT', message });
}

export function registerOrders(app, db, config, { authRead, orderWrite }) {
  app.get('/api/pedidos/:token', async (request, reply) => {
    const raw = request.params.token;
    const notFound = () => reply.code(404).send({ code: 'ORDER_UNKNOWN', message: 'Link de pedido inválido ou indisponível.' });
    if (!validToken(raw)) return notFound();
    const { rows: [row] } = await db.query(`SELECT *, ${state} AS status FROM orders WHERE token_digest = $1`, [digest(raw)]);
    if (!row) return notFound();
    const { id, ...order } = asOrder(row);
    return order;
  });

  app.post('/api/admin/pedidos', orderWrite, async (request, reply) => {
    const idempotency = request.headers['idempotency-key'];
    if (typeof idempotency !== 'string' || !uuid.test(idempotency)) {
      return badInput(reply, 'Crie uma chave de idempotência válida.');
    }
    const { cents, maxInstallments, days } = request.body ?? {};
    const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
    const reference = typeof request.body?.reference === 'string' ? request.body.reference.trim() : '';
    if (!Number.isInteger(cents) || cents < 1 || cents > MAX_CENTS ||
      !Number.isInteger(maxInstallments) || maxInstallments < 1 || maxInstallments > 12 ||
      !Number.isInteger(days) || days < 1 || days > 90 || description.length > 120 || reference.length > 50) {
      return badInput(reply, 'Confira o valor, a descrição, a referência, as parcelas e a validade do pedido.');
    }
    const input = digest(JSON.stringify({ cents, maxInstallments, days, description, reference }));
    const admin = request.session.id;
    const result = await inTransaction(db, async client => {
      await client.query('SELECT id FROM administrators WHERE id = $1 FOR UPDATE', [admin]);
      const { rows: [existing] } = await client.query(`
        SELECT *, ${state} AS status FROM orders WHERE admin_id = $1 AND idempotency_key = $2
      `, [admin, idempotency]);
      if (existing) return existing.input_digest === input ? { row: existing } : { conflict: true };

      const { rows: [limits] } = await client.query('SELECT * FROM store_settings WHERE id FOR SHARE');
      if (cents < limits.min_cents || cents > limits.max_cents || maxInstallments > limits.max_installments ||
          maxInstallments > Math.max(1, Math.floor(cents / limits.min_installment))) {
        return { invalid: true };
      }
      const id = randomUUID();
      const secret = token();
      const orderReference = reference || 'PED-' + id.slice(0, 8).toUpperCase();
      const { rows: [row] } = await client.query(`
        INSERT INTO orders (id, admin_id, idempotency_key, input_digest, token_digest, token_sealed,
          reference, description, amount_cents, max_installments, min_installment, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now() + make_interval(days => $12))
        RETURNING *, 'open' AS status
      `, [id, admin, idempotency, input, digest(secret), seal(secret, config.key, id),
        orderReference, description, cents, maxInstallments, limits.min_installment, days]);
      await audit(client, admin, 'pedido_criado', id);
      return { row, created: true };
    });
    if (result.conflict) return reply.code(409).send({ code: 'IDEMPOTENCY', message: 'Esta tentativa já corresponde a outro pedido.' });
    if (result.invalid) return badInput(reply, 'O valor ou o parcelamento está fora dos limites do estabelecimento.');
    reply.code(result.created ? 201 : 200);
    return serialized(result.row, config);
  });

  app.get('/api/admin/pedidos', authRead, async (request, reply) => {
    const filter = orderFilter(request.query);
    if (!filter) return badInput(reply, 'Informe um período, faixa de valor e situação válidos.');
    const { sql: where, args } = filter;
    const { format } = request.query;
    if (format === 'csv' || format === 'xlsx') {
      const { rows } = await db.query(`SELECT reference, description, amount_cents, max_installments,
          created_at, expires_at, ${state} AS status FROM orders ${where}
        ORDER BY created_at DESC, id DESC LIMIT 10001`, args);
      if (rows.length > 10000) return badInput(reply, 'Selecione um período com até 10.000 pedidos para exportar.');
      const report = [
        ['Referência', 'Descrição', 'Centavos', 'Máximo de parcelas', 'Status', 'Criação (UTC)', 'Validade (UTC)'],
        ...rows.map(row => [row.reference, row.description, row.amount_cents, row.max_installments, labels[row.status],
          row.created_at.toISOString(), row.expires_at.toISOString()]),
      ];
      if (format === 'xlsx') {
        const workbook = await writeExcelFile(report.map(row =>
          row.map(value => ({ value, type: typeof value === 'number' ? Number : String }))),
        { sheet: 'Pedidos' }).toBuffer();
        return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', 'attachment; filename="pedidos.xlsx"').send(workbook);
      }
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="pedidos.csv"')
        .send(csv(report));
    }
    const page = Number(request.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000) return badInput(reply, 'Página inválida.');
    const { rows } = await db.query(`SELECT *, ${state} AS status FROM orders ${where}
      ORDER BY created_at DESC, id DESC LIMIT 26 OFFSET $${args.length + 1}`, [...args, (page - 1) * 25]);
    return { orders: rows.slice(0, 25).map(row => serialized(row, config, request.session.role !== 'viewer')), page, hasNext: rows.length > 25 };
  });

  app.post('/api/admin/pedidos/:id/cancelar', orderWrite, async (request, reply) => {
    if (!uuid.test(request.params.id) || request.body?.confirm !== true) {
      return badInput(reply, 'Confirme o cancelamento do pedido.');
    }
    const canceled = await inTransaction(db, async client => {
      const { rows: [row] } = await client.query(`
        UPDATE orders SET canceled_at = now() WHERE id = $1
          AND canceled_at IS NULL AND expires_at > now() RETURNING id
      `, [request.params.id]);
      if (!row) return false;
      await audit(client, request.session.id, 'pedido_cancelado', row.id);
      return true;
    });
    if (!canceled) return reply.code(409).send({ code: 'ORDER_CLOSED', message: 'Este pedido já está encerrado.' });
    return { ok: true };
  });

  app.get('/api/admin/resumo', authRead, async (request, reply) => {
    const filter = orderFilter(request.query);
    if (!filter) return badInput(reply, 'Informe um período, faixa de valor e situação válidos.');
    const { rows: [row] } = await db.query(`
      SELECT count(*)::integer AS total, coalesce(sum(amount_cents), 0)::text AS volume,
        count(*) FILTER (WHERE ${state} = 'open')::integer AS open,
        count(*) FILTER (WHERE ${state} = 'expired')::integer AS expired,
        count(*) FILTER (WHERE ${state} = 'canceled')::integer AS canceled
      FROM orders ${filter.sql}
    `, filter.args);
    return row;
  });
}
