/**
 * RN-CAT-06 (T-0120): consumidor de `tabela_preco_external_id` de `integracao.cliente.atualizado@1`. Banco falso em memória
 * (uma tabela por tenant); a prova com RLS real e dois tenants está em `consumidor-cliente-tabela.db.test.ts` (CI).
 */
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { criarConsumidorClienteTabelaDoErp, ReferenciaAusenteErp, type ResolverClientes } from './consumidores-erp';
import { moduloApi } from './index';

const CLIENTE = '0ca00000-0000-4000-8000-0000000000c1';
const TABELA = '0ca00000-0000-4000-8000-0000000000a1';

interface Vinculo { cliente_id: string; tabela_preco_id: string; external_id: string | null; deleted_at: string | null }

function ambiente(tabelas: Record<string, string>, vinculos: Vinculo[] = []) {
  const consultas: string[] = [];
  const db = {
    query: vi.fn(async (sql: string, v: readonly unknown[] = []) => {
      consultas.push(sql);
      if (sql.startsWith('select id from catalogo.tabela_preco')) {
        const id = tabelas[v[0] as string];
        return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
      }
      if (sql.startsWith('update catalogo.cliente_tabela_preco set tabela_preco_id')) {
        const vivos = vinculos.filter((x) => x.cliente_id === v[0] && !x.deleted_at);
        for (const x of vivos) Object.assign(x, { tabela_preco_id: v[1], external_id: v[2] });
        return { rows: vivos.map(() => ({ id: 'x' })), rowCount: vivos.length };
      }
      if (sql.startsWith('update catalogo.cliente_tabela_preco set deleted_at')) {
        for (const x of vinculos.filter((y) => y.cliente_id === v[0] && !y.deleted_at)) x.deleted_at = 'agora';
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('insert into catalogo.cliente_tabela_preco')) {
        vinculos.push({ cliente_id: v[0] as string, tabela_preco_id: v[1] as string, external_id: v[2] as string, deleted_at: null });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  const ctx = { db, log: { warn: vi.fn(), info: vi.fn() } } as unknown as ContextoConsumo;
  return { ctx, vinculos, consultas };
}
const resolver: ResolverClientes = async (_c, ids) => new Map(ids.filter((i) => i === 'C-1').map((i) => [i, CLIENTE]));
const evento = (registro: Record<string, unknown> | undefined, acao = 'atualizado') => ({ lote_id: 'L1', entidade: 'cliente', external_id: 'C-1', acao, hash: 'h', ocorrido_em: '2026-11-08T12:00:00Z', ...(registro ? { registro: { external_id: 'C-1', alterado_em: '2026-11-08T10:00:00.000Z', ativo: true, razao_social: 'Mercado Sol', ...registro } } : {}) });
const entregar = (ctx: ContextoConsumo, p: unknown) => criarConsumidorClienteTabelaDoErp(resolver).executar(p as never, ctx);

describe('RN-CAT-06: vínculo cliente x tabela do ERP (T-0120)', () => {
  it('RN-INT-04: o manifesto declara o consumo e o moduloApi registra o consumidor', () => {
    expect(manifest.consome).toContain('integracao.cliente.atualizado@1');
    expect(moduloApi.consumidores?.map((c) => c.evento.nome)).toContain('integracao.cliente.atualizado@1');
  });
  it('RN-CAT-06: tabela existente cria o vínculo e a reentrega não duplica (idempotente)', async () => {
    const { ctx, vinculos } = ambiente({ 'TAB-A': TABELA });
    await entregar(ctx, evento({ tabela_preco_external_id: 'TAB-A' }));
    await entregar(ctx, evento({ tabela_preco_external_id: 'TAB-A' }));
    expect(vinculos).toEqual([{ cliente_id: CLIENTE, tabela_preco_id: TABELA, external_id: 'C-1', deleted_at: null }]);
  });
  it('RN-CAT-06: troca de tabela atualiza a linha viva do cliente', async () => {
    const { ctx, vinculos } = ambiente({ 'TAB-B': 'outra' }, [{ cliente_id: CLIENTE, tabela_preco_id: TABELA, external_id: null, deleted_at: null }]);
    await entregar(ctx, evento({ tabela_preco_external_id: 'TAB-B' }));
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]).toMatchObject({ tabela_preco_id: 'outra', external_id: 'C-1' });
  });
  it('RN-INT-04: tabela inexistente repete na outbox (referencia_ausente) e não grava nada', async () => {
    const { ctx, vinculos } = ambiente({});
    await expect(entregar(ctx, evento({ tabela_preco_external_id: 'TAB-X' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
    expect(vinculos).toEqual([]);
  });
  it('RN-INT-04: cliente que ainda não chegou repete na outbox', async () => {
    const { ctx } = ambiente({ 'TAB-A': TABELA });
    await expect(criarConsumidorClienteTabelaDoErp(async () => new Map()).executar(evento({ tabela_preco_external_id: 'TAB-A' }) as never, ctx)).rejects.toBeInstanceOf(ReferenciaAusenteErp);
  });
  it('RN-CAT-06: null desvincula (soft delete) e cliente desconhecido na desvinculação é ignorado', async () => {
    const { ctx, vinculos } = ambiente({}, [{ cliente_id: CLIENTE, tabela_preco_id: TABELA, external_id: 'C-1', deleted_at: null }]);
    await entregar(ctx, evento({ tabela_preco_external_id: null }));
    expect(vinculos[0]!.deleted_at).not.toBeNull();
    await expect(criarConsumidorClienteTabelaDoErp(async () => new Map()).executar(evento({ tabela_preco_external_id: null }) as never, ctx)).resolves.toBeUndefined();
  });
  it('RN-CAT-06: campo ausente não consulta nem altera nada', async () => {
    const { ctx, consultas } = ambiente({ 'TAB-A': TABELA });
    await entregar(ctx, evento({}));
    expect(consultas).toEqual([]);
  });
});
