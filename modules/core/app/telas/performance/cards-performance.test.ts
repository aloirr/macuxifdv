import { describe, expect, it } from 'vitest';

import { INDICADORES_PRODUTIVIDADE, type ProdutividadeIndicador, type ResultadoIndicador } from '../../../contracts/performance';
import { cardsDeProdutividade, cardsDeResultados, dinheiro, leituraDoCardProdutividade, percentual, textoDaMeta, textoDosDiasUteis, valorProdutividade } from './cards-performance';

const resultado = (p: Partial<ResultadoIndicador> & Pick<ResultadoIndicador, 'indicador'>): ResultadoIndicador => ({
  situacao: 'a_cumprir',
  meta: null,
  realizado: null,
  atingimento_pb: null,
  gap: null,
  meta_dia: null,
  real_dia: null,
  ...p,
});
const VENDEDOR = { tipoMetaVenda: 'faturamento' as const, perfil: 'vendedor' as const, umDia: false };

describe('T-0170 §1.5: formatos', () => {
  it('dinheiro: "R$ 84,6 k" de R$ 10 mil para cima; a meta sem "R$"; abaixo, em reais', () => {
    expect(dinheiro(8_460_000)).toBe('R$ 84,6 k');
    expect(dinheiro(18_000_000, false)).toBe('180 k');
    expect(dinheiro(795_000)).toBe('R$ 7.950');
    expect(dinheiro(150_000_000)).toBe('R$ 1,5 mi');
    expect(percentual(4700)).toBe('47,0%');
    expect(percentual(5429)).toBe('54,3%');
  });

  it('produtividade: hora, duração, %, décimos, metros e km', () => {
    expect(valorProdutividade('primeiro_checkin', 472)).toBe('07:52');
    expect(valorProdutividade('tma', 27)).toBe('27 min');
    expect(valorProdutividade('almoco', 94)).toBe('1h34');
    expect(valorProdutividade('jornada_liquida', 480)).toBe('8h00');
    expect(valorProdutividade('fora_rota', 1400)).toBe('14%');
    expect(valorProdutividade('visitas_dia', 107)).toBe('10,7');
    expect(valorProdutividade('visitas_dia', 110)).toBe('11');
    expect(valorProdutividade('raio_checkin', 58)).toBe('58 m');
    expect(valorProdutividade('km_dia', 88_000)).toBe('88 km');
    expect(valorProdutividade('km_cliente', 8_200)).toBe('8,2 km');
    expect(valorProdutividade('km_cliente', 12_000)).toBe('12 km');
  });

  it('a linha da meta segue o sentido (RN-CORE-45): "até", "depois de" ou só o valor', () => {
    expect(textoDaMeta('primeiro_checkin', 480)).toBe('meta até 08:00');
    expect(textoDaMeta('ultimo_checkin', 1020)).toBe('meta depois de 17:00');
    expect(textoDaMeta('almoco', 90)).toBe('meta até 1h30');
    expect(textoDaMeta('visitas_dia', 110)).toBe('meta 11');
    expect(textoDaMeta('cobertura_rota', 9000)).toBe('meta 90%');
    expect(textoDaMeta('km_dia', 120_000)).toBe('meta até 120 km');
  });
});

