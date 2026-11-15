/**
 * T-0180 (ADR 0059 §8) sem banco: `ctx.gravarParametros` grava só o módulo da rota, no tenant da transação, idempotente e
 * auditado (RN-AUD-01); dentro do `comTenant` usa a MESMA transação (desfaz junto); o `ctx.parametros()` seguinte já enxerga o
 * valor novo; chave de outro módulo e rota da plataforma são recusadas. O banco falso guarda `plataforma.parametro` por tenant
 * (RLS) e desfaz a transação que falha. A prova com o Postgres fica em `gravar-parametros.banco.test.ts`.
 */
import { definirModuloApi, ErroRegraNegocio, type ClienteBanco, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import type { LicencasUsuario } from '../src/licencas';
import { gravarParametrosDoModulo } from '../src/parametros-modulo';
import { LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, usuarios } from './apoio';

const TENANT_B = '0a000000-0000-4000-8000-0000000000b2';
const VENDEDOR_B: UsuarioAutenticado = { id: '0b000000-0000-4000-8000-0000000000b1', tenant_id: TENANT_B, perfil: 'vendedor' };

interface Linha {
  tenant_id: string;
  modulo: string;
  chave: string;
  valor: unknown;
}

/** `plataforma.parametro` e `plataforma.auditoria` em memória, com o tenant da transação (RLS) e rollback em erro. */
function bancoDeParametros() {
  let tabela: Linha[] = [];
  const auditoria: { tenant: string; params: readonly unknown[] }[] = [];
  let transacoes = 0;
  const cliente = (tenant: string): ClienteBanco => ({
    query: async <R>(sql: string, v: readonly unknown[] = []) => {
      const nada = { rows: [] as R[], rowCount: 0 };
      if (/^\s*select chave, valor from plataforma\.parametro/.test(sql)) {
        const [modulo, chaves] = v as [string, string[]];
        const rows = tabela.filter((l) => l.tenant_id === tenant && l.modulo === modulo && chaves.includes(l.chave));
        return { rows: rows.map((l) => ({ chave: l.chave, valor: l.valor })) as R[], rowCount: rows.length };
      }
      if (/^\s*insert into plataforma\.parametro/.test(sql)) {
        const [modulo, chave, json] = v as [string, string, string];
        const valor = JSON.parse(json) as unknown;
        const l = tabela.find((x) => x.tenant_id === tenant && x.modulo === modulo && x.chave === chave);
        if (l && JSON.stringify(l.valor) === json) return nada;
        if (l) l.valor = valor;
        else tabela.push({ tenant_id: tenant, modulo, chave, valor });
        return { rows: [{ chave }] as R[], rowCount: 1 };
      }
      if (/insert into plataforma\.auditoria/.test(sql)) auditoria.push({ tenant, params: v });
      return nada;
    },
  });
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (t, fn) => {
      transacoes++;
      const antes = tabela.map((l) => ({ ...l }));
      const auditadas = auditoria.length;
      try {
        return await fn(cliente(t));
      } catch (e) {
        tabela = antes;
        auditoria.length = auditadas;
        throw e;
      }
    },
    semTenant: async (fn) => fn(cliente('')),
    horizonteSync: async () => new Date(Date.now() - 2_000),
    instanteSync: async () => new Date(),
  };
  const params = (t: string, m: ModuloId) => Object.fromEntries(tabela.filter((l) => l.tenant_id === t && l.modulo === m).map((l) => [l.chave, l.valor]));
  return { banco, tabela: () => tabela, auditoria, params, transacoes: () => transacoes };
}

const Corpo = z.object({ valores: z.record(z.unknown()), dentro: z.boolean().default(false), falhar: z.boolean().default(false), acao: z.string().optional() });

/** Rota de teste do Vendedor (manifesto real; ação `pedido.criar` do vendedor). Devolve o `ctx.parametros()` depois de gravar. */
const vendedorComParametros = definirModuloApi({
  manifesto: vendedor,
  rotas: [
    {
      metodo: 'PUT',
      caminho: 'parametros-teste',
      acao: 'pedido.criar',
      carteira: 'nao_se_aplica',
      corpo: Corpo,
      executar: async (ctx) => {
        const c = ctx.corpo as z.output<typeof Corpo>;
        const opcoes = c.acao ? { acao: c.acao } : undefined;
        if (!c.dentro) {
          await ctx.gravarParametros!(c.valores, opcoes);
          return { parametros: ctx.parametros() };
        }
        return ctx.comTenant(async () => {
          await ctx.gravarParametros!(c.valores, opcoes);
          const visto = ctx.parametros();
          if (c.falhar) throw new ErroRegraNegocio('RN-TESTE-01', 'Falha depois de gravar.');
          return { parametros: visto };
        });
      },
    },
  ],
});

