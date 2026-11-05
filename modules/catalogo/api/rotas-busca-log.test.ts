/** T-0052 (🟢7): o registro da busca (busca_log) é melhor esforço; falha nele não derruba a resposta (RF-CAT-07). */
import { criarRelogio } from '@macuxi/comum/relogio';
import type { ContextoRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { RespostaBusca } from '../contracts';
import { ROTAS_CATALOGO } from '../contracts';
import { idDemo, PRODUTOS_DEMO } from '../fixtures/base-demo';
import { criarRepositorioMemoria } from './repositorio';
import { criarRotasCatalogo } from './rotas';

const relogio = criarRelogio();
const TENANT = idDemo('tenant:A');

describe('GET /v1/catalogo/busca — registro da busca', () => {
  it('RF-CAT-07: falha ao gravar o busca_log não derruba a busca; o aviso no log não leva o termo', async () => {
    const memoria = criarRepositorioMemoria({ [TENANT]: { produtos: structuredClone([...PRODUTOS_DEMO]) } });
    const rotas = criarRotasCatalogo({
      repositorio: (ctx, db, tx) => ({
        ...memoria.fabrica(ctx, db, tx),
        async registrarBusca() {
          throw new Error('banco indisponível');
        },
      }),
    });
    const rota = rotas.find((r) => r.metodo === 'GET' && r.caminho === ROTAS_CATALOGO.busca)!;
    const logs: Array<{ nivel: string; obj: Record<string, unknown> }> = [];
    const u = { id: idDemo('usuario:vendedor'), tenant_id: TENANT, perfil: 'vendedor', modulos: ['core', 'catalogo'] };
    const ctx = {
      usuario: u,
      dependencias: {},
      requestId: 'req',
      agora: () => relogio.agora(),
      fuso: () => 'America/Manaus',
      parametros: () => ({}),
      carteira: async () => new Set<string>(),
      usuariosVisiveis: async () => new Set([u.id]),
      comTenant: async (fn: (db: unknown, tx: unknown) => Promise<unknown>) =>
        fn({ query: async () => ({ rows: [], rowCount: 0 }) }, { publicar: async () => undefined, auditar: async () => undefined, consultar: async () => [] }),
      log: {
        info: (obj: Record<string, unknown>) => logs.push({ nivel: 'info', obj }),
        warn: (obj: Record<string, unknown>) => logs.push({ nivel: 'warn', obj }),
        error: (obj: Record<string, unknown>) => logs.push({ nivel: 'error', obj }),
      },
      corpo: {},
      query: rota.query!.parse({ q: 'café', mode: 'basica' }),
      params: {},
    } as unknown as ContextoRota;
    const r = (await rota.executar(ctx as never)) as RespostaBusca;
    expect(r.items.length).toBeGreaterThan(0);
    const aviso = logs.find((l) => l.nivel === 'warn');
    expect(aviso?.obj).toEqual({ evento: 'catalogo.busca_log_falhou' });
  });
});
