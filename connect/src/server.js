import { buildConnect, loadConnectConfig } from './app.js';

let app;
try {
  const config = await loadConnectConfig();
  app = buildConnect(config, { logger: true });
  await app.listen({ port: config.port, host: config.host });
  const stop = () => { void app.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error('Falha ao iniciar o CS REDE CONNECT.', error.message);
  await app?.close();
  process.exitCode = 1;
}
