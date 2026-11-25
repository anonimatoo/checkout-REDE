import { openPool } from '../../backend/src/db.js';
import { buildConnect, loadConnectConfig } from './app.js';

let app;
try {
  const config = await loadConnectConfig();
  const db = config.databaseUrl ? openPool(config.databaseUrl) : null;
  db?.on('error', () => console.error('Conexão ociosa do cofre e.Rede interrompida.'));
  app = buildConnect(config, { logger: true, db });
  if (db) app.addHook('onClose', () => db.end());
  await app.listen({ port: config.port, host: config.host });
  const stop = () => { void app.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error('Falha ao iniciar o CS REDE CONNECT.', error.message);
  await app?.close();
  process.exitCode = 1;
}
