import { isIP } from 'node:net';
import { NetworkError } from '../../connect/src/network.js';

const knownCodes = new Set([
  'CONNECT_UNAUTHORIZED', 'PROBE_NOT_CONFIGURED', 'PROBE_HTTP', 'PROBE_TIMEOUT', 'PROBE_DNS',
  'PROBE_TLS', 'PROBE_UNREACHABLE', 'PROBE_RESPONSE', 'PROBE_READ',
]);

export function connectClient(config, fetcher = fetch) {
  if (!config.connectUrl) return null;

  async function request(path) {
    let response;
    try {
      response = await fetcher(new URL(path, config.connectUrl), {
        headers: { accept: 'application/json', authorization: 'Bearer ' + config.connectToken },
        redirect: 'error', signal: AbortSignal.timeout(7_000),
      });
    } catch {
      throw new NetworkError('CONNECT_UNREACHABLE', 'Confira o endereço, a rede e o certificado do CS REDE CONNECT.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = knownCodes.has(data?.code) ? data.code : 'CONNECT_HTTP';
      const detail = code === 'CONNECT_UNAUTHORIZED' ? 'Confira o token compartilhado do CS REDE CONNECT.'
        : code === 'PROBE_NOT_CONFIGURED' ? 'Configure o serviço de detecção de IP no CS REDE CONNECT.'
          : 'O serviço intermediário retornou um erro na consulta.';
      const status = Number.isInteger(data?.httpStatus) ? data.httpStatus : response.status;
      throw new NetworkError(code, detail, status);
    }
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
    async egress() {
      const data = await request('/v1/network');
      if (!isIP(data?.ip)) throw new NetworkError('CONNECT_RESPONSE', 'O CS REDE CONNECT retornou um IP inválido.');
      return data.ip;
    },
  };
}
