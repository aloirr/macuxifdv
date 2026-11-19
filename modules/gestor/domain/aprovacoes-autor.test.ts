import { describe, expect, it } from 'vitest';
import type { MembroEquipe } from '../contracts';
import { autorDoPedido, decisorEhAutor, filaDeAprovacoes, verificarDecisor } from './aprovacoes';
import { escopoDoUsuario } from './equipe';
import { CLIENTE_A, ev, pedidoCriado, u } from './fixtures';
import { aplicarEventos, estadoInicial, type EstadoProjecao, type EventoRecebido } from './projecao';

const GER = u(1), SUP = u(2), V1 = u(11);
const m = (id: string, perfil: MembroEquipe['perfil'], superior_id: string | null): MembroEquipe => ({ id, nome: perfil, perfil, superior_id, ativo: true });
const ROSTER = [m(GER, 'gerente', null), m(SUP, 'supervisor', GER), m(V1, 'vendedor', SUP)];
const AGORA = '2026-10-30T20:00:00Z';
const PEDIDO = u(1001);
const solicita = (): EventoRecebido =>
  ev('vendedor.pedido.aprovacao_solicitada@1', '2026-10-30T14:00:00Z', {
    pedido_id: PEDIDO, vendedor_id: V1, cliente_id: CLIENTE_A, solicitada_em: '2026-10-30T14:00:00Z', nivel: 'supervisor', motivos: ['desconto'],
    desconto_efetivo_pct: 12, total_cents: 500_000, credito: null, historico: null,
  });
const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const fila = (s: EstadoProjecao, viewer: { id: string; perfil: MembroEquipe['perfil'] }) =>
  filaDeAprovacoes({ estado: s, viewer, escopo: escopoDoUsuario(viewer, ROSTER), agora: AGORA, modulos: new Set(['core', 'vendedor']) });
const comAutorNaSolicitacao = (s: EstadoProjecao, autor: string | null): EstadoProjecao => {
  const linha = s.aprovacoes[PEDIDO]!;
  return { ...s, aprovacoes: { ...s.aprovacoes, [PEDIDO]: { ...linha, solicitacao: { ...linha.solicitacao!, autor_id: autor } as never } } };
};

describe('RN-VEN-10 / RN-GES-04 (T-0187, P4 A): quem decide nunca é o autor do pedido', () => {
  it('RN-VEN-10: o autor vem do pedido criado (autor_id) e, na falta dele, do autor_id opcional da solicitação @2', () => {
    const base = montar([solicita()]);
    expect(autorDoPedido(base, PEDIDO)).toBeNull();
    expect(autorDoPedido(montar([solicita(), pedidoCriado({ pedido: PEDIDO, vendedor: V1, autor: SUP, total: 1 })]), PEDIDO)).toBe(SUP);
    expect(autorDoPedido(comAutorNaSolicitacao(base, SUP), PEDIDO)).toBe(SUP);
  });

  it('RN-GES-04: o supervisor autor do pedido em nome não vê o item na própria fila; o gerente vê', () => {
    const s = montar([solicita(), pedidoCriado({ pedido: PEDIDO, vendedor: V1, autor: SUP, total: 500_000 })]);
    expect(fila(s, { id: SUP, perfil: 'supervisor' })).toHaveLength(0);
    const g = fila(s, { id: GER, perfil: 'gerente' });
    expect(g).toHaveLength(1);
    expect(g[0]!.pode_decidir).toBe(true);
  });

  it('RN-VEN-10: o mesmo vale quando o autor chega só pelo @2 (sem pedido criado)', () => {
    const s = comAutorNaSolicitacao(montar([solicita()]), SUP);
    expect(fila(s, { id: SUP, perfil: 'supervisor' })).toHaveLength(0);
    expect(fila(s, { id: GER, perfil: 'gerente' })).toHaveLength(1);
  });

  it('RN-GES-04: pedido do próprio vendedor (autor = vendedor) segue na fila do supervisor; sem autor conhecido, comportamento de hoje', () => {
    const proprio = montar([solicita(), pedidoCriado({ pedido: PEDIDO, vendedor: V1, total: 500_000 })]);
    expect(fila(proprio, { id: SUP, perfil: 'supervisor' })).toHaveLength(1);
    expect(fila(montar([solicita()]), { id: SUP, perfil: 'supervisor' })).toHaveLength(1);
  });

  it('RN-GES-07: analista e admin leem a fila inteira, inclusive o pedido em nome do supervisor', () => {
    const s = montar([solicita(), pedidoCriado({ pedido: PEDIDO, vendedor: V1, autor: SUP, total: 500_000 })]);
    const r = fila(s, { id: u(50), perfil: 'analista' });
    expect(r).toHaveLength(1);
    expect(r[0]!.pode_decidir).toBe(false);
  });

  it('RN-VEN-10: decisorEhAutor e verificarDecisor devolvem APROVACAO_DO_PROPRIO_PEDIDO só quando o decisor é o autor', () => {
    const s = montar([solicita(), pedidoCriado({ pedido: PEDIDO, vendedor: V1, autor: SUP, total: 1 })]);
    expect(decisorEhAutor(s, PEDIDO, SUP)).toBe(true);
    expect(decisorEhAutor(s, PEDIDO, GER)).toBe(false);
    expect(verificarDecisor(s, PEDIDO, SUP)).toEqual({ ok: false, status: 422, codigo: 'APROVACAO_DO_PROPRIO_PEDIDO', mensagem: expect.stringContaining('fez este pedido') });
    expect(verificarDecisor(s, PEDIDO, GER)).toEqual({ ok: true });
    expect(verificarDecisor(montar([solicita()]), PEDIDO, SUP)).toEqual({ ok: true });
  });
});
