import React, { useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Building2, ChevronLeft, ChevronRight,
  Clipboard, CreditCard, FileText, Globe2, LayoutDashboard, Link2, LockKeyhole, LogOut, Menu, Plus,
  ReceiptText, Settings2, ShieldCheck, UserRound, UsersRound, X,
} from 'lucide-react';
import { ConnectStatus, Guide, RedeSettings, SandboxPix } from './rede.jsx';
import { FirstAccess, Team } from './access.jsx';
import { brl, maskCnpj, maskPhone, parseMoney } from '../../shared/format.js';
import { api, Field, fmtDate, Header, Loading, Message, MoneyInput, moneyValue, SectionTitle, useRemote } from './ui.jsx';

const pages = [
  ['painel', 'Dashboard', LayoutDashboard], ['nova', 'Nova venda', Plus], ['links', 'Links de pagamento', Link2],
  ['pedidos', 'Pedidos', ReceiptText], ['transacoes', 'Transações', CreditCard], ['clientes', 'Clientes', UserRound],
  ['rede', 'Configurações Rede', Settings2], ['ip', 'IP e Conectividade', Globe2],
  ['connect', 'CS REDE CONNECT', Activity], ['configurar', 'Configuração inicial', Settings2], ['diagnostico', 'Diagnóstico', Activity],
  ['sandbox', 'Simulador Sandbox', ShieldCheck], ['relatorios', 'Relatórios', ArrowDownToLine],
  ['loja', 'Personalização', Building2], ['seguranca', 'Segurança', LockKeyhole],
  ['equipe', 'Equipe e permissões', UsersRound], ['auditoria', 'Auditoria', FileText],
];
const ownerPages = new Set(['rede', 'ip', 'diagnostico', 'sandbox', 'loja', 'auditoria', 'equipe', 'connect', 'configurar']);
const orderStatuses = { open: 'Aberto', canceled: 'Cancelado', expired: 'Expirado' };

