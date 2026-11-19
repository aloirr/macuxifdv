/**
 * Rotas do Gestor sem banco (T-0055): contexto falso da plataforma (usuário do token, usuários visíveis, transação com
 * `consultar`/`auditar`) e repositório em memória. A licença e o perfil são da plataforma (`verificarAcesso`/`verificarAcao`,
 * os mesmos do `createApp`); o escopo (RN-CORE-04) e o isolamento por tenant são provados chamando `executar`.
 * Uma só linha do tempo: o relógio do teste (`criarRelogio`), injetado em `ctx.agora` e no consumidor.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO } from '@macuxi/core/contracts';
import { criarRelogio } from '@macuxi/comum/relogio';
import {
  criarPermissoes,
  promotorBarradoNaRota,
  verificarAcao,
  verificarAcesso,
  type ContextoConsumo,
  type ContextoRota,
  type ModuloId,
  type PerfilDaRequisicao,
  type Perfil,
  type RegistroAuditoria,
  type RotaModulo,
} from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { ACAO_VER_TRAJETO, FichaMembro, FilaAprovacao, ListaAlertas, RankingEquipe, RegraAlerta, TrajetoEquipe, VisaoEquipe } from '../contracts';
import { CLIENTE_A, checkin, GERENTE, pedidoCriado, PROMOTOR, statusAlterado, SUPERVISOR, u, VENDEDOR, VENDEDOR_2 } from '../domain/fixtures';
import type { EventoRecebido } from '../domain';
import { dataDoUsuario } from './rotas';
import apiGestor, { criarApiGestor, criarRepositorioEmMemoria, PERFIS_LEITURA } from './index';

const TENANT = u(9001);
const OUTRO_TENANT = u(9002);
const SUP_2 = u(301);
const VEND_3 = u(102);
const ANALISTA = u(600);
const CADASTRO = [
  { id: GERENTE, nome: 'Gilda', perfil: 'gerente' },
  { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor' },
  { id: SUP_2, nome: 'Silas', perfil: 'supervisor' },
  { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor' },
  { id: VENDEDOR_2, nome: 'Vitor', perfil: 'vendedor' },
  { id: PROMOTOR, nome: 'Paula', perfil: 'promotor' },
  { id: VEND_3, nome: 'Valter', perfil: 'vendedor' },
  { id: ANALISTA, nome: 'Ana', perfil: 'analista' },
];
/** Usuários visíveis como a plataforma calcula (RN-CORE-04). */
const VISIVEIS: Record<string, ReadonlySet<string> | 'tenant'> = {
  [SUPERVISOR]: new Set([SUPERVISOR, VENDEDOR, VENDEDOR_2, PROMOTOR]),
  [SUP_2]: new Set([SUP_2, VEND_3]),
  [GERENTE]: new Set([GERENTE, SUPERVISOR, SUP_2, VENDEDOR, VENDEDOR_2, PROMOTOR, VEND_3]),
  [ANALISTA]: 'tenant',
  [VENDEDOR]: new Set([VENDEDOR]),
};
const PERFIL: Record<string, Perfil> = Object.fromEntries(CADASTRO.map((c) => [c.id, c.perfil as Perfil]));
const TODOS: ModuloId[] = ['core', 'gestor', 'vendedor', 'promotor', 'catalogo'];

/** Perfis resolvidos como o Core entrega: só a chave do trajeto interessa (padrão de fábrica do tracking §7). */
const perfisDeFabrica = (base: Perfil): PerfilDaRequisicao[] => [{ codigo: base, base, permissoes: ['supervisor', 'gerente', 'admin'].includes(base) ? { 'trajeto.ver_equipe': {} } : {} }];

