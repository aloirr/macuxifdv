import { describe, expect, it } from 'vitest';

import { itemNoPeriodo, periodoDe, periodoForaDaJanela, intervaloDoPeriodo, type ItemDaBusca } from './busca-periodo';
import {
  AJUDA_FORA_DA_JANELA,
  ajudaDaJanela,
  ATALHO_PADRAO,
  atalhoEmVigor,
  contarFiltros,
  escolhaEmVigor,
  periodoDoAtalho,
  textoDaEtiquetaDoPeriodo,
} from './filtro-periodo';

const TZ = 'America/Manaus';
// sexta-feira, 06/11/2026, 10h em Manaus
const AGORA = new Date('2026-11-06T14:00:00Z');

const item = (emitido: string): ItemDaBusca => ({ id: 'x', numero: '1', nome_fantasia: 'A', razao_social: 'A', tipo: 'pedido', status: 'approved', local: false, total_cents: 1, emitido_em: emitido, status_alterado_em: null });

describe('T-0090: filtro de período num botão só (RF-VEN-05)', () => {
  it('RF-VEN-05: os atalhos valem Hoje, Ontem, Esta semana (domingo a sábado), Este mês, Mês passado e Este ano no fuso do tenant', () => {
    expect(periodoDoAtalho('hoje', AGORA, TZ)).toEqual({ tipo: 'dia', valor: '2026-11-06' });
    expect(periodoDoAtalho('ontem', AGORA, TZ)).toEqual({ tipo: 'dia', valor: '2026-11-05' });
    expect(periodoDoAtalho('esta_semana', AGORA, TZ)).toEqual({ tipo: 'semana', valor: '2026-11-01' });
    expect(periodoDoAtalho('este_mes', AGORA, TZ)).toEqual({ tipo: 'mes', valor: '2026-11' });
    expect(periodoDoAtalho('mes_passado', AGORA, TZ)).toEqual({ tipo: 'mes', valor: '2026-10' });
    expect(periodoDoAtalho('este_ano', AGORA, TZ)).toEqual({ tipo: 'ano', valor: '2026' });
    // 01h UTC de 07/11 ainda é 06/11 em Manaus
    expect(periodoDoAtalho('hoje', new Date('2026-11-07T01:00:00Z'), TZ).valor).toBe('2026-11-06');
  });

  it('RF-VEN-05: Mês passado em janeiro vira dezembro do ano anterior', () => {
    expect(periodoDoAtalho('mes_passado', new Date('2027-01-10T15:00:00Z'), TZ)).toEqual({ tipo: 'mes', valor: '2026-12' });
  });

  it('RF-VEN-05: Esta semana pega só pedidos de domingo a sábado', () => {
    const p = periodoDoAtalho('esta_semana', AGORA, TZ);
    expect(itemNoPeriodo(item('2026-11-01T15:00:00Z'), p, TZ)).toBe(true);
    expect(itemNoPeriodo(item('2026-11-06T15:00:00Z'), p, TZ)).toBe(true);
    expect(itemNoPeriodo(item('2026-10-31T15:00:00Z'), p, TZ)).toBe(false);
    expect(itemNoPeriodo(item('2026-11-08T15:00:00Z'), p, TZ)).toBe(false);
    expect(intervaloDoPeriodo(p)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
  });

  it('RF-VEN-05: o padrão é Este mês, não conta como filtro e não tem etiqueta própria de dia/mês/ano', () => {
    expect(ATALHO_PADRAO).toBe('este_mes');
    expect(contarFiltros({ periodo: periodoDe('mes', AGORA, TZ), agora: AGORA, tz: TZ, vendedorEscolhido: false })).toBe(0);
    expect(escolhaEmVigor(periodoDe('mes', AGORA, TZ), AGORA, TZ)).toBeNull();
  });

  it('RF-VEN-05: o selo conta o período fora do padrão e o vendedor escolhido (Gestão)', () => {
    const ontem = periodoDoAtalho('ontem', AGORA, TZ);
    expect(contarFiltros({ periodo: ontem, agora: AGORA, tz: TZ, vendedorEscolhido: false })).toBe(1);
    expect(contarFiltros({ periodo: ontem, agora: AGORA, tz: TZ, vendedorEscolhido: true })).toBe(2);
    expect(contarFiltros({ periodo: periodoDe('mes', AGORA, TZ), agora: AGORA, tz: TZ, vendedorEscolhido: true })).toBe(1);
  });

  it('RF-VEN-05: o atalho em vigor leva o ✓; dia, mês ou ano que não é atalho abre a folha na aba dele', () => {
    expect(atalhoEmVigor({ tipo: 'dia', valor: '2026-11-05' }, AGORA, TZ)).toBe('ontem');
    expect(atalhoEmVigor({ tipo: 'dia', valor: '2026-11-02' }, AGORA, TZ)).toBeNull();
    expect(escolhaEmVigor({ tipo: 'dia', valor: '2026-11-02' }, AGORA, TZ)).toEqual({ tipo: 'dia', valor: '2026-11-02' });
    expect(escolhaEmVigor({ tipo: 'mes', valor: '2026-09' }, AGORA, TZ)).toEqual({ tipo: 'mes', valor: '2026-09' });
    expect(escolhaEmVigor({ tipo: 'ano', valor: '2025' }, AGORA, TZ)).toEqual({ tipo: 'ano', valor: '2025' });
    expect(escolhaEmVigor(periodoDoAtalho('hoje', AGORA, TZ), AGORA, TZ)).toBeNull();
  });

  it('RF-VEN-05: a etiqueta mostra o atalho, o dia, o mês ou o ano', () => {
    expect(textoDaEtiquetaDoPeriodo(periodoDoAtalho('ontem', AGORA, TZ), AGORA, TZ)).toBe('Ontem');
    expect(textoDaEtiquetaDoPeriodo({ tipo: 'dia', valor: '2026-11-02' }, AGORA, TZ)).toBe('Seg, 02/11/2026');
    expect(textoDaEtiquetaDoPeriodo({ tipo: 'mes', valor: '2026-09' }, AGORA, TZ)).toBe('Setembro de 2026');
    expect(textoDaEtiquetaDoPeriodo({ tipo: 'ano', valor: '2025' }, AGORA, TZ)).toBe('2025');
  });

  it('RF-VEN-05: o aviso dos 90 dias só aparece quando o período sai da janela do aparelho (e aí a consulta vai ao servidor)', () => {
    expect(ajudaDaJanela(periodoDe('mes', AGORA, TZ), AGORA, TZ)).toBeNull();
    expect(ajudaDaJanela(periodoDoAtalho('hoje', AGORA, TZ), AGORA, TZ)).toBeNull();
    expect(ajudaDaJanela(periodoDoAtalho('mes_passado', AGORA, TZ), AGORA, TZ)).toBeNull();
    const maio = { tipo: 'mes' as const, valor: '2026-05' };
    expect(periodoForaDaJanela(maio, AGORA, TZ)).toBe(true);
    expect(ajudaDaJanela(maio, AGORA, TZ)).toBe(AJUDA_FORA_DA_JANELA);
    // Este ano começa antes da janela: parte do período está só no servidor
    expect(ajudaDaJanela(periodoDoAtalho('este_ano', AGORA, TZ), AGORA, TZ)).toBe(AJUDA_FORA_DA_JANELA);
  });
});
