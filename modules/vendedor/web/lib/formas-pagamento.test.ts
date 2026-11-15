import { describe, expect, it } from 'vitest';
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import {
  buscaDosFiltrosFormas,
  corpoDoPrazo,
  formatarPercentualPrazo,
  formasToCsv,
  lerFiltrosFormas,
  linhasDeFormas,
  linhasDePrazos,
  normalizarBusca,
  percentualDoPrazo,
  prazoEfetivamenteAtivo,
  prazosToCsv,
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

describe('RN-VEN-24: tabela única de prazos, abas, busca e CSV', () => {
  const formas = [forma(1, 'PIX', 'Pix'), forma(2, 'BOLETO', 'Boleto', { ativo: false }), forma(3, 'CARTAO', 'Cartão de crédito')];
  const prazos = [prazo(10, U(1), 'PIX-AV', [0], 0), prazo(11, U(2), 'BOL-28', [28], 28), prazo(12, U(2), 'BOL-30', [30], 30, { ativo: false })];
  const vazios = { aba: 'prazos', q: '', forma: '', ativas: '' } as const;

  it('RN-VEN-24: os filtros (aba, busca, forma, situação) vão e voltam pela URL; Prazos é a aba padrão', () => {
    expect(lerFiltrosFormas('')).toEqual(vazios);
    const f = lerFiltrosFormas(`?aba=formas&q=bol&forma=${U(2)}&ativas=1`);
    expect(f).toEqual({ aba: 'formas', q: 'bol', forma: U(2), ativas: '1' });
    expect(buscaDosFiltrosFormas(f)).toBe(`?aba=formas&q=bol&forma=${U(2)}&ativas=1`);
    expect(buscaDosFiltrosFormas(vazios)).toBe('');
    expect(lerFiltrosFormas('?aba=xyz').aba).toBe('prazos');
  });
  it('RN-VEN-24: a busca ignora maiúsculas e acentos', () => {
    expect(normalizarBusca('  CARTÃO ')).toBe('cartao');
    expect(linhasDeFormas(formas, { ...vazios, q: 'cartao' }).map((f) => f.codigo)).toEqual(['CARTAO']);
    expect(linhasDeFormas(formas, { ...vazios, q: 'CARTÃO' }).map((f) => f.codigo)).toEqual(['CARTAO']);
  });
  it('RN-VEN-24: a tabela única tem uma linha por prazo, com o nome da forma como coluna', () => {
    const l = linhasDePrazos(formas, prazos, vazios);
    expect(l.map((x) => [x.formaNome, x.prazo.codigo])).toEqual([['Pix', 'PIX-AV'], ['Boleto', 'BOL-28'], ['Boleto', 'BOL-30']]);
  });
  it('RN-VEN-24: na aba Prazos a busca olha código, descrição e nome da forma', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'BOL-30' }).map((x) => x.prazo.codigo)).toEqual(['BOL-30']);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'boleto' })).toHaveLength(2);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: '28 dias' }).map((x) => x.prazo.codigo)).toEqual(['BOL-28']);
    expect(linhasDePrazos(formas, prazos, { ...vazios, q: 'nada' })).toEqual([]);
  });
  it('R-20261115-121500: o filtro Forma deixa só os prazos da forma escolhida', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, forma: U(2) }).map((x) => x.prazo.codigo)).toEqual(['BOL-28', 'BOL-30']);
  });
  it('RN-VEN-24: "só ativas" tira prazo inativo e prazo de forma inativa', () => {
    expect(linhasDePrazos(formas, prazos, { ...vazios, ativas: '1' }).map((x) => x.prazo.codigo)).toEqual(['PIX-AV']);
    expect(linhasDeFormas(formas, { ...vazios, aba: 'formas', ativas: '1' }).map((f) => f.codigo)).toEqual(['PIX', 'CARTAO']);
  });
  it('RN-VEN-24: o CSV da aba Prazos segue as colunas da tabela, em padrão brasileiro', () => {
    const csv = prazosToCsv(linhasDePrazos(formas, [...prazos.slice(0, 1), { ...prazos[1]!, percentual_ajuste: -1.71 }, prazos[2]!], vazios));
    expect(csv).toContain('"Código";"Descrição";"Forma";"Código da forma";"Parcelas (dias)";"Prazo médio (dias)";"Desc./Acrésc. (%)";"Situação";"Origem"');
    expect(csv).toContain('"BOL-28";"28 dias";"Boleto";"BOLETO";"28";"28";"\u22121,71%";"Inativo";"BKO"');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3);
  });
  it('RN-VEN-24: o CSV da aba Formas tem uma linha por forma', () => {
    const csv = formasToCsv(linhasDeFormas(formas, vazios));
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3);
    expect(csv).toContain('"BOLETO";"Boleto"');
  });
});

describe('RN-VEN-24: Desc./Acrésc. (%) do prazo (vem do ERP, só leitura)', () => {
  it('RN-VEN-46: formata com sinal, vírgula e 2 casas', () => {
    expect(formatarPercentualPrazo(-1.71)).toBe('\u22121,71%');
    expect(formatarPercentualPrazo(2.5)).toBe('+2,50%');
    expect(formatarPercentualPrazo(0)).toBe('0,00%');
  });
  it('RN-VEN-46: a leitura devolve o % do ERP; prazo sem o campo (criado no BKO) vale 0', () => {
    expect(percentualDoPrazo(prazo(1, U(1), 'X', [0], 0))).toBe(0);
    expect(percentualDoPrazo({ ...prazo(1, U(1), 'X', [0], 0), percentual_ajuste: -1.71 })).toBe(-1.71);
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

describe('prazoEfetivamenteAtivo', () => {
  it('prazo ativo só conta como ativo quando a forma também está ativa', () => {
    const prazo = { ativo: true } as PrazoPagamento;
    expect(prazoEfetivamenteAtivo({ prazo, formaAtiva: true })).toBe(true);
    expect(prazoEfetivamenteAtivo({ prazo, formaAtiva: false })).toBe(false);
    expect(prazoEfetivamenteAtivo({ prazo: { ...prazo, ativo: false }, formaAtiva: true })).toBe(false);
  });
});
