import React, { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, CreditCard, LoaderCircle, Settings2 } from 'lucide-react';
import { brl, groupMoneyInput, parseMoney } from '../../shared/format.js';

export const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
export const fmtDate = value => value ? dateTime.format(new Date(value)) : '—';
export const moneyValue = cents => brl(cents).replace(/^R\$\s*/, '');

export async function api(path, { method = 'GET', data, csrf, signal, headers } = {}) {
  const response = await fetch('/api' + path, {
    method, signal, credentials: 'same-origin',
    headers: { ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.message || 'Serviço indisponível. Tente novamente.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function useRemote(path) {
  const [result, setResult] = useState({ data: null, error: '', loading: true });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ data: null, error: '', loading: true });
    api(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ data, error: '', loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ data: null, error: error.message, loading: false });
    });
    return () => controller.abort();
  }, [path, attempt]);
  return { ...result, retry: () => retry(current => current + 1) };
}

export function Brand() {
  return <a className="brand" href="/" aria-label="CS REDE PRO, início">
    <span className="brand-symbol"><CreditCard size={22} strokeWidth={2.5} /></span>
    <span><strong>CS REDE <em>PRO</em></strong><small>Checkout de Pagamento Online</small></span>
  </a>;
}

export function Header({ store, admin = false }) {
  return <header className="site-header">
    <div className="wrap header-inner">
      <Brand />
      {!admin && <div className="header-store">
        {store?.hasLogo && <img src="/api/loja/logo" alt="" />}
        <span>{store?.name ?? 'CS REDE PRO'}</span>
      </div>}
      <a className="header-button" href={admin ? '/' : '/admin'}>
        <Settings2 size={17} aria-hidden="true" />{admin ? 'Ver checkout' : 'Painel Administrativo'}
      </a>
    </div>
  </header>;
}

export function SectionTitle({ icon: Icon, children, side }) {
  return <div className="section-title">
    <span className="icon-square"><Icon size={21} aria-hidden="true" /></span>
    <h2>{children}</h2>{side && <div className="section-side">{side}</div>}
  </div>;
}

export function Message({ children, tone = 'info' }) {
  if (!children) return null;
  const Icon = tone === 'ok' ? CircleCheck : CircleAlert;
  return <div className={'message ' + tone} role={tone === 'error' ? 'alert' : 'status'}>
    <Icon size={17} aria-hidden="true" /><span>{children}</span>
  </div>;
}

export function Loading({ children = 'Carregando…' }) {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> {children}</div>;
}

export function MoneyInput({ id, value, onChange, onBlur, invalid, describedBy, className = '' }) {
  function update(event) {
    const control = event.currentTarget;
    const typed = control.value;
    const position = control.selectionStart ?? typed.length;
    const before = typed.slice(0, position).replaceAll('.', '').trimStart().length;
    const oldGrouping = value.includes('.') && parseMoney(value) !== null;
    const isTyping = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.nativeEvent.inputType);
    const editable = oldGrouping && isTyping && event.nativeEvent.data !== '.' ? typed.replaceAll('.', '') : typed;
    const formatted = groupMoneyInput(editable);
    onChange(formatted);
    if (formatted === typed || position === typed.length) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== control) return;
      let caret = 0;
      let count = 0;
      while (caret < formatted.length && count < before) {
        if (formatted[caret++] !== '.') count++;
      }
      control.setSelectionRange(caret, caret);
    });
  }
  return <div className={'money-input ' + className}>
    <span aria-hidden="true">R$</span>
    <input id={id} value={value} onChange={update} inputMode="decimal" maxLength={18}
      aria-invalid={invalid || undefined} aria-describedby={describedBy} placeholder="0,00"
      onBlur={() => {
        const cents = parseMoney(value);
        if (cents !== null) onChange(moneyValue(cents));
        onBlur?.();
      }} />
  </div>;
}

export function Field({ label, required, children, className = '' }) {
  return <label className={'field ' + className}>
    <span>{label}{required && <span className="required" aria-hidden="true"> *</span>}</span>
    {children}
  </label>;
}
