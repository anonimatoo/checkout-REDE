import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { connectClient } from './connect.js';
import { registerAuth } from './auth.js';
import { registerTeam } from './team.js';
import { registerRedeRoutes } from './rede.js';
import { registerOrders } from './orders.js';
import { egressMonitor, registerStore } from './store.js';

export async function buildApp(config, pool, { logger = false, frontend = true } = {}) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.proxy || false,
    bodyLimit: 380_000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    strictTransportSecurity: config.secure ? { maxAge: 31_536_000 } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://viacep.com.br'],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/assets/')) reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  });
  app.setErrorHandler((error, request, reply) => {
    const client = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
    if (!client) request.log.error({ code: error.code ?? 'INTERNAL' }, 'Falha na solicitação');
    const code = client ? error.statusCode : 500;
    reply.code(code).send({ code: client ? 'REQUEST' : 'INTERNAL',
      message: client ? 'Confira os dados da solicitação.' : 'O sistema encontrou uma falha. Tente novamente.' });
  });

  const authorization = await registerAuth(app, pool, config);
  const connect = connectClient(config);
  const verifyEgress = egressMonitor(pool, config, connect);
  registerStore(app, pool, config, authorization, verifyEgress, connect);
  registerOrders(app, pool, config, authorization);
  registerRedeRoutes(app, pool, connect, authorization);
  registerTeam(app, pool, config, authorization);
  if (connect || config.egressUrl) {
    const check = () => verifyEgress().catch(() => app.log.warn('Não foi possível verificar o IP de saída.'));
    const interval = setInterval(check, 60 * 60 * 1000);
    interval.unref();
    const initial = setTimeout(check, 1000);
    initial.unref();
    app.addHook('onClose', async () => { clearInterval(interval); clearTimeout(initial); });
  }

  if (frontend) {
    const dist = new URL('../../frontend/dist/', import.meta.url);
    const html = await readFile(new URL('index.html', dist));
    const assets = new URL('assets/', dist);
    const types = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
    for (const asset of await readdir(assets, { withFileTypes: true })) {
      const type = types[extname(asset.name)];
      if (!asset.isFile() || !type || !/^[a-zA-Z0-9_.-]+$/.test(asset.name)) continue;
      const file = new URL(asset.name, assets);
      app.get('/assets/' + asset.name, async (request, reply) => reply.type(type)
        .header('Cache-Control', 'public, max-age=31536000, immutable').send(createReadStream(file)));
    }
    for (const path of ['/', '/pedido/:token', '/admin', '/admin/:page']) {
      app.get(path, async (request, reply) => reply.type('text/html; charset=utf-8').send(html));
    }
  }
  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    code: 'NOT_FOUND', message: 'Página ou serviço não encontrado.',
  }));
  return app;
}
