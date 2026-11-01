/**
 * T-0029 §11 E1 (ADR 0012), E3 e E4 no SDK, sem banco: consultas entre módulos (manifesto, montagem na API e no shell,
 * execução no aparelho), parâmetros do tenant guardados no aparelho e extensões por app.
 * A execução na API (mesma transação, RLS do tenant) é provada com Postgres em `apps/api/test/consultas.banco.test.ts`.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ambienteIndisponivel } from './ambiente';
import { consultasSemImplementacao, definirModuloApi, implementarConsulta } from './api';
import {
  CODIGO_CONSULTA_INDISPONIVEL,
  completarAmbiente,
  ConsultaIndisponivel,
  definirConsulta,
  ehConsultaIndisponivel,
  implementarConsultaAparelho,
  type ContextoConsultaAparelho,
} from './consultas';
import { defineModule, validarConjunto, type ManifestoEntrada } from './manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync } from './motor-sync';
import { criarShell, definirModuloShell } from './shell';
import { definirEntidadeSync, type LinhaSync } from './sync';

/** Contrato de exemplo no formato do `catalogo.precos_cliente@1` (desenho §3.5). */
const PRECOS = definirConsulta({
  nome: 'catalogo.precos_cliente@1',
  entrada: z.object({ cliente_id: z.string(), produto_ids: z.array(z.string()).max(500) }),
  saida: z.object({ itens: z.array(z.object({ produto_id: z.string(), preco_cents: z.number().int().nullable() })) }),
});
const CADASTRO = definirConsulta({
  nome: 'core.cadastro_resumo@1',
  entrada: z.object({ cliente_ids: z.array(z.string()).max(500) }),
  saida: z.object({ clientes: z.array(z.object({ id: z.string() })) }),
});

const mCore = (extra: Partial<ManifestoEntrada> = {}) =>
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'supervisor'], apps: { campo: { abas: [] }, gestao: { abas: [] } }, ofereceExtensoes: ['cliente.acoes'], ...extra });
const mCatalogo = (extra: Partial<ManifestoEntrada> = {}) =>
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor', 'supervisor'], apps: { campo: { abas: [] } }, sync: ['tabela_preco_item'], ofereceConsultas: ['catalogo.precos_cliente@1'], ...extra });
const mVendedor = (extra: Partial<ManifestoEntrada> = {}) =>
  defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core', 'catalogo'],
    perfis: ['vendedor', 'supervisor'],
    apps: { campo: { abas: ['Pedidos'] }, gestao: { abas: ['Pedidos'] } },
    sync: ['pedido'],
    usaConsultas: ['catalogo.precos_cliente@1'],
    acoes: { 'pedido.criar': { perfis: ['vendedor', 'supervisor'] } },
    usaExtensoes: ['cliente.acoes'],
    ...extra,
  });

describe('E1 — contrato e manifesto (ADR 0012)', () => {
  it('definirConsulta exige <modulo>.<consulta>@vN e guarda dono e versão', () => {
    expect(PRECOS).toMatchObject({ nome: 'catalogo.precos_cliente@1', modulo: 'catalogo', versao: 1 });
    expect(() => definirConsulta({ nome: 'precos_cliente', entrada: z.object({}), saida: z.object({}) })).toThrow('Nome de consulta inválido');
    expect(() => definirConsulta({ nome: 'catalogo.precos.cliente@1', entrada: z.object({}), saida: z.object({}) })).toThrow();
  });

  it('manifesto: só oferece consultas próprias; só usa de módulo em depende/opcionais; nome no padrão', () => {
    expect(() => mCatalogo({ ofereceConsultas: ['core.cadastro_resumo@1'] })).toThrow('só oferece consultas catalogo.*');
    expect(() => mVendedor({ depende: ['core'], usaConsultas: ['catalogo.precos_cliente@1'] })).toThrow('precisa estar em depende ou opcionais');
    expect(() => mVendedor({ usaConsultas: ['vendedor.alcadas@1'] })).toThrow('é do próprio módulo');
    expect(() => mVendedor({ usaConsultas: ['catalogo.precos_cliente'] })).toThrow('consulta no formato');
    expect(() => mVendedor({ depende: ['core'], opcionais: ['catalogo'] })).not.toThrow();
  });

  it('conjunto: consulta usada precisa ser oferecida pelo dono instalado; dono opcional ausente não é erro de montagem', () => {
    expect(validarConjunto([mCore(), mCatalogo(), mVendedor()])).toEqual([]);
    expect(validarConjunto([mCore(), mCatalogo({ ofereceConsultas: [] }), mVendedor()])).toEqual([
      'vendedor usa a consulta catalogo.precos_cliente@1, que catalogo não oferece',
    ]);
    const opcional = mVendedor({ depende: ['core'], opcionais: ['catalogo'] });
    expect(validarConjunto([mCore(), opcional])).toEqual([]);
  });
});