function AdminLogin({ onLogin, recovery }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [secret] = useState(() => location.hash.slice(1));
  const setup = useRemote('/auth/setup');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (recovery) {
        await api('/auth/recovery', { method: 'POST', data: { secret, password } });
        history.replaceState(null, '', '/admin/recuperar');
        setDone(true);
      } else {
        const { user } = await api('/auth/login', { method: 'POST', data: { email, password } });
        onLogin(user);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="checkout-page login-page">
    <Header admin />
    <main className="wrap"><section className="surface login-card">
      <SectionTitle icon={LockKeyhole}>{recovery ? 'Definir senha' : 'Painel Administrativo'}</SectionTitle>
      <p>{recovery ? 'Use seu link de convite ou recuperação para definir a senha da conta.' : 'Entre para gerenciar seu estabelecimento.'}</p>
      {done ? <><Message tone="ok">Senha atualizada. Entre novamente para continuar.</Message>
        <a className="button primary" href="/admin">Voltar ao login</a></>
        : <form onSubmit={submit} className="form-stack">
          {!recovery && <Field label="E-mail"><input type="email" autoComplete="username" required maxLength={254}
            value={email} onChange={event => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /></Field>}
          <Field label={recovery ? 'Nova senha' : 'Senha'}><input type="password" required
            autoComplete={recovery ? 'new-password' : 'current-password'} maxLength={128} minLength={recovery ? 12 : undefined}
            value={password} onChange={event => setPassword(event.target.value)} /></Field>
          <Message tone="error">{error}</Message>
          <button className="button primary" disabled={busy || recovery && !secret}>
            {busy ? 'Aguarde…' : recovery ? 'Atualizar senha' : 'Entrar'}
          </button>
        </form>}
      {!recovery && setup.data?.initialized === false && <a className="button secondary" href="/admin/primeiro-acesso">Primeiro acesso</a>}
      {!recovery && <details className="recovery-help">
        <summary>Esqueci minha senha</summary>
        <p>Solicite ao responsável pela instalação um link de recuperação de uso único.</p>
      </details>}
      {recovery && !secret && !done && <Message tone="error">Use o link completo de recuperação.</Message>}
    </section></main>
  </div>;
}

function Data({ remote, children }) {
  if (remote.loading) return <Loading />;
  if (remote.error) return <div className="form-stack">
    <Message tone="error">{remote.error}</Message>
    <button className="button secondary fit" onClick={remote.retry}>Tentar novamente</button>
  </div>;
  return children(remote.data);
}

function usePeriod() {
  const [period, setPeriod] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const ready = period !== 'personalizado' || Boolean(start && end && start <= end);
  const query = ready && period ? new URLSearchParams({ period, ...(period === 'personalizado' ? { start, end } : {}) }) : new URLSearchParams();
  return { period, setPeriod, start, setStart, end, setEnd, query, ready };
}

function PeriodFilter({ value, onChange }) {
  return <>
    <Field label="Período">
      <select value={value.period} onChange={event => { value.setPeriod(event.target.value); onChange?.(); }}>
        <option value="">Todos</option><option value="hoje">Hoje</option><option value="ontem">Ontem</option>
        <option value="7dias">Últimos sete dias</option><option value="30dias">Últimos trinta dias</option>
        <option value="mes">Mês atual</option><option value="personalizado">Personalizado</option>
      </select>
    </Field>
    {value.period === 'personalizado' && <>
      <Field label="De"><input type="date" value={value.start} onChange={event => { value.setStart(event.target.value); onChange?.(); }} /></Field>
      <Field label="Até"><input type="date" value={value.end} onChange={event => { value.setEnd(event.target.value); onChange?.(); }} /></Field>
    </>}
  </>;
}

function Dashboard({ user }) {
  const period = usePeriod();
  const remote = useRemote('/admin/resumo?' + period.query);
  return <>
    <div className="admin-toolbar"><PeriodFilter value={period} />
      {user.role !== 'viewer' && <a className="button primary" href="/?nova=1"><Plus size={17} /> Nova venda</a>}</div>
    {!period.ready ? <Message>Informe as datas inicial e final.</Message> : <Data remote={remote}>{data => <>
      <div className="metrics">
        {[['Pedidos criados', data.total], ['Pedidos abertos', data.open], ['Pedidos encerrados', data.canceled + data.expired],
          ['Valor dos pedidos', brl(data.volume)]].map(([label, value]) =>
          <div className="surface metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <section className="surface admin-panel"><SectionTitle icon={Activity}>Status dos pedidos</SectionTitle>
        {data.total ? <div className="bar-chart" role="img" aria-label={`${data.open} abertos, ${data.expired} expirados e ${data.canceled} cancelados`}>
          {[['Abertos', data.open], ['Expirados', data.expired], ['Cancelados', data.canceled]].map(([label, value]) => <div key={label}>
            <span>{label}</span><progress max={data.total} value={value} /><strong>{value}</strong>
          </div>)}
        </div> : <p className="muted">Nenhum pedido no período selecionado.</p>}
      </section>
    </>}</Data>}
    <Message>Valores de pedidos representam cobranças previstas. O processamento de pagamentos está indisponível.</Message>
  </>;
}

function Orders({ user, pageType }) {
  const [selected, select] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const period = usePeriod();
  const filters = new URLSearchParams(period.query);
  if (status) filters.set('status', status);
  if (orderId.trim()) filters.set('id', orderId.trim());
  const minCents = parseMoney(min);
  const maxCents = parseMoney(max);
  const validValue = (!min || minCents !== null) && (!max || maxCents !== null) &&
    (minCents === null || maxCents === null || minCents <= maxCents);
  if (minCents !== null) filters.set('min', minCents);
  if (maxCents !== null) filters.set('max', maxCents);
  function exportQuery(format) {
    const query = new URLSearchParams(filters);
    query.delete('page');
    query.set('format', format);
    return '/api/admin/pedidos?' + query;
  }
  filters.set('page', page);
  const remote = useRemote('/admin/pedidos?' + filters);

  async function closeOrder(order) {
    setError('');
    setBusy(true);
    try {
      await api('/admin/pedidos/' + order.id + '/cancelar', { method: 'POST', data: { confirm: true }, csrf: user.csrf });
      setConfirm(false);
      select(null);
      remote.retry();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function show(order) {
    select(order);
    setConfirm(false);
    setError('');
    setCopied(false);
  }

  return <>
    <div className="admin-toolbar">
      <PeriodFilter value={period} onChange={() => { setPage(1); select(null); }} />
      <Field label="Situação"><select value={status} onChange={event => {
        setStatus(event.target.value); setPage(1); select(null);
      }}>
        <option value="">Todas</option>{Object.entries(orderStatuses).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
      </select></Field>
      <Field label="Código ou referência do pedido"><input value={orderId} maxLength={50} onChange={event => {
        setOrderId(event.target.value); setPage(1); select(null);
      }} /></Field>
      <div className="field"><label htmlFor="filter-min">Valor mínimo</label>
        <MoneyInput id="filter-min" className="filter-money" value={min} onChange={value => {
          setMin(value); setPage(1); select(null);
        }} /></div>
      <div className="field"><label htmlFor="filter-max">Valor máximo</label>
        <MoneyInput id="filter-max" className="filter-money" value={max} onChange={value => {
          setMax(value); setPage(1); select(null);
        }} /></div>
      {period.ready && validValue && <>{[['csv', 'CSV'], ['xlsx', 'Excel']].map(([format, label]) =>
        <a key={format} className="button secondary" href={exportQuery(format)}><ArrowDownToLine size={16} /> Exportar {label}</a>
      )}</>}
      {pageType !== 'relatorios' && user.role !== 'viewer' && <a className="button primary" href="/?nova=1"><Plus size={17} /> Nova venda</a>}
    </div>
    {!period.ready ? <Message>Informe as datas inicial e final.</Message> : !validValue ? <Message>Confira a faixa de valores.</Message> : <Data remote={remote}>{data => <div className="surface admin-panel">
      {data.orders.length ? <>
        <div className="table-scroll"><table><thead><tr>
          <th scope="col">Referência</th><th scope="col">Valor</th><th scope="col">Criado em</th><th scope="col">Situação</th><th scope="col">Ações</th>
        </tr></thead><tbody>
          {data.orders.map(order => <tr key={order.id}>
            <td><strong>{order.reference}</strong>{order.description && <small>{order.description}</small>}</td>
            <td>{brl(order.cents)}</td><td>{fmtDate(order.createdAt)}</td>
            <td><span className={'status-tag ' + order.status}>{orderStatuses[order.status]}</span></td>
            <td><button className="button small" onClick={() => show(order)}>Detalhes <ChevronRight size={14} /></button></td>
          </tr>)}
        </tbody></table></div>
        <div className="pagination">
          <button type="button" className="button small" disabled={page <= 1} onClick={() => { setPage(page - 1); select(null); }}>
            <ChevronLeft size={15} /> Anterior
          </button><span>Página {page}</span>
          <button type="button" className="button small" disabled={!data.hasNext} onClick={() => { setPage(page + 1); select(null); }}>
            Próxima <ChevronRight size={15} />
          </button>
        </div>
      </> : <div className="empty"><ReceiptText size={28} /><h2>Nenhum pedido encontrado</h2><p>Confira os filtros ou crie uma nova venda.</p></div>}
    </div>}</Data>}
    {selected && <section className="surface admin-panel">
      <SectionTitle icon={ReceiptText} side={<button className="icon-button" onClick={() => select(null)} aria-label="Fechar detalhes"><X size={19} /></button>}>
        Pedido {selected.reference}
      </SectionTitle>
      <dl className="summary-list">
        <div><dt>Valor</dt><dd>{brl(selected.cents)}</dd></div>
        <div><dt>Parcelas permitidas</dt><dd>Até {selected.maxInstallments}×</dd></div>
        <div><dt>Validade</dt><dd>{fmtDate(selected.expiresAt)}</dd></div>
        <div><dt>Situação</dt><dd>{orderStatuses[selected.status]}</dd></div>
      </dl>
      {selected.url && <>
        <Field label="Link para conferir o pedido"><input readOnly value={selected.url} onFocus={event => event.target.select()} /></Field>
        <div className="share-actions">
          <button className="button secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(selected.url); setCopied(true); }
            catch { setError('Selecione o endereço no campo para copiar o link.'); }
          }}><Clipboard size={16} /> {copied ? 'Copiado' : 'Copiar link'}</button>
          <a className="button secondary" href={'https://wa.me/?text=' + encodeURIComponent(selected.url)} target="_blank" rel="noreferrer">WhatsApp</a>
          <a className="button secondary" href={'mailto:?subject=Pedido&body=' + encodeURIComponent(selected.url)}>E-mail</a>
          <a className="button secondary" href={selected.url} target="_blank" rel="noreferrer">Abrir <ArrowUpRight size={14} /></a>
        </div>
        <div className="group-actions">{confirm ? <>
          <span>Confirma o cancelamento deste link?</span>
          <button className="button danger" disabled={busy} onClick={() => closeOrder(selected)}>{busy ? 'Cancelando…' : 'Sim, cancelar link'}</button>
          <button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>Voltar</button>
        </> : <button className="button danger" onClick={() => setConfirm(true)}>Cancelar link</button>}</div>
      </>}
      <Message tone="error">{error}</Message>
    </section>}
  </>;
}

function StoreForm({ store, user }) {
  const [form, setForm] = useState(store);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api('/admin/loja', { method: 'PUT', data: form, csrf: user.csrf });
      setForm(saved.store);
      setNotice({ tone: 'ok', text: 'Dados do estabelecimento salvos.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  function changeLogo(file) {
    if (!file) return;
    if (file.size > 250_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setNotice({ tone: 'error', text: 'Selecione um logotipo PNG, JPEG ou WebP de até 250 KB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result);
    reader.onerror = () => setNotice({ tone: 'error', text: 'Não foi possível ler o logotipo.' });
    reader.readAsDataURL(file);
  }

  return <form className="surface admin-panel form-stack" onSubmit={submit}>
    <SectionTitle icon={Building2}>Dados do estabelecimento</SectionTitle>
    <div className="field-grid">
      <Field label="Nome comercial" required><input required maxLength={80} value={form.name} onChange={event => set('name', event.target.value)} /></Field>
      <Field label="Razão social"><input maxLength={160} value={form.legalName} onChange={event => set('legalName', event.target.value)} /></Field>
      <Field label="CNPJ"><input value={maskCnpj(form.document)} onChange={event => set('document', maskCnpj(event.target.value))} /></Field>
      <Field label="Identificador do lojista"><input maxLength={50} value={form.merchantReference} onChange={event => set('merchantReference', event.target.value)} /></Field>
      <Field label="E-mail de atendimento"><input type="email" value={form.supportEmail} maxLength={254} onChange={event => set('supportEmail', event.target.value)} /></Field>
      <Field label="Telefone"><input type="tel" value={maskPhone(form.supportPhone)} onChange={event => set('supportPhone', maskPhone(event.target.value))} /></Field>
      <Field label="WhatsApp"><input type="tel" value={maskPhone(form.supportWhatsapp)} onChange={event => set('supportWhatsapp', maskPhone(event.target.value))} /></Field>
      <Field label="Logotipo"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => changeLogo(event.target.files[0])} /></Field>
      {(form.logo === undefined ? form.hasLogo : form.logo) && <div className="logo-control">
        <img src={form.logo || '/api/loja/logo'} alt="Logotipo do estabelecimento" />
        <button className="button small" type="button" onClick={() => set('logo', '')}>Remover logo</button>
      </div>}
      <div className="color-fields">
        <Field label="Cor principal"><input type="color" value={form.primaryColor} onChange={event => set('primaryColor', event.target.value)} /></Field>
        <Field label="Cor secundária"><input type="color" value={form.secondaryColor} onChange={event => set('secondaryColor', event.target.value)} /></Field>
      </div>
    </div>
    {['description', 'privacy', 'terms'].map((key, index) => <Field key={key} label={['Descrição', 'Política de privacidade', 'Termos de utilização'][index]}>
      <textarea maxLength={index === 0 ? 300 : 8_000} value={form[key]} onChange={event => set(key, event.target.value)} />
    </Field>)}
    {notice && <Message tone={notice.tone}>{notice.text}</Message>}
    <button className="button primary fit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar personalização'}</button>
  </form>;
}

function Limits({ store, user }) {
  const [values, setValues] = useState({
    minCents: moneyValue(store.minCents), maxCents: moneyValue(store.maxCents), minInstallment: moneyValue(store.minInstallment),
  });
  const [max, setMax] = useState(store.maxInstallments);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api('/admin/limites', { method: 'PUT', csrf: user.csrf, data: {
        minCents: parseMoney(values.minCents), maxCents: parseMoney(values.maxCents),
        minInstallment: parseMoney(values.minInstallment), maxInstallments: max,
      } });
      setNotice({ tone: 'ok', text: 'Limites de novos pedidos atualizados.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error.message });
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="surface admin-panel form-stack">
    <SectionTitle icon={Settings2}>Limites do checkout</SectionTitle>
    <div className="field-grid">
      {Object.entries({ minCents: 'Valor mínimo', maxCents: 'Valor máximo', minInstallment: 'Mínimo por parcela' }).map(([key, label]) =>
        <div className="field" key={key}><label htmlFor={key}>{label}</label><MoneyInput id={key} value={values[key]}
          onChange={value => setValues(prev => ({ ...prev, [key]: value }))} /></div>)}
      <Field label="Máximo de parcelas"><input type="number" required min={1} max={12} value={Number.isNaN(max) ? '' : max}
        onChange={event => setMax(event.target.valueAsNumber)} /></Field>
    </div>
    {notice && <Message tone={notice.tone}>{notice.text}</Message>}
    <button className="button primary fit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar limites'}</button>
  </form>;
}

function IpManager({ user }) {
  const remote = useRemote('/admin/ip');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  async function action(task, success) {
    setBusy(true);
    setNotice(null);
    try { await task(); setNotice({ tone: 'ok', text: success }); remote.retry(); }
    catch (error) { setNotice({ tone: 'error', text: error.message }); }
    finally { setBusy(false); }
  }
  return <Data remote={remote}>{data => <section className="surface admin-panel form-stack">
    <SectionTitle icon={Globe2}>Rede e saída do backend</SectionTitle>
    <dl className="summary-list">
      <div><dt>IP da conexão com o painel</dt><dd>{data.clientIp}</dd></div>
      <div><dt>IP público de saída {data.probeSource === 'connect' ? 'do CS REDE CONNECT' : 'do checkout'}</dt><dd>{data.store.observedEgress || 'Não verificado'}</dd></div>
      <div><dt>Bloco cadastrado internamente</dt><dd>{data.store.authorizedCidr || 'Não configurado'}</dd></div>
      <div><dt>Última verificação</dt><dd>{fmtDate(data.store.egressCheckedAt)}</dd></div>
      <div><dt>Comparação com o bloco cadastrado</dt><dd>{data.store.egressMatch === null ? 'Não verificado' : data.store.egressMatch ? 'Dentro do bloco' : 'Fora do bloco'}</dd></div>
      <div><dt>Autorização do gateway</dt><dd>Não verificada</dd></div>
    </dl>
    <p className="muted">Use o portal oficial para solicitar a autorização do IP exigido para seu contrato.</p>
    {data.store.egressMatch === false && <Message tone="error">O IP público de saída está fora do bloco cadastrado.</Message>}
    <div className="share-actions">
      <button className="button secondary" disabled={busy} onClick={remote.retry}>Atualizar conexões</button>
      <button className="button secondary" disabled={busy || !data.probeConfigured} onClick={() => action(
        () => api('/admin/ip/verificar', { method: 'POST', data: {}, csrf: user.csrf }), 'IP de saída atualizado.',
      )}>Detectar IP do servidor</button>
      {data.store.observedEgress && [false, true].map(cidr => <button className="button secondary" key={String(cidr)} onClick={async () => {
        const ip = data.store.observedEgress;
        try {
          await navigator.clipboard.writeText(ip + (cidr ? ip.includes(':') ? '/128' : '/32' : ''));
          setNotice({ tone: 'ok', text: 'Endereço copiado.' });
        } catch { setNotice({ tone: 'error', text: 'Não foi possível copiar o endereço.' }); }
      }}>{cidr ? 'Copiar CIDR' : 'Copiar IP'}</button>)}
    </div>
    {!data.probeConfigured && <p className="muted">A detecção do IP público requer um serviço configurado na instalação.</p>}
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      void action(() => api('/admin/ip', { method: 'PUT', data: { cidr: field.current.value }, csrf: user.csrf }), 'Bloco interno atualizado.');
    }}>
      <Field label="Cadastrar IP ou CIDR"><input ref={field} defaultValue={data.store.authorizedCidr} maxLength={49} placeholder="203.0.113.10/32" /></Field>
      <div className="share-actions">
        <button className="button primary" disabled={busy}>Salvar bloco</button>
        {data.store.authorizedCidr && <button type="button" className="button danger" disabled={busy} onClick={() => action(
          () => api('/admin/ip', { method: 'PUT', data: { cidr: '' }, csrf: user.csrf }), 'Bloco interno removido.',
        )}>Remover bloco</button>}
        <a className="button secondary" href="https://meu.userede.com.br/" target="_blank" rel="noreferrer">Portal Rede <ArrowUpRight size={15} /></a>
      </div>
      <p className="muted">O bloco salvo serve para comparação. A saída real é definida pela infraestrutura.</p>
    </form>
    {notice && <Message tone={notice.tone}>{notice.text}</Message>}
  </section>}</Data>;
}

function Diagnosis({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    setError('');
    setBusy(true);
    try { setData(await api('/admin/diagnostico', { method: 'POST', data: {}, csrf: user.csrf })); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function exportDiagnosis() {
    const object = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = object;
    link.download = 'diagnostico-cs-rede-pro.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(object), 1_000);
  }
  return <section className="surface admin-panel form-stack">
    <div className="share-actions">
      <button className="button primary" onClick={run} disabled={busy}><Activity size={17} /> {busy ? 'Verificando…' : 'Executar diagnóstico completo'}</button>
      {data && <button className="button secondary" onClick={exportDiagnosis}><ArrowDownToLine size={17} /> Exportar relatório</button>}
    </div>
    <Message tone="error">{error}</Message>
    {data && <><p className="muted">Verificação em {fmtDate(data.checkedAt)}</p>
      <div className="table-scroll"><table><thead><tr><th>Teste</th><th>Status</th><th>Tempo</th><th>Detalhes</th></tr></thead><tbody>
        {data.tests.map(test => <tr key={test.name}><td><strong>{test.name}</strong></td><td>{test.status}</td>
          <td>{test.ms === null ? '—' : test.ms + ' ms'}</td>
          <td>{test.detail}{test.code && <small>{test.code}</small>}</td></tr>)}
      </tbody></table></div>
    </>}
  </section>;
}

function Security({ user, onLogout }) {
  const [values, setValues] = useState({ current: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', { method: 'POST', data: values, csrf: user.csrf });
      onLogout('Senha atualizada. Entre novamente.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <form className="surface admin-panel form-stack" onSubmit={submit}>
    <SectionTitle icon={LockKeyhole}>Alterar senha</SectionTitle>
    <Message>Ao trocar a senha, todas as sessões administrativas serão encerradas.</Message>
    <Field label="Senha atual"><input type="password" autoComplete="current-password" required maxLength={128} value={values.current}
      onChange={event => setValues({ ...values, current: event.target.value })} /></Field>
    <Field label="Nova senha"><input type="password" autoComplete="new-password" required maxLength={128} minLength={12} value={values.password}
      onChange={event => setValues({ ...values, password: event.target.value })} /></Field>
    <Message tone="error">{error}</Message>
    <button className="button primary fit" disabled={busy}>{busy ? 'Atualizando…' : 'Atualizar senha'}</button>
  </form>;
}

function Audit() {
  const remote = useRemote('/admin/auditoria');
  return <section className="surface admin-panel form-stack">
    <a className="button secondary fit" href="/api/admin/auditoria?format=csv"><ArrowDownToLine size={16} /> Exportar CSV</a>
    <Data remote={remote}>{data => <div className="table-scroll"><table><thead><tr><th>Evento</th><th>Referência</th><th>Data</th></tr></thead>
      <tbody>{data.events.map((event, index) => <tr key={index}>
        <td>{event.action.replaceAll('_', ' ')}</td><td>{event.subject || '—'}</td><td>{fmtDate(event.created_at)}</td>
      </tr>)}</tbody>
    </table></div>}</Data>
  </section>;
}

function GatewayState({ page }) {
  const sections = {
    transacoes: ['Nenhuma transação processada', 'A criação e a gestão de transações dependem de um gateway homologado.'],
    clientes: ['Nenhum cadastro de comprador', 'O checkout atual mantém os campos de comprador apenas no navegador.'],
  };
  const [title, detail] = sections[page];
  return <section className="surface admin-panel unavailable">
    <SectionTitle icon={CreditCard}>{title}</SectionTitle><p>{detail}</p>
  </section>;
}

function SettingsPage({ user, type }) {
  const remote = useRemote('/admin/configuracao');
  return <Data remote={remote}>{data => type === 'loja' ? <StoreForm store={data.store} user={user} />
    : <Limits store={data.store} user={user} />}</Data>;
}

function AdminPanel({ user, page, onLogout }) {
  const [nav, setNav] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canAccess = !ownerPages.has(page) || user.role === 'owner';
  const title = pages.find(([key]) => key === page)?.[1] ?? 'Dashboard';
  async function logout() {
    setBusy(true);
    try { await api('/auth/logout', { method: 'POST', data: {}, csrf: user.csrf }); onLogout(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  let content;
  if (!canAccess) content = <Message tone="error">Seu perfil não tem permissão para acessar esta seção.</Message>;
  else if (['pedidos', 'links', 'relatorios'].includes(page)) content = <Orders user={user} pageType={page} />;
  else if (page === 'rede') content = <><RedeSettings user={user} /><SettingsPage user={user} type={page} /></>;
  else if (page === 'sandbox') content = <SandboxPix user={user} />;
  else if (['transacoes', 'clientes'].includes(page)) content = <GatewayState page={page} />;
  else if (page === 'ip') content = <><IpManager user={user} /><ConnectStatus /></>;
  else if (page === 'connect') content = <ConnectStatus />;
  else if (page === 'configurar') content = <Guide />;
  else if (page === 'diagnostico') content = <Diagnosis user={user} />;
  else if (page === 'loja') content = <SettingsPage user={user} type={page} />;
  else if (page === 'seguranca') content = <Security user={user} onLogout={onLogout} />;
  else if (page === 'equipe') content = <Team user={user} />;
  else if (page === 'auditoria') content = <Audit />;
  else content = <Dashboard user={user} />;

  return <div className="admin-page">
    <Header admin />
    <div className="wrap admin-layout">
      <button className="button secondary nav-toggle" onClick={() => setNav(!nav)} aria-controls="admin-nav" aria-expanded={nav}>
        {nav ? <X size={17} /> : <Menu size={17} />} Menu
      </button>
      <nav className={'admin-nav surface ' + (nav ? 'is-open' : '')} id="admin-nav" aria-label="Painel Administrativo">
        {pages.filter(([key]) => (!ownerPages.has(key) || user.role === 'owner') && (key !== 'nova' || user.role !== 'viewer')).map(([key, label, Icon]) => <a key={key} href={key === 'nova' ? '/?nova=1' : key === 'painel' ? '/admin' : '/admin/' + key}
          aria-current={key === page ? 'page' : undefined}><Icon size={17} aria-hidden="true" /> {label}</a>)}
        <button onClick={logout} disabled={busy}><LogOut size={17} /> {busy ? 'Saindo…' : 'Sair'}</button>
      </nav>
      <main className="admin-main">
        <div className="admin-title"><h1>{title}</h1><span><UserRound size={15} /> {user.email}</span></div>
        <Message tone="error">{error}</Message>
        {content}
      </main>
    </div>
  </div>;
}

export function Admin({ page = 'painel' }) {
  const session = useRemote('/auth/session');
  const [user, setUser] = useState(undefined);
  const [notice, setNotice] = useState('');
  const [pageAfterLogout, setPageAfterLogout] = useState(null);
  if (page === 'recuperar') return <AdminLogin recovery />;
  if (page === 'primeiro-acesso') return <FirstAccess />;
  const current = user === undefined ? session.data?.user : user;
  if (user === undefined && (session.loading || session.error)) {
    return <div className="checkout-page"><Header admin /><main className="wrap"><div className="surface status-page">
      {session.error ? <><Message tone="error">{session.error}</Message>
        <button className="button secondary" onClick={session.retry}>Tentar novamente</button></> : <Loading />}
    </div></main></div>;
  }
  if (!current) return <><AdminLogin onLogin={setUser} />{notice && <div className="global-notice"><Message tone="ok">{notice}</Message></div>}</>;
  return <AdminPanel user={current} page={pageAfterLogout ?? page} onLogout={message => {
    setNotice(message || '');
    setUser(null);
    setPageAfterLogout('painel');
    history.replaceState(null, '', '/admin');
  }} />;
}
