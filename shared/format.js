const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integerFormat = new Intl.NumberFormat('pt-BR');
export const MAX_CENTS = 999_999_999;
export const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function brl(cents) {
  const amount = BigInt(cents);
  const fraction = String(amount % 100n).padStart(2, '0');
  return currency.formatToParts(amount / 100n).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

export function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function parseMoney(value) {
  const input = String(value ?? '').trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(input)) return null;
  const [whole, decimal = ''] = input.replaceAll('.', '').split(',');
  if (whole.length > 7) return null;
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return cents <= MAX_CENTS ? cents : null;
}

export function groupMoneyInput(value) {
  const text = value.trim();
  const cents = parseMoney(text);
  if (cents === null) return text;
  const decimal = text.includes(',') ? ',' + text.split(',')[1] : '';
  return integerFormat.format(Math.trunc(cents / 100)) + decimal;
}

export function installmentOptions(cents, max, minimum) {
  if (cents <= 0) return [];
  const maxAllowed = Math.min(max, Math.max(1, Math.floor(cents / minimum)));
  return Array.from({ length: maxAllowed }, (_, index) => {
    const quantity = index + 1;
    const base = Math.floor(cents / quantity);
    const extra = cents % quantity;
    return { quantity, base, extra };
  });
}

export function maskCpf(value) {
  return digits(value).slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2')
    .replace(/(\.\d{3})(\d)/, '$1-$2');
}

export function cnpjCharacters(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function maskCnpj(value) {
  const input = cnpjCharacters(value).slice(0, 12) + digits(cnpjCharacters(value).slice(12)).slice(0, 2);
  return input
    .replace(/^(.{2})(.)/, '$1.$2')
    .replace(/^(.{2}\..{3})(.)/, '$1.$2')
    .replace(/^(.{2}\..{3}\..{3})(.)/, '$1/$2')
    .replace(/(\/.{4})(.)/, '$1-$2');
}

export function maskCep(value) {
  return digits(value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
}

export function maskPhone(value) {
  const input = digits(value).slice(0, 11);
  if (input.length <= 2) return input ? '(' + input : '';
  const split = input.length > 10 ? 7 : 6;
  return '(' + input.slice(0, 2) + ') ' + input.slice(2, split)
    + (input.length > split ? '-' + input.slice(split) : '');
}

function weightedDigit(value, weights) {
  const remainder = weights.reduce((sum, weight, index) =>
    sum + weight * (value.charCodeAt(index) - 48), 0) % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function validCpf(value) {
  const input = digits(value);
  if (input.length !== 11 || /^(\d)\1+$/.test(input)) return false;
  return Number(input[9]) === weightedDigit(input, [10, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    Number(input[10]) === weightedDigit(input, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
}

export function validCnpj(value) {
  const input = cnpjCharacters(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(input) || /^(\d)\1+$/.test(input)) return false;
  return Number(input[12]) === weightedDigit(input, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) &&
    Number(input[13]) === weightedDigit(input, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
