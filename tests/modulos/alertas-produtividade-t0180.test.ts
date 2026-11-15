/**
 * T-0180 (alertas de produtividade e Parâmetros › Alertas, v1.0.13): costura entre o Core e o Gestor, valor × regra (D1, D5, D6),
 * licença do módulo (RN-CORE-03), permissão, multi-tenant e o caminho Core → Gestor do alerta ao gestor. Os testes de unidade de cada
 * regra ficam nos módulos; aqui fica o que só aparece quando os PRs se encontram: o Gestor monta a tela e grava no parâmetro do Core,
 * e a lista de alertas do Gestor abre o alerta com o que a consulta `core.produtividade_equipe@1` do Core devolve.
 * Ordem de merge: core → testes → gestor. Sem o PR do Gestor no main, os blocos do Gestor não rodam (`apoio/estado-prs.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { criarPermissoes, verificarAcao, verificarAcesso, PERFIS, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest as core } from '../../modules/core/manifest';
import { manifest as gestor } from '../../modules/gestor/manifest';
import { criarApiGestor, criarRepositorioEmMemoria } from '../../modules/gestor/api';
import { CLIENTE_A, CLIENTE_B, checkin, checkout, ev, PROMOTOR, SUPERVISOR, u, VENDEDOR, VENDEDOR_2 } from '../../modules/gestor/domain/fixtures';
import { ALERTAS_CORE_T0180 as comCore, ALERTAS_GESTOR_T0180 as comGestor } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const TENANT_B = '0b000000-0000-4000-8000-0000000000bb';
type Qualquer = Record<string, unknown>;
type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[] }[] } }; parse: (v: unknown) => unknown };
type Rota = { metodo: string; caminho: string; acao?: string; superficie?: string };
type Alerta = { tipo: string; chave: string; alvo_id: string; valor: number | null; status: string };

/** Módulo carregado sem tipo: os nomes do T-0180 só existem depois dos PRs. */
const carregar = async (m: string): Promise<Qualquer> => (await import(/* @vite-ignore */ m)) as Qualquer;
const CONTRATOS_CORE = '../../modules/core/contracts';
const TELA_GESTOR = '../../modules/gestor/domain/produtividade-do-dia';
const quemPode = (manifestos: Parameters<typeof criarPermissoes>[0], acao: string, modulos: ModuloId[]) => {
  const p = criarPermissoes(manifestos);
  return PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, p, acao).ok);
};