function montar() {
  const b = bancoDeParametros();
  const app = createApp(
    opcoesDeTeste(LICENCAS_PADRAO, {
      banco: b.banco,
      modulos: modulosDeTeste({ vendedor: vendedorComParametros }),
      autenticar: async (h) => (h['x-teste-usuario'] === 'vendedorB' ? VENDEDOR_B : (usuarios[h['x-teste-usuario'] ?? ''] ?? null)),
      // as licenças leem os parâmetros do "banco": a requisição seguinte vê o que a anterior gravou
      licencas: async (u): Promise<LicencasUsuario> => ({
        ativosNoTenant: LICENCAS_PADRAO.tenant,
        doPerfil: LICENCAS_PADRAO.perfil[u.perfil] ?? ['core'],
        removidosDoUsuario: [],
        parametros: { core: b.params(u.tenant_id, 'core'), vendedor: b.params(u.tenant_id, 'vendedor') },
      }),
    }),
  );
  const put = (quem: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/v1/vendedor/parametros-teste', headers: { 'x-teste-usuario': quem }, payload: corpo });
  return { app, b, put };
}

describe('ctx.gravarParametros (T-0180, ADR 0059 §8)', () => {
  it('grava no módulo da rota e no tenant do token; ctx.parametros() da mesma requisição já vê o valor novo', async () => {
    const { app, b, put } = montar();
    const r = await put('vendedor', { valores: { alcada_pct: 7, faixas: [1, 2] } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ parametros: { alcada_pct: 7, faixas: [1, 2] } });
    expect(b.tabela()).toEqual([
      { tenant_id: TENANT, modulo: 'vendedor', chave: 'alcada_pct', valor: 7 },
      { tenant_id: TENANT, modulo: 'vendedor', chave: 'faixas', valor: [1, 2] },
    ]);
    await app.close();
  });

  it('idempotente: repetir o mesmo valor não grava nem audita; mudar uma chave audita só ela (RN-AUD-01)', async () => {
    const { app, b, put } = montar();
    await put('vendedor', { valores: { alcada_pct: 7, faixas: [1, 2] } });
    expect(b.auditoria).toHaveLength(1);
    const [, usuarioId, modulo, acao, entidade, entidadeId, antes, depois] = b.auditoria[0]!.params;
    expect({ usuarioId, modulo, acao, entidade, entidadeId }).toEqual({ usuarioId: usuarios.vendedor!.id, modulo: 'vendedor', acao: 'parametro.gravar', entidade: 'parametro', entidadeId: null });
    expect(JSON.parse(antes as string)).toEqual({ alcada_pct: null, faixas: null });
    expect(JSON.parse(depois as string)).toEqual({ alcada_pct: 7, faixas: [1, 2] });

    const igual = await put('vendedor', { valores: { alcada_pct: 7, faixas: [1, 2] } });
    expect(igual.statusCode).toBe(200);
    expect(b.auditoria).toHaveLength(1);

    const outra = await put('vendedor', { valores: { alcada_pct: 9, faixas: [1, 2] }, acao: 'alcada.gerenciar' });
    expect(outra.json()).toEqual({ parametros: { alcada_pct: 9, faixas: [1, 2] } });
    expect(b.auditoria).toHaveLength(2);
    const p = b.auditoria[1]!.params;
    expect(p[3]).toBe('alcada.gerenciar');
    expect(JSON.parse(p[6] as string)).toEqual({ alcada_pct: 7 });
    expect(JSON.parse(p[7] as string)).toEqual({ alcada_pct: 9 });
    await app.close();
  });

  it('isolamento por tenant: o que o tenant A grava não aparece no B, e cada um audita no próprio', async () => {
    const { app, b, put } = montar();
    await put('vendedor', { valores: { alcada_pct: 7 } });
    const rb = await put('vendedorB', { valores: { alcada_pct: 3 } });
    expect(rb.json()).toEqual({ parametros: { alcada_pct: 3 } });
    expect(b.params(TENANT, 'vendedor')).toEqual({ alcada_pct: 7 });
    expect(b.params(TENANT_B, 'vendedor')).toEqual({ alcada_pct: 3 });
    expect(b.auditoria.map((a) => [a.tenant, a.params[0]])).toEqual([
      [TENANT, TENANT],
      [TENANT_B, TENANT_B],
    ]);
    await app.close();
  });

  it('dentro do comTenant: mesma transação (uma só) e desfaz junto quando a rota falha depois de gravar', async () => {
    const { app, b, put } = montar();
    const ok = await put('vendedor', { valores: { alcada_pct: 5 }, dentro: true });
    expect(ok.json()).toEqual({ parametros: { alcada_pct: 5 } });
    expect(b.transacoes()).toBe(1);

    const falha = await put('vendedor', { valores: { alcada_pct: 6 }, dentro: true, falhar: true });
    expect(falha.statusCode).toBe(422);
    expect(b.params(TENANT, 'vendedor')).toEqual({ alcada_pct: 5 });
    expect(b.auditoria).toHaveLength(1);
    await app.close();
  });

  it('recusa chave de outro módulo (ex.: core.*) sem tocar no banco; o Core continua com os próprios valores', async () => {
    const { app, b, put } = montar();
    const r = await put('vendedor', { valores: { 'core.checkin.raio_m': 10, alcada_pct: 1 } });
    expect(r.statusCode).toBe(500);
    expect(b.tabela()).toEqual([]);
    expect(b.transacoes()).toBe(0);
    for (const ruim of [{ 'Chave-Ruim': 1 }, { x: undefined }, {}]) expect((await put('vendedor', { valores: ruim })).statusCode).toBe(500);
    expect(b.tabela()).toEqual([]);
    await app.close();
  });

  it('rota da plataforma (sem módulo) não grava parâmetro de módulo', async () => {
    const db: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) };
    await expect(gravarParametrosDoModulo(db, null, { a: 1 }, async () => undefined)).rejects.toThrow(/rota da plataforma/);
  });
});
