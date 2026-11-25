import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, BadgeCheck, Building2, ChevronDown, Coins, CreditCard, FileText, Link2,
  LockKeyhole, MapPin, ReceiptText, Search, ShieldCheck, Trash2, UserRound, WalletCards,
} from 'lucide-react';
import {
  brl, digits, installmentOptions, maskCep, maskCnpj, maskCpf, maskPhone,
  parseMoney, states, validCnpj, validCpf, validEmail,
} from '../../shared/format.js';
import { api, Field, fmtDate, Header, Loading, Message, MoneyInput, moneyValue, SectionTitle, useRemote } from './ui.jsx';

const changes = [5_000, 10_000, 25_000, 50_000, 100_000];
const labels = { open: 'Aberto', canceled: 'Cancelado', expired: 'Expirado' };
const blankAddress = { street: '', number: '', complement: '', district: '', city: '', state: '' };

function Stepper() {
  return <ol className="steps" aria-label="Etapas do checkout">
    {['Dados do comprador', 'Pagamento', 'Confirmação'].map((label, index) =>
      <li key={label} aria-current={index === 0 ? 'step' : undefined}>
        <span className="step-number">{index + 1}</span>
        <span>{label}</span>
      </li>)}
  </ol>;
}

function useCep() {
  const [cep, setCep] = useState('');
  const [address, setAddress] = useState(blankAddress);
  const [status, setStatus] = useState({ text: '', tone: 'info' });
  const [open, setOpen] = useState(false);
  const active = useRef(null);
  const cached = useRef(new Map());

  useEffect(() => () => active.current?.abort(), []);

  function setField(key, value) {
    setAddress(current => ({ ...current, [key]: value }));
  }

  async function lookup(value) {
    const code = digits(value);
    if (code.length !== 8) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 6_000);
    setStatus({ tone: 'info', text: 'Consultando o ViaCEP…', pending: true });
    setOpen(true);
    try {
      let found = cached.current.get(code);
      if (!found) {
        const response = await fetch('https://viacep.com.br/ws/' + code + '/json/', {
          signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error('ViaCEP');
        found = await response.json();
        cached.current.set(code, found);
      }
      if (active.current !== controller) return;
      if (found.erro === true || found.erro === 'true') {
        setStatus({ tone: 'error', text: 'CEP não encontrado. Você pode preencher o endereço manualmente.' });
        return;
      }
      const result = { street: found.logradouro, district: found.bairro, city: found.localidade,
        state: states.includes(found.uf) ? found.uf : '' };
      setAddress(current => {
        const next = { ...current };
        for (const [key, value] of Object.entries(result)) {
          if (!next[key] && typeof value === 'string') next[key] = value;
        }
        return next;
      });
      setStatus({ tone: 'ok', text: result.street ? 'Endereço encontrado. Confira os dados e informe o número.'
        : 'CEP encontrado. Complete os dados do endereço.' });
    } catch {
      if (active.current === controller) {
        setStatus({ tone: 'error', text: 'ViaCEP indisponível. Você pode preencher o endereço manualmente.' });
      }
    } finally {
      clearTimeout(timer);
      if (active.current === controller) active.current = null;
    }
  }

  function update(value) {
    const formatted = maskCep(value);
    if (formatted === cep) return;
    if (digits(cep).length === 8) setAddress(blankAddress);
    const previous = active.current;
    active.current = null;
    previous?.abort();
    setStatus({ text: '', tone: 'info' });
    setCep(formatted);
    if (digits(formatted).length === 8) void lookup(formatted);
  }

  return { cep, update, lookup, status, address, setField, open, setOpen };
}

function BuyerForm() {
  const [person, setPerson] = useState('cpf');
  const [document, setDocument] = useState('');
  const [phone, setPhone] = useState('');
  const [docTouched, touchDoc] = useState(false);
  const [email, setEmail] = useState('');
  const [emailTouched, touchEmail] = useState(false);
  const cep = useCep();
  const docInvalid = docTouched && document && !(person === 'cpf' ? validCpf(document) : validCnpj(document));
  const emailInvalid = emailTouched && email && !validEmail(email);

  return <section className="buyer-section">
    <SectionTitle icon={UserRound}>Dados do comprador</SectionTitle>
    <div className="field-grid">
      <Field label="Nome completo" required><input placeholder="Digite seu nome completo" autoComplete="name" maxLength={128} required /></Field>
      <div className="field">
        <div className="doc-line">
          <label htmlFor="buyer-doc">{person.toUpperCase()} <span className="required" aria-hidden="true">*</span></label>
          <select aria-label="Tipo de documento" value={person} onChange={event => {
            setPerson(event.target.value); setDocument(''); touchDoc(false);
          }}><option value="cpf">CPF</option><option value="cnpj">CNPJ</option></select>
        </div>
        <input id="buyer-doc" placeholder={person === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}
          inputMode={person === 'cpf' ? 'numeric' : 'text'} autoComplete="off" required
          value={document} onChange={event => setDocument(person === 'cpf' ? maskCpf(event.target.value) : maskCnpj(event.target.value))}
          onBlur={() => touchDoc(true)} aria-invalid={Boolean(docInvalid)}
          aria-describedby={docInvalid ? 'buyer-doc-error' : undefined} />
        {docInvalid && <small className="field-error" id="buyer-doc-error">Confira os dígitos do {person.toUpperCase()}.</small>}
      </div>
      <Field label="E-mail" required><input type="email" placeholder="seu@email.com" autoComplete="email" required
        maxLength={254} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => touchEmail(true)}
        aria-invalid={Boolean(emailInvalid)} aria-describedby={emailInvalid ? 'buyer-email-error' : undefined} />
        {emailInvalid && <small className="field-error" id="buyer-email-error">Informe um e-mail válido.</small>}
      </Field>
      <Field label="Telefone / WhatsApp" required><input type="tel" inputMode="tel" placeholder="(00) 00000-0000" autoComplete="tel-national"
        value={phone} onChange={event => setPhone(maskPhone(event.target.value))} required minLength={14} /></Field>
    </div>
    <div className="billing">
      <div className="billing-title"><MapPin size={17} aria-hidden="true" /><strong>Endereço de cobrança</strong>
        <button type="button" className="text-button" aria-expanded={cep.open} aria-controls="billing-fields"
          onClick={() => cep.setOpen(!cep.open)}>
          {cep.open ? 'Recolher endereço' : 'Preencher endereço'} <ChevronDown size={15} className={cep.open ? 'up' : ''} />
        </button>
      </div>
      <div className="field cep-row">
        <label htmlFor="cep">CEP <span className="required" aria-hidden="true">*</span></label>
        <div className="with-button">
          <input id="cep" value={cep.cep} onChange={event => cep.update(event.target.value)} inputMode="numeric"
            autoComplete="postal-code" placeholder="00000-000" aria-describedby="cep-status" required />
          <button type="button" className="button secondary" onClick={() => cep.lookup(cep.cep)}
            disabled={digits(cep.cep).length !== 8 || cep.status.pending}><Search size={16} /> Buscar CEP</button>
        </div>
        <div id="cep-status" aria-live="polite" className={'field-status ' + cep.status.tone}>{cep.status.text}</div>
      </div>
      <div id="billing-fields" className="field-grid address-grid" hidden={!cep.open}>
        <Field label="Logradouro" required><input value={cep.address.street} onChange={event => cep.setField('street', event.target.value)} autoComplete="address-line1" maxLength={110} required /></Field>
        <Field label="Número" required><input value={cep.address.number} onChange={event => cep.setField('number', event.target.value)} maxLength={15} required /></Field>
        <Field label="Bairro" required><input value={cep.address.district} onChange={event => cep.setField('district', event.target.value)} maxLength={64} required /></Field>
        <Field label="Complemento"><input value={cep.address.complement} onChange={event => cep.setField('complement', event.target.value)} autoComplete="address-line2" maxLength={80} /></Field>
        <Field label="Cidade" required><input value={cep.address.city} onChange={event => cep.setField('city', event.target.value)} autoComplete="address-level2" maxLength={64} required /></Field>
        <Field label="Estado" required><select value={cep.address.state} onChange={event => cep.setField('state', event.target.value)} autoComplete="address-level1" required>
          <option value="">Selecione a UF</option>{states.map(state => <option key={state}>{state}</option>)}
        </select></Field>
      </div>
    </div>
  </section>;
}

