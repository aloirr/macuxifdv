import { describe, expect, it } from 'vitest';
import {
  devolvidoDaNota,
  filtrarNotas,
  inicioDoPeriodoNf,
  JANELA_APARELHO_DIAS,
  descricaoDaFormaPagamento,
  limiteEDisponivelDoResumo,
  nfEmAtraso,
  periodoPrecisaDoServidor,
  rotuloStatusNf,
  saldoDisponivelCents,
  statusDaNf,
  statusDaParcela,
  tomStatusNf,
  type LinhaHistoricoNf,
} from './historico-nf';
import type { StatusNf } from '../contracts/cliente360-v2';
import type { TituloLike } from './cliente360';

const HOJE = '2026-11-19';
const parcela = (vencimento: string, saldo_cents: number, situacao: TituloLike['situacao'] = 'aberto'): TituloLike => ({ vencimento, saldo_cents, situacao });
const nota = (valor_cents = 128_000, devolvido_cents = 0) => ({ valor_cents, devolvido_cents });
const TODOS: StatusNf[] = ['em_atraso', 'em_aberto', 'pago', 'devolvido', 'devolvido_parcial'];

describe('RN-CORE-40 / T-0186: status da NF no Histórico do Cliente 360', () => {
  it('RN-CORE-40: parcela com saldo e vencimento futuro = Em aberto', () => {
    expect(statusDaNf(nota(), [parcela('2026-11-25', 128_000)], HOJE)).toBe('em_aberto');
  });
  it('RN-CORE-40: parcela que vence hoje ainda é Em aberto (vencida só no dia seguinte)', () => {
    expect(statusDaNf(nota(), [parcela('2026-11-19', 128_000)], HOJE)).toBe('em_aberto');
  });
  it('RN-CORE-40: parcela vencida e não paga = Em atraso', () => {
    expect(statusDaNf(nota(), [parcela('2026-10-31', 64_000), parcela('2026-10-10', 0, 'liquidado')], HOJE)).toBe('em_atraso');
  });
  it('RN-CORE-40: uma parcela vencida e outra a vencer = Em atraso (o atraso prevalece)', () => {
    expect(statusDaNf(nota(), [parcela('2026-10-31', 64_000), parcela('2026-12-01', 64_000)], HOJE)).toBe('em_atraso');
  });
  it('RN-CORE-40: todas as parcelas liquidadas, sem devolução = Pago', () => {
    expect(statusDaNf(nota(), [parcela('2026-10-10', 0, 'liquidado'), parcela('2026-10-31', 0, 'liquidado')], HOJE)).toBe('pago');
  });
  it('RN-CORE-40: nota sem parcela no ERP (à vista) e sem devolução = Pago', () => {
    expect(statusDaNf(nota(), [], HOJE)).toBe('pago');
  });
  it('RN-CORE-40: parcela cancelada não conta como saldo', () => {
    expect(statusDaNf(nota(), [parcela('2026-10-10', 128_000, 'cancelado')], HOJE)).toBe('pago');
  });
  it('RN-CORE-40: devolução total sem saldo = Devolvido', () => {
    expect(statusDaNf(nota(128_000, 128_000), [parcela('2026-10-10', 0, 'cancelado')], HOJE)).toBe('devolvido');
  });
  it('RN-CORE-40: devolução parcial sem saldo = Devolvido parcial', () => {
    expect(statusDaNf(nota(128_000, 33_000), [parcela('2026-10-10', 0, 'liquidado')], HOJE)).toBe('devolvido_parcial');
  });
  it('RN-CORE-40 / P3: Devolvido parcial com saldo a vencer = Em aberto (o saldo prevalece)', () => {
    expect(statusDaNf(nota(128_000, 33_000), [parcela('2026-12-10', 95_000)], HOJE)).toBe('em_aberto');
  });
  it('RN-CORE-40 / P3: Devolvido parcial com saldo vencido = Em atraso (o saldo prevalece)', () => {
    expect(statusDaNf(nota(128_000, 33_000), [parcela('2026-10-10', 95_000)], HOJE)).toBe('em_atraso');
  });
  it('RN-CORE-40 / P3: devolução total com saldo ainda no ERP = Em aberto até o ERP baixar', () => {
    expect(statusDaNf(nota(128_000, 128_000), [parcela('2026-12-10', 10_000)], HOJE)).toBe('em_aberto');
  });
  it('RN-CORE-40: devolvido maior que o valor da nota conta como devolução total', () => {
    expect(statusDaNf(nota(100, 500), [], HOJE)).toBe('devolvido');
  });
});

