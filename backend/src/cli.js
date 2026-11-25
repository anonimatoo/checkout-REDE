import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { audit, inTransaction, migrate, openPool } from './db.js';
import { digest, hashPassword, token, validPassword } from './security.js';
import { validEmail } from '../../shared/format.js';

const [command, rawEmail] = process.argv.slice(2);
const config = loadConfig();
const pool = openPool(config.databaseUrl);

try {
  await migrate(pool);
  if (command === 'migrate') {
    console.log('Migrações aplicadas.');
  } else if (command === 'create-admin') {
    const email = rawEmail?.trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Informe um e-mail válido.');
    if (process.stdin.isTTY) throw new Error('Forneça a senha de forma oculta pela entrada padrão. Consulte o README.');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 130) throw new Error('Senha precisa ter de 12 a 128 caracteres.');
    }
    const password = input.replace(/\r?\n$/, '');
    if (!validPassword(password)) throw new Error('Senha precisa ter de 12 a 128 caracteres.');
    const id = randomUUID();
    const hash = await hashPassword(password);
    await inTransaction(pool, async db => {
      const result = await db.query(`
        INSERT INTO administrators (id, singleton, email, password_hash)
        VALUES ($1, true, $2, $3) ON CONFLICT (singleton) DO NOTHING
      `, [id, email, hash]);
      if (!result.rowCount) throw new Error('Já existe uma conta administrativa.');
      await audit(db, id, 'conta_criada');
    });
    console.log('Conta administrativa criada.');
  } else if (command === 'recover-admin') {
    const email = rawEmail?.trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Informe um e-mail válido.');
    const secret = token();
    await inTransaction(pool, async db => {
      const { rows: [admin] } = await db.query('SELECT id FROM administrators WHERE email = $1 FOR UPDATE', [email]);
      if (!admin) throw new Error('Conta administrativa não encontrada.');
      await db.query('DELETE FROM reset_tokens WHERE admin_id = $1', [admin.id]);
      await db.query(`
        INSERT INTO reset_tokens (digest, admin_id, expires_at)
        VALUES ($1, $2, now() + interval '20 minutes')
      `, [digest(secret), admin.id]);
      await audit(db, admin.id, 'recuperacao_emitida');
    });
    console.log('Link de recuperação de uso único, válido por 20 minutos.');
    console.log(config.origin + '/admin/recuperar#' + secret);
  } else {
    throw new Error('Comando inválido.');
  }
} catch (error) {
  console.error(error instanceof Error && !error.code ? error.message : 'Falha ao executar o comando administrativo.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