describe('T-0170 §2 (RN-CORE-42): cards de Resultados', () => {
  it('a cumprir: real / meta, barra, %, Gap, Meta/dia e Real/dia (exemplo da §2.2)', () => {
    const [c] = cardsDeResultados(
      [resultado({ indicador: 'venda_cents', meta: 18_000_000, realizado: 8_460_000, atingimento_pb: 4700, gap: 9_540_000, meta_dia: 795_000, real_dia: 940_000 })],
      VENDEDOR,
    );
    expect(c).toEqual({
      indicador: 'venda_cents',
      titulo: 'Faturamento',
      real: 'R$ 84,6 k',
      meta: '180 k',
      atingimento: '47,0%',
      barra: 0.47,
      tom: 'a_cumprir',
      colunas: [
        { rotulo: 'Gap', valor: 'R$ 95,4 k' },
        { rotulo: 'Meta/dia', valor: 'R$ 7.950' },
        { rotulo: 'Real/dia', valor: 'R$ 9.400' },
      ],
    });
  });

  it('D6: "Vendas" quando a meta é de pedido', () => {
    const [c] = cardsDeResultados([resultado({ indicador: 'venda_cents', meta: 100, realizado: 10, atingimento_pb: 1000, gap: 90 })], { ...VENDEDOR, tipoMetaVenda: 'pedido' });
    expect(c!.titulo).toBe('Vendas');
  });

  it('Itens por pedido: Gap, Meta/pedido e Real, em uma casa', () => {
    const [c] = cardsDeResultados([resultado({ indicador: 'itens_por_pedido', meta: 800, realizado: 640, atingimento_pb: 8000, gap: 160, meta_dia: 920 })], VENDEDOR);
    expect(c!.real).toBe('6,4');
    expect(c!.meta).toBe('8,0');
    expect(c!.colunas).toEqual([
      { rotulo: 'Gap', valor: '1,6' },
      { rotulo: 'Meta/pedido', valor: '9,2' },
      { rotulo: 'Real', valor: '6,4' },
    ]);
  });

  it('meta batida: barra cheia em azul noite, % passa de 100 e sai Gap e Meta/dia (nunca valor negativo)', () => {
    const [c] = cardsDeResultados([resultado({ indicador: 'positivacao', situacao: 'batida', meta: 70, realizado: 77, atingimento_pb: 11000, gap: 0, real_dia: 9 })], VENDEDOR);
    expect(c!.tom).toBe('batida');
    expect(c!.barra).toBe(1);
    expect(c!.atingimento).toBe('110,0%');
    expect(c!.colunas).toEqual([{ rotulo: 'Real/dia', valor: '9' }]);
  });

  it('período encerrado: sem Meta/dia; Real/dia sem dia decorrido = "—"', () => {
    const [c] = cardsDeResultados([resultado({ indicador: 'visitas', meta: 220, realizado: 96, atingimento_pb: 4364, gap: 124, meta_dia: null, real_dia: null })], VENDEDOR);
    expect(c!.colunas).toEqual([
      { rotulo: 'Gap', valor: '124' },
      { rotulo: 'Real/dia', valor: '—' },
    ]);
  });

  it('período de um dia: o Real/dia sai (seria o próprio realizado)', () => {
    const [c] = cardsDeResultados([resultado({ indicador: 'visitas', meta: 12, realizado: 5, atingimento_pb: 4167, gap: 7, real_dia: 5 })], { ...VENDEDOR, umDia: true });
    expect(c!.colunas).toEqual([{ rotulo: 'Gap', valor: '7' }]);
  });

  it('sem meta: só o realizado, sem barra nem "/ meta"; sem dado: "—"', () => {
    const [semMeta, semDado] = cardsDeResultados(
      [resultado({ indicador: 'visitas', situacao: 'sem_meta', realizado: 96, real_dia: 11 }), resultado({ indicador: 'positivacao', situacao: 'sem_dado' })],
      VENDEDOR,
    );
    expect(semMeta).toMatchObject({ real: '96', meta: null, atingimento: null, tom: null, colunas: [{ rotulo: 'Real/dia', valor: '11' }] });
    expect(semDado).toMatchObject({ real: '—', meta: null, colunas: [] });
  });

  it('RN-PRO-01 (§2.4): o promotor só vê Visitas', () => {
    const cards = cardsDeResultados(
      [resultado({ indicador: 'venda_cents', situacao: 'sem_dado' }), resultado({ indicador: 'visitas', situacao: 'sem_meta', realizado: 3, real_dia: 1 }), resultado({ indicador: 'itens_por_pedido', situacao: 'sem_dado' })],
      { ...VENDEDOR, perfil: 'promotor' },
    );
    expect(cards.map((c) => c.indicador)).toEqual(['visitas']);
  });
});

