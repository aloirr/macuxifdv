import { describe, expect, it } from 'vitest';
import { compraMediaMesCents, linksDeContato, resumoCompras, resumoSemCompras, semComprasNaJanela, resumoFinanceiro, situacaoTitulo, type TituloLike } from './cliente360';

const titulo = (vencimento: string, saldo_cents: number, situacao: TituloLike['situacao'] = 'aberto'): TituloLike => ({ vencimento, saldo_cents, situacao });

describe('situação do título (Cliente 360, RF-CORE-04)', () => {
  it('título que vence hoje ainda é a vencer', () => {
    expect(situacaoTitulo(titulo('2026-10-12', 100), '2026-10-12')).toEqual({ situacao: 'a_vencer', dias_atraso: 0 });
  });
  it('título de ontem está vencido há 1 dia', () => {
    expect(situacaoTitulo(titulo('2026-10-11', 100), '2026-10-12')).toEqual({ situacao: 'vencido', dias_atraso: 1 });
  });
  it('liquidado e cancelado nunca vencem', () => {
    expect(situacaoTitulo(titulo('2026-01-01', 0, 'liquidado'), '2026-10-12').situacao).toBe('liquidado');
    expect(situacaoTitulo(titulo('2026-01-01', 0, 'cancelado'), '2026-10-12').situacao).toBe('cancelado');
  });
});

describe('resumo financeiro (Cliente 360, RF-CORE-04)', () => {
  const fin = { limite_cents: 1_000_000, saldo_aberto_cents: 300_000, credito_disponivel_cents: null, bloqueado: false, motivo_bloqueio: null };

  it('crédito disponível = limite − saldo quando o ERP não informa', () => {
    expect(resumoFinanceiro(fin, [], '2026-10-12')!.credito_disponivel_cents).toBe(700_000);
  });
  it('crédito do ERP prevalece sobre o cálculo', () => {
    expect(resumoFinanceiro({ ...fin, credito_disponivel_cents: 500_000 }, [], '2026-10-12')!.credito_disponivel_cents).toBe(500_000);
  });
  it('separa vencidos e a vencer só entre títulos abertos, com maior atraso', () => {
    const r = resumoFinanceiro(
      fin,
      [titulo('2026-10-01', 50_000), titulo('2026-10-10', 20_000), titulo('2026-10-12', 10_000), titulo('2026-11-01', 5_000), titulo('2026-09-01', 99_000, 'liquidado')],
      '2026-10-12',
    )!;
    expect(r).toMatchObject({ vencidos_qtd: 2, vencidos_cents: 70_000, a_vencer_qtd: 2, a_vencer_cents: 15_000, maior_atraso_dias: 11 });
  });
  it('mantém o bloqueio e o motivo para o cabeçalho da ficha', () => {
    const r = resumoFinanceiro({ ...fin, bloqueado: true, motivo_bloqueio: 'Inadimplência' }, [], '2026-10-12')!;
    expect(r.bloqueado).toBe(true);
    expect(r.motivo_bloqueio).toBe('Inadimplência');
  });
  it('cliente sem registro financeiro devolve null (a tela mostra "sem dados")', () => {
    expect(resumoFinanceiro(null, [], '2026-10-12')).toBeNull();
  });
});

describe('resumo de compras (Cliente 360, RF-CORE-04)', () => {
  const mes = (ano_mes: string, valor_cents: number, pedidos: number, ultima: string | null = null) => ({ ano_mes, valor_cents, pedidos, ultima_compra_em: ultima });

  it('sem histórico: zeros e nulos, sem quebrar', () => {
    expect(resumoCompras([], '2026-10-12')).toEqual({ ultima_compra_em: null, dias_sem_compra: null, ticket_medio_cents: 0, frequencia_media_dias: null, total_12m_cents: 0 });
  });
  it('ticket médio = total ÷ pedidos, em centavos inteiros', () => {
    const r = resumoCompras([mes('2026-09', 100_001, 2, '2026-09-20'), mes('2026-10', 50_000, 1, '2026-10-02')], '2026-10-12');
    expect(r.total_12m_cents).toBe(150_001);
    expect(r.ticket_medio_cents).toBe(50_000);
  });
  it('última compra é a maior data; dias sem compra contam até hoje', () => {
    const r = resumoCompras([mes('2026-09', 1, 1, '2026-09-20'), mes('2026-10', 1, 1, '2026-10-02')], '2026-10-12');
    expect(r.ultima_compra_em).toBe('2026-10-02');
    expect(r.dias_sem_compra).toBe(10);
  });
  it('só entram os 12 meses até o mês de hoje (mês 13 fica de fora)', () => {
    const r = resumoCompras([mes('2025-10', 999, 9, '2025-10-10'), mes('2025-11', 100, 1, '2025-11-10')], '2026-10-12');
    expect(r.total_12m_cents).toBe(100);
  });
  it('RN-CORE-40: Compra média/mês = total da janela ÷ 12, sempre (2 meses com compra em 12 não dividem por 2)', () => {
    const h = [mes('2026-09', 300_000, 2, '2026-09-20'), mes('2026-10', 200_000, 1, '2026-10-02'), mes('2025-09', 999_999, 9, '2025-09-01')];
    expect(compraMediaMesCents(h, '2026-10-12')).toBe(41_667);
    expect(compraMediaMesCents([mes('2025-10', 120_000, 1)], '2026-10-12')).toBe(0);
    expect(compraMediaMesCents([mes('2025-11', 5, 1)], '2026-10-12')).toBe(0);
    expect(compraMediaMesCents([mes('2025-11', 6, 1)], '2026-10-12')).toBe(1);
  });
  it('RN-CORE-40: sem compra na janela (inclui só o 13º mês) a ficha mostra "Sem compras em 12 meses"', () => {
    expect(semComprasNaJanela([], '2026-10-12')).toBe(true);
    expect(semComprasNaJanela([mes('2025-10', 100, 1, '2025-10-10')], '2026-10-12')).toBe(true);
    expect(semComprasNaJanela([mes('2025-11', 100, 1, '2025-11-10')], '2026-10-12')).toBe(false);
    expect(resumoSemCompras(resumoCompras([], '2026-10-12'))).toBe(true);
    expect(resumoSemCompras(resumoCompras([mes('2026-10', 100, 1, '2026-10-02')], '2026-10-12'))).toBe(false);
  });
  it('frequência média em dias = dias desde o 1º mês com compra ÷ pedidos', () => {
    const r = resumoCompras([mes('2026-08', 1, 3, '2026-08-20'), mes('2026-09', 1, 3, '2026-09-20')], '2026-10-01');
    // de 01/08 a 01/10 = 61 dias, 6 pedidos
    expect(r.frequencia_media_dias).toBe(10.2);
  });
});

describe('links de contato (ligar e WhatsApp em 1 toque)', () => {
  it('tel: e WhatsApp com DDI 55 e só dígitos', () => {
    expect(linksDeContato({ telefone: '(92) 3234-5678', whatsapp: '(92) 99123-4567' })).toEqual({ tel: 'tel:+559232345678', whatsapp: 'https://wa.me/5592991234567' });
  });
  it('número que já traz 55 não duplica o DDI', () => {
    expect(linksDeContato({ telefone: null, whatsapp: '+55 92 99123-4567' }).whatsapp).toBe('https://wa.me/5592991234567');
  });
  it('sem número devolve null nos dois', () => {
    expect(linksDeContato({ telefone: null, whatsapp: '' })).toEqual({ tel: null, whatsapp: null });
  });
});