function cenario() {
  /** Último contato do aparelho por usuário, como a consulta `core.produtividade_equipe@1` do Core devolve (nulo = nunca sincronizou). */
  const contatos: Record<string, string | null> = {};
  /** Trajeto do dia como o Core devolve (`core.trajeto_do_dia@1`); o Core confere o escopo, aqui só devolve o que foi pedido. */
  const trajetos: Record<string, { metros: number; pontos: { capturado_em: string; latitude: number; longitude: number; precisao_m: number }[]; pausas: { inicio: string; fim: string | null }[] }> = {};
  const chamadasTrajeto: { usuario_ids: string[]; data: string }[] = [];
  const relogio = criarRelogio({ agora: '2026-11-03T15:00:00Z' }); // terça, 11:00 em Manaus
  const repo = criarRepositorioEmMemoria();
  const api = criarApiGestor(repo);
  const auditoria: RegistroAuditoria[] = [];
  /** Parâmetros do módulo como o SDK guarda por tenant; `gravarParametros` grava e audita como o SDK. */
  const guardados: Record<string, unknown> = {};
  const rota = (metodo: string, caminho: string): RotaModulo => {
    const r = api.rotas!.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
    return r;
  };
  const chamar = async (metodo: string, caminho: string, quem: string, o: { tenant?: string; query?: unknown; params?: unknown; corpo?: unknown; modulos?: ModuloId[]; perfis?: readonly PerfilDaRequisicao[] } = {}) => {
    const r = rota(metodo, caminho);
    const tx = {
      publicar: async () => {
        throw new Error('o Gestor não publica evento');
      },
      registrarArquivo: async () => {
        throw new Error('sem arquivo');
      },
      consultar: async (def: { nome: string }, entrada: { usuario_ids: string[] }) => {
        if (def.nome === 'core.calendario_metas@1') return { dias_uteis_semana: DIAS_UTEIS_DO_CORE, feriados: [] };
        if (def.nome === 'core.trajeto_do_dia@1') {
          const e = entrada as unknown as { usuario_ids: string[]; data: string };
          chamadasTrajeto.push(e);
          return { data: e.data, usuarios: e.usuario_ids.filter((id) => trajetos[id]).map((id) => ({ id, ...trajetos[id]! })) };
        }
        if (def.nome === 'core.produtividade_equipe@1') {
          return { parado_min: 60, alertas: PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, usuarios: entrada.usuario_ids.map((id) => ({ id, ultimo_contato_em: contatos[id] ?? null, almoco_inicio_min: 720, almoco_fim_min: 780 })) };
        }
        return { clientes: [], produtos: [], usuarios: CADASTRO.filter((c) => entrada.usuario_ids.includes(c.id)).map((c) => ({ ...c, external_id: null })) };
      },
      auditar: async (a: RegistroAuditoria) => {
        auditoria.push(a);
      },
    };
    const ctx = {
      usuario: { id: quem, tenant_id: o.tenant ?? TENANT, perfil: PERFIL[quem]!, modulos: o.modulos ?? TODOS, perfis: o.perfis ?? perfisDeFabrica(PERFIL[quem]!) },
      dependencias: {},
      requestId: 'req-1',
      agora: () => relogio.agora(),
      comTenant: async <T,>(fn: (db: never, tx: never) => Promise<T>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never, tx as never),
      carteira: async () => 'tenant' as const,
      usuariosVisiveis: async () => VISIVEIS[quem] ?? new Set([quem]),
      parametros: () => ({ ...guardados }),
      gravarParametros: async (v: Record<string, unknown>, op?: { acao?: string }) => {
        const mudou = Object.entries(v).some(([k, x]) => guardados[k] !== x);
        Object.assign(guardados, v);
        if (mudou) auditoria.push({ acao: op?.acao ?? 'parametro.gravar', entidade: 'parametro', entidade_id: null, antes: null, depois: v } as RegistroAuditoria);
      },
      fuso: () => 'America/Manaus',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      query: r.query ? r.query.parse(o.query ?? {}) : undefined,
      params: r.params ? r.params.parse(o.params ?? {}) : undefined,
      corpo: r.corpo ? r.corpo.parse(o.corpo ?? {}) : undefined,
    } as unknown as ContextoRota;
    return r.executar(ctx);
  };
  const publicar = async (eventos: EventoRecebido[], tenant = TENANT) => {
    for (const e of eventos) {
      const c = api.consumidores!.find((x) => x.evento.nome === e.nome)!;
      const ctx = { envelope: { evento_id: e.evento_id, nome: e.nome, origem: 'core', tenant_id: tenant, usuario_id: null, request_id: null, ocorrido_em: e.ocorrido_em, payload: e.payload }, db: {}, publicar: async () => {}, agora: () => relogio.agora(), log: { info: () => {}, warn: () => {}, error: () => {} } } as unknown as ContextoConsumo;
      await c.executar(c.evento.schema.parse(e.payload), ctx);
    }
  };
  return { relogio, repo, api, auditoria, chamar, publicar, contatos, trajetos, chamadasTrajeto };
}

const iso = (r: ReturnType<typeof criarRelogio>, hora: string, dias = 0) => r.instante({ dias, hora }).toISOString();