describe('R-20261119-0530 / T-0186: "Em atraso" vai sem data, só o fato', () => {
  it('R-20261119-0530: nfEmAtraso é só verdadeiro/falso e o rótulo não traz data', () => {
    expect(nfEmAtraso([parcela('2026-10-31', 64_000)], HOJE)).toBe(true);
    expect(nfEmAtraso([parcela('2026-11-19', 64_000)], HOJE)).toBe(false);
    expect(nfEmAtraso([parcela('2026-10-31', 0, 'liquidado')], HOJE)).toBe(false);
    expect(rotuloStatusNf('em_atraso')).toBe('Em atraso');
    expect(rotuloStatusNf('em_atraso')).not.toMatch(/\d/);
  });
  it('spec §4: rótulos e tons dos cinco status', () => {
    expect(TODOS.map(rotuloStatusNf)).toEqual(['Em atraso', 'Em aberto', 'Pago', 'Devolvido', 'Devolvido parcial']);
    expect(TODOS.map(tomStatusNf)).toEqual(['danger', 'warning', 'success', 'neutral', 'accent']);
  });
});

describe('RN-CORE-40 / P4: valor devolvido da NF vem das devoluções vivas ligadas à NF original', () => {
  const dev = (nf_original: string | null, total_cents: number, cancelada = false, nf_original_serie: string | null = null) => ({ nf_original, nf_original_serie, total_cents, cancelada });
  it('P4: soma só as devoluções não canceladas da mesma NF original', () => {
    expect(devolvidoDaNota('004655', null, [dev('004655', 20_000), dev('004655', 13_000), dev('004655', 5_000, true), dev('004700', 9_999), dev(null, 1)])).toBe(33_000);
  });
  it('P4: NF de mesmo número e série diferente não recebe a devolução da outra (casa por número E série)', () => {
    const ds = [dev('004655', 20_000, false, '1'), dev('004655', 7_000, false, '2')];
    expect(devolvidoDaNota('004655', '1', ds)).toBe(20_000);
    expect(devolvidoDaNota('004655', '2', ds)).toBe(7_000);
    expect(devolvidoDaNota('004655', '3', ds)).toBe(0);
    expect(devolvidoDaNota('004655', null, [dev('004655', 5_000)])).toBe(5_000);
  });
  it('P4: sem devolução = 0', () => {
    expect(devolvidoDaNota('004655', null, [])).toBe(0);
  });
});

describe('RN-VEN-12 / R-20261119-0530: Limite, Saldo disponível e Prazo médio do Resumo', () => {
  const f = { limite_cents: 800_000, saldo_aberto_cents: 612_000, credito_disponivel_erp_cents: null };
  it('RN-VEN-12: saldo disponível = limite − em aberto − pedidos aprovados não faturados', () => {
    expect(saldoDisponivelCents(f, 0)).toBe(188_000);
    expect(saldoDisponivelCents(f, 50_000)).toBe(138_000);
  });
  it('RN-VEN-12: o crédito do ERP prevalece sobre limite − saldo', () => {
    expect(saldoDisponivelCents({ ...f, credito_disponivel_erp_cents: 100_000 }, 0)).toBe(100_000);
  });
  it('RN-VEN-12: pode ficar negativo (limite estourado)', () => {
    expect(saldoDisponivelCents({ limite_cents: 100_000, saldo_aberto_cents: 150_000, credito_disponivel_erp_cents: null }, 0)).toBe(-50_000);
  });
  it('R-20261119-0530: o cartão tem só Limite, Saldo disponível e Prazo médio (e o motivo do bloqueio)', () => {
    expect(limiteEDisponivelDoResumo({ ...f, bloqueado: true, motivo_bloqueio: 'Crédito' }, 0, 24)).toEqual({
      limite_cents: 800_000,
      saldo_disponivel_cents: 188_000,
      prazo_medio_dias: 24,
      bloqueado: true,
      motivo_bloqueio: 'Crédito',
    });
  });
  it('R-20261119-0530: sem linha financeira o cartão não existe', () => {
    expect(limiteEDisponivelDoResumo(null, 0, 24)).toBeNull();
  });
});

