/**
 * Rotas do Gestor sem banco (T-0055): contexto falso da plataforma (usuário do token, usuários visíveis, transação com
 * `consultar`/`auditar`) e repositório em memória. A licença e o perfil são da plataforma (`verificarAcesso`/`verificarAcao`,
 * os mesmos do `createApp`); o escopo (RN-CORE-04) e o isolamento por tenant são provados chamando `executar`.
 * Uma só linha do tempo: o relógio do teste (`criarRelogio`), injetado em `ctx.agora` e no consumidor.
 */
import { describe, expect, it } from 'vitest';
import { criarRelogio } from '@macuxi/comum/relogio';
import {
  criarPermissoes,
  promotorBarradoNaRota,
  verificarAcao,
  verificarAcesso,
  type ContextoConsumo,
  type ContextoRota,
  type ModuloId,
  type Perfil,
  type RegistroAuditoria,
  type RotaModulo,
} from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { FichaMembro, FilaAprovacao, ListaAlertas, RankingEquipe, RegraAlerta, VisaoEquipe } from '../contracts';
import { CLIENTE_A, checkin, GERENTE, pedidoCriado, PROMOTOR, statusAlterado, SUPERVISOR, u, VENDEDOR, VENDEDOR_2 } from '../domain/fixtures';
import type { EventoRecebido } from '../domain';
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

function cenario() {
  const relogio = criarRelogio({ agora: '2026-11-03T15:00:00Z' }); // terça, 11:00 em Manaus
  const repo = criarRepositorioEmMemoria();
  const api = criarApiGestor(repo);
  const auditoria: RegistroAuditoria[] = [];
  const rota = (metodo: string, caminho: string): RotaModulo => {
    const r = api.rotas!.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
    return r;
  };
  const chamar = async (metodo: string, caminho: string, quem: string, o: { tenant?: string; query?: unknown; params?: unknown; corpo?: unknown; modulos?: ModuloId[] } = {}) => {
    const r = rota(metodo, caminho);
    const tx = {
      publicar: async () => {
        throw new Error('o Gestor não publica evento');
      },
      registrarArquivo: async () => {
        throw new Error('sem arquivo');
      },
      consultar: async (_def: unknown, entrada: { usuario_ids: string[] }) => ({ clientes: [], produtos: [], usuarios: CADASTRO.filter((c) => entrada.usuario_ids.includes(c.id)).map((c) => ({ ...c, external_id: null })) }),
      auditar: async (a: RegistroAuditoria) => {
        auditoria.push(a);
      },
    };
    const ctx = {
      usuario: { id: quem, tenant_id: o.tenant ?? TENANT, perfil: PERFIL[quem]!, modulos: o.modulos ?? TODOS },
      dependencias: {},
      requestId: 'req-1',
      agora: () => relogio.agora(),
      comTenant: async <T,>(fn: (db: never, tx: never) => Promise<T>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never, tx as never),
      carteira: async () => 'tenant' as const,
      usuariosVisiveis: async () => VISIVEIS[quem] ?? new Set([quem]),
      parametros: () => ({}),
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
  return { relogio, repo, api, auditoria, chamar, publicar };
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

describe('API do Gestor: declaração, licença e perfis (regra 6)', () => {
  it('a API é válida no SDK: 9 rotas, um consumidor por evento de `consome`, escrita sempre com ação do manifesto', () => {
    expect(apiGestor.rotas!.map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'GET equipe',
      'GET equipe/:usuario_id',
      'GET ranking',
      'GET aprovacoes',
      'GET alertas',
      'POST alertas/:id/dispensar',
      'GET alertas/regras',
      'PUT alertas/regras/:tipo',
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
    const pode = (perfil: Perfil, r: RotaModulo) => (r.acao ? verificarAcao(como(perfil), perm, r.acao) : verificarAcesso(como(perfil), { modulo: 'gestor', perfis: r.perfis! })).ok;
    const rotas = Object.fromEntries(apiGestor.rotas!.map((r) => [`${r.metodo} ${r.caminho}`, r]));
    for (const perfil of ['vendedor', 'promotor', 'assistente'] as const) for (const r of apiGestor.rotas!) expect(pode(perfil, r)).toBe(false);
    for (const perfil of ['supervisor', 'gerente'] as const) {
      expect(pode(perfil, rotas['POST alertas/:id/dispensar']!)).toBe(true);
      expect(pode(perfil, rotas['PUT alertas/regras/:tipo']!)).toBe(false);
    }
    for (const perfil of ['analista', 'admin'] as const) {
      expect(pode(perfil, rotas['GET equipe']!)).toBe(true);
      expect(pode(perfil, rotas['POST alertas/:id/dispensar']!)).toBe(false); // RN-GES-07: só leitura
      expect(pode(perfil, rotas['PUT alertas/regras/:tipo']!)).toBe(true);
    }
    expect(promotorBarradoNaRota(rotas['GET pedido-em-nome/disponibilidade']!)).toBe(true);
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