describe('T-0180 — D6: os padrões em todo lugar (valor × regra)', () => {
  if (!comCore) {
    it('antes do PR do modulo-core: o Core não declara a ação dos parâmetros de produtividade', () => {
      expect(Object.keys(core.acoes ?? {})).not.toContain('parametro.alertas_produtividade');
    });
    return;
  }

  it('Core: almoço 10 min antes; parado com gestor +30 min; sem check-in até 10:00; rota às 16:00; visita aberta 120 min; envio 4 h; teto 4', async () => {
    const c = await carregar(CONTRATOS_CORE);
    expect(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO).toEqual({
      fim_almoco: { ativa: true, antecedencia_min: 10, vendedor: true },
      parado_entre_visitas: { ativa: true, vendedor: true, gestor: true, gestor_depois_min: 30 },
      sem_checkin_inicio: { ativa: true, ate_min: 600, vendedor: true, gestor: true },
      rota_incompleta: { ativa: true, as_min: 960, vendedor: true },
      visita_aberta: { ativa: true, apos_min: 120, vendedor: true },
      envio_pendente: { ativa: true, apos_h: 4, vendedor: true },
      teto_lembretes_dia: 4,
    });
    expect((c.ParametrosAlertasProdutividadeSchema as Schema).safeParse(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO).success).toBe(true);
  });

  it('D5: almoço padrão da empresa 12:00 às 13:00; D1: "parado" 60 min num valor só (inicio.parado_min)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    expect(c.ALMOCO_PADRAO_EMPRESA).toEqual({ inicio_min: 720, fim_min: 780 });
    expect(c.PARADO_MIN_PADRAO).toBe(60);
    expect(c.PARAMETRO_PARADO_MIN).toBe('inicio.parado_min');
    expect(JSON.stringify(c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO)).not.toContain('parado_min');
  });

  it('D1: o campo do "parado" sumiu do painel Parâmetros › Início do BKO', () => {
    expect(ler('modules/core/web/components/metas/inicio-parametros-panel.tsx')).not.toContain('data-testid="inicio-params.parado"');
  });

  if (!comGestor) return;

  it('Gestor: a tela mostra os MESMOS números do Core (10, +30, 10:00 e 16:00 como minuto do dia, 120, 4 h; parado 60)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const campos = g.CAMPOS_PRODUTIVIDADE as Record<string, { id: string; padrao: number; tipo: string; origem: string }[]>;
    const padroes = (regra: string) => (campos[regra] ?? []).map((x) => x.padrao);
    const p = c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as Record<string, Record<string, number>>;
    expect(padroes('fim_almoco')).toEqual([p.fim_almoco!.antecedencia_min]);
    expect(padroes('parado_entre_visitas')).toEqual([c.PARADO_MIN_PADRAO, p.parado_entre_visitas!.gestor_depois_min]);
    expect(padroes('sem_checkin_inicio')).toEqual([600]); // 10:00
    expect(padroes('rota_incompleta')).toEqual([960]); // 16:00
    expect(padroes('visita_aberta')).toEqual([p.visita_aberta!.apos_min]);
    expect(padroes('envio_pendente')).toEqual([p.envio_pendente!.apos_h]);
    // rótulo × valor: os de hora são `hora` (a tela mostra HH:MM); o "parado" é o `inicio.parado_min` do Core (D1)
    expect(campos.sem_checkin_inicio!.map((x) => x.tipo)).toEqual(['hora']);
    expect(campos.rota_incompleta!.map((x) => x.tipo)).toEqual(['hora']);
    expect(campos.parado_entre_visitas!.map((x) => x.origem)).toEqual(['core_parado_min', 'produtividade']);
  });
});