function installmentLabel(option) {
  if (option.quantity === 1) return brl(option.base) + ' à vista';
  return option.quantity + '× de ' + brl(option.base) + (option.extra ? ' (com ajuste de centavos)' : '');
}

function Payment({ cents, installments, selected, onSelect, closed, provider }) {
  return <section className="payment-section">
    <SectionTitle icon={CreditCard}>Pagamento com cartão</SectionTitle>
    <Field label="Parcelamento" required>
      <select value={selected} disabled={!installments.length || closed} onChange={event => onSelect(Number(event.target.value))}>
        {!installments.length && <option value={1}>Defina o valor para ver as parcelas</option>}
        {installments.map(option => <option key={option.quantity} value={option.quantity}>{installmentLabel(option)}</option>)}
      </select>
    </Field>
    <div className="payment-note" aria-describedby="pay-note">
      <span className="payment-icon"><WalletCards size={22} aria-hidden="true" /></span>
      <div id="pay-note"><strong>{closed ? 'Pedido encerrado' : 'Pagamento indisponível'}</strong>
        <p>{closed ? 'Este link já foi cancelado ou perdeu a validade.' : 'A integração com ' + provider + ' está pendente.'}</p></div>
    </div>
    <button className="pay-button" type="button" disabled aria-describedby="pay-note">
      <LockKeyhole size={21} /> Pagar agora <span>·</span> {brl(cents)}
    </button>
  </section>;
}

