import { describe, expect, it } from 'vitest';
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import {
  buscaDosFiltrosFormas,
  corpoDoPrazo,
  filtrarFormas,
  formasToCsv,
  lerFiltrosFormas,
  parcelasDoTexto,
  previaDoPrazo,
  registroDoErp,
  textoDasParcelas,
  validarForma,
  validarPrazo,
  FORM_FORMA_VAZIO,
  FORM_PRAZO_VAZIO,
} from './formas-pagamento';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const forma = (n: number, codigo: string, nome: string, o: Partial<FormaPagamento> = {}): FormaPagamento => ({ id: U(n), codigo, nome, ativo: true, ordem: n, external_id: null, updated_at: '2026-11-06T00:00:00.000000Z', ...o });
const prazo = (n: number, formaId: string, codigo: string, parcelas: number[], medio: number, o: Partial<PrazoPagamento> = {}): PrazoPagamento => ({
  id: U(n),
  forma_pagamento_id: formaId,
  codigo,
  descricao: parcelas.join('/') + ' dias',
  parcelas_dias: parcelas,
  prazo_medio_dias: medio,
  ativo: true,
  ordem: n,
  external_id: null,
  updated_at: '2026-11-06T00:00:00.000000Z',
  ...o,
});

describe('RN-VEN-24: parcelas digitadas no BKO', () => {
  it('RN-VEN-24: lê 28/56, 30 60 90 e "à vista"', () => {
    expect(parcelasDoTexto('28/56')).toEqual([28, 56]);
    expect(parcelasDoTexto('30 60, 90')).toEqual([30, 60, 90]);
    expect(parcelasDoTexto('À vista')).toEqual([0]);
  });
  it('RN-VEN-24: recusa vazio, letra e dia fora de 0 a 365', () => {
    expect(parcelasDoTexto('')).toBeNull();
    expect(parcelasDoTexto('28/abc')).toBeNull();
    expect(parcelasDoTexto('400')).toBeNull();
  });
  it('RN-VEN-24: a prévia mostra o prazo e o prazo médio arredondado para cima (28/56 = 42)', () => {
    expect(previaDoPrazo('28/56')).toEqual({ descricao: '28/56 dias', prazoMedio: 42 });
    expect(previaDoPrazo('30/45')?.prazoMedio).toBe(38);
    expect(previaDoPrazo('56/28')).toBeNull();
  });
  it('RN-VEN-24: o texto volta para o campo na edição', () => {
    expect(textoDasParcelas([28, 56])).toBe('28/56');
    expect(textoDasParcelas([0])).toBe('à vista');
  });
});

describe('RN-VEN-24: formulário de forma e de prazo', () => {
  const formas = [forma(1, 'PIX', 'Pix'), forma(2, 'BOLETO', 'Boleto')];
  it('RN-VEN-24: código repetido na outra forma é recusado; editar a própria forma passa', () => {
    expect(validarForma({ ...FORM_FORMA_VAZIO, codigo: 'pix', nome: 'Pix 2' }, formas, null).codigo).toMatch(/Já existe/);
    expect(validarForma({ ...FORM_FORMA_VAZIO, codigo: 'PIX', nome: 'Pix' }, formas, U(1))).toEqual({});
  });
  it('RN-VEN-24: sem código nem nome, mensagens com a ação seguinte', () => {
    const e = validarForma(FORM_FORMA_VAZIO, formas, null);
    expect(e.codigo).toMatch(/Informe o código/);
    expect(e.nome).toMatch(/Informe o nome/);
  });
  it('RN-VEN-24: prazo exige forma, código e dias que não diminuem', () => {
    const e = validarPrazo({ ...FORM_PRAZO_VAZIO, parcelas: '56/28' }, [], null);
    expect(e.forma_pagamento_id).toMatch(/Escolha/);
    expect(e.parcelas).toMatch(/não podem diminuir/);
    expect(validarPrazo({ ...FORM_PRAZO_VAZIO, forma_pagamento_id: U(2), codigo: 'BOL-28', parcelas: '28' }, [], null)).toEqual({});
  });
  it('RN-VEN-24: o corpo leva o id do BKO, o código em maiúsculas e as parcelas em número', () => {
    expect(corpoDoPrazo(U(9), { forma_pagamento_id: U(2), codigo: 'bol-28-56', parcelas: '28/56', ordem: '3', ativo: true })).toEqual({
      id: U(9),
      forma_pagamento_id: U(2),
      codigo: 'BOL-28-56',
      parcelas_dias: [28, 56],
      ativo: true,
      ordem: 3,
    });
  });
});

describe('RN-VEN-24: filtros na URL e CSV', () => {
  const formas = [forma(1, 'PIX', 'Pix'), forma(2, 'BOLETO', 'Boleto', { ativo: false })];
  const prazos = [prazo(10, U(1), 'PIX-AV', [0], 0), prazo(11, U(2), 'BOL-28', [28], 28), prazo(12, U(2), 'BOL-30', [30], 30, { ativo: false })];
  it('RN-VEN-24: os filtros vão e voltam pela URL', () => {
    const f = lerFiltrosFormas('?q=bol&ativas=1');
    expect(f).toEqual({ q: 'bol', ativas: '1' });
    expect(buscaDosFiltrosFormas(f)).toBe('?q=bol&ativas=1');
    expect(buscaDosFiltrosFormas({ q: '', ativas: '' })).toBe('');
  });
  it('RN-VEN-24: "só ativas" tira forma e prazo inativos; a busca olha o código do prazo', () => {
    expect(filtrarFormas(formas, prazos, { q: '', ativas: '1' }).map((x) => x.forma.codigo)).toEqual(['PIX']);
    expect(filtrarFormas(formas, prazos, { q: 'BOL-30', ativas: '' }).map((x) => x.forma.codigo)).toEqual(['BOLETO']);
  });
  it('RN-VEN-24: o CSV tem uma linha por prazo, com o prazo médio, em padrão brasileiro', () => {
    const csv = formasToCsv(filtrarFormas(formas, prazos, { q: '', ativas: '' }));
    expect(csv).toContain('Prazo médio (dias)');
    expect(csv).toContain('Boleto;BOLETO;28 dias;BOL-28;28;Inativo;BKO');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3);
  });
});

describe('T-0089: registro do ERP', () => {
  it('RN-VEN-24: registro com external_id é do ERP (código e parcelas só para leitura); do BKO é editável', () => {
    expect(registroDoErp({ external_id: 'ERP-1' })).toBe(true);
    expect(registroDoErp({ external_id: null })).toBe(false);
    expect(registroDoErp({})).toBe(false);
    expect(registroDoErp(undefined)).toBe(false);
  });
});
