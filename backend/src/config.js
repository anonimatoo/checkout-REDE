import { isIP } from 'node:net';
import { probeUrl } from '../../connect/src/network.js';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('Configure DATABASE_URL.');
  const key = Buffer.from(env.LINK_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('LINK_ENCRYPTION_KEY precisa conter 32 bytes em Base64.');
  const origin = new URL(env.APP_ORIGIN ?? 'http://localhost:3000');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== origin.origin + '/') {
    throw new Error('APP_ORIGIN precisa conter somente o protocolo, host e porta da aplicação.');
  }
  if (origin.protocol !== 'https:' && (!loopback.has(origin.hostname) || env.NODE_ENV === 'production')) {
    throw new Error('Configure uma origem HTTPS para servir fora do ambiente local.');
  }
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
  const proxy = env.TRUST_PROXY_IP;
  if (proxy && !isIP(proxy)) throw new Error('TRUST_PROXY_IP precisa ser o IP do proxy reverso.');
  const egressUrl = probeUrl(env.EGRESS_PROBE_URL);
  const connectUrl = env.CONNECT_URL ? new URL(env.CONNECT_URL) : null;
  const connectToken = env.CONNECT_TOKEN;
  if (connectUrl) {
    const privateOrigin = connectUrl.protocol === 'http:' && (
      loopback.has(connectUrl.hostname) && env.NODE_ENV !== 'production' ||
      connectUrl.hostname === 'connect' && env.CONNECT_PRIVATE_HTTP === 'true'
    );
    if ((connectUrl.protocol !== 'https:' && !privateOrigin) || connectUrl.href !== connectUrl.origin + '/') {
      throw new Error('Configure CONNECT_URL com a origem HTTPS do serviço intermediário.');
    }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(connectToken ?? '')) throw new Error('Configure o CONNECT_TOKEN compartilhado.');
  }
  return {
    databaseUrl: env.DATABASE_URL, key, origin: origin.origin, port,
    secure: origin.protocol === 'https:', host: env.APP_HOST ?? '127.0.0.1',
    proxy, egressUrl, connectUrl, connectToken,
  };
}

export const payment = Object.freeze({
  available: false,
  provider: 'Itaú Checkout',
  status: 'aguardando_contrato_tecnico',
  portal: 'https://developer.userede.com.br/',
  announcement: 'https://www.maxipago.com/developers/',
});