describe('T-0170 §3 (RN-CORE-43/45/46): cards de Produtividade', () => {
  const p = (indicador: ProdutividadeIndicador['indicador'], q: Partial<ProdutividadeIndicador> = {}): ProdutividadeIndicador => ({
    indicador,
    situacao: 'dentro',
    valor: 0,
    meta: 0,
    meta_origem: 'padrao_fdv',
    amostra: 1,
    ...q,
  });

  it('os 12 indicadores, na ordem do contrato, com a meta e o ponto verde ou laranja', () => {
    const cards = cardsDeProdutividade(INDICADORES_PRODUTIVIDADE.map((i) => p(i, { valor: 1, meta: 1 })));
    expect(cards).toHaveLength(12);
    expect(cards.map((c) => c.indicador)).toEqual([...INDICADORES_PRODUTIVIDADE]);
    const [tmd] = cardsDeProdutividade([p('tmd', { situacao: 'fora', valor: 31, meta: 25 })]);
    expect(tmd).toEqual({ indicador: 'tmd', titulo: 'TMD · deslocamento', valor: '31 min', meta: 'meta até 25 min', ponto: 'fora' });
    const [primeiro] = cardsDeProdutividade([p('primeiro_checkin', { valor: 472, meta: 480 })]);
    expect(primeiro).toMatchObject({ valor: '07:52', meta: 'meta até 08:00', ponto: 'dentro' });
  });

  it('km e raio sem dado: "—" sem ponto, com a meta visível (§5)', () => {
    const cards = cardsDeProdutividade([
      p('km_dia', { situacao: 'sem_dado', valor: null, meta: 120_000, amostra: 0 }),
      p('km_cliente', { situacao: 'sem_dado', valor: null, meta: 12_000, amostra: 0 }),
      p('raio_checkin', { situacao: 'sem_dado', valor: null, meta: 100, amostra: 0 }),
    ]);
    expect(cards.map((c) => [c.valor, c.ponto, c.meta])).toEqual([
      ['—', null, 'meta até 120 km'],
      ['—', null, 'meta até 12 km'],
      ['—', null, 'meta até 100 m'],
    ]);
    expect(leituraDoCardProdutividade(cards[0]!)).toBe('Km por dia, sem dado, meta até 120 km');
  });

  it('sem meta: sem ponto e sem a linha "meta …"', () => {
    const [c] = cardsDeProdutividade([p('tma', { situacao: 'sem_meta', valor: 27, meta: null, meta_origem: null })]);
    expect(c).toMatchObject({ valor: '27 min', meta: null, ponto: null });
  });
});

describe('T-0170 §1.3 (RN-CORE-41, D1): a linha dos dias úteis', () => {
  const mes = { de: '2026-11-01', ate: '2026-11-30' };
  it('"DU 9 de 20 · 12 restantes" com hoje no período; dia não útil = "DU —"', () => {
    expect(textoDosDiasUteis({ du_total: 20, du_decorridos: 9, du_restantes: 12, du_hoje: 9 }, mes, '2026-11-12')).toBe('DU 9 de 20 · 12 restantes');
    expect(textoDosDiasUteis({ du_total: 20, du_decorridos: 9, du_restantes: 11, du_hoje: null }, mes, '2026-11-15')).toBe('DU — de 20 · 11 restantes');
    expect(textoDosDiasUteis({ du_total: 20, du_decorridos: 20, du_restantes: 1, du_hoje: 20 }, mes, '2026-11-30')).toBe('DU 20 de 20 · 1 restante');
  });
  it('período encerrado: só o total', () => {
    expect(textoDosDiasUteis({ du_total: 21, du_decorridos: 21, du_restantes: 0, du_hoje: null }, { de: '2026-10-01', ate: '2026-10-31' }, '2026-11-12')).toBe('21 dias úteis');
  });
});