describe('T-0180 — o Gestor grava no contrato do Core (alertas.produtividade e parado-min)', () => {
  if (!comCore || !comGestor) {
    it('sem os dois PRs (core e gestor) no main, a costura ainda não roda', () => {
      expect(comCore && comGestor).toBe(false);
    });
    return;
  }

  it('formato do PUT: o que a tela monta passa no schema estrito e na validação do Core; o "parado" vai à parte', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const d = await carregar('../../modules/core/domain');
    const g = await carregar(TELA_GESTOR);
    const atual = { parametros: c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, paradoMin: 60 };
    const montar = g.montarSalvamentoProdutividade as (k: string, r: Qualquer, a: typeof atual) => { ok: boolean; parametros: unknown; paradoMin: number | null };
    const r = montar('parado_entre_visitas', { ativa: true, destinos: { gestor: false }, valores: { parado_min: 45, gestor_depois_min: 20 } }, atual);
    expect(r.ok).toBe(true);
    expect(r.paradoMin).toBe(45); // PUT /core/parametros/parado-min
    const s = (c.ParametrosAlertasProdutividadeSchema as Schema).safeParse(r.parametros);
    expect(s.error?.issues.map((i) => i.path.join('.') || '(raiz)') ?? []).toEqual([]);
    expect(JSON.stringify(r.parametros)).not.toContain('parado_min');
    expect((r.parametros as Record<string, Qualquer>).parado_entre_visitas).toEqual({ ativa: true, vendedor: true, gestor: false, gestor_depois_min: 20 });
    expect((d.validarParametrosAlertasProdutividade as (v: unknown) => { ok: boolean })(r.parametros).ok).toBe(true);
    // hora digitada HH:MM vira o minuto do dia do Core
    const h = montar('sem_checkin_inicio', { ativa: true, destinos: {}, valores: { ate_min: '09:30' } }, atual);
    expect((h.parametros as Record<string, Qualquer>).sem_checkin_inicio!.ate_min).toBe(570);
    // nada mudou = nada a gravar (escrita idempotente)
    expect(montar('visita_aberta', { ativa: true, destinos: {}, valores: { apos_min: 120 } }, atual)).toEqual({ ok: true, parametros: null, paradoMin: null });
  });

  it('as faixas da tela são as do Core (fim do almoço, gestor, visita aberta, envio e teto 1 a 10)', async () => {
    const c = await carregar(CONTRATOS_CORE);
    const g = await carregar(TELA_GESTOR);
    const F = c.FAIXAS_ALERTAS_PRODUTIVIDADE as Record<string, { min: number; max: number }>;
    const campos = g.CAMPOS_PRODUTIVIDADE as Record<string, { min: number; max: number }[]>;
    const faixa = (regra: string, i: number) => ({ min: campos[regra]![i]!.min, max: campos[regra]![i]!.max });
    expect(faixa('fim_almoco', 0)).toEqual(F.antecedencia_min);
    expect(faixa('parado_entre_visitas', 0)).toEqual({ min: c.PARADO_MIN_MIN, max: c.PARADO_MIN_MAX });
    expect(faixa('parado_entre_visitas', 1)).toEqual(F.gestor_depois_min);
    expect(faixa('visita_aberta', 0)).toEqual(F.visita_aberta_min);
    expect(faixa('envio_pendente', 0)).toEqual(F.envio_pendente_h);
    const teto = g.montarSalvamentoTeto as (t: number | null, a: Qualquer) => { ok: boolean };
    const atual = { parametros: c.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO };
    const { min, max } = F.teto_lembretes_dia!;
    expect([min - 1, min, max, max + 1].map((t) => teto(t, atual).ok)).toEqual([false, true, true, false]);
  });

  it('D1: a tela grava o "parado" pela rota própria do Core (PUT /core/parametros/parado-min, corpo { parado_min }), não pelo PUT do Início', async () => {
    const c = await carregar(CONTRATOS_CORE);
    expect(c.CAMINHO_PARAMETRO_PARADO_MIN).toBe('parametros/parado-min');
    const web = ler('modules/gestor/web/lib/parametros-alertas.ts');
    expect(web).toContain('`/core/${CAMINHO_PARAMETRO_PARADO_MIN}`');
    expect(web).toContain("method: 'PUT', body: { parado_min }");
    expect(web).not.toMatch(/body: \{ dias_uteis_semana/);
    expect((c.ParametroParadoMinSchema as Schema).safeParse({ parado_min: 45 }).success).toBe(true);
    expect((c.ParametroParadoMinSchema as Schema).safeParse({ parado_min: 45, dias_uteis_semana: [1] }).success).toBe(false);
  });

  it('o Gestor usa o tipo e o padrão do contrato do Core (sem espelho local)', async () => {
    const g = await carregar(TELA_GESTOR);
    expect(g).not.toHaveProperty('PARAMETROS_PRODUTIVIDADE_PADRAO');
    expect(ler('modules/gestor/domain/produtividade-do-dia.ts')).not.toContain('export interface ParametrosAlertasProdutividade');
    expect(ler('modules/gestor/domain/produtividade-do-dia.ts')).toContain("from '@macuxi/core/contracts'");
  });
});