function OrderShare({ order }) {
  const [copied, setCopied] = useState(false);
  return <div className="order-share">
    <Message tone="ok">Pedido {order.reference} criado.</Message>
    <label className="field">Link do pedido
      <input value={order.url} readOnly onFocus={event => event.target.select()} />
    </label>
    {order.url && <div className="share-actions">
      <button className="button secondary" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(order.url); setCopied(true); } catch { setCopied(false); }
      }}><Link2 size={16} /> {copied ? 'Link copiado' : 'Copiar link'}</button>
      <a className="button secondary" href={order.url} target="_blank" rel="noreferrer">Abrir <ArrowUpRight size={15} /></a>
    </div>}
  </div>;
}

function ValueCard({ store, user, amount, setAmount, amountValid, onClear, description, setDescription, reference, setReference,
  isOrder, order, confirmed, setConfirmed, created, setCreated, choices }) {
  const [touched, touch] = useState(false);
  const [details, setDetails] = useState(Boolean(user && new URLSearchParams(location.search).has('nova')));
  const [days, setDays] = useState(7);
  const [cap, setCap] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef({ input: '', key: '' });
  const cents = parseMoney(amount);
  const maxChoice = choices.at(-1)?.quantity ?? 1;
  const availableCap = Math.min(maxChoice, cap);

  async function createOrder() {
    if (busy || !amountValid || !confirmed || !user) return;
    const data = { cents, description, reference, days, maxInstallments: availableCap };
    const input = JSON.stringify(data);
    if (input !== attempt.current.input) attempt.current = { input, key: crypto.randomUUID() };
    setError('');
    setBusy(true);
    try {
      setCreated(await api('/admin/pedidos', { method: 'POST', data, csrf: user.csrf,
        headers: { 'Idempotency-Key': attempt.current.key },
      }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="surface side-card">
    <SectionTitle icon={Coins}>{isOrder ? 'Valor do pedido' : 'Definir o valor da venda'}</SectionTitle>
    {isOrder ? <div className="locked-amount">
      <strong>{brl(order.cents)}</strong><p><LockKeyhole size={14} /> Valor definido pelo estabelecimento</p>
      <dl className="summary-list">
        <div><dt>Referência</dt><dd>{order.reference}</dd></div>
        <div><dt>Status</dt><dd>{labels[order.status]}</dd></div>
        <div><dt>Validade</dt><dd>{fmtDate(order.expiresAt)}</dd></div>
      </dl>
    </div> : <>
      <label className="money-label" htmlFor="sale-amount">Valor da cobrança <span className="required">*</span></label>
      <MoneyInput id="sale-amount" value={amount} onChange={setAmount} onBlur={() => touch(true)}
        invalid={touched && amount !== '' && !amountValid} describedBy="amount-range" />
      <div id="amount-range" className={touched && amount !== '' && !amountValid ? 'field-error' : 'amount-range'}>
        {brl(store.minCents)} a {brl(store.maxCents)}
      </div>
      <div className="quick-values">
        {changes.map(change => <button className="button small" type="button" key={change}
          disabled={(cents ?? 0) + change > store.maxCents} onClick={() => setAmount(moneyValue((cents ?? 0) + change))}>
          + {brl(change)}
        </button>)}
        <button className="button small clear" type="button" onClick={() => { onClear(); touch(false); setError(''); }}>
          <Trash2 size={13} /> Limpar
        </button>
      </div>
      {user && <div className="sale-options">
        <button type="button" className="text-button" aria-expanded={details} aria-controls="sale-options"
          onClick={() => setDetails(!details)}><FileText size={15} /> Detalhes da venda <ChevronDown size={14} className={details ? 'up' : ''} />
        </button>
        <div id="sale-options" hidden={!details} className="detail-fields">
          <Field label="Descrição"><input value={description} onChange={event => setDescription(event.target.value)}
            maxLength={120} placeholder="Produto ou serviço" /></Field>
          <Field label="Referência"><input value={reference} onChange={event => setReference(event.target.value)}
            maxLength={50} placeholder="Gerada automaticamente" /></Field>
          <div className="field-grid">
            <Field label="Validade em dias"><input type="number" min={1} max={90} value={Number.isNaN(days) ? '' : days} onChange={event => {
              setDays(event.target.valueAsNumber); setCreated(null);
            }} /></Field>
            <Field label="Até quantas parcelas"><select value={availableCap} onChange={event => {
              setCap(Number(event.target.value)); setCreated(null);
            }}>
              {(choices.length ? choices : [{ quantity: 1 }]).map(({ quantity }) => <option key={quantity} value={quantity}>{quantity}×</option>)}
            </select></Field>
          </div>
        </div>
      </div>}
      <button type="button" className={'button confirm ' + (confirmed ? 'confirmed' : '')}
        disabled={!amountValid} onClick={() => { setAmount(moneyValue(cents)); setConfirmed(true); }}>
        {confirmed && <BadgeCheck size={17} />} {confirmed ? 'Valor confirmado' : 'Confirmar valor'}
      </button>
      {confirmed && user && !created && <button type="button" className="button primary create-order"
        onClick={createOrder} disabled={busy || !Number.isInteger(days) || days < 1 || days > 90}>
        <Link2 size={17} /> {busy ? 'Criando pedido…' : 'Gerar link do pedido'}
      </button>}
      {confirmed && !user && <p className="subnote"><a href="/admin">Entre no painel</a> para gerar um link de pedido.</p>}
      <Message tone="error">{error}</Message>
      {created && <OrderShare order={created} />}
    </>}
  </section>;
}

function Summary({ store, cents, reference, description, option }) {
  const quantities = option?.quantity > 1;
  return <section className="surface side-card summary">
    <SectionTitle icon={ReceiptText}>Resumo da compra</SectionTitle>
    <dl className="summary-list">
      <div><dt>Estabelecimento</dt><dd>{store.name}</dd></div>
      {description && <div><dt>Descrição</dt><dd>{description}</dd></div>}
      {reference && <div><dt>Referência</dt><dd>{reference}</dd></div>}
      <div><dt>Valor da cobrança</dt><dd>{brl(cents)}</dd></div>
      <div><dt>Encargos de parcelamento</dt><dd>{brl(0)}</dd></div>
      {quantities && <div><dt>Parcelas</dt><dd>{option.extra ? `${option.quantity - option.extra}× ${brl(option.base)} + ${option.extra}× ${brl(option.base + 1)}`
        : `${option.quantity}× ${brl(option.base)}`}</dd></div>}
    </dl>
    <div className="total"><span>Total a pagar</span><output aria-live="polite">{brl(cents)}</output></div>
    <div className="summary-foot"><CreditCard size={15} aria-hidden="true" /> Cartão de crédito <span>BRL</span></div>
  </section>;
}

function Footer({ store }) {
  const dialog = useRef(null);
  const [policy, setPolicy] = useState(null);
  const handlePolicy = (title, body) => { setPolicy({ title, body }); dialog.current.showModal(); };
  return <footer className="wrap site-footer">
    <span><ShieldCheck size={16} aria-hidden="true" /> CS REDE PRO</span>
    <div>
      {store.supportEmail && <a href={'mailto:' + store.supportEmail}>Suporte</a>}
      {store.supportPhone && <a href={'tel:+55' + store.supportPhone}>Telefone</a>}
      {store.supportWhatsapp && <a href={'https://wa.me/55' + store.supportWhatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
      {store.privacy && <button className="text-button" onClick={() => handlePolicy('Privacidade', store.privacy)}>Privacidade</button>}
      {store.terms && <button className="text-button" onClick={() => handlePolicy('Termos de utilização', store.terms)}>Termos</button>}
    </div>
    <dialog className="policy-dialog" ref={dialog} aria-labelledby="policy-title">
      <h2 id="policy-title">{policy?.title}</h2><p>{policy?.body}</p>
      <button className="button secondary" onClick={() => dialog.current.close()}>Fechar</button>
    </dialog>
  </footer>;
}

function CheckoutContent({ store, payment, user, order }) {
  const [amount, setRawAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [installments, setInstallments] = useState(1);
  const [created, setCreated] = useState(null);
  const cents = order?.cents ?? parseMoney(amount) ?? 0;
  const isOrder = Boolean(order);
  const closed = isOrder && order.status !== 'open';
  const amountValid = isOrder || (cents >= store.minCents && cents <= store.maxCents);
  const choices = installmentOptions(amountValid ? cents : 0, order?.maxInstallments ?? store.maxInstallments,
    order?.minInstallment ?? store.minInstallment);
  const selected = Math.min(installments, choices.at(-1)?.quantity ?? 1);

  function setAmount(value) {
    if (parseMoney(value) !== parseMoney(amount)) { setConfirmed(false); setCreated(null); }
    setRawAmount(value);
  }

  return <div className="checkout-page" style={{ '--merchant-accent': store.primaryColor, '--merchant-bg': store.secondaryColor }}>
    <Header store={store} />
    <main className="wrap checkout-wrap">
      <div className="checkout-top">
        <div><div className="merchant-name"><Building2 size={15} /> {store.name}</div>
          <h1>Checkout de pagamento</h1>
          {(order?.description || store.description) && <p className="checkout-description">{order?.description || store.description}</p>}
        </div>
        <span className="gateway-status"><i /> {closed ? 'Pedido encerrado' : 'Cobrança indisponível'}</span>
      </div>
      <div className="checkout-layout">
        <aside className="checkout-sidebar">
          <ValueCard store={store} user={user} amount={amount} setAmount={setAmount} amountValid={amountValid}
            onClear={() => { setAmount(''); setInstallments(1); setConfirmed(false); setCreated(null); }}
            description={description} setDescription={value => { setDescription(value); setCreated(null); }}
            reference={reference} setReference={value => { setReference(value); setCreated(null); }}
            isOrder={isOrder} order={order} confirmed={confirmed} setConfirmed={setConfirmed}
            created={created} setCreated={setCreated} choices={choices} />
          <Summary store={store} cents={cents} reference={order?.reference ?? reference} description={order?.description ?? description}
            option={choices[selected - 1]} />
          <div className="gateway-id"><ShieldCheck size={19} /><div><strong>Gateway previsto</strong><span>{payment.provider} · Integração pendente</span></div></div>
        </aside>
        <div className="surface checkout-main">
          <Stepper />
          <div className="checkout-form">
            {closed ? <Message tone="error">Pedido {labels[order.status].toLowerCase()}.</Message> : <BuyerForm />}
            <Payment provider={payment.provider} cents={cents} installments={choices} selected={selected} onSelect={setInstallments} closed={closed} />
          </div>
        </div>
      </div>
      <div className="checkout-note"><span>Integração Rede Itaú</span>
        <a target="_blank" rel="noreferrer" href={payment.announcement}>Comunicado da Rede <ArrowUpRight size={13} /></a></div>
    </main>
    <Footer store={store} />
  </div>;
}

export function Checkout({ orderToken }) {
  const remote = useRemote('/loja');
  const session = useRemote('/auth/session');
  const [orderState, setOrderState] = useState({ loading: Boolean(orderToken), order: null, error: '' });
  useEffect(() => {
    if (!orderToken) return;
    const controller = new AbortController();
    api('/pedidos/' + encodeURIComponent(orderToken), { signal: controller.signal }).then(order => {
      if (!controller.signal.aborted) setOrderState({ order, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setOrderState({ order: null, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [orderToken]);
  if (!remote.data || orderState.loading || orderState.error) {
    return <div className="checkout-page"><Header store={remote.data?.store} />
      <main className="wrap"><div className="surface status-page">
        {orderState.error || remote.error ? <Message tone="error">{orderState.error || remote.error}</Message> : <Loading />}
        {remote.error && <button className="button secondary" onClick={remote.retry}>Tentar novamente</button>}
      </div></main>
    </div>;
  }
  return <CheckoutContent {...remote.data} user={session.data?.user?.role === 'viewer' ? null : session.data?.user} order={orderState.order} />;
}
