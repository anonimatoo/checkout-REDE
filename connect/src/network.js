import { isIP } from 'node:net';

export class NetworkError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function probeUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('EGRESS_PROBE_URL deve ser uma URL HTTPS sem credenciais.');
  }
  return url;
}

export async function measureEgress(url, fetcher = fetch) {
  if (!url) throw new NetworkError('PROBE_NOT_CONFIGURED', 'Configure o serviço HTTPS de detecção de IP.');
  let response;
  try {
    response = await fetcher(url, {
      headers: { accept: 'text/plain' }, redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const cause = error.cause?.code;
    const timedOut = ['TimeoutError', 'AbortError'].includes(error.name) || cause === 'UND_ERR_CONNECT_TIMEOUT';
    const dns = ['ENOTFOUND', 'EAI_AGAIN'].includes(cause);
    const tls = /^(?:CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO_)/.test(cause ?? '');
    const code = timedOut ? 'PROBE_TIMEOUT' : dns ? 'PROBE_DNS' : tls ? 'PROBE_TLS' : 'PROBE_UNREACHABLE';
    throw new NetworkError(code, 'O servidor não conseguiu consultar o serviço de detecção de IP.');
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new NetworkError('PROBE_HTTP', 'O serviço de detecção de IP retornou um erro HTTP.', response.status);
  }
  const reader = response.body.getReader();
  let body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (body.length + value.byteLength > 128) throw new NetworkError('PROBE_RESPONSE', 'Resposta de IP acima do tamanho esperado.');
      body += Buffer.from(value).toString('utf8');
    }
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError('PROBE_READ', 'O corpo da resposta de IP não pôde ser lido.');
  } finally {
    await reader.cancel().catch(() => {});
  }
  const ip = body.trim();
  if (!/^[a-fA-F0-9:.]+$/.test(ip) || !isIP(ip)) {
    throw new NetworkError('PROBE_RESPONSE', 'O serviço de detecção não retornou um IP válido.');
  }
  return ip;
}
