import { criarArmazenamentoEmMemoria } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { adicionarAoPedidoEmCurso, aguardarPedidoEmCurso, AVISO_ADICIONADO_AO_PEDIDO, AVISO_FALHA_AO_ADICIONAR, AVISO_VOLTE_AO_PEDIDO } from './pedido-em-curso';
import { rascunhoVazio } from './pedidos';

const arm = () =>
  criarArmazenamentoEmMemoria({
    clientes: [{ id: 'c1', trade_name: 'Mercado', price_table_id: null }],
    produtos: { default: { items: [{ id: 'p1', description: 'Parafuso', price_cents: 500 }, { id: 'p2', description: 'Porca', price_cents: null }], synced_at: 'x' } },
    rascunhos: { c1: { ...rascunhoVazio('c1'), lines: { p9: 2 } } },
  });
const linhas = async (a: ReturnType<typeof arm>) => ((await a.ler<Record<string, { lines: Record<string, number> }>>('rascunhos'))!)['c1']!.lines;

describe('RN-VEN-49: "+" do Catálogo grava no rascunho do aparelho (offline)', () => {
  it('RN-VEN-49: acha o rascunho pelo código do pedido em curso e entra com 1 unidade', async () => {
    const a = arm();
    expect(await adicionarAoPedidoEmCurso('c1', 'p1', a)).toBe(AVISO_ADICIONADO_AO_PEDIDO);
    expect(await linhas(a)).toEqual({ p9: 2, p1: 1 });
  });
  it('RN-VEN-49: toques seguidos somam, sem perder nenhum', async () => {
    const a = arm();
    await Promise.all([adicionarAoPedidoEmCurso('c1', 'p1', a), adicionarAoPedidoEmCurso('c1', 'p1', a), adicionarAoPedidoEmCurso('c1', 'p1', a)]);
    expect((await linhas(a)).p1).toBe(3);
  });
  it('RN-VEN-49: sem pedido em curso, sem rascunho ou sem armazenamento, avisa "Volte ao pedido"', async () => {
    const a = arm();
    expect(await adicionarAoPedidoEmCurso(null, 'p1', a)).toBe(AVISO_VOLTE_AO_PEDIDO);
    expect(await adicionarAoPedidoEmCurso('outro', 'p1', a)).toBe(AVISO_VOLTE_AO_PEDIDO);
    expect(await adicionarAoPedidoEmCurso('c1', 'p1', null)).toBe(AVISO_VOLTE_AO_PEDIDO);
  });
  it('RN-VEN-49 / RN-CAT-06: produto sem preço para o cliente não entra e o aviso diz o motivo', async () => {
    const a = arm();
    expect(await adicionarAoPedidoEmCurso('c1', 'p2', a)).toBe('Porca está sem preço na tabela do cliente e não entrou.');
    expect(await linhas(a)).toEqual({ p9: 2 });
  });
  it('RN-VEN-49: falha ao gravar no aparelho devolve aviso curto, sem rejeitar', async () => {
    const a = arm();
    const quebrado = { ...a, gravar: async () => { throw new Error('disco cheio'); } } as unknown as typeof a;
    expect(await adicionarAoPedidoEmCurso('c1', 'p1', quebrado)).toBe(AVISO_FALHA_AO_ADICIONAR);
  });
  it('R-20261123-201347: "+" pendente e releitura: aguardar a fila deixa o item presente', async () => {
    const a = arm();
    void adicionarAoPedidoEmCurso('c1', 'p1', a);
    await aguardarPedidoEmCurso();
    expect((await linhas(a)).p1).toBe(1);
  });
});