function diaDeVendas(r: ReturnType<typeof criarRelogio>): EventoRecebido[] {
  return [
    checkin({ visita: u(2001), usuario: VENDEDOR, cliente: CLIENTE_A, em: iso(r, '09:00') }),
    pedidoCriado({ pedido: u(900), vendedor: VENDEDOR, cliente: CLIENTE_A, total: 50_000, em: iso(r, '09:30') }),
    statusAlterado({ pedido: u(900), vendedor: VENDEDOR, para: 'aprovado', em: iso(r, '09:31') }),
    pedidoCriado({ pedido: u(901), vendedor: VEND_3, cliente: u(504), total: 20_000, em: iso(r, '10:00') }),
    statusAlterado({ pedido: u(901), vendedor: VEND_3, para: 'aprovado', em: iso(r, '10:01') }),
    pedidoCriado({ pedido: u(902), vendedor: VENDEDOR_2, cliente: u(505), total: 80_000, em: iso(r, '10:30') }),
  ];
}
const aprovacaoSolicitada = (r: ReturnType<typeof criarRelogio>, o: { pedido: string; vendedor: string; nivel: 'supervisor' | 'gerente' | 'analista' }): EventoRecebido => ({
  evento_id: `apr-${o.pedido}`,
  nome: 'vendedor.pedido.aprovacao_solicitada@1',
  ocorrido_em: iso(r, '10:31'),
  payload: { pedido_id: o.pedido, vendedor_id: o.vendedor, cliente_id: u(505), solicitada_em: iso(r, '10:31'), nivel: o.nivel, motivos: ['desconto'], desconto_efetivo_pct: 12.5, total_cents: 80_000, credito: null, historico: null },
});

/** Semana útil devolvida pela consulta `core.calendario_metas@1` do Core nos testes (padrão seg–sáb). */
const DIAS_UTEIS_DO_CORE = [1, 2, 3, 4, 5, 6];

describe('API do Gestor: declaração, licença e perfis (regra 6)', () => {
  it('a API é válida no SDK: 12 rotas, um consumidor por evento de `consome`, escrita sempre com ação do manifesto', () => {
    expect(apiGestor.rotas!.map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'GET equipe',
      'GET equipe/:usuario_id',
      'GET equipe/:usuario_id/trajeto',
      'GET ranking',
      'GET aprovacoes',
      'GET alertas',
      'POST alertas/:id/dispensar',
      'GET alertas/regras',
      'PUT alertas/regras/:tipo',
      'GET parametros/alertas',
      'PUT parametros/alertas',
      'GET pedido-em-nome/disponibilidade',
    ]);
    expect(apiGestor.consumidores!.map((c) => c.evento.nome)).toEqual(manifest.consome);
    for (const r of apiGestor.rotas!) if (r.metodo !== 'GET') expect(r.acao).toBeTruthy();
  });

  it('RN-CORE-02: sem a licença do Gestor toda rota responde 403 MODULO_INATIVO', () => {
    const perm = criarPermissoes([manifest]);
    const sup = { id: SUPERVISOR, tenant_id: TENANT, perfil: 'supervisor' as const, modulos: ['core'] as ModuloId[] };
    for (const r of apiGestor.rotas!) {
      const res = r.acao ? verificarAcao(sup, perm, r.acao) : verificarAcesso(sup, { modulo: 'gestor', perfis: r.perfis ?? manifest.perfis });
      expect(res).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
    }
  });

  it('RN-CORE-04 / RN-GES-07 / RN-PRO-01: leitura para supervisor, gerente, analista e admin; vendedor, promotor e assistente recebem 403', () => {
    expect([...PERFIS_LEITURA].sort()).toEqual(['admin', 'analista', 'gerente', 'supervisor']);
    const perm = criarPermissoes([manifest]);
    const como = (perfil: Perfil) => ({ id: u(1), tenant_id: TENANT, perfil, modulos: TODOS });
    const pode = (perfil: Perfil, r: RotaModulo) => (r.acao ? verificarAcao(como(perfil), perm, r.acao) : verificarAcesso(como(perfil), { modulo: 'gestor', perfis: r.perfis ?? manifest.perfis })).ok;
    const rotas = Object.fromEntries(apiGestor.rotas!.map((r) => [`${r.metodo} ${r.caminho}`, r]));
    for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) for (const r of apiGestor.rotas!) expect(pode(perfil, r)).toBe(false);
    for (const perfil of ['supervisor', 'gerente'] as const) {
      expect(pode(perfil, rotas['POST alertas/:id/dispensar']!)).toBe(true);
      expect(pode(perfil, rotas['PUT alertas/regras/:tipo']!)).toBe(false);
      expect(pode(perfil, rotas['PUT parametros/alertas']!)).toBe(false);
    }
    for (const perfil of ['analista', 'admin'] as const) {
      expect(pode(perfil, rotas['GET equipe']!)).toBe(true);
      expect(pode(perfil, rotas['POST alertas/:id/dispensar']!)).toBe(false); // RN-GES-07: só leitura
      expect(pode(perfil, rotas['PUT alertas/regras/:tipo']!)).toBe(true);
      expect(pode(perfil, rotas['PUT parametros/alertas']!)).toBe(true);
    }
    expect(promotorBarradoNaRota(rotas['GET pedido-em-nome/disponibilidade']!)).toBe(true);
  });
});

