import React, { useRef, useState } from 'react';
import { CreditCard, ExternalLink, FlaskConical } from 'lucide-react';
import { brl, parseMoney } from '../../shared/format.js';
import { api, Field, fmtDate, Loading, Message, MoneyInput, SectionTitle, useRemote } from './ui.jsx';

function errorText(error) {
  return error.message + (error.upstreamCode ? ' Código Rede ' + error.upstreamCode + '.' : '') +
    (error.upstreamStatus ? ' HTTP ' + error.upstreamStatus + '.' : '');
}

function Credentials({ user, environment }) {
  const path = '/admin/rede/' + environment;
  const status = useRemote(path);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function run(method, action = '', data) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api(path + action, { method, csrf: user.csrf, data });
      setNotice({ tone: 'ok', text: method === 'DELETE' ? 'Integração desconectada.' : 'A Rede confirmou a autenticação.' });
      setClientSecret('');
      setClientId('');
      setConfirm(false);
      status.retry();
    } catch (failure) {
      setNotice({ tone: 'error', text: errorText(failure) });
    } finally { setBusy(false); }
  }

  if (status.loading) return <Loading />;
  return <>
    <Message tone="error">{status.error}</Message>
    {status.data && <>
      {status.data.configured ? <dl className="summary-list">
        <div><dt>Conta</dt><dd>{status.data.account}</dd></div>
        <div><dt>Última autenticação confirmada</dt><dd>{fmtDate(status.data.verifiedAt)}</dd></div>
      </dl> : <p>Credenciais do ambiente ainda não cadastradas.</p>}
      <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        void run('PUT', '', { clientId, clientSecret });
      }}>
        <div className="field-grid">
          <Field label="Client ID (PV)"><input required autoComplete="off" maxLength={128} value={clientId} onChange={event => setClientId(event.target.value)} /></Field>
          <Field label="Client Secret (chave de integração)"><input required type="password" autoComplete="new-password" maxLength={512} value={clientSecret} onChange={event => setClientSecret(event.target.value)} /></Field>
        </div>
        <div className="share-actions">
          <button className="button primary" disabled={busy}>{status.data.configured ? 'Validar e substituir credenciais' : 'Conectar Rede'}</button>
          {status.data.configured && <>
            <button className="button secondary" type="button" disabled={busy}
              onClick={() => void run('POST', '/testar')}>Testar conexão</button>
            {!confirm ? <button className="button danger" type="button" disabled={busy} onClick={() => setConfirm(true)}>Desconectar</button> :
              <button className="button danger" type="button" disabled={busy} onClick={() => void run('DELETE')}>Confirmar desconexão</button>}
          </>}
        </div>
      </form>
    </>}
    {status.error && <button className="button secondary fit" onClick={status.retry}>Atualizar status</button>}
    {notice && <Message tone={notice.tone}>{notice.text}</Message>}
  </>;
}

export function RedeSettings({ user }) {
  const [environment, setEnvironment] = useState('sandbox');
  return <section className="surface admin-panel form-stack">
    <SectionTitle icon={CreditCard}>Configurações da Rede Itaú</SectionTitle>
    <p>A e.Rede usa OAuth 2.0. Cadastre a credencial correspondente ao ambiente do seu projeto.</p>
    <Field label="Ambiente"><select value={environment} onChange={event => setEnvironment(event.target.value)}>
      <option value="sandbox">Sandbox</option><option value="production">Produção · autenticação</option>
    </select></Field>
    {environment === 'production' && <Message>Este ambiente permite validar credenciais. As cobranças aguardam homologação.</Message>}
    <Credentials key={environment} user={user} environment={environment} />
    <a className="button secondary fit" href="https://developer.userede.com.br/ponto-partida" target="_blank" rel="noreferrer">
      <ExternalLink size={15} /> Portal do Desenvolvedor Rede
    </a>
  </section>;
}