describe('T-0180 — permissão e licença nas rotas novas (RN-CORE-03, RN-CORE-26, RN-CORE-44)', () => {
  if (!comCore) {
    it('antes do PR do modulo-core: não há rota de parâmetros de produtividade nem de jornada', () => {
      expect(comCore).toBe(false);
    });
    return;
  }

  it('Core: as rotas novas existem, são do BKO e usam a ação certa', async () => {
    const a = await carregar('../../modules/core/api/parametros-alertas');
    const j = await carregar('../../modules/core/api/parametros-jornada');
    const rotas = [...(a.rotasDeParametrosAlertas as Rota[]), ...(j.rotasDeParametrosJornada as Rota[])];
    expect(rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.superficie}`)).toEqual([
      'GET parametros/alertas-produtividade parametro.alertas_produtividade bko',
      'PUT parametros/alertas-produtividade parametro.alertas_produtividade bko',
      'GET parametros/parado-min parametro.alertas_produtividade bko',
      'PUT parametros/parado-min parametro.alertas_produtividade bko',
      'GET parametros/jornada parametro.inicio bko',
      'PUT parametros/jornada parametro.inicio bko',
    ]);
  });

  it('Core: só analista e admin; sem o módulo licenciado, ninguém (RN-CORE-03)', () => {
    for (const acao of ['parametro.alertas_produtividade', 'parametro.inicio']) {
      expect(quemPode([core], acao, ['core'])).toEqual(['analista', 'admin']);
      expect(quemPode([core], acao, [])).toEqual([]);
    }
  });

  if (!comGestor) return;

  it('Parâmetros › Alertas tem o mesmo público nas duas metades da tela (alerta_regra.gerenciar = parametro.alertas_produtividade)', () => {
    const modulos: ModuloId[] = ['core', 'gestor'];
    expect(quemPode([core, gestor], 'alerta_regra.gerenciar', modulos)).toEqual(quemPode([core, gestor], 'parametro.alertas_produtividade', modulos));
  });

  it('sem o Gestor licenciado, as regras da equipe e a lista de alertas somem (RN-CORE-03); a Produtividade do dia continua com o Core', () => {
    const lista = criarApiGestor(criarRepositorioEmMemoria()).rotas!.find((r) => r.metodo === 'GET' && r.caminho === 'alertas')!;
    const leem = (modulos: ModuloId[]) => PERFIS.filter((perfil) => verificarAcesso({ id: 'x', tenant_id: TENANT, perfil, modulos }, { modulo: 'gestor', perfis: lista.perfis! }).ok);
    expect(quemPode([core, gestor], 'alerta_regra.gerenciar', ['core'])).toEqual([]);
    expect(leem(['core'])).toEqual([]); // 403 MODULO_INATIVO
    expect(leem(['core', 'gestor'])).toEqual(expect.arrayContaining(['supervisor', 'gerente']));
    expect(leem(['core', 'gestor'])).not.toContain('vendedor');
    expect(leem(['core', 'gestor'])).not.toContain('promotor');
    expect(quemPode([core, gestor], 'parametro.alertas_produtividade', ['core'])).toEqual(['analista', 'admin']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Core → Gestor: a lista de alertas do Gestor com a consulta REAL do Core (`core.produtividade_equipe@1`) sobre um banco falso
// por tenant (o RLS vira "cada tenant lê só o próprio mapa"). Terça 03/11/2026, 11:00 em Manaus (15:00 UTC), dia útil.
// ---------------------------------------------------------------------------------------------------------------------------
const AGORA = '2026-11-03T15:00:00Z';
type DadosCore = { parametros: { chave: string; valor: unknown }[]; usuarios: Record<string, { almoco_inicio_min: number | null; almoco_fim_min: number | null; ultimo_contato_em: string | null }> };
const CADASTRO = [
  { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor' },
  { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor' },
  { id: VENDEDOR_2, nome: 'Vitor', perfil: 'vendedor' },
  { id: PROMOTOR, nome: 'Paula', perfil: 'promotor' },
];
const VISIVEIS = new Set(CADASTRO.map((c) => c.id));

/** Banco falso do Core por tenant: só as duas leituras da consulta (parâmetro do tenant e usuários com contato e almoço). */
const dbDoCore = (d: DadosCore) => ({
  query: async (sql: string, params: unknown[]) => {
    const lista = params[0] as string[];
    if (sql.includes('plataforma.parametro')) return { rows: d.parametros.filter((p) => lista.includes(p.chave)).map((p) => ({ modulo: 'core', ...p })), rowCount: 0 };
    if (sql.includes('core.usuario u')) return { rows: lista.filter((id) => d.usuarios[id]).map((id) => ({ id, ...d.usuarios[id]! })), rowCount: 0 };
    throw new Error(`SQL inesperado: ${sql}`);
  },
});

async function cenarioCoreGestor(dados: Record<string, DadosCore>) {
  const consultaCore = (await carregar('../../modules/core/api/produtividade-equipe')).consultaProdutividadeEquipe as { consulta: { entrada: Schema; saida: Schema }; executar: (e: unknown, ctx: unknown) => Promise<unknown> };
  const pedidosAoCore: { tenant: string; usuario_ids: string[] }[] = [];
  const api = criarApiGestor(criarRepositorioEmMemoria());
  const chamar = async (metodo: string, caminho: string, o: { tenant?: string; quem?: string; query?: unknown; params?: unknown; modulos?: ModuloId[] } = {}) => {
    const r = api.rotas!.find((x) => x.metodo === metodo && x.caminho === caminho) as RotaModulo;
    const tenant = o.tenant ?? TENANT;
    const quem = o.quem ?? SUPERVISOR;
    const tx = {
      publicar: async () => {},
      registrarArquivo: async () => {},
      auditar: async () => {},
      consultar: async (def: { nome: string }, entrada: { usuario_ids: string[] }) => {
        if (def.nome === 'core.calendario_metas@1') return { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] };
        if (def.nome === 'core.produtividade_equipe@1') {
          pedidosAoCore.push({ tenant, usuario_ids: [...entrada.usuario_ids].sort() });
          const e = consultaCore.consulta.entrada.parse(entrada);
          return consultaCore.consulta.saida.parse(await consultaCore.executar(e, { db: dbDoCore(dados[tenant]!), usuario: { id: quem, tenant_id: tenant } }));
        }
        return { clientes: [], produtos: [], usuarios: CADASTRO.filter((c) => entrada.usuario_ids.includes(c.id)).map((c) => ({ ...c, external_id: null })) };
      },
    };
    const ctx = {
      usuario: { id: quem, tenant_id: tenant, perfil: CADASTRO.find((c) => c.id === quem)!.perfil as Perfil, modulos: o.modulos ?? ['core', 'gestor', 'vendedor', 'promotor'] },
      dependencias: {},
      requestId: 'req-t0180',
      agora: () => new Date(AGORA),
      comTenant: async <T,>(fn: (db: never, tx: never) => Promise<T>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never, tx as never),
      carteira: async () => 'tenant' as const,
      usuariosVisiveis: async () => VISIVEIS,
      parametros: () => ({}),
      fuso: () => 'America/Manaus',
      log: { info: () => {}, warn: () => {}, error: () => {} },
      query: r.query ? r.query.parse(o.query ?? {}) : undefined,
      params: r.params ? r.params.parse(o.params ?? {}) : undefined,
      corpo: undefined,
    } as unknown as ContextoRota;
    return r.executar(ctx);
  };
  /** Entrega eventos do Core aos consumidores do Gestor, como a plataforma faz (envelope com o tenant). */
  const publicar = async (eventos: { evento_id: string; nome: string; ocorrido_em: string; payload: unknown }[], tenant = TENANT) => {
    for (const e of eventos) {
      const c = api.consumidores!.find((x) => x.evento.nome === e.nome)!;
      const ctx = { envelope: { evento_id: e.evento_id, nome: e.nome, origem: 'core', tenant_id: tenant, usuario_id: null, request_id: null, ocorrido_em: e.ocorrido_em, payload: e.payload }, db: {}, publicar: async () => {}, agora: () => new Date(AGORA), log: { info: () => {}, warn: () => {}, error: () => {} } };
      await c.executar(c.evento.schema.parse(e.payload), ctx as never);
    }
  };
  const alertas = async (o: { tenant?: string; produtividade?: boolean } = {}) =>
    ((await chamar('GET', 'alertas', { tenant: o.tenant, query: o.produtividade ? { produtividade: '1' } : {} })) as { itens: Alerta[] }).itens.filter((a) => ['sem_checkin_inicio', 'parado_entre_visitas'].includes(a.tipo));
  return { chamar, alertas, publicar, pedidosAoCore };
}
const usuario = (ultimo_contato_em: string | null, almoco: [number, number] | null = null) => ({ ultimo_contato_em, almoco_inicio_min: almoco?.[0] ?? null, almoco_fim_min: almoco?.[1] ?? null });

describe('T-0180 — Core → Gestor: o alerta de produtividade abre com o que o Core devolve (D4, ADR 0059 §1, §5 e §7)', () => {
  if (!comCore || !comGestor) {
    it('sem os PRs do core e do gestor no main, a lista do Gestor ainda não pede a produtividade ao Core', () => {
      expect(comCore && comGestor).toBe(false);
    });
    return;
  }

  it('sem check-in até 10:00: abre com `produtividade` e `ultimo_contato_em` do Core, só com `?produtividade=1`, um por pessoa', async () => {
    const c = await cenarioCoreGestor({
      [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:30:00Z'), [VENDEDOR_2]: usuario('2026-11-03T13:30:00Z'), [PROMOTOR]: usuario(null) } },
    });
    // Gestão anterior à v1.0.13: o tipo novo não vem na lista (e omitir não encerra o alerta)
    expect(await c.alertas()).toEqual([]);
    const com = await c.alertas({ produtividade: true });
    // Vera sincronizou às 10:30 (depois do "até" 10:00); Vitor às 09:30 (pode estar sem sinal); Paula nunca: só Vera
    expect(com.map((a) => [a.tipo, a.alvo_id, a.chave])).toEqual([['sem_checkin_inicio', VENDEDOR, `produtividade:${VENDEDOR}`]]);
    expect(await c.alertas()).toEqual([]);
    expect(await c.alertas({ produtividade: true })).toHaveLength(1); // idempotente: reconciliar de novo não duplica
    // escopo: o Gestor só pergunta ao Core pela gente de campo que ele vê (supervisor fica fora)
    expect(c.pedidosAoCore[0]).toEqual({ tenant: TENANT, usuario_ids: [VENDEDOR, VENDEDOR_2, PROMOTOR].sort() });
  });

  it('valor × regra: o "até" e o liga/desliga vêm do parâmetro `alertas.produtividade` salvo no Core do tenant', async () => {
    const C = await carregar(CONTRATOS_CORE);
    const P = C.PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as Record<string, Qualquer>;
    const contato = { [VENDEDOR]: usuario('2026-11-03T14:30:00Z') }; // 10:30 em Manaus
    const as1030 = { ...P, sem_checkin_inicio: { ...P.sem_checkin_inicio, ate_min: 645 } }; // até 10:45: contato 10:30 é antes
    const semGestor = { ...P, sem_checkin_inicio: { ...P.sem_checkin_inicio, gestor: false } };
    const c = await cenarioCoreGestor({
      [TENANT]: { parametros: [{ chave: 'alertas.produtividade', valor: as1030 }], usuarios: contato },
      [TENANT_B]: { parametros: [{ chave: 'alertas.produtividade', valor: semGestor }], usuarios: contato },
    });
    expect(await c.alertas({ produtividade: true })).toEqual([]);
    expect(await c.alertas({ tenant: TENANT_B, produtividade: true })).toEqual([]);
  });

  it('multi-tenant: o alerta do tenant A não aparece no B, e cada tenant usa o próprio Core', async () => {
    const c = await cenarioCoreGestor({
      [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:30:00Z') } },
      [TENANT_B]: { parametros: [], usuarios: { [VENDEDOR]: usuario(null) } },
    });
    expect((await c.alertas({ produtividade: true })).map((a) => a.alvo_id)).toEqual([VENDEDOR]);
    expect(await c.alertas({ tenant: TENANT_B, produtividade: true })).toEqual([]);
    expect(c.pedidosAoCore.map((p) => p.tenant)).toEqual([TENANT, TENANT_B]);
  });

  it('ADR 0059 §1: tipo de produtividade não tem ajuste em `alertas/regras/:tipo` (4xx de validação antes do banco, não 500)', async () => {
    const c = await cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: {} } });
    for (const tipo of ['parado_entre_visitas', 'sem_checkin_inicio']) {
      const erro = await c.chamar('PUT', 'alertas/regras/:tipo', { params: { tipo } }).catch((e: unknown) => e);
      expect((erro as { name?: string }).name).toBe('ZodError'); // a plataforma responde 400
    }
    expect(((await c.chamar('GET', 'alertas/regras')) as { regras: { tipo: string }[] }).regras.map((r) => r.tipo)).not.toContain('parado_entre_visitas');
  });
});

describe('T-0180 — Parado ao gestor: almoço do Core descontado e o mais novo substitui o anterior (RN-CORE-26, RN-CORE-44, D4)', () => {
  if (!comCore || !comGestor) {
    it('sem os PRs do core e do gestor no main, o parado ao gestor ainda não existe', () => {
      expect(comCore && comGestor).toBe(false);
    });
    return;
  }

  // rota com 2 clientes; checkout às 08:30 em Manaus (12:30 UTC); aparelho sincronizou 10:59
  const V1 = u(2180);
  const eventos = () => [
    ev('core.rota.dia_planejado@1', '2026-11-03T10:00:00Z', { usuario_id: VENDEDOR, data: '2026-11-03', cliente_ids: [CLIENTE_A, CLIENTE_B] }),
    checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-11-03T12:00:00Z' }),
    checkout({ visita: V1, cliente: CLIENTE_A, em: '2026-11-03T12:30:00Z' }),
  ];
  const MEMBROS = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor', superior_id: null, ativo: true }];

  async function parado(agora: string, almoco: [number, number] | null) {
    const g = await carregar('../../modules/gestor/domain');
    const consultaCore = (await carregar('../../modules/core/api/produtividade-equipe')).consultaProdutividadeEquipe as { consulta: { saida: Schema }; executar: (e: unknown, ctx: unknown) => Promise<unknown> };
    const saida = consultaCore.consulta.saida.parse(
      await consultaCore.executar({ usuario_ids: [VENDEDOR] }, { db: dbDoCore({ parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z', almoco) } }) }),
    ) as { parado_min: number; alertas: Qualquer; usuarios: { id: string; ultimo_contato_em: string | null; almoco_inicio_min: number; almoco_fim_min: number }[] };
    const estado = ((g.aplicarEventos as (e: unknown, ev: unknown[]) => { estado: unknown })((g.estadoInicial as () => unknown)(), eventos())).estado;
    const condicoes = (g.avaliarAlertas as (e: Qualquer) => (Alerta & { limiar: number | null })[])({
      estado,
      membros: MEMBROS,
      agora,
      modulos: new Set(['core']),
      regras: (g.resolverRegras as () => unknown)(),
      params: { parado_min: saida.parado_min },
      produtividade: saida.alertas,
      ultimo_contato_em: Object.fromEntries(saida.usuarios.map((x) => [x.id, x.ultimo_contato_em])),
      almoco: Object.fromEntries(saida.usuarios.map((x) => [x.id, { inicio_min: x.almoco_inicio_min, fim_min: x.almoco_fim_min }])),
    });
    return condicoes.filter((x) => x.tipo === 'parado_entre_visitas');
  }

  it('sem almoço na espera: 10:00 = 90 min (60 + 30) abre, com valor 90 e limiar 90; só com o módulo core', async () => {
    const [c] = await parado('2026-11-03T14:00:00Z', null); // almoço padrão 12:00–13:00 fica fora
    expect(c).toMatchObject({ tipo: 'parado_entre_visitas', chave: `produtividade:${VENDEDOR}`, valor: 90, limiar: 90 });
    expect(await parado('2026-11-03T13:59:00Z', null)).toEqual([]);
  });

  it('almoço da pessoa salvo no Core (09:00–10:00) é descontado: 10:00 vale 30 min, 11:00 vale 90 min', async () => {
    expect(await parado('2026-11-03T14:00:00Z', [540, 600])).toEqual([]);
    const [c] = await parado('2026-11-03T15:00:00Z', [540, 600]);
    expect(c?.valor).toBe(90);
  });

  it('um alerta por pessoa: o "parado" substitui o "sem check-in" vivo (mesmo dispensado) e reconciliar de novo não muda nada', async () => {
    const g = await carregar('../../modules/gestor/domain');
    const [cond] = await parado('2026-11-03T14:00:00Z', null);
    const reconciliar = g.reconciliarAlertas as (ex: Qualquer[], c: unknown[], o: Qualquer) => { abrir: Alerta[]; atualizar: unknown[]; encerrar: { id: string; motivo: string }[] };
    const ativos = new Set(['parado_entre_visitas', 'sem_checkin_inicio']);
    const vivo = { id: u(9180), chave: `produtividade:${VENDEDOR}`, tipo: 'sem_checkin_inicio', status: 'dispensado', valor: null, mensagem: 'Vera', severidade: 'atencao', aberto_em: '2026-11-03T14:05:00Z' };
    const ops = reconciliar([vivo], [cond], { agora: '2026-11-03T14:00:00Z', tipos_ativos: ativos });
    expect(ops.encerrar).toEqual([expect.objectContaining({ id: vivo.id })]);
    expect(ops.abrir.map((a) => a.tipo)).toEqual(['parado_entre_visitas']);
    const novo = { ...cond!, id: u(9181), status: 'aberto', mensagem: (cond as unknown as { mensagem: string }).mensagem, severidade: 'atencao', aberto_em: '2026-11-03T14:00:00Z' };
    expect(reconciliar([{ ...vivo, status: 'encerrado' }, novo], [cond], { agora: '2026-11-03T14:01:00Z', tipos_ativos: ativos })).toEqual({ abrir: [], atualizar: [], encerrar: [] });
  });

  it('pela API, sem rota do dia (o Core não publica `core.rota.dia_planejado@1`): o "Parado" abre ao gestor com o almoço do Core descontado', async () => {
    // checkout 08:30, agora 11:00 em Manaus: 150 min corridos; com o almoço da pessoa no Core (09:00–10:00), 90 min = 60 + 30
    const V2 = u(2181);
    const dia = [checkin({ visita: V2, cliente: CLIENTE_A, em: '2026-11-03T12:00:00Z' }), checkout({ visita: V2, cliente: CLIENTE_A, em: '2026-11-03T12:30:00Z' })];
    expect(gestor.consome).not.toContain('core.rota.dia_planejado@1');
    const semAlmoco = await cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z') } } });
    await semAlmoco.publicar(dia);
    expect((await semAlmoco.alertas({ produtividade: true })).map((a) => [a.tipo, a.alvo_id, a.valor])).toEqual([['parado_entre_visitas', VENDEDOR, 150]]);
    const comAlmoco = await cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z', [540, 600]) } } });
    await comAlmoco.publicar(dia);
    expect((await comAlmoco.alertas({ produtividade: true })).map((a) => [a.tipo, a.valor])).toEqual([['parado_entre_visitas', 90]]);
    // sem sinal depois do checkout (último contato 08:00): não acusa
    const semSinal = await cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T12:00:00Z') } } });
    await semSinal.publicar(dia);
    expect(await semSinal.alertas({ produtividade: true })).toEqual([]);
  });
});