describe('API do Gestor: trajeto do dia da equipe (T-0156, tracking §7)', () => {
  const PONTO = { capturado_em: '2026-11-03T12:00:00Z', latitude: -3.1, longitude: -60.02, precisao_m: 8 };
  const SEGREDO = String(PONTO.latitude);

  it('RN-CORE-13 / §7: o supervisor vê o trajeto do dia do vendedor da equipe, pela consulta do Core, com a data do tenant', async () => {
    const c = cenario();
    c.trajetos[VENDEDOR] = { metros: 1200, pontos: [PONTO], pausas: [] };
    const r = TrajetoEquipe.parse(await c.chamar('GET', 'equipe/:usuario_id/trajeto', SUPERVISOR, { params: { usuario_id: VENDEDOR } }));
    expect(r.data).toBe(c.relogio.hoje());
    expect(r.trajeto).toMatchObject({ id: VENDEDOR, metros: 1200, pontos: [PONTO] });
    expect(c.chamadasTrajeto).toEqual([{ usuario_ids: [VENDEDOR], data: c.relogio.hoje() }]);
  });

  it('RN-CORE-13: sem pontos (tracking desligado de fábrica) a resposta traz o trajeto vazio, não erro', async () => {
    const c = cenario();
    const r = TrajetoEquipe.parse(await c.chamar('GET', 'equipe/:usuario_id/trajeto', GERENTE, { params: { usuario_id: PROMOTOR }, query: { data: '2026-11-02' } }));
    expect(r).toEqual({ data: '2026-11-02', trajeto: { id: PROMOTOR, metros: 0, pontos: [], pausas: [] } });
  });

  it('RN-CORE-04: fora da equipe responde 404 e a consulta do Core nem é feita; o gerente alcança as equipes abaixo', async () => {
    const c = cenario();
    await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', SUPERVISOR, { params: { usuario_id: VEND_3 } })).rejects.toMatchObject({ status: 404, codigo: 'MEMBRO_NAO_ENCONTRADO' });
    expect(c.chamadasTrajeto).toEqual([]);
    await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', GERENTE, { params: { usuario_id: VEND_3 } })).resolves.toBeTruthy();
  });

  it('RN-CORE-37 / §7: sem `core.trajeto.ver_equipe` é 403, mesmo para quem entra pelo perfil (analista); a consulta não roda', async () => {
    const c = cenario();
    await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', ANALISTA, { params: { usuario_id: VENDEDOR } })).rejects.toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', SUPERVISOR, { params: { usuario_id: VENDEDOR }, perfis: [{ codigo: 'supervisor', base: 'supervisor', permissoes: {} }] })).rejects.toMatchObject({ status: 403 });
    expect(c.chamadasTrajeto).toEqual([]);
  });

  it('RN-CORE-13 / ordem do dono (v1.0.15): vendedor e promotor recebem 403 na rota, mesmo com `trajeto.ver_proprio`, e a consulta do Core não roda', async () => {
    const c = cenario();
    for (const [perfil, base] of [[VENDEDOR, 'vendedor'], [PROMOTOR, 'promotor']] as const) {
      for (const alvo of [perfil, VENDEDOR_2]) {
        await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', perfil, { params: { usuario_id: alvo }, perfis: [{ codigo: base, base, permissoes: { 'trajeto.ver_proprio': {} } }] })).rejects.toMatchObject({ status: 403 });
      }
    }
    expect(c.chamadasTrajeto).toEqual([]);
  });

  it('RN-CORE-37 / §7: a rota não traz lista de perfis própria; quem decide é `core.trajeto.ver_equipe` (motor de permissões), por perfil e por licença', async () => {
    const c = cenario();
    const r = c.api.rotas!.find((x) => x.caminho === 'equipe/:usuario_id/trajeto')!;
    expect(r.perfis).toBeUndefined();
    expect(r.acao).toBeUndefined();
    expect(ACAO_VER_TRAJETO).toBe('trajeto.ver_equipe');
    for (const perfil of [VENDEDOR, ANALISTA] as const) await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', perfil, { params: { usuario_id: VENDEDOR } })).rejects.toMatchObject({ status: 403 });
    for (const perfil of [SUPERVISOR, GERENTE] as const) await expect(c.chamar('GET', 'equipe/:usuario_id/trajeto', perfil, { params: { usuario_id: VENDEDOR } })).resolves.toBeTruthy();
    expect(c.chamadasTrajeto).toHaveLength(2);
  });

  it('§7: nenhuma exportação de pontos brutos (só leitura de um dia, uma pessoa) e nenhuma coordenada no erro', async () => {
    const c = cenario();
    expect(c.api.rotas!.filter((x) => /trajeto|csv|export/i.test(x.caminho)).map((x) => `${x.metodo} ${x.caminho}`)).toEqual(['GET equipe/:usuario_id/trajeto']);
    c.trajetos[VENDEDOR] = { metros: 10, pontos: [PONTO], pausas: [] };
    const erro = await c.chamar('GET', 'equipe/:usuario_id/trajeto', SUPERVISOR, { params: { usuario_id: VEND_3 } }).catch((e: Error) => e);
    expect(JSON.stringify({ m: (erro as Error).message, s: (erro as Error).stack })).not.toContain(SEGREDO);
  });
});