const states = {
  sending: 'Envio registrado', uncertain: 'Aguardando conciliação', pending: 'Aguardando pagamento',
  approved: 'Aprovado', rejected: 'Recusado', canceled: 'Cancelado', expired: 'Expirado', refunded: 'Estornado',
};

export function SandboxPix({ user }) {
  const [amount, setAmount] = useState('');
  const [selected, select] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const attempt = useRef(null);
  const sandbox = useRemote('/admin/sandbox/pix');
  const status = useRemote('/admin/rede/sandbox');
  const cents = parseMoney(amount);

  async function execute(operation) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const path = '/admin/sandbox/pix';
      let result;
      if (operation === 'create') {
        if (!attempt.current || attempt.current.cents !== cents) attempt.current = { cents, id: crypto.randomUUID() };
        result = await api(path, { method: 'POST', csrf: user.csrf, data: { cents }, headers: { 'Idempotency-Key': attempt.current.id } });
        attempt.current = null;
        setAmount('');
      } else {
        result = await api(path + '/' + selected.id + '/' + operation,
          { method: 'POST', csrf: user.csrf, data: { confirm } });
      }
      select(result);
      setConfirm(false);
      sandbox.retry();
      if (result.error) setError(errorText(result.error));
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  return <section className="surface admin-panel form-stack">
    <SectionTitle icon={FlaskConical}>Pix no Sandbox e.Rede</SectionTitle>
    <p>Gere um QR Code no ambiente oficial de testes. Os valores e os estados abaixo se referem somente ao Sandbox.</p>
    {status.loading ? <Loading /> : !status.data?.configured &&
      <Message tone="error">{status.error || 'Cadastre e valide as credenciais e.Rede do Sandbox.'}</Message>}
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void execute('create'); }}>
      <div className="field"><label htmlFor="pix-amount">Valor de teste</label>
        <MoneyInput id="pix-amount" value={amount} onChange={setAmount} />
      </div>
      <button className="button primary fit" disabled={busy || !status.data?.configured || !cents}>Solicitar Pix de teste</button>
    </form>
    <Message tone="error">{error}</Message>
    {selected && <div className="form-stack sandbox-result">
      <dl className="summary-list">
        <div><dt>Referência</dt><dd>{selected.reference}</dd></div>
        <div><dt>Valor</dt><dd>{brl(selected.cents)}</dd></div>
        <div><dt>Estado</dt><dd>{states[selected.state]}</dd></div>
        <div><dt>TID e código da Rede</dt><dd>{selected.tid ?? '—'} · {selected.code ?? '—'}</dd></div>
        {selected.refund && <div><dt>Solicitação de estorno</dt><dd>{selected.refund === 'accepted' ? 'Aceita' : 'Em conciliação'}</dd></div>}
      </dl>
      {selected.qrImage && <img className="sandbox-qr" alt="QR Code Pix de teste da Rede" src={'data:image/png;base64,' + selected.qrImage} />}
      {selected.qrText && <Field label="Pix copia e cola de teste"><input readOnly value={selected.qrText} onFocus={event => event.target.select()} /></Field>}
      <div className="share-actions">
        <button className="button secondary" disabled={busy || !status.data?.configured || ['rejected', 'expired', 'refunded'].includes(selected.state)}
          onClick={() => void execute('consultar')}>Consultar na Rede</button>
        {selected.state === 'approved' && !selected.refund &&
          <button className="button danger" disabled={busy || !status.data?.configured}
            onClick={() => confirm ? void execute('estornar') : setConfirm(true)}>
            {confirm ? 'Confirmar estorno Sandbox' : 'Estornar Pix Sandbox'}
          </button>}
      </div>
    </div>}
    {sandbox.loading ? <Loading /> : sandbox.error ? <Message tone="error">{sandbox.error}</Message> : sandbox.data.operations.length > 0 && <>
      <h2>Histórico Sandbox</h2>
      <div className="table-scroll"><table><thead><tr><th>Referência</th><th>Valor</th><th>Estado</th><th>Data</th></tr></thead>
        <tbody>{sandbox.data.operations.map(record => <tr key={record.id}>
          <td><button className="button small" disabled={busy} onClick={() => { select(record); setConfirm(false); setError(''); }}>
            {record.reference}</button></td><td>{brl(record.cents)}</td><td>{states[record.state]}</td><td>{fmtDate(record.createdAt)}</td>
        </tr>)}</tbody></table></div>
    </>}
  </section>;
}

