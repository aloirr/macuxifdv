import { describe, expect, it } from 'vitest';
import type { ContextoEtapaSync } from '@macuxi/platform-sdk';
import { etapasVendedor } from './etapas';
import { criarRepositorio } from './lib/repositorio';

function ctx(erro: unknown, usuario: { fuso?: string } | null = null): ContextoEtapaSync {
  return {
    usuario: () => usuario,
    http: { get: async () => { throw erro; } },
    armazenamento: { ler: async () => null, gravar: async () => {}, apagar: async () => {} },
    agora: () => new Date('2026-10-31T12:00:00Z'),
  } as unknown as ContextoEtapaSync;
}

describe('etapas da Fase M do Vendedor (ADR 0009)', () => {
  it('T-0029: na API v1 (login com fuso do tenant) nenhuma rota da Fase M é chamada', async () => {
    let chamadas = 0;
    const c = { ...ctx({ status: 500 }, { fuso: 'America/Manaus' }), http: { get: async () => { chamadas++; throw new Error('não deveria chamar'); } } } as unknown as ContextoEtapaSync;
    for (const e of etapasVendedor) await expect(e.executar(c)).resolves.toBeUndefined();
    expect(chamadas).toBe(0);
  });
  it('API real sem a rota (404): as etapas são puladas sem erro', async () => {
    for (const e of etapasVendedor) await expect(e.executar(ctx({ status: 404 }))).resolves.toBeUndefined();
  });
  it('falha de rede ou 5xx continua sendo erro da sincronização', async () => {
    for (const e of etapasVendedor) await expect(e.executar(ctx({ status: 503 }))).rejects.toBeDefined();
  });
  it('501 e SYNC_NAO_IMPLEMENTADO também pulam a etapa', async () => {
    for (const e of etapasVendedor) {
      await expect(e.executar(ctx({ status: 501 }))).resolves.toBeUndefined();
      await expect(e.executar(ctx({ status: 400, code: 'SYNC_NAO_IMPLEMENTADO' }))).resolves.toBeUndefined();
    }
  });
  it('RN-CORE-15: 401, 403 e 423 DISPOSITIVO_BLOQUEADO não são engolidos', async () => {
    for (const erro of [{ status: 401 }, { status: 403, code: 'MODULO_INATIVO' }, { status: 403, code: 'PERFIL_SEM_ACESSO' }, { status: 423, code: 'DISPOSITIVO_BLOQUEADO' }])
      for (const e of etapasVendedor) await expect(e.executar(ctx(erro))).rejects.toBeDefined();
  });
});

describe('T-0079 / ADR 0021: base do servidor recriada', () => {
  const memoria = (inicial: Record<string, unknown>) => {
    const m = new Map(Object.entries(inicial));
    return {
      m,
      arm: {
        ler: async (k: string) => (m.has(k) ? m.get(k) : null),
        gravar: async (k: string, v: unknown) => void (v == null ? m.delete(k) : m.set(k, v)),
        remover: async (k: string) => void m.delete(k),
        chaves: async () => [...m.keys()],
      },
    };
  };
  const comTroca = etapasVendedor.filter((e) => e.aoTrocarGeracao);

  it('RN-CORE-23: uma etapa do Vendedor limpa a cópia do servidor; roda mesmo na API v1', () => {
    expect(comTroca).toHaveLength(1);
  });
  it('RN-CORE-23: some o pedido fantasma e ficam os rascunhos e a exibição dos itens da fila', async () => {
    const { m, arm } = memoria({
      pedidos: [{ id: 'fantasma', number: '000011' }],
      detalhes: { fantasma: { id: 'fantasma' } },
      ultimos: { c1: [{ id: 'fantasma' }] },
      rascunhos: { 'c1': { lines: [{ product_id: 'p', quantity: 2 }] } },
      exibicoes: { 'na-fila': { customer_name: 'Mercado do Zé' } },
    });
    await comTroca[0]!.aoTrocarGeracao!({ ...ctx(null), armazenamento: arm } as unknown as ContextoEtapaSync);
    expect(m.get('pedidos')).toEqual([]);
    expect(m.get('detalhes')).toEqual({});
    expect(m.get('ultimos')).toEqual({});
    expect(m.get('rascunhos')).toEqual({ c1: { lines: [{ product_id: 'p', quantity: 2 }] } });
    expect(m.get('exibicoes')).toEqual({ 'na-fila': { customer_name: 'Mercado do Zé' } });
    expect(m.get('podar_exibicoes')).toBe(true);
  });
  it('RN-CORE-23: exibição órfã (de pedido que não está na fila) sai; a do item da fila fica', async () => {
    const { m, arm } = memoria({
      exibicoes: { 'na-fila': { customer_name: 'Mercado do Zé' }, orfa: { customer_name: 'Pedido da base antiga' } },
    });
    await comTroca[0]!.aoTrocarGeracao!({ ...ctx(null), armazenamento: arm } as unknown as ContextoEtapaSync);
    const repo = criarRepositorio(arm as never);
    const fila = [{ id: 'na-fila', entidade: 'pedido', situacao: 'pendente' as const }];
    expect(await repo.podarExibicoesOrfas(fila)).toBe(true);
    expect(m.get('exibicoes')).toEqual({ 'na-fila': { customer_name: 'Mercado do Zé' } });
    expect(m.has('podar_exibicoes')).toBe(false);
    expect(await repo.podarExibicoesOrfas([])).toBe(false); // sem troca de geração nada é podado
  });
});
