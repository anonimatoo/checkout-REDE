import React, { useState } from 'react';
import { LockKeyhole, UsersRound } from 'lucide-react';
import { api, Field, Header, Loading, Message, SectionTitle, useRemote } from './ui.jsx';

const roles = { owner: 'Proprietário', operator: 'Operador', viewer: 'Consulta' };

function RoleOptions() {
  return <><option value="operator">Operador</option><option value="viewer">Consulta</option></>;
}

export function FirstAccess() {
  const status = useRemote('/auth/setup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [secret] = useState(() => location.hash.slice(1));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) {
      setError('As duas senhas precisam ser iguais.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/auth/setup', { method: 'POST', data: { email, password, secret } });
      history.replaceState(null, '', '/admin/primeiro-acesso');
      setPassword('');
      setConfirmation('');
      setDone(true);
    } catch (failure) {
      setError(failure.message);
    } finally { setBusy(false); }
  }

  const initialized = done || status.data?.initialized;
  return <div className="checkout-page login-page">
    <Header admin />
    <main className="wrap"><section className="surface login-card">
      <SectionTitle icon={LockKeyhole}>Primeiro acesso</SectionTitle>
      {status.loading ? <Loading /> : status.error ? <>
        <Message tone="error">{status.error}</Message><button className="button secondary" onClick={status.retry}>Tentar novamente</button>
      </> : initialized ? <>
        <Message tone="ok">{done ? 'Conta criada. Entre no painel para continuar a configuração.' : 'A instalação já está configurada.'}</Message>
        <a className="button primary" href="/admin/configurar">Entrar no painel</a>
      </> : !secret ? <>
        <p>Use o link de primeiro acesso emitido na instalação. O link é individual e válido por 30 minutos.</p>
        <a className="button secondary" href="/admin">Voltar ao login</a>
      </> : <form className="form-stack" onSubmit={submit}>
        <p>Crie a conta proprietária deste estabelecimento.</p>
        <Field label="E-mail"><input type="email" required autoComplete="username" maxLength={254}
          value={email} onChange={event => setEmail(event.target.value)} /></Field>
        <Field label="Senha"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password"
          value={password} onChange={event => setPassword(event.target.value)} /></Field>
        <Field label="Confirme a senha"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password"
          value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
        <Message tone="error">{error}</Message>
        <button className="button primary" disabled={busy}>{busy ? 'Criando…' : 'Criar conta proprietária'}</button>
      </form>}
    </section></main>
  </div>;
}

function Member({ account, user, refresh }) {
  const [role, setRole] = useState(account.role);
  const [disabled, setDisabled] = useState(account.disabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/equipe/' + account.id, { method: 'PATCH', csrf: user.csrf, data: { role, disabled } });
      refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <details className="member-card">
    <summary><strong>{account.email}</strong><span>{roles[account.role]} · {account.disabled ? 'Bloqueado' : account.pending ? 'Aguardando ativação' : 'Ativo'}</span></summary>
    {account.role !== 'owner' && <form className="form-stack" onSubmit={save}>
      <div className="field-grid">
        <Field label="Perfil"><select value={role} onChange={event => setRole(event.target.value)}><RoleOptions /></select></Field>
        <Field label="Acesso"><select value={disabled ? 'blocked' : 'active'} onChange={event => setDisabled(event.target.value === 'blocked')}>
          <option value="active">Habilitado</option><option value="blocked">Bloqueado</option>
        </select></Field>
      </div>
      <Message tone="error">{error}</Message>
      <button className="button secondary fit" disabled={busy || role === account.role && disabled === account.disabled}>
        {busy ? 'Salvando…' : 'Salvar acesso'}
      </button>
    </form>}
  </details>;
}

export function Team({ user }) {
  const remote = useRemote('/admin/equipe');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');
  const [invitation, setInvitation] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function invite(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInvitation('');
    setCopied(false);
    try {
      const result = await api('/admin/equipe', { method: 'POST', csrf: user.csrf, data: { email, role } });
      setInvitation(result.url);
      setEmail('');
      remote.retry();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <>
    <section className="surface admin-panel form-stack">
      <SectionTitle icon={UsersRound}>Convidar pessoa</SectionTitle>
      <p>Operadores criam e cancelam links de pedido. O perfil Consulta pode ver pedidos e exportar relatórios.</p>
      <form className="form-stack" onSubmit={invite}>
        <div className="field-grid">
          <Field label="E-mail"><input type="email" required value={email} maxLength={254} onChange={event => setEmail(event.target.value)} /></Field>
          <Field label="Perfil"><select value={role} onChange={event => setRole(event.target.value)}><RoleOptions /></select></Field>
        </div>
        <button className="button primary fit" disabled={busy}>{busy ? 'Gerando…' : 'Gerar convite'}</button>
      </form>
      <Message tone="error">{error}</Message>
      {invitation && <>
        <Field label="Link de ativação, válido por 24 horas"><input readOnly value={invitation} onFocus={event => event.target.select()} /></Field>
        <button className="button secondary fit" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(invitation); setCopied(true); }
          catch { setError('Selecione o endereço no campo para copiar.'); }
        }}>{copied ? 'Link copiado' : 'Copiar convite'}</button>
      </>}
    </section>
    <section className="surface admin-panel form-stack">
      <SectionTitle icon={UsersRound}>Pessoas com acesso</SectionTitle>
      {remote.loading ? <Loading /> : remote.error ? <>
        <Message tone="error">{remote.error}</Message>
        <button className="button secondary fit" onClick={remote.retry}>Tentar novamente</button>
      </> : remote.data.accounts.map(account => <Member key={account.id} account={account} user={user} refresh={remote.retry} />)}
    </section>
  </>;
}
