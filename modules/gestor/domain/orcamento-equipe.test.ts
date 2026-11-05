import { describe, expect, it } from 'vitest';
import type { MembroEquipe } from '../contracts';
import { filaDeAprovacoes } from './aprovacoes';
import { escopoDoUsuario } from './equipe';
import { ev, pedidoCriado, statusAlterado, u } from './fixtures';
import { montarPainelDia, vendasDoPeriodo } from './painel';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';
import { rankingDaEquipe } from './ranking';

// T-0071 (RN-VEN-18, RN-VEN-32, RN-CORE-21): o orçamento da equipe não é venda, não entra na fila "Para aprovar" nem no ranking/ficha.
// A LISTA de orçamentos da equipe (aba Pedidos, filtro Orçamentos) é do Vendedor; o Gestor só garante que o orçamento não vira número.
const SUP = u(2), GER = u(1), V = u(11);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null): MembroEquipe => ({ id, nome, perfil, superior_id, ativo: true });
const ROSTER = [m(GER, 'G', 'gerente', null), m(SUP, 'S', 'supervisor', GER), m(V, 'V', 'vendedor', SUP)];
const AGORA = '2026-10-30T20:00:00Z';
const MODULOS = new Set(['core', 'vendedor']);

const orcamento = (n: number, total: number): EventoRecebido =>
  ev('vendedor.pedido.criado@1', '2026-10-30T14:00:00Z', { ...(pedidoCriado({ pedido: u(2000 + n), vendedor: V, total }).payload as Record<string, unknown>), tipo: 'orcamento' });
const pedido = aplicarEventos(estadoInicial(), [
  pedidoCriado({ pedido: u(1001), vendedor: V, total: 10_000 }),
  statusAlterado({ pedido: u(1001), vendedor: V, para: 'aprovado', em: '2026-10-30T15:00:00Z' }),
]).estado;
const comOrcamento = aplicarEventos(pedido, [orcamento(1, 90_000), orcamento(2, 70_000)]).estado;

describe('T-0071 / RN-VEN-32: orçamento da equipe não é venda no Gestor', () => {
  it('RN-VEN-32: a ficha do vendedor (vendas do período) ignora orçamento', () => {
    expect(vendasDoPeriodo(comOrcamento, V, '2026-10-01', '2026-10-30')).toEqual(vendasDoPeriodo(pedido, V, '2026-10-01', '2026-10-30'));
    expect(vendasDoPeriodo(comOrcamento, V, '2026-10-01', '2026-10-30')).toMatchObject({ vendas_cents: 10_000, pedidos: 1 });
  });

  it('RN-VEN-32: o painel do dia (vendido e a faturar) ignora orçamento', () => {
    const linha = montarPainelDia(comOrcamento, { id: V, perfil: 'vendedor' }, '2026-10-30', { modulos: MODULOS, agora: AGORA });
    expect(linha.faturamento?.vendido_cents).toBe(10_000);
    expect(linha.vendas?.pedidos).toBe(1);
  });

  it('RN-VEN-32: o ranking de vendas e de pedidos ignora orçamento', () => {
    for (const indicador of ['vendas_cents', 'pedidos'] as const) {
      const r = rankingDaEquipe({ estado: comOrcamento, membros: ROSTER, modulos: MODULOS, data_ref: '2026-10-30', agora: AGORA, viewer: { id: SUP, perfil: 'supervisor' }, indicador, periodo: 'diario' });
      expect(r.linhas.find((l) => l.usuario_id === V)?.valor).toBe(indicador === 'vendas_cents' ? 10_000 : 1);
    }
  });

  it('RN-VEN-18: orçamento não vai à alçada, então a fila "Para aprovar" fica vazia para supervisor e gerente', () => {
    for (const viewer of [{ id: SUP, perfil: 'supervisor' as const }, { id: GER, perfil: 'gerente' as const }]) {
      expect(filaDeAprovacoes({ estado: comOrcamento, viewer, escopo: escopoDoUsuario(viewer, ROSTER), agora: AGORA, modulos: MODULOS })).toEqual([]);
    }
  });
});