describe('RN-CORE-40 / P8 e P17: período do Histórico e consulta online', () => {
  it('P8: padrão de 90 dias; 30 dias e 12 meses a partir de hoje', () => {
    expect(JANELA_APARELHO_DIAS).toBe(90);
    expect(inicioDoPeriodoNf('30d', HOJE)).toBe('2026-10-20');
    expect(inicioDoPeriodoNf('90d', HOJE)).toBe('2026-08-21');
    expect(inicioDoPeriodoNf('12m', HOJE)).toBe('2025-11-19');
  });
  it('P17: além de 90 dias só consulta o servidor (online); dentro dos 90 dias, não', () => {
    expect(periodoPrecisaDoServidor('2026-08-21', HOJE)).toBe(false);
    expect(periodoPrecisaDoServidor('2026-08-20', HOJE)).toBe(true);
    expect(periodoPrecisaDoServidor('2025-11-19', HOJE)).toBe(true);
  });
});

describe('RN-CORE-40 / P14: filtros do Histórico (período, status, forma e Nº da NF)', () => {
  const l = (numero_nf: string, data: string, status: StatusNf, forma_pagamento: string | null): LinhaHistoricoNf => ({ data, numero_nf, valor_cents: 100, forma_pagamento, status });
  const linhas = [l('004817', '2026-11-12', 'em_aberto', 'Boleto 28 dias'), l('004655', '2026-10-10', 'em_atraso', 'Boleto 14/21 dias'), l('004702', '2026-09-30', 'pago', 'PIX'), l('004500', '2026-08-01', 'devolvido', null)];
  it('ordena da mais recente para a mais antiga e não filtra nada por padrão', () => {
    expect(filtrarNotas([...linhas].reverse(), {}).map((x) => x.numero_nf)).toEqual(['004817', '004655', '004702', '004500']);
  });
  it('status é múltipla escolha; vazio vale como todos', () => {
    expect(filtrarNotas(linhas, { status: ['em_atraso'] }).map((x) => x.numero_nf)).toEqual(['004655']);
    expect(filtrarNotas(linhas, { status: ['em_atraso', 'pago'] }).map((x) => x.numero_nf)).toEqual(['004655', '004702']);
    expect(filtrarNotas(linhas, { status: [] })).toHaveLength(4);
  });
  it('forma de pagamento: nota sem a forma não entra no grupo', () => {
    expect(filtrarNotas(linhas, { forma_pagamento: ['PIX'] }).map((x) => x.numero_nf)).toEqual(['004702']);
  });
  it('P14: Nº da NF busca por parte do número', () => {
    expect(filtrarNotas(linhas, { numero_nf: '4655' }).map((x) => x.numero_nf)).toEqual(['004655']);
  });
  it('período inclui as duas pontas', () => {
    expect(filtrarNotas(linhas, { de: '2026-09-30', ate: '2026-10-10' }).map((x) => x.numero_nf)).toEqual(['004655', '004702']);
  });
});

describe('R-20261119-0530: status da parcela no detalhe da NF', () => {
  it('a parcela em atraso é só "Em atraso", sem a data; liquidada é "Paga"', () => {
    expect(statusDaParcela({ situacao: 'aberto', em_atraso: true })).toEqual({ rotulo: 'Em atraso', tom: 'danger' });
    expect(statusDaParcela({ situacao: 'aberto', em_atraso: false })).toEqual({ rotulo: 'Em aberto', tom: 'warning' });
    expect(statusDaParcela({ situacao: 'liquidado', em_atraso: false }).rotulo).toBe('Paga');
    expect(statusDaParcela({ situacao: 'cancelado', em_atraso: false })).toEqual({ rotulo: 'Cancelada', tom: 'neutral' });
  });
});

describe('T-0186: forma de pagamento da NF aparece como descrição, nunca como código', () => {
  const formas = [{ codigo: 'BOL', nome: 'Boleto' }, { codigo: 'PIX', nome: 'Pix' }];
  it('o código do ERP vira a descrição, sem diferenciar maiúsculas nem espaços', () => {
    expect(descricaoDaFormaPagamento('BOL', formas)).toBe('Boleto');
    expect(descricaoDaFormaPagamento(' pix ', formas)).toBe('Pix');
  });
  it('código sem forma cadastrada fica como veio, e sem forma é nulo', () => {
    expect(descricaoDaFormaPagamento('Boleto 28 dias', formas)).toBe('Boleto 28 dias');
    expect(descricaoDaFormaPagamento('  ', formas)).toBeNull();
    expect(descricaoDaFormaPagamento(null, formas)).toBeNull();
  });
});
