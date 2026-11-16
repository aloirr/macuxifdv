/**
 * T-0180 / v1.0.14 (alertas de produtividade e Parâmetros › Alertas): costura entre o Core e o Gestor, valor × regra (D1, D5, D6,
 * RN-CORE-26, RN-GES-01/02/03), licença do módulo (RN-CORE-03), permissão, multi-tenant, dia útil, expediente e fuso do tenant.
 * Os testes de unidade de cada regra ficam nos módulos; aqui fica o que só aparece quando os PRs se encontram: o Gestor monta a tela e
 * grava no parâmetro do Core, a lista de alertas do Gestor abre o alerta com o que a consulta REAL `core.produtividade_equipe@1`
 * devolve, e `GET|PUT /v1/gestor/parametros/alertas` grava pelo SDK (`ctx.gravarParametros`).
 * Vale contra o código dos PRs #390 (gestor), #419 (engenheiro-software), #395 (banco) e #405 (designer-ux) com o modulo-core da T-0180
 * (`nuvem/v1014-alertas-modulo-core`): sem eles no main, este arquivo não compila (de propósito: nada é pulado).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALMOCO_PADRAO_EMPRESA,
  CAMINHO_PARAMETRO_PARADO_MIN,
  FAIXAS_ALERTAS_PRODUTIVIDADE as FAIXAS,
  PARADO_MIN_MAX,
  PARADO_MIN_MIN,
  PARADO_MIN_PADRAO,
  PARAMETRO_PARADO_MIN,
  PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as PADRAO,
  ParametroParadoMinSchema,
  ParametrosAlertasProdutividadeSchema,
  type ParametrosAlertasProdutividade,
} from '@macuxi/core/contracts';
import { criarPermissoes, verificarAcao, verificarAcesso, PERFIS, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { consultaProdutividadeEquipe } from '../../modules/core/api/produtividade-equipe';
import { rotasDeParametrosAlertas as rotasCoreAlertas } from '../../modules/core/api/parametros-alertas';
import { rotasDeParametrosJornada } from '../../modules/core/api/parametros-jornada';
import { validarParametrosAlertasProdutividade } from '../../modules/core/domain';
import { manifest as core } from '../../modules/core/manifest';
import { criarApiGestor, criarRepositorioEmMemoria } from '../../modules/gestor/api';
import {
  aplicarEventos,
  avaliarAlertas,
  CAMPOS_PRODUTIVIDADE,
  estadoInicial,
  montarSalvamentoProdutividade,
  montarSalvamentoTeto,
  reconciliarAlertas,
  resolverRegras,
  type AlertaExistente,
} from '../../modules/gestor/domain';
import { CLIENTE_A, CLIENTE_B, checkin, checkout, ev, PROMOTOR, SUPERVISOR, u, VENDEDOR, VENDEDOR_2 } from '../../modules/gestor/domain/fixtures';
import { manifest as gestor } from '../../modules/gestor/manifest';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const TENANT_B = '0b000000-0000-4000-8000-0000000000bb';
type Alerta = { tipo: string; chave: string; alvo_id: string; valor: number | null; status: string };
const quemPode = (manifestos: Parameters<typeof criarPermissoes>[0], acao: string, modulos: ModuloId[]) => {
  const p = criarPermissoes(manifestos);
  return PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, p, acao).ok);
};

describe('T-0180 — D6: os padrões em todo lugar (valor × regra)', () => {
  it('Core: almoço 10 min antes; parado com gestor +30 min; sem check-in até 10:00; rota às 16:00; visita aberta 120 min; envio 4 h; teto 4', () => {
    expect(PADRAO).toEqual({
      fim_almoco: { ativa: true, antecedencia_min: 10, vendedor: true },
      parado_entre_visitas: { ativa: true, vendedor: true, gestor: true, gestor_depois_min: 30 },
      sem_checkin_inicio: { ativa: true, ate_min: 600, vendedor: true, gestor: true },
      rota_incompleta: { ativa: true, as_min: 960, vendedor: true },
      visita_aberta: { ativa: true, apos_min: 120, vendedor: true },
      envio_pendente: { ativa: true, apos_h: 4, vendedor: true },
      teto_lembretes_dia: 4,
    });
    expect(ParametrosAlertasProdutividadeSchema.safeParse(PADRAO).success).toBe(true);
  });

  it('D5: almoço padrão da empresa 12:00 às 13:00; D1: "parado" 60 min num valor só (inicio.parado_min)', () => {
    expect(ALMOCO_PADRAO_EMPRESA).toEqual({ inicio_min: 720, fim_min: 780 });
    expect(PARADO_MIN_PADRAO).toBe(60);
    expect(PARAMETRO_PARADO_MIN).toBe('inicio.parado_min');
    expect(JSON.stringify(PADRAO)).not.toContain('parado_min');
  });

  it('D1: o campo do "parado" sumiu do painel Parâmetros › Início do BKO', () => {
    expect(ler('modules/core/web/components/metas/inicio-parametros-panel.tsx')).not.toContain('data-testid="inicio-params.parado"');
  });

  it('Gestor: a tela mostra os MESMOS números do Core (10, +30, 10:00 e 16:00 como minuto do dia, 120, 4 h; parado 60)', () => {
    const padroes = (regra: keyof typeof CAMPOS_PRODUTIVIDADE) => CAMPOS_PRODUTIVIDADE[regra].map((x) => x.padrao);
    expect(padroes('fim_almoco')).toEqual([PADRAO.fim_almoco.antecedencia_min]);
    expect(padroes('parado_entre_visitas')).toEqual([PARADO_MIN_PADRAO, PADRAO.parado_entre_visitas.gestor_depois_min]);
    expect(padroes('sem_checkin_inicio')).toEqual([600]); // 10:00
    expect(padroes('rota_incompleta')).toEqual([960]); // 16:00
    expect(padroes('visita_aberta')).toEqual([PADRAO.visita_aberta.apos_min]);
    expect(padroes('envio_pendente')).toEqual([PADRAO.envio_pendente.apos_h]);
    // rótulo × valor: os de hora são `hora` (a tela mostra HH:MM); o "parado" é o `inicio.parado_min` do Core (D1); a unidade diz o que o número é
    expect(CAMPOS_PRODUTIVIDADE.sem_checkin_inicio.map((x) => x.tipo)).toEqual(['hora']);
    expect(CAMPOS_PRODUTIVIDADE.rota_incompleta.map((x) => x.tipo)).toEqual(['hora']);
    expect(CAMPOS_PRODUTIVIDADE.parado_entre_visitas.map((x) => x.origem)).toEqual(['core_parado_min', 'produtividade']);
    expect(CAMPOS_PRODUTIVIDADE.envio_pendente.map((x) => x.unidade)).toEqual(['h']);
    expect(CAMPOS_PRODUTIVIDADE.visita_aberta.map((x) => x.unidade)).toEqual(['min']);
  });
});

describe('T-0180 — o Gestor grava no contrato do Core (alertas.produtividade e parado-min)', () => {
  const atual = { parametros: PADRAO, paradoMin: 60 };

  it('formato do PUT: o que a tela monta passa no schema estrito e na validação do Core; o "parado" vai à parte', () => {
    const r = montarSalvamentoProdutividade('parado_entre_visitas', { ativa: true, destinos: { gestor: false }, valores: { parado_min: 45, gestor_depois_min: 20 } }, atual);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.paradoMin).toBe(45); // PUT /core/parametros/parado-min
    const s = ParametrosAlertasProdutividadeSchema.safeParse(r.parametros);
    expect(s.error?.issues.map((i) => i.path.join('.') || '(raiz)') ?? []).toEqual([]);
    expect(JSON.stringify(r.parametros)).not.toContain('parado_min');
    expect(r.parametros?.parado_entre_visitas).toEqual({ ativa: true, vendedor: true, gestor: false, gestor_depois_min: 20 });
    expect(validarParametrosAlertasProdutividade(r.parametros!).ok).toBe(true);
    // hora digitada HH:MM vira o minuto do dia do Core
    const h = montarSalvamentoProdutividade('sem_checkin_inicio', { ativa: true, destinos: {}, valores: { ate_min: '09:30' } }, atual);
    expect(h.ok && h.parametros?.sem_checkin_inicio.ate_min).toBe(570);
    // nada mudou = nada a gravar (escrita idempotente)
    expect(montarSalvamentoProdutividade('visita_aberta', { ativa: true, destinos: {}, valores: { apos_min: 120 } }, atual)).toEqual({ ok: true, parametros: null, paradoMin: null });
  });

  it('as faixas da tela são as do Core (fim do almoço, gestor, visita aberta, envio e teto 1 a 10), inclusive nos limites', () => {
    const faixa = (regra: keyof typeof CAMPOS_PRODUTIVIDADE, i: number) => ({ min: CAMPOS_PRODUTIVIDADE[regra][i]!.min, max: CAMPOS_PRODUTIVIDADE[regra][i]!.max });
    expect(faixa('fim_almoco', 0)).toEqual(FAIXAS.antecedencia_min);
    expect(faixa('parado_entre_visitas', 0)).toEqual({ min: PARADO_MIN_MIN, max: PARADO_MIN_MAX });
    expect(faixa('parado_entre_visitas', 1)).toEqual(FAIXAS.gestor_depois_min);
    expect(faixa('visita_aberta', 0)).toEqual(FAIXAS.visita_aberta_min);
    expect(faixa('envio_pendente', 0)).toEqual(FAIXAS.envio_pendente_h);
    const { min, max } = FAIXAS.teto_lembretes_dia;
    expect([min - 1, min, max, max + 1].map((t) => montarSalvamentoTeto(t, atual).ok)).toEqual([false, true, true, false]);
    // "parado" no limite: 15 e 480 aceitos, 14 e 481 recusados (nada é enviado)
    const parado = (n: number) => montarSalvamentoProdutividade('parado_entre_visitas', { ativa: true, destinos: {}, valores: { parado_min: n, gestor_depois_min: 30 } }, atual).ok;
    expect([PARADO_MIN_MIN - 1, PARADO_MIN_MIN, PARADO_MIN_MAX, PARADO_MIN_MAX + 1].map(parado)).toEqual([false, true, true, false]);
  });

  it('D1: a tela grava o "parado" pela rota própria do Core (PUT /core/parametros/parado-min, corpo { parado_min }), não pelo PUT do Início', () => {
    expect(CAMINHO_PARAMETRO_PARADO_MIN).toBe('parametros/parado-min');
    const web = ler('modules/gestor/web/lib/parametros-alertas.ts');
    expect(web).toContain('`/core/${CAMINHO_PARAMETRO_PARADO_MIN}`');
    expect(web).toContain("method: 'PUT', body: { parado_min }");
    expect(web).not.toMatch(/body: \{ dias_uteis_semana/);
    expect(ParametroParadoMinSchema.safeParse({ parado_min: 45 }).success).toBe(true);
    expect(ParametroParadoMinSchema.safeParse({ parado_min: 45, dias_uteis_semana: [1] }).success).toBe(false);
  });

  it('o Gestor usa o tipo e o padrão do contrato do Core (sem espelho local)', () => {
    const fonte = ler('modules/gestor/domain/produtividade-do-dia.ts');
    expect(fonte).not.toContain('PARAMETROS_PRODUTIVIDADE_PADRAO =');
    expect(fonte).not.toContain('export interface ParametrosAlertasProdutividade');
    expect(fonte).toContain("from '@macuxi/core/contracts'");
  });
});

describe('T-0180 — permissão e licença nas rotas novas (RN-CORE-03)', () => {
  it('Core: as rotas novas existem, são do BKO e usam a ação certa', () => {
    const rotas = [...rotasCoreAlertas, ...rotasDeParametrosJornada] as Array<RotaModulo & { superficie?: string }>;
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

  it('Parâmetros › Alertas tem o mesmo público nas duas metades da tela (alerta_regra.gerenciar = parametro.alertas_produtividade)', () => {
    const modulos: ModuloId[] = ['core', 'gestor'];
    expect(quemPode([core, gestor], 'alerta_regra.gerenciar', modulos)).toEqual(quemPode([core, gestor], 'parametro.alertas_produtividade', modulos));
    const parametros = criarApiGestor(criarRepositorioEmMemoria()).rotas!.filter((r) => r.caminho === 'parametros/alertas');
    expect(parametros.map((r) => `${r.metodo} ${r.acao}`)).toEqual(['GET alerta_regra.gerenciar', 'PUT alerta_regra.gerenciar']);
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

describe('T-0180 — GET|PUT /v1/gestor/parametros/alertas (RN-GES-01/02/03; um valor, um lugar)', () => {
  const rota = (metodo: string) => criarApiGestor(criarRepositorioEmMemoria()).rotas!.find((r) => r.metodo === metodo && r.caminho === 'parametros/alertas')!;
  const chamar = async (metodo: string, o: { tenant?: Record<string, unknown>; corpo?: unknown } = {}) => {
    const gravados: Array<{ valores: unknown; opcoes: unknown }> = [];
    const r = rota(metodo);
    const ctx = {
      usuario: { id: u(9001), tenant_id: TENANT, perfil: 'analista' as Perfil, modulos: ['core', 'gestor'] },
      agora: () => new Date('2026-11-03T15:00:00Z'),
      parametros: () => o.tenant ?? {},
      fuso: () => 'America/Manaus',
      comTenant: async <T,>(fn: (db: never, tx: never) => Promise<T>) => fn({} as never, {} as never),
      gravarParametros: async (valores: unknown, opcoes: unknown) => void gravados.push({ valores, opcoes }),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      corpo: r.corpo ? r.corpo.parse(o.corpo) : undefined,
    } as unknown as ContextoRota;
    return { resposta: await r.executar(ctx), gravados };
  };
  const NOVO = { pct_tolerancia_frequencia: 50, dias_sem_visita_padrao: 30, dias_carencia_cliente_novo: 15, prazo_aprovacao_dias_uteis: 1 };

  it('sem nada salvo, os valores da RN: tolerância 50%, 30 dias sem frequência, carência 15 dias, prazo 1 dia útil', async () => {
    expect((await chamar('GET')).resposta).toEqual(NOVO);
  });

  it('valor salvo fora da faixa vale o padrão, chave por chave (o resto do que está salvo continua)', async () => {
    const { resposta } = await chamar('GET', { tenant: { pct_tolerancia_frequencia: 900, dias_sem_visita_padrao: 20 } });
    expect(resposta).toEqual({ ...NOVO, dias_sem_visita_padrao: 20 });
  });

  it('PUT grava os 4 valores pelo SDK, com a ação da rota (auditado e idempotente no SDK)', async () => {
    const corpo = { ...NOVO, prazo_aprovacao_dias_uteis: 2 };
    const { resposta, gravados } = await chamar('PUT', { corpo });
    expect(resposta).toEqual(corpo);
    expect(gravados).toEqual([{ valores: corpo, opcoes: { acao: 'alerta_regra.gerenciar' } }]);
  });

  it('RN-GES-03: prazo que deixa o aviso da fila (horas úteis) maior que o prazo é 422 e nada é gravado; com prazo maior, grava', async () => {
    // aviso de 12 h úteis no tenant: 1 dia útil = 10 h (08:00–18:00) não comporta; 2 dias = 20 h comporta
    const erro = await chamar('PUT', { tenant: { aprovacao_aviso_horas: 12 }, corpo: NOVO }).catch((e: unknown) => e);
    expect(erro).toMatchObject({ status: 422, codigo: 'RN-GES-03' });
    const ok = await chamar('PUT', { tenant: { aprovacao_aviso_horas: 12 }, corpo: { ...NOVO, prazo_aprovacao_dias_uteis: 2 } });
    expect(ok.gravados).toHaveLength(1);
  });

  it('corpo fora da faixa ou com chave a mais (permanência mínima é do Promotor) é recusado antes de gravar', () => {
    const corpo = rota('PUT').corpo!;
    expect(corpo.safeParse({ ...NOVO, prazo_aprovacao_dias_uteis: 0 }).success).toBe(false);
    expect(corpo.safeParse({ ...NOVO, pct_tolerancia_frequencia: 501 }).success).toBe(false);
    expect(corpo.safeParse({ ...NOVO, permanencia_min_min: 5 }).success).toBe(false);
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
const executarCore = consultaProdutividadeEquipe as unknown as {
  consulta: { entrada: { parse: (v: unknown) => unknown }; saida: { parse: (v: unknown) => unknown } };
  executar: (e: unknown, ctx: unknown) => Promise<unknown>;
};

function cenarioCoreGestor(dados: Record<string, DadosCore>) {
  const pedidosAoCore: { tenant: string; usuario_ids: string[] }[] = [];
  const api = criarApiGestor(criarRepositorioEmMemoria());
  const chamar = async (metodo: string, caminho: string, o: { tenant?: string; quem?: string; query?: unknown; params?: unknown; modulos?: ModuloId[]; agora?: string } = {}) => {
    const r = api.rotas!.find((x) => x.metodo === metodo && x.caminho === caminho) as RotaModulo;
    const tenant = o.tenant ?? TENANT;
    const quem = o.quem ?? SUPERVISOR;
    const agora = o.agora ?? AGORA;
    const tx = {
      publicar: async () => {},
      registrarArquivo: async () => {},
      auditar: async () => {},
      consultar: async (def: { nome: string }, entrada: { usuario_ids: string[] }) => {
        if (def.nome === 'core.calendario_metas@1') return { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] };
        if (def.nome === 'core.produtividade_equipe@1') {
          pedidosAoCore.push({ tenant, usuario_ids: [...entrada.usuario_ids].sort() });
          const e = executarCore.consulta.entrada.parse(entrada);
          return executarCore.consulta.saida.parse(await executarCore.executar(e, { db: dbDoCore(dados[tenant]!), usuario: { id: quem, tenant_id: tenant } }));
        }
        return { clientes: [], produtos: [], usuarios: CADASTRO.filter((c) => entrada.usuario_ids.includes(c.id)).map((c) => ({ ...c, external_id: null })) };
      },
    };
    const ctx = {
      usuario: { id: quem, tenant_id: tenant, perfil: CADASTRO.find((c) => c.id === quem)!.perfil as Perfil, modulos: o.modulos ?? ['core', 'gestor', 'vendedor', 'promotor'] },
      dependencias: {},
      requestId: 'req-t0180',
      agora: () => new Date(agora),
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
  const alertas = async (o: { tenant?: string; produtividade?: boolean; agora?: string } = {}) =>
    ((await chamar('GET', 'alertas', { tenant: o.tenant, agora: o.agora, query: o.produtividade ? { produtividade: '1' } : {} })) as { itens: Alerta[] }).itens.filter((a) => ['sem_checkin_inicio', 'parado_entre_visitas'].includes(a.tipo));
  return { chamar, alertas, publicar, pedidosAoCore };
}
const usuario = (ultimo_contato_em: string | null, almoco: [number, number] | null = null) => ({ ultimo_contato_em, almoco_inicio_min: almoco?.[0] ?? null, almoco_fim_min: almoco?.[1] ?? null });

describe('T-0180 — Core → Gestor: o alerta de produtividade abre com o que o Core devolve (D4, ADR 0059 §1, §5 e §7)', () => {
  it('sem check-in até 10:00: abre com `produtividade` e `ultimo_contato_em` do Core, só com `?produtividade=1`, um por pessoa', async () => {
    const c = cenarioCoreGestor({
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
    const contato = { [VENDEDOR]: usuario('2026-11-03T14:30:00Z') }; // 10:30 em Manaus
    const ate1045: ParametrosAlertasProdutividade = { ...PADRAO, sem_checkin_inicio: { ...PADRAO.sem_checkin_inicio, ate_min: 645 } }; // contato 10:30 é antes
    const semGestor: ParametrosAlertasProdutividade = { ...PADRAO, sem_checkin_inicio: { ...PADRAO.sem_checkin_inicio, gestor: false } };
    const desligada: ParametrosAlertasProdutividade = { ...PADRAO, sem_checkin_inicio: { ...PADRAO.sem_checkin_inicio, ativa: false } };
    const c = cenarioCoreGestor({
      [TENANT]: { parametros: [{ chave: 'alertas.produtividade', valor: ate1045 }], usuarios: contato },
      [TENANT_B]: { parametros: [{ chave: 'alertas.produtividade', valor: semGestor }], usuarios: contato },
    });
    expect(await c.alertas({ produtividade: true })).toEqual([]);
    expect(await c.alertas({ tenant: TENANT_B, produtividade: true })).toEqual([]);
    const d = cenarioCoreGestor({ [TENANT]: { parametros: [{ chave: 'alertas.produtividade', valor: desligada }], usuarios: contato } });
    expect(await d.alertas({ produtividade: true })).toEqual([]);
  });

  it('fuso do tenant: o "até 10:00" é 10:00 em Manaus (14:00 UTC); contato às 09:59 não abre, às 10:01 abre', async () => {
    const antes = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T13:59:00Z') } } });
    expect(await antes.alertas({ produtividade: true, agora: '2026-11-03T14:05:00Z' })).toEqual([]);
    const depois = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:01:00Z') } } });
    expect((await depois.alertas({ produtividade: true, agora: '2026-11-03T14:05:00Z' })).map((a) => a.tipo)).toEqual(['sem_checkin_inicio']);
    // antes das 10:00 em Manaus (09:50 = 13:50 UTC), mesmo com contato, ainda não vale
    const cedo = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T13:45:00Z') } } });
    expect(await cedo.alertas({ produtividade: true, agora: '2026-11-03T13:50:00Z' })).toEqual([]);
  });

  it('dia não útil e fora do expediente: domingo 08/11 às 11:00 e terça 03/11 às 18:30 (Manaus) não abrem, com contato depois do "até"', async () => {
    const domingo = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-08T14:30:00Z') } } });
    expect(await domingo.alertas({ produtividade: true, agora: '2026-11-08T15:00:00Z' })).toEqual([]);
    const noite = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T22:20:00Z') } } });
    expect(await noite.alertas({ produtividade: true, agora: '2026-11-03T22:30:00Z' })).toEqual([]);
  });

  it('virada de dia no fuso: 04/11 03:30 UTC ainda é 03/11 23:30 em Manaus, fora do expediente: não abre', async () => {
    // 03/11 23:30 local = 04/11 03:30 UTC: em UTC já é outro dia, mas o dia civil do tenant é 03/11 e está fora do horário comercial
    const c = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-04T03:20:00Z') } } });
    expect(await c.alertas({ produtividade: true, agora: '2026-11-04T03:30:00Z' })).toEqual([]);
  });

  it('multi-tenant: o alerta do tenant A não aparece no B, e cada tenant usa o próprio Core', async () => {
    const c = cenarioCoreGestor({
      [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:30:00Z') } },
      [TENANT_B]: { parametros: [], usuarios: { [VENDEDOR]: usuario(null) } },
    });
    expect((await c.alertas({ produtividade: true })).map((a) => a.alvo_id)).toEqual([VENDEDOR]);
    expect(await c.alertas({ tenant: TENANT_B, produtividade: true })).toEqual([]);
    expect(c.pedidosAoCore.map((p) => p.tenant)).toEqual([TENANT, TENANT_B]);
  });

  it('ADR 0059 §1: tipo de produtividade não tem ajuste em `alertas/regras/:tipo` (4xx de validação antes do banco, não 500)', async () => {
    const c = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: {} } });
    for (const tipo of ['parado_entre_visitas', 'sem_checkin_inicio']) {
      const erro = await c.chamar('PUT', 'alertas/regras/:tipo', { params: { tipo } }).catch((e: unknown) => e);
      expect((erro as { name?: string }).name).toBe('ZodError'); // a plataforma responde 400
    }
    expect(((await c.chamar('GET', 'alertas/regras')) as { regras: { tipo: string }[] }).regras.map((r) => r.tipo)).not.toContain('parado_entre_visitas');
  });
});

describe('T-0180 — Parado ao gestor: almoço da pessoa (Core) descontado e o mais novo substitui o anterior (RN-CORE-26, D4, D5)', () => {
  // rota com 2 clientes; checkout às 08:30 em Manaus (12:30 UTC); aparelho sincronizou 10:59
  const V1 = u(2180);
  const eventos = () => [
    ev('core.rota.dia_planejado@1', '2026-11-03T10:00:00Z', { usuario_id: VENDEDOR, data: '2026-11-03', cliente_ids: [CLIENTE_A, CLIENTE_B] }),
    checkin({ visita: V1, cliente: CLIENTE_A, em: '2026-11-03T12:00:00Z' }),
    checkout({ visita: V1, cliente: CLIENTE_A, em: '2026-11-03T12:30:00Z' }),
  ];
  const MEMBROS = [{ id: VENDEDOR, nome: 'Vera', perfil: 'vendedor' as const, superior_id: null, ativo: true }];

  async function parado(agora: string, almoco: [number, number] | null) {
    const saida = executarCore.consulta.saida.parse(
      await executarCore.executar({ usuario_ids: [VENDEDOR] }, { db: dbDoCore({ parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z', almoco) } }) }),
    ) as { parado_min: number; alertas: ParametrosAlertasProdutividade; usuarios: { id: string; ultimo_contato_em: string | null; almoco_inicio_min: number; almoco_fim_min: number }[] };
    const { estado } = aplicarEventos(estadoInicial(), eventos() as never);
    const condicoes = avaliarAlertas({
      estado,
      membros: MEMBROS as never,
      agora,
      modulos: new Set(['core']),
      regras: resolverRegras(),
      params: { parado_min: saida.parado_min },
      produtividade: saida.alertas,
      ultimo_contato_em: Object.fromEntries(saida.usuarios.map((x) => [x.id, x.ultimo_contato_em])),
      almoco: Object.fromEntries(saida.usuarios.map((x) => [x.id, { inicio_min: x.almoco_inicio_min, fim_min: x.almoco_fim_min }])),
    });
    return condicoes.filter((x) => x.tipo === 'parado_entre_visitas');
  }

  it('sem almoço na espera: 10:00 = 90 min (60 + 30) abre, com valor 90 e limiar 90; 09:59 (89 min) não; só com o módulo core', async () => {
    const [c] = await parado('2026-11-03T14:00:00Z', null); // almoço padrão 12:00–13:00 fica fora
    expect(c).toMatchObject({ tipo: 'parado_entre_visitas', chave: `produtividade:${VENDEDOR}`, valor: 90, limiar: 90, mensagem: 'Vera: último checkout às 08:30.' });
    expect(await parado('2026-11-03T13:59:00Z', null)).toEqual([]);
  });

  it('D5: almoço da pessoa salvo no Core (09:00–10:00) é descontado: 10:00 vale 30 min, 11:00 vale 90 min', async () => {
    expect(await parado('2026-11-03T14:00:00Z', [540, 600])).toEqual([]);
    const [c] = await parado('2026-11-03T15:00:00Z', [540, 600]);
    expect(c?.valor).toBe(90);
  });

  it('D4: um alerta por pessoa: o "parado" substitui o "sem check-in" vivo (mesmo dispensado) e reconciliar de novo não muda nada', async () => {
    const [cond] = await parado('2026-11-03T14:00:00Z', null);
    const ativos = new Set(['parado_entre_visitas', 'sem_checkin_inicio'] as const);
    const vivo: AlertaExistente = { id: u(9180), chave: `produtividade:${VENDEDOR}`, tipo: 'sem_checkin_inicio', status: 'dispensado', valor: null, mensagem: 'Vera', severidade: 'atencao', aberto_em: '2026-11-03T14:05:00Z' };
    const ops = reconciliarAlertas([vivo], [cond!], { agora: '2026-11-03T14:00:00Z', tipos_ativos: ativos });
    expect(ops.encerrar).toEqual([expect.objectContaining({ id: vivo.id })]);
    expect(ops.abrir.map((a) => a.tipo)).toEqual(['parado_entre_visitas']);
    const novo: AlertaExistente = { id: u(9181), chave: cond!.chave, tipo: cond!.tipo, status: 'aberto', valor: cond!.valor, mensagem: cond!.mensagem, severidade: 'atencao', aberto_em: '2026-11-03T14:00:00Z' };
    expect(reconciliarAlertas([{ ...vivo, status: 'encerrado' }, novo], [cond!], { agora: '2026-11-03T14:01:00Z', tipos_ativos: ativos })).toEqual({ abrir: [], atualizar: [], encerrar: [] });
  });

  it('pela API, sem rota do dia (o Core não publica `core.rota.dia_planejado@1`): o "Parado" abre ao gestor com o almoço do Core descontado', async () => {
    // checkout 08:30, agora 11:00 em Manaus: 150 min corridos; com o almoço da pessoa no Core (09:00–10:00), 90 min = 60 + 30
    const V2 = u(2181);
    const dia = [checkin({ visita: V2, cliente: CLIENTE_A, em: '2026-11-03T12:00:00Z' }), checkout({ visita: V2, cliente: CLIENTE_A, em: '2026-11-03T12:30:00Z' })];
    expect(gestor.consome).not.toContain('core.rota.dia_planejado@1');
    const semAlmoco = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z') } } });
    await semAlmoco.publicar(dia);
    expect((await semAlmoco.alertas({ produtividade: true })).map((a) => [a.tipo, a.alvo_id, a.valor])).toEqual([['parado_entre_visitas', VENDEDOR, 150]]);
    const comAlmoco = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T14:59:00Z', [540, 600]) } } });
    await comAlmoco.publicar(dia);
    expect((await comAlmoco.alertas({ produtividade: true })).map((a) => [a.tipo, a.valor])).toEqual([['parado_entre_visitas', 90]]);
    // sem sinal depois do checkout (último contato 08:00): não acusa
    const semSinal = cenarioCoreGestor({ [TENANT]: { parametros: [], usuarios: { [VENDEDOR]: usuario('2026-11-03T12:00:00Z') } } });
    await semSinal.publicar(dia);
    expect(await semSinal.alertas({ produtividade: true })).toEqual([]);
  });

  it('o "parado" salvo no tenant (inicio.parado_min = 45) muda o limiar do gestor para 75 (45 + 30)', async () => {
    const V3 = u(2182);
    const dia = [checkin({ visita: V3, cliente: CLIENTE_A, em: '2026-11-03T12:00:00Z' }), checkout({ visita: V3, cliente: CLIENTE_A, em: '2026-11-03T12:30:00Z' })];
    // 08:30 → 09:45 = 75 min (abre no limite); 09:44 = 74 min (não abre)
    const abre = cenarioCoreGestor({ [TENANT]: { parametros: [{ chave: PARAMETRO_PARADO_MIN, valor: 45 }], usuarios: { [VENDEDOR]: usuario('2026-11-03T13:44:30Z') } } });
    await abre.publicar(dia);
    expect((await abre.alertas({ produtividade: true, agora: '2026-11-03T13:45:00Z' })).map((a) => [a.tipo, a.valor])).toEqual([['parado_entre_visitas', 75]]);
    const naoAbre = cenarioCoreGestor({ [TENANT]: { parametros: [{ chave: PARAMETRO_PARADO_MIN, valor: 45 }], usuarios: { [VENDEDOR]: usuario('2026-11-03T13:43:30Z') } } });
    await naoAbre.publicar(dia);
    expect((await naoAbre.alertas({ produtividade: true, agora: '2026-11-03T13:44:00Z' })).filter((a) => a.tipo === 'parado_entre_visitas')).toEqual([]);
  });
});
