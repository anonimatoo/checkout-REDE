import { isIP } from 'node:net';
import { boundedJson, RedeError } from '../../connect/src/rede.js';
import { NetworkError } from '../../connect/src/network.js';

const knownCodes = new Set([
  'CONNECT_UNAUTHORIZED', 'PROBE_NOT_CONFIGURED', 'PROBE_HTTP', 'PROBE_TIMEOUT', 'PROBE_DNS',
  'PROBE_TLS', 'PROBE_UNREACHABLE', 'PROBE_RESPONSE', 'PROBE_READ',
]);

export function connectClient(config, fetcher = fetch) {
  if (!config.connectUrl) return null;

  async function request(path, { method = 'GET', body, isRede = false } = {}) {
    let response;
    try {
      response = await fetcher(new URL(path, config.connectUrl), {
        method, headers: { accept: 'application/json', authorization: 'Bearer ' + config.connectToken,
          ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', signal: AbortSignal.timeout(isRede ? 18_000 : 7_000),
      });
    } catch {
      throw new NetworkError('CONNECT_UNREACHABLE', 'Confira o endereço, a rede e o certificado do CS REDE CONNECT.');
    }
    const data = await boundedJson(response);
    if (!response.ok) {
      if (isRede) {
        const code = typeof data?.code === 'string' && /^REDE_[A-Z_]{1,50}$/.test(data.code) ? data.code : 'CONNECT_REDE';
        const message = code !== 'CONNECT_REDE' && typeof data.message === 'string'
          ? data.message.slice(0, 240) : 'Confira o cofre e a conexão autenticada do CS REDE CONNECT.';
        throw new RedeError(code, message, response.status, data?.upstreamCode ?? null, data?.upstreamStatus ?? null);
      }
      const code = knownCodes.has(data?.code) ? data.code : 'CONNECT_HTTP';
      const detail = code === 'CONNECT_UNAUTHORIZED' ? 'Confira o token compartilhado do CS REDE CONNECT.'
        : code === 'PROBE_NOT_CONFIGURED' ? 'Configure o serviço de detecção de IP no CS REDE CONNECT.'
          : 'O serviço intermediário retornou um erro na consulta.';
      const status = Number.isInteger(data?.httpStatus) ? data.httpStatus : response.status;
      throw new NetworkError(code, detail, status);
    }
    if (isRede && (!data || typeof data !== 'object')) throw new RedeError('CONNECT_RESPONSE', 'Resposta inválida do Connect.');
    return data;
  }

  return {
    async health() {
      const data = await request('/v1/health');
      if (data?.status !== 'ok' || data.service !== 'cs-rede-connect' || data.version !== 1) {
        throw new NetworkError('CONNECT_RESPONSE', 'O endereço respondeu com um serviço ou versão incompatível.');
      }
      return data;
    },
    rede(environment, operation, options) {
      return request('/v1/rede/' + environment + operation, { ...options, isRede: true });
    },
    async egress() {
      const data = await request('/v1/network');
      if (!isIP(data?.ip)) throw new NetworkError('CONNECT_RESPONSE', 'O CS REDE CONNECT retornou um IP inválido.');
      return data.ip;
    },
  };
}
