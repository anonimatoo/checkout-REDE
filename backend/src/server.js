import { loadConfig } from './config.js';
import { migrate, openPool } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const pool = openPool(config.databaseUrl);
pool.on('error', () => console.error('A conexão ociosa com o PostgreSQL foi interrompida.'));
let app;
try {
  await migrate(pool);
  app = await buildApp(config, pool, { logger: true });
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  console.error('Falha ao iniciar o checkout.', error.code ?? error.name);
  await app?.close();
  await pool.end();
  process.exitCode = 1;
}

if (app && !process.exitCode) {
  const stop = async () => {
    await app.close();
    await pool.end();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
