import Fastify, { LogController } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { measureEgress, NetworkError, probeUrl } from './network.js';

export function connectToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export async function loadConnectConfig(env = process.env) {
  if (!connectToken(env.CONNECT_TOKEN)) throw new Error('Configure um CONNECT_TOKEN aleatório.');
  const port = Number(env.CONNECT_PORT ?? 3400);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CONNECT_PORT inválida.');
  const host = env.CONNECT_HOST ?? '127.0.0.1';
  const certFile = env.CONNECT_TLS_CERT;
  const keyFile = env.CONNECT_TLS_KEY;
  const privateHttp = env.CONNECT_PRIVATE_HTTP === 'true';
  if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('Configure o certificado e a chave TLS em conjunto.');
  if (!certFile && !privateHttp && !['127.0.0.1', '::1'].includes(host)) {
    throw new Error('Configure TLS para expor o Connect fora da máquina.');
  }
  const https = certFile ? { cert: await readFile(certFile), key: await readFile(keyFile), minVersion: 'TLSv1.2' } : undefined;
  return { port, host, https, token: env.CONNECT_TOKEN, egressUrl: probeUrl(env.EGRESS_PROBE_URL) };
}

export function buildConnect(config, { fetcher = fetch, logger = false } = {}) {
  const app = Fastify({
    logger, https: config.https, bodyLimit: 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const expected = Buffer.from('Bearer ' + config.token);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const incoming = Buffer.from(request.headers.authorization ?? '');
    if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
      return reply.code(401).send({ code: 'CONNECT_UNAUTHORIZED' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ code: error.code ?? 'CONNECT_INTERNAL' }, 'Falha no Connect');
    reply.code(error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500)
      .send({ code: 'CONNECT_REQUEST' });
  });
  app.get('/v1/health', async () => ({ service: 'cs-rede-connect', status: 'ok', version: 1,
    probeConfigured: Boolean(config.egressUrl) }));

  let pending;
  let previous;
  app.get('/v1/network', async (request, reply) => {
    try {
      pending ??= measureEgress(config.egressUrl, fetcher).finally(() => { pending = null; });
      const ip = await pending;
      const changed = previous !== undefined && previous !== ip;
      previous = ip;
      return { ip, changed, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      return reply.code(error.code === 'PROBE_NOT_CONFIGURED' ? 409 : 502)
        .send({ code: error.code, httpStatus: error.status ?? null });
    }
  });
  return app;
}