export function ConnectStatus() {
  const remote = useRemote('/admin/connect');
  const data = remote.data;
  return <section className="surface admin-panel form-stack">
    <SectionTitle icon={CreditCard}>Disponibilidade do CS REDE CONNECT</SectionTitle>
    {remote.loading ? <Loading /> : remote.error ? <Message tone="error">{remote.error}</Message> : <>
      <dl className="summary-list">
        <div><dt>Serviço</dt><dd>{data.status}</dd></div>
        <div><dt>Cofre de credenciais e.Rede</dt><dd>{data.vaultEnabled ? 'Habilitado' : 'A configurar'}</dd></div>
        <div><dt>Última medição de IP</dt><dd>{fmtDate(data.store.egressCheckedAt)}</dd></div>
      </dl>
      <Message tone={data.status === 'Disponível' ? 'ok' : 'error'}>{data.detail}</Message>
      {data.changes.length > 0 && <>
        <h2>Histórico de IP</h2>
        <div className="table-scroll"><table><thead><tr><th>Evento</th><th>Endereço</th><th>Data</th></tr></thead>
          <tbody>{data.changes.map((item, index) => <tr key={index}><td>{item.action === 'ip_saida_alterado' ? 'Mudança de saída' : 'Bloco local atualizado'}</td>
            <td>{item.subject || 'Removido'}</td><td>{fmtDate(item.created_at)}</td></tr>)}</tbody></table></div>
      </>}
    </>}
    <div className="share-actions">
      <button className="button secondary" onClick={remote.retry} disabled={remote.loading}>Testar conectividade</button>
      <a className="button secondary" href="/admin/diagnostico">Testar e.Rede e exportar diagnóstico</a>
    </div>
  </section>;
}

export function Guide() {
  const shop = useRemote('/admin/configuracao');
  const connect = useRemote('/admin/connect');
  const sandbox = useRemote('/admin/rede/sandbox');
  const operations = useRemote('/admin/sandbox/pix');
  const steps = [
    ['Conta proprietária', '/admin/seguranca', 'Criada'],
    ['Identidade visual', '/admin/loja', shop.data?.store.name !== 'Meu estabelecimento' && shop.data?.store.name ? 'Configurada' : 'A configurar'],
    ['Ambiente e credenciais', '/admin/rede', sandbox.data?.configured ? 'Sandbox configurado' : 'A configurar'],
    ['Disponibilidade do Connect', '/admin/connect', connect.data?.status ?? 'A verificar'],
    ['IP de saída e autorização', '/admin/ip', connect.data?.store.observedEgress ? 'IP medido' : 'A verificar'],
    ['Autenticação e diagnóstico', '/admin/diagnostico', sandbox.data?.verifiedAt ? 'Autenticação confirmada' : 'A testar'],
    ['Pagamento no Sandbox', '/admin/sandbox', operations.data?.operations.some(item => item.state === 'approved' || item.state === 'refunded')
      ? 'Pagamento confirmado' : 'A testar'],
    ['Homologação e Produção', '/admin/rede', 'Aguardando homologação'],
  ];
  return <section className="surface admin-panel form-stack">
    <SectionTitle icon={FlaskConical}>Configurar o checkout</SectionTitle>
    <div className="table-scroll"><table><thead><tr><th>Etapa</th><th>Situação</th></tr></thead><tbody>
      {steps.map(([name, href, status]) => <tr key={name}><td><a className="button small" href={href}>{name}</a></td><td>{status}</td></tr>)}
    </tbody></table></div>
  </section>;
}