describe('E1 — montagem na API (definirModuloApi)', () => {
  const impl = implementarConsulta(PRECOS, async (e) => ({ itens: e.produto_ids.map((id) => ({ produto_id: id, preco_cents: 100 })) }));

  it('aceita a implementação da consulta oferecida', () => {
    expect(() => definirModuloApi({ manifesto: mCatalogo(), consultas: [impl] })).not.toThrow();
  });

  it('consulta oferecida sem implementação: a fixture monta, e consultasSemImplementacao aponta (a API real não sobe)', () => {
    const fixture = definirModuloApi({ manifesto: mCatalogo() });
    expect(consultasSemImplementacao([fixture])).toEqual(['catalogo: consulta catalogo.precos_cliente@1 oferecida no manifesto sem implementação em "consultas"']);
    expect(consultasSemImplementacao([definirModuloApi({ manifesto: mCatalogo(), consultas: [impl] })])).toEqual([]);
  });

  it('recusa implementação não declarada, de outro módulo ou repetida', () => {
    expect(() => definirModuloApi({ manifesto: mCatalogo({ ofereceConsultas: [] }), consultas: [impl] })).toThrow('não está em "ofereceConsultas"');
    expect(() => definirModuloApi({ manifesto: mCore({ ofereceConsultas: ['core.cadastro_resumo@1'] }), consultas: [impl, implementarConsulta(CADASTRO, async () => ({ clientes: [] }))] })).toThrow(
      'é de catalogo, implementada por core',
    );
    expect(() => definirModuloApi({ manifesto: mCatalogo(), consultas: [impl, impl] })).toThrow('implementação repetida');
  });
});