describe('API do Gestor: fluxo de ponta a ponta com eventos (RF-GES-01..07)', () => {
  it('RF-GES-01 / RN-CORE-04: o supervisor vê só a própria equipe; o gerente vê as duas equipes', async () => {
    const c = cenario();
    await c.publicar(diaDeVendas(c.relogio));
    const sup = VisaoEquipe.parse(await c.chamar('GET', 'equipe', SUPERVISOR));
    expect(sup.data).toBe(c.relogio.hoje());
    expect(sup.membros.map((m) => m.membro.nome)).toEqual(['Paula', 'Vera', 'Vitor']);
    expect(sup.resumo.vendas_cents).toBe(50_000);
    const ger = VisaoEquipe.parse(await c.chamar('GET', 'equipe', GERENTE));
    expect(ger.membros.map((m) => m.membro.nome)).toEqual(['Paula', 'Valter', 'Vera', 'Vitor']);
    expect(ger.resumo.vendas_cents).toBe(70_000);
  });

  it('RN-GES-07: o analista lê o tenant pelos usuários da projeção', async () => {
    const c = cenario();
    await c.publicar(diaDeVendas(c.relogio));
    const v = VisaoEquipe.parse(await c.chamar('GET', 'equipe', ANALISTA));
    expect(v.membros.map((m) => m.membro.nome)).toEqual(['Valter', 'Vera', 'Vitor']);
  });

  it('RN-CORE-05: eventos de um tenant nunca aparecem no outro', async () => {
    const c = cenario();
    await c.publicar(diaDeVendas(c.relogio), OUTRO_TENANT);
    const v = VisaoEquipe.parse(await c.chamar('GET', 'equipe', SUPERVISOR));
    expect(v.resumo.vendas_cents).toBe(0);
    expect(v.membros.find((m) => m.membro.id === VENDEDOR)?.painel.visitas.realizadas).toBe(0);
    expect(VisaoEquipe.parse(await c.chamar('GET', 'equipe', SUPERVISOR, { tenant: OUTRO_TENANT })).resumo.vendas_cents).toBe(50_000);
  });

  it('RF-GES-02 / RN-CORE-04: ficha da equipe; fora do escopo = 404 sem revelar', async () => {
    const c = cenario();
    await c.publicar(diaDeVendas(c.relogio));
    const f = FichaMembro.parse(await c.chamar('GET', 'equipe/:usuario_id', SUPERVISOR, { params: { usuario_id: VENDEDOR } }));
    expect(f.painel.vendas?.vendas_cents).toBe(50_000);
    expect(f.pedido_em_nome).toMatchObject({ visivel: true, permitido: true });
    await expect(c.chamar('GET', 'equipe/:usuario_id', SUPERVISOR, { params: { usuario_id: VEND_3 } })).rejects.toMatchObject({ status: 404, codigo: 'MEMBRO_NAO_ENCONTRADO' });
  });

  it('RF-GES-03: ranking de vendas do dia da equipe do gerente, do maior para o menor', async () => {
    const c = cenario();
    await c.publicar(diaDeVendas(c.relogio));
    const r = RankingEquipe.parse(await c.chamar('GET', 'ranking', GERENTE, { query: { indicador: 'vendas_cents', periodo: 'diario' } }));
    expect(r.linhas.filter((l) => l.perfil === 'vendedor').map((l) => [l.nome, l.valor])).toEqual([
      ['Vera', 50_000],
      ['Valter', 20_000],
      ['Vitor', 0],
    ]);
  });

  it('RF-GES-04 / RN-GES-03/04/07: fila com prazo em dias úteis; supervisor decide, analista só lê; nível analista fica fora', async () => {
    const c = cenario();
    await c.publicar([...diaDeVendas(c.relogio), aprovacaoSolicitada(c.relogio, { pedido: u(902), vendedor: VENDEDOR_2, nivel: 'supervisor' }), aprovacaoSolicitada(c.relogio, { pedido: u(903), vendedor: VENDEDOR_2, nivel: 'analista' })]);
    const sup = FilaAprovacao.parse(await c.chamar('GET', 'aprovacoes', SUPERVISOR));
    expect(sup.itens.map((i) => [i.pedido_id, i.situacao, i.pode_decidir])).toEqual([[u(902), 'no_prazo', true]]);
    expect(sup.itens[0]!.prazo_em).toBe(iso(c.relogio, '10:31', 1)); // 1 dia útil depois, mesmo horário local
    expect(sup.resumo).toMatchObject({ total: 1, para_mim: 1 });
    expect(FilaAprovacao.parse(await c.chamar('GET', 'aprovacoes', SUP_2)).itens).toEqual([]);
    const ana = FilaAprovacao.parse(await c.chamar('GET', 'aprovacoes', ANALISTA));
    expect(ana.itens.map((i) => i.pode_decidir)).toEqual([false]);
    // decidido no Vendedor ⇒ some da fila
    await c.publicar([statusAlterado({ pedido: u(902), vendedor: VENDEDOR_2, para: 'aprovado', em: iso(c.relogio, '11:00') })]);
    expect(FilaAprovacao.parse(await c.chamar('GET', 'aprovacoes', SUPERVISOR)).itens).toEqual([]);
  });

  it('RN-CORE-03: sem o Vendedor ativo a fila vem vazia e a visão continua válida', async () => {
    const c = cenario();
    await c.publicar([...diaDeVendas(c.relogio), aprovacaoSolicitada(c.relogio, { pedido: u(902), vendedor: VENDEDOR_2, nivel: 'supervisor' })]);
    const semVendedor: ModuloId[] = ['core', 'gestor'];
    expect(FilaAprovacao.parse(await c.chamar('GET', 'aprovacoes', SUPERVISOR, { modulos: semVendedor })).itens).toEqual([]);
    expect(VisaoEquipe.parse(await c.chamar('GET', 'equipe', SUPERVISOR, { modulos: semVendedor })).resumo.vendas_cents).toBeNull();
  });

  it('RF-GES-07: aprovação vencida vira alerta da equipe; dispensar é auditado e idempotente; outro supervisor recebe 404', async () => {
    const c = cenario();
    await c.publicar([...diaDeVendas(c.relogio), aprovacaoSolicitada(c.relogio, { pedido: u(902), vendedor: VENDEDOR_2, nivel: 'supervisor' })]);
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR)).itens.filter((a) => a.tipo === 'pedido_aguardando_aprovacao')).toEqual([]);
    c.relogio.avancar({ dias: 2 }); // quinta: passou do prazo de 1 dia útil
    const lista = ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR)).itens.filter((a) => a.tipo === 'pedido_aguardando_aprovacao');
    expect(lista).toHaveLength(1);
    const alerta = lista[0]!;
    expect(alerta).toMatchObject({ status: 'aberto', alvo_id: u(902), responsavel_id: VENDEDOR_2 });
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUP_2)).itens.some((a) => a.id === alerta.id)).toBe(false);
    await expect(c.chamar('POST', 'alertas/:id/dispensar', SUP_2, { params: { id: alerta.id } })).rejects.toMatchObject({ status: 404 });
    expect(await c.chamar('POST', 'alertas/:id/dispensar', SUPERVISOR, { params: { id: alerta.id } })).toMatchObject({ id: alerta.id, status: 'dispensado' });
    expect(await c.chamar('POST', 'alertas/:id/dispensar', SUPERVISOR, { params: { id: alerta.id } })).toMatchObject({ status: 'dispensado' });
    expect(c.auditoria).toEqual([{ acao: 'alerta_equipe.dispensar', entidade: 'alerta', entidade_id: alerta.id, antes: { status: 'aberto', tipo: 'pedido_aguardando_aprovacao' }, depois: { status: 'dispensado' } }]);
    // dispensado não reabre enquanto a condição persiste; some quando o pedido é decidido
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR)).itens.find((a) => a.id === alerta.id)?.status).toBe('dispensado');
    await c.publicar([statusAlterado({ pedido: u(902), vendedor: VENDEDOR_2, para: 'aprovado', em: c.relogio.iso() })]);
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR)).itens.some((a) => a.id === alerta.id)).toBe(false);
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR, { query: { status: 'encerrado' } })).itens.map((a) => [a.id, a.motivo_encerramento])).toEqual([[alerta.id, 'condicao_normalizada']]);
  });

  it('RF-GES-07 (BKO): o analista ajusta a regra, com auditoria; ajuste inválido = 422 com a regra citada', async () => {
    const c = cenario();
    const r = RegraAlerta.parse(await c.chamar('PUT', 'alertas/regras/:tipo', ANALISTA, { params: { tipo: 'ruptura_recorrente' }, corpo: { limiar: 4 } }));
    expect(r).toMatchObject({ tipo: 'ruptura_recorrente', limiar: 4, ativa: true });
    const regras = (await c.chamar('GET', 'alertas/regras', ANALISTA)) as { regras: RegraAlerta[] };
    expect(regras.regras.find((x) => x.tipo === 'ruptura_recorrente')?.limiar).toBe(4);
    expect(c.auditoria.map((a) => a.acao)).toEqual(['alerta_regra.gerenciar']);
    await expect(c.chamar('PUT', 'alertas/regras/:tipo', ANALISTA, { params: { tipo: 'cliente_sem_visita' }, corpo: { limiar: 5 } })).rejects.toMatchObject({ status: 422, codigo: 'REGRA_ALERTA_INVALIDA' });
  });

  it('RN-GES-01/03, RN-PRO-07: Parâmetros › Alertas devolve os padrões, grava só o que mudou, audita e recusa valor fora da faixa', async () => {
    const c = cenario();
    const padrao = { pct_tolerancia_frequencia: 50, dias_sem_visita_padrao: 30, dias_carencia_cliente_novo: 15, prazo_aprovacao_dias_uteis: 1 };
    expect(await c.chamar('GET', 'parametros/alertas', ANALISTA)).toEqual(padrao);
    expect(await c.chamar('PUT', 'parametros/alertas', ANALISTA, { corpo: { ...padrao, pct_tolerancia_frequencia: 60 } })).toMatchObject({ pct_tolerancia_frequencia: 60 });
    expect(c.auditoria.map((a) => a.acao)).toEqual(['alerta_regra.gerenciar']);
    const recusado = await c.chamar('PUT', 'parametros/alertas', ANALISTA, { corpo: { ...padrao, dias_sem_visita_padrao: 0 } }).catch((e: unknown) => e);
    expect(recusado).toBeInstanceOf(ZodError);
    expect((recusado as ZodError).issues[0]).toMatchObject({ path: ['dias_sem_visita_padrao'], code: 'too_small' });
  });

  it('RN-PRO-07: a permanência mínima é do Promotor; o PUT do Gestor recusa o campo e a leitura não o traz', async () => {
    const c = cenario();
    expect(await c.chamar('GET', 'parametros/alertas', ANALISTA)).not.toHaveProperty('permanencia_min_min');
    const recusado = await c
      .chamar('PUT', 'parametros/alertas', ANALISTA, { corpo: { pct_tolerancia_frequencia: 50, dias_sem_visita_padrao: 30, dias_carencia_cliente_novo: 15, prazo_aprovacao_dias_uteis: 1, permanencia_min_min: 5 } })
      .catch((e: unknown) => e);
    expect((recusado as ZodError).issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['permanencia_min_min'] });
  });

  it('RN-VEN-42, D4: a lista só traz os alertas de produtividade com `?produtividade=1` e só de quem sincronizou depois do horário do check-in', async () => {
    const c = cenario(); // terça, 11:00 em Manaus; ninguém fez check-in; o "até" padrão é 10:00
    c.contatos[VENDEDOR] = '2026-11-03T14:30:00Z'; // 10:30 em Manaus, depois das 10:00
    c.contatos[VENDEDOR_2] = '2026-11-03T13:00:00Z'; // 09:00, antes das 10:00: pode estar sem sinal, não acusa
    const sem = ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR));
    expect(sem.itens.filter((a) => a.tipo === 'sem_checkin_inicio')).toEqual([]); // Gestão anterior à v1.0.13 não recebe o tipo novo
    const com = ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR, { query: { produtividade: '1' } }));
    expect(com.itens.filter((a) => a.tipo === 'sem_checkin_inicio').map((a) => [a.alvo_id, a.chave, a.mensagem])).toEqual([[VENDEDOR, `produtividade:${VENDEDOR}`, 'Vera']]);
    const semFiltroDeNovo = ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR));
    expect(semFiltroDeNovo.itens.some((a) => a.tipo === 'sem_checkin_inicio')).toBe(false); // omitir da lista não encerra o alerta
    expect(ListaAlertas.parse(await c.chamar('GET', 'alertas', SUPERVISOR, { query: { produtividade: '1' } })).itens.filter((a) => a.tipo === 'sem_checkin_inicio')).toHaveLength(1);
  });

  it('ADR 0059 §1: ajustar regra de produtividade é recusado com erro de validação (4xx), não com 500', async () => {
    const c = cenario();
    const recusado = await c.chamar('PUT', 'alertas/regras/:tipo', ANALISTA, { params: { tipo: 'parado_entre_visitas' }, corpo: { ativa: false } }).catch((e: unknown) => e);
    expect(recusado).toBeInstanceOf(ZodError);
    expect((recusado as ZodError).issues[0]).toMatchObject({ path: ['tipo'], code: 'invalid_enum_value' });
    const regras = (await c.chamar('GET', 'alertas/regras', ANALISTA)) as { regras: RegraAlerta[] };
    expect(regras.regras.map((r) => r.tipo)).toEqual(['cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps']);
  });

  it('RF-GES-05 / RN-VEN-35: disponibilidade do pedido em nome segue o escopo e some sem o Vendedor', async () => {
    const c = cenario();
    expect(await c.chamar('GET', 'pedido-em-nome/disponibilidade', SUPERVISOR, { query: { vendedor_id: VENDEDOR } })).toMatchObject({ visivel: true, permitido: true });
    expect(await c.chamar('GET', 'pedido-em-nome/disponibilidade', SUPERVISOR, { query: { vendedor_id: VEND_3 } })).toMatchObject({ permitido: false, codigo: 'FORA_DO_ESCOPO' });
    expect(await c.chamar('GET', 'pedido-em-nome/disponibilidade', SUPERVISOR, { query: { vendedor_id: VENDEDOR }, modulos: ['core', 'gestor'] })).toMatchObject({ visivel: false });
  });

  it('consumidor: evento fora do contrato não derruba a fila do despachante (vira aviso) e reentrega não duplica', async () => {
    const c = cenario();
    const ruim: EventoRecebido = { evento_id: 'ruim-1', nome: 'vendedor.pedido.criado@1', ocorrido_em: c.relogio.iso(), payload: { pedido_id: 'x' } };
    await expect(c.publicar([ruim])).resolves.toBeUndefined();
    const dia = diaDeVendas(c.relogio);
    await c.publicar(dia);
    await c.publicar(dia);
    expect(VisaoEquipe.parse(await c.chamar('GET', 'equipe', SUPERVISOR)).resumo.vendas_cents).toBe(50_000);
  });
});

describe('T-0140: data impossível na entrada das rotas (D-T0140-L03a)', () => {
  it('RN-GES-01: data inexistente (2026-02-30, 2026-13-01) vira 422 DATA_INVALIDA em português, não 500', () => {
    for (const d of ['2026-02-30', '2026-13-01']) {
      expect(() => dataDoUsuario(d)).toThrowError(expect.objectContaining({ status: 422, codigo: 'DATA_INVALIDA', message: expect.stringContaining('não existe') }));
    }
  });
  it('RN-GES-01: data válida e ausente passam sem mudança', () => {
    expect(dataDoUsuario('2026-02-28')).toBe('2026-02-28');
    expect(dataDoUsuario('2028-02-29')).toBe('2028-02-29');
    expect(dataDoUsuario(undefined)).toBeUndefined();
  });
});
