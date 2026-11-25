import test from 'node:test';
import assert from 'node:assert/strict';
import { brl, groupMoneyInput, installmentOptions, maskCep, maskCnpj, maskCpf, maskPhone,
  parseMoney, validCnpj, validCpf } from '../shared/format.js';

test('BRL aceita reais inteiros e valores brasileiros sem perder centavos', () => {
  assert.equal(groupMoneyInput('2599'), '2.599');
  assert.equal(groupMoneyInput('2599,1'), '2.599,1');
  assert.equal(parseMoney('2599'), 259900);
  assert.equal(parseMoney('R$ 2.599,07'), 259907);
  assert.equal(parseMoney('1.350,00'), 135000);
  assert.equal(parseMoney('0,1'), 10);
  assert.equal(parseMoney('9.999.999,99'), 999999999);
  assert.equal(brl('900719925474099301').replace(/\s/g, ' '), 'R$ 9.007.199.254.740.993,01');
  assert.equal(brl(259900).replace(/\s/g, ' '), 'R$ 2.599,00');
  for (const value of ['-1', '25.99', '2.599,007', '1e3', 'NaN', '10.000.000,00']) {
    assert.equal(parseMoney(value), null, value);
  }
});

test('parcelas preservam o total exato e respeitam os limites', () => {
  assert.equal(installmentOptions(1000, 12, 500).length, 2);
  const option = installmentOptions(259901, 12, 500)[2];
  assert.equal(option.quantity, 3);
  assert.equal(option.quantity * option.base + option.extra, 259901);
  assert.equal(installmentOptions(100, 12, 500).length, 1);
});

test('formata e valida CPF e CNPJ e mascara CEP e telefone', () => {
  assert.equal(maskCpf('52998224725'), '529.982.247-25');
  assert.equal(validCpf('529.982.247-25'), true);
  assert.equal(validCpf('529.982.247-00'), false);
  assert.equal(validCpf('000.000.000-00'), false);
  assert.equal(maskCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(validCnpj('11.222.333/0001-81'), true);
  assert.equal(maskCnpj('12abc34501de35'), '12.ABC.345/01DE-35');
  assert.equal(validCnpj('12.ABC.345/01DE-35'), true);
  assert.equal(validCnpj('12.ABC.345/01DE-53'), false);
  assert.equal(maskCep('01001000'), '01001-000');
  assert.equal(maskPhone('11987654321'), '(11) 98765-4321');
  assert.equal(maskPhone('1133334444'), '(11) 3333-4444');
});