describe('E1 — aparelho (criarShell + motor: ambiente.consultar)', () => {
  const ITEM = definirEntidadeSync({ nome: 'tabela_preco_item', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });
  const PEDIDO = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'servidor_vence', schema: z.object({}) });
  type ExecPrecos = (e: z.output<typeof PRECOS.entrada>, ctx: ContextoConsultaAparelho) => Promise<z.input<typeof PRECOS.saida>>;
  const catalogoComConsulta = (executar?: ExecPrecos) =>
    definirModuloShell({
      manifesto: mCatalogo(),
      entidadesSync: [ITEM],
      consultas: [
        implementarConsultaAparelho(
          PRECOS,
          executar ??
            (async (e, ctx) => {
              const linhas = await ctx.linhasPorIds<LinhaSync & { preco_cents: number }>('tabela_preco_item', e.produto_ids);
              const porId = new Map(linhas.map((l) => [l.id, l.preco_cents]));
              const desconto = Number(ctx.parametros().desconto_teste ?? 0);
              return { itens: e.produto_ids.map((id) => ({ produto_id: id, preco_cents: porId.has(id) ? porId.get(id)! - desconto : null })) };
            }),
        ),
      ],
    });
  const vendedorShell = definirModuloShell({ manifesto: mVendedor(), entidadesSync: [PEDIDO] });

  async function motorCom(catalogo = catalogoComConsulta()) {
    const shell = criarShell('campo', [definirModuloShell({ manifesto: mCore() }), catalogo, vendedorShell]);
    const armazenamento = criarArmazenamentoEmMemoria({
      'ent:tabela_preco_item': { p1: { id: 'p1', updated_at: '2026-11-01T00:00:00Z', preco_cents: 990 } },
    });
    const motor = criarMotorSync({
      registro: shell.registroSync,
      armazenamento,
      transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
      consultas: shell.consultas,
    });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor'], { catalogo: { desconto_teste: 10 } });
    return { shell, motor, armazenamento };
  }

  it('o dono responde sobre as próprias linhas locais, com os parâmetros dele, e a saída passa pelo contrato', async () => {
    const { motor } = await motorCom();
    await expect(motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: ['p1', 'p2'] })).resolves.toEqual({
      itens: [
        { produto_id: 'p1', preco_cents: 980 },
        { produto_id: 'p2', preco_cents: null },
      ],
    });
  });

  it('entrada fora do contrato = erro de quem consulta; saída fora = erro do dono', async () => {
    const { motor } = await motorCom();
    await expect(motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: Array.from({ length: 501 }, (_, i) => `p${i}`) })).rejects.toThrow(
      'entrada inválida (erro de quem consulta)',
    );
    const ruim = await motorCom(catalogoComConsulta(async () => ({ itens: [{ produto_id: 'p1', preco_cents: 1.5 }] })));
    await expect(ruim.motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: ['p1'] })).rejects.toThrow('saída inválida (erro do módulo catalogo)');
  });

  it('o dono só lê entidades do próprio módulo', async () => {
    const { motor } = await motorCom(
      catalogoComConsulta(async (_e, ctx) => {
        await ctx.linhas('pedido');
        return { itens: [] };
      }),
    );
    await expect(motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: [] })).rejects.toThrow('só lê entidades de catalogo');
  });

  it('dono inativo ou sem implementação no aparelho → ConsultaIndisponivel (503 CONSULTA_INDISPONIVEL)', async () => {
    const { motor } = await motorCom();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    const e = await motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: ['p1'] }).catch((x: unknown) => x);
    expect(ehConsultaIndisponivel(e)).toBe(true);
    expect(e).toMatchObject({ status: 503, codigo: CODIGO_CONSULTA_INDISPONIVEL, detalhes: { consulta: 'catalogo.precos_cliente@1', modulo: 'catalogo' } });
    const semImpl = await motorCom(definirModuloShell({ manifesto: mCatalogo(), entidadesSync: [ITEM] }));
    await expect(semImpl.motor.ambiente.consultar(PRECOS, { cliente_id: 'c1', produto_ids: [] })).rejects.toBeInstanceOf(ConsultaIndisponivel);
    // ambiente sem motor (BKO): sempre indisponível
    await expect(completarAmbiente(ambienteIndisponivel()).consultar(PRECOS, { cliente_id: 'c1', produto_ids: [] })).rejects.toBeInstanceOf(ConsultaIndisponivel);
  });

  it('consulta que nenhum módulo instalado declara em usaConsultas = erro de programação', async () => {
    const { motor } = await motorCom();
    await expect(motor.ambiente.consultar(CADASTRO, { cliente_ids: [] })).rejects.toThrow('nenhum módulo instalado a declara em usaConsultas');
  });

  it('criarShell recusa implementação não oferecida e consulta usada que o dono instalado não oferece', () => {
    const naoOferecida = definirModuloShell({ manifesto: mCatalogo({ ofereceConsultas: [] }), entidadesSync: [ITEM], consultas: [implementarConsultaAparelho(PRECOS, async () => ({ itens: [] }))] });
    const erro = (() => {
      try {
        criarShell('campo', [definirModuloShell({ manifesto: mCore() }), naoOferecida, vendedorShell]);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(erro).toContain('catalogo: consulta catalogo.precos_cliente@1 não está em ofereceConsultas do manifesto');
    expect(erro).toContain('vendedor usa a consulta catalogo.precos_cliente@1, que catalogo não oferece');
  });
});

describe('E3 — parâmetros do tenant no aparelho (valem offline; somem com o módulo)', () => {
  const registro = criarShell('campo', [definirModuloShell({ manifesto: mCore() })]).registroSync;
  const transporte = { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) };
  const ALCADAS = { 'alcada.vendedor_pct': 5, 'alcada.supervisor_pct': 10 };

  it('guarda os parâmetros da última sessão: o app sem rede, reaberto, lê as alçadas', async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const m1 = criarMotorSync({ registro, armazenamento, transporte });
    await m1.carregar();
    await m1.aplicarModulosAtivos(['core', 'catalogo', 'vendedor'], { vendedor: ALCADAS, core: { raio_checkin_m: 150 } });
    expect(m1.ambiente.parametros('vendedor')).toEqual(ALCADAS);

    // reabre sem rede (nenhum GET /v1/me/modulos): vale o guardado
    const m2 = criarMotorSync({ registro, armazenamento, transporte, online: () => false });
    await m2.carregar();
    expect(m2.ambiente.parametros('vendedor')).toEqual(ALCADAS);
    expect(m2.parametros('core')).toEqual({ raio_checkin_m: 150 });
    expect(m2.parametros('pesquisa')).toEqual({});
    expect(Object.isFrozen(m2.parametros('vendedor'))).toBe(true);
  });

  it('sem parâmetros novos mantém os guardados; RN-CORE-02: módulo que sai leva os parâmetros junto', async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const m = criarMotorSync({ registro, armazenamento, transporte });
    await m.carregar();
    await m.aplicarModulosAtivos(['core', 'vendedor'], { vendedor: ALCADAS });
    await m.aplicarModulosAtivos(['core', 'vendedor']);
    expect(m.parametros('vendedor')).toEqual(ALCADAS);
    await m.aplicarModulosAtivos(['core']);
    expect(m.parametros('vendedor')).toEqual({});
    expect(armazenamento.conteudo()['sync:parametros']).toEqual({});
    await m.aplicarModulosAtivos(['core', 'vendedor']);
    expect(m.parametros('vendedor')).toEqual({});
  });

  it('as etapas de sync recebem consultar e parametros no ctx', async () => {
    let visto: unknown = null;
    const m = criarMotorSync({
      registro,
      armazenamento: criarArmazenamentoEmMemoria(),
      transporte,
      etapas: [{ id: 'x', rotulo: 'x', modulo: 'core', executar: async (ctx) => void (visto = ctx.parametros('core')) }],
    });
    await m.carregar();
    await m.aplicarModulosAtivos(['core'], { core: { raio_checkin_m: 80 } });
    await m.sincronizar();
    expect(visto).toEqual({ raio_checkin_m: 80 });
  });
});

describe('E4 — item de extensão com apps (T-0029 §7)', () => {
  const vendedor = definirModuloShell({
    manifesto: mVendedor({ usaConsultas: [], depende: ['core'] }),
    extensoes: [
      { slot: 'cliente.acoes', id: 'novo-pedido', acao: 'pedido.criar', apps: ['campo'], payload: { rotulo: 'Novo pedido' } },
      { slot: 'cliente.acoes', id: 'ver-pedidos', payload: { rotulo: 'Pedidos do cliente' } },
    ],
  });
  const modulos = [definirModuloShell({ manifesto: mCore() }), vendedor];
  const ctx = (perfil: 'vendedor' | 'supervisor') => ({ perfil, modulosAtivos: ['core', 'vendedor'] as const });

  it('item apps: [campo] aparece no Campo e some no Gestão (mesmo com a ação permitida)', () => {
    expect(criarShell('campo', modulos).montar(ctx('vendedor')).extensoes('cliente.acoes').map((i) => i.id)).toEqual(['novo-pedido', 'ver-pedidos']);
    const gestao = criarShell('gestao', modulos).montar(ctx('supervisor'));
    expect(gestao.pode('pedido.criar')).toBe(true);
    expect(gestao.extensoes('cliente.acoes').map((i) => i.id)).toEqual(['ver-pedidos']);
  });
});
