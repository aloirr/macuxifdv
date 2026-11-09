/**
 * T-0124 (v1.0.1) — valor × regra ENTRE TELAS: o mesmo tenant, o mesmo mês e o mesmo realizado têm de dar o mesmo número de
 * dias úteis e a mesma necessidade diária no Início (Campo), em Metas (Campo), no BKO Indicadores (Core) e na Ficha do
 * vendedor (Gestão). Sem banco: roda local e no CI.
 *
 * Contexto (08/11/2026): Core e Gestor passaram a usar `diasUteisDoPeriodo` de @macuxi/comum e a consulta
 * `core.calendario_metas@1` (entregas R-20261108-203623 do modulo-core e R-20261108-210410 do modulo-gestor).
 *
 * Regra (docs/produto/03): RN-CORE-22 necessidade diária = (meta − realizado) ÷ dias úteis restantes; RN-CORE-26 meta do dia =
 * (meta do mês − realizado até ontem) ÷ dias úteis restantes contando hoje; "Os dias úteis seguem o calendário do tenant
 * [`dias_uteis_semana` = segunda a sábado], SEM FERIADOS até existir o cadastro de feriados". O ORÁCULO abaixo segue esse
 * texto (semana do tenant, nenhum feriado).
 *
 * Cadeia real de cada tela (nada copiado à mão):
 *  - Início: `montarInicio` (modules/core/app/lib/inicio-local.ts) → `metas[0].meta_dia` e `meta_hoje.por_dia_util` →
 *    `desenhoMetaDoMes` (apps/mobile/src/lib/inicio.ts) "Meta de hoje R$ X";
 *  - Metas: `painelLocal` (modules/core/app/lib/metas-local.ts) → `textoNecessidadeDiaria`;
 *  - BKO Indicadores: `painelDoUsuario` com `calendarioDoTenant(parametros)` como a rota GET /v1/core/metas/indicadores
 *    (modules/core/api/metas.ts) → `celulasDoUsuario` (coluna "Necessidade diária");
 *  - Ficha do Gestor: calendário pela implementação REAL de `core.calendario_metas@1` (modules/core/api/consultas.ts), como
 *    a rota do Gestor (modules/gestor/api/rotas.ts, carregarContexto) → `fichaDoMembro` → `painel.mes.necessidade_diaria_cents`
 *    → `formatBRL0` (modules/gestor/app/screens/ficha-screen.tsx, linha "Precisa por dia").
 *
 * Divergência = defeito: o caso fica em `it.fails` (falha hoje pelo motivo descrito) e vira pedido ao dono; o agente testes
 * volta para `it` no commit da correção (Ficha do Gestor: corrigida em 08/11, R-20261108-230904; todos os casos em `it`). Matriz e resultados: docs/testes/T-0124.md.
 */
import { describe, expect, it } from 'vitest';

import { formatBRL0 } from '@macuxi/comum';

import { desenhoMetaDoMes } from '../../apps/mobile/src/lib/inicio';
import { consultaCalendarioMetas } from '../../modules/core/api/consultas';
import type { IndicadorDiarioSync, IndicadoresLista, Inicio, MetaSync, ParametroSync } from '../../modules/core/contracts';
import { montarInicio } from '../../modules/core/app/lib/inicio-local';
import { painelLocal } from '../../modules/core/app/lib/metas-local';
import { textoNecessidadeDiaria } from '../../modules/core/app/lib/metas-formato';
import { calendarioDoTenant, painelDoUsuario } from '../../modules/core/domain';
import { CABECALHO, celulasDoUsuario } from '../../modules/core/web/lib/indicadores';
import { meta as metaGestor, pedidoCriado, statusAlterado, SUPERVISOR, u, VENDEDOR } from '../../modules/gestor/domain/fixtures';
import { aplicarEventos, estadoInicial } from '../../modules/gestor/domain/projecao';
import { dataDaConsulta, escopoDosVisiveis, fichaDoMembro } from '../../modules/gestor/domain/visao';

// ---------- oráculo (texto da RN, independente do código) ----------
const SEG_A_SAB = [1, 2, 3, 4, 5, 6];
const SEG_A_SEX = [1, 2, 3, 4, 5];
const diaDaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
function diasDoMesDesde(hoje: string): string[] {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = Number(hoje.slice(8, 10)); d <= ultimo; d++) out.push(`${hoje.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return out;
}
/** RN-CORE-26: dias úteis restantes contando hoje, semana do tenant, SEM feriados (não há cadastro de feriados). */
const diasPelaRegra = (hoje: string, semana: number[]) => diasDoMesDesde(hoje).filter((d) => semana.includes(diaDaSemana(d))).length;
/** RN-CORE-22/26: ⌈falta ÷ dias⌉ em centavos (a mesma conta de `necessidadeDiaria` e `metaDoDia` do Core). */
const necessidadePelaRegra = (falta: number, dias: number) => Math.ceil(falta / dias);
/** "R$ 9.969" / "Precisa de R$ 9.969 por dia útil (18 restantes)." → 9969 */
const reais = (s: string | null | undefined): number | null => {
  const m = /R\$\s*([\d.]+)/.exec((s ?? '').replace(/\u00a0/g, ' '));
  return m ? Number(m[1]!.replace(/\./g, '')) : null;
};
const restantesDoTexto = (s: string) => Number(/\((\d+) restantes\)/.exec(s)?.[1] ?? NaN);

// ---------- o mesmo tenant nas três telas ----------
const FUSO = 'America/Manaus';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANA = id(1);
const base = { updated_at: '2026-11-01T10:00:00.000000Z', deleted_at: null, external_id: null };
const hojeEmManaus = (agora: Date) => new Date(agora.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
const ontem = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

interface Caso {
  nome: string;
  agora: string;
  semana: number[];
  meta: number;
  /** realizado do mês até ontem, vendido num dia só (o anterior a hoje); hoje = 0, então meta do dia = necessidade do mês */
  ateOntem: number;
}

interface Telas {
  hoje: string;
  inicio: { dias: number; meta_dia: number | null; por_dia_util: number | null; apoio: string | null };
  metas: { dias: number; necessidade: number | null; texto: string };
  bko: { texto: string };
  gestor: { dias: number; necessidade: number | null; texto: string };
}

async function telas(c: Caso): Promise<Telas> {
  const agora = new Date(c.agora);
  const hoje = hojeEmManaus(agora);
  const periodo = hoje.slice(0, 7);
  const diaVenda = ontem(hoje).slice(0, 7) === periodo ? ontem(hoje) : null;
  const parametros = [{ ...base, id: id(700), modulo: 'core', chave: 'metas.dias_uteis_semana', valor: c.semana }] as ParametroSync[];
  const metas: MetaSync[] = [{ ...base, id: id(800), usuario_id: ANA, periodo, indicador: 'venda_cents', valor: c.meta }];
  const diarios: IndicadorDiarioSync[] = diaVenda ? [{ ...base, id: id(600), usuario_id: ANA, data: diaVenda, pedidos: 1, vendido_cents: c.ateOntem, cancelado_cents: 0 }] : [];

  // Início (Campo): cópia do GET /v1/core/inicio + linhas do pull
  const copia: Inicio = {
    dia: hoje,
    periodo,
    calculado_em: agora.toISOString(),
    escopo: 'proprio',
    usuarios: [{ usuario_id: ANA, nome: 'Ana', perfil: 'vendedor', equipe_id: null, tipo_meta_venda: 'pedido', venda_cents: { ate_ontem: diaVenda ? c.ateOntem : 0, hoje: 0 }, positivacao: null }],
    metas_do_dia: [],
  };
  const v = montarInicio({ metas, paradas: [], visitas: [], notificacoes: [], parametros, clientes: [] }, copia, [], { usuarioId: ANA, perfil: 'vendedor', fuso: FUSO, agora });
  const linha = v.metas.find((m) => m.indicador === 'venda_cents')!;
  const desenho = desenhoMetaDoMes(linha, v.meta_hoje);

  // Metas (Campo)
  const p = painelLocal({ paradas: [], visitas: [], diarios, metas, parametros }, [], { usuarioId: ANA, fuso: FUSO, agora });

  // BKO Indicadores: o mesmo caminho da rota (calendarioDoTenant das linhas de plataforma.parametro)
  const pb = painelDoUsuario({ periodo, usuario_id: ANA, hoje, calendario: calendarioDoTenant(parametros.map((x) => ({ ...x, valor: x.valor }))), paradas: [], visitas: [], diarios, metas });
  const item = { usuario_id: ANA, usuario_nome: 'Ana', indicadores: pb.indicadores, metas: pb.metas } as unknown as IndicadoresLista['itens'][number];

  // Ficha do Gestor: calendário pela consulta real do Core, como a rota do Gestor
  const consulta = consultaCalendarioMetas as unknown as { executar: (e: unknown, ctx: unknown) => Promise<{ dias_uteis_semana: number[]; feriados: string[] }> };
  const cal = await consulta.executar({}, { parametros: () => ({ 'metas.dias_uteis_semana': c.semana }) });
  const eventos = [
    metaGestor(VENDEDOR, periodo, c.meta, `${periodo}-01T10:00:00Z`),
    ...(diaVenda ? [pedidoCriado({ pedido: u(5001), total: c.ateOntem, em: `${diaVenda}T14:00:00Z` }), statusAlterado({ pedido: u(5001), para: 'aprovado', em: `${diaVenda}T14:05:00Z` })] : []),
  ];
  const estado = aplicarEventos(estadoInicial(), eventos).estado;
  const viewer = { id: SUPERVISOR, perfil: 'supervisor' as const };
  const ficha = fichaDoMembro({
    estado,
    membros: [
      { id: SUPERVISOR, nome: 'Sup', perfil: 'supervisor', superior_id: null, ativo: true },
      { id: VENDEDOR, nome: 'Ana', perfil: 'vendedor', superior_id: SUPERVISOR, ativo: true },
    ],
    viewer,
    escopo: escopoDosVisiveis(viewer, new Set([VENDEDOR])),
    data: dataDaConsulta(undefined, agora.toISOString(), FUSO),
    modulos: new Set(['vendedor']),
    agora: agora.toISOString(),
    params: { fuso: FUSO, calendario_metas: { dias_uteis_semana: cal.dias_uteis_semana, feriados: cal.feriados } },
    usuario_id: VENDEDOR,
  });
  const mes = ficha!.painel.mes!;

  return {
    hoje,
    inicio: { dias: linha.dias_uteis_restantes, meta_dia: linha.meta_dia, por_dia_util: v.meta_hoje?.por_dia_util ?? null, apoio: desenho.apoio },
    metas: { dias: p.indicadores.dias_uteis_restantes, necessidade: p.indicadores.necessidade_diaria_cents, texto: textoNecessidadeDiaria(p.indicadores).replace(/\u00a0/g, ' ') },
    bko: { texto: celulasDoUsuario(item)[7]!.replace(/\u00a0/g, ' ') },
    gestor: { dias: mes.dias_uteis_restantes, necessidade: mes.necessidade_diaria_cents, texto: mes.necessidade_diaria_cents === null ? '—' : formatBRL0(mes.necessidade_diaria_cents) },
  };
}

const META = 18_000_000; // R$ 180.000 (caso do teste de campo)
const ATE_ONTEM = 55_300; // R$ 553

/**
 * Casos. `antes`: o que o Gestor dava antes da correção de 08/11 (R-20261108-230904), só como histórico:
 *  - feriado nacional no período: o Gestor tirava o feriado (lista `[]` da consulta lida como "informada") e o Core não;
 *  - arredondamento: o Core arredonda a necessidade para cima (⌈⌉); o Gestor arredondava meio para cima.
 */
const CASOS: Array<Caso & { antes: string | null; diaUtil: boolean }> = [
  { nome: 'terça 10/11, seg–sáb (20/11 no período)', agora: '2026-11-10T13:00:00Z', semana: SEG_A_SAB, meta: META, ateOntem: ATE_ONTEM, diaUtil: true, antes: 'Core 18 dias / R$ 9.969 × Gestor 17 dias / R$ 10.556 (corrigido)' },
  { nome: 'terça 10/11, seg–sex (20/11 no período)', agora: '2026-11-10T13:00:00Z', semana: SEG_A_SEX, meta: META, ateOntem: ATE_ONTEM, diaUtil: true, antes: 'Core 15 dias / R$ 11.963 × Gestor 14 dias / R$ 12.818 (corrigido)' },
  { nome: 'domingo 08/11 (dia não útil), seg–sáb', agora: '2026-11-08T18:00:00Z', semana: SEG_A_SAB, meta: META, ateOntem: ATE_ONTEM, diaUtil: false, antes: 'Core 19 dias × Gestor 18 dias (corrigido)' },
  { nome: 'sexta 20/11 (Consciência Negra), seg–sex', agora: '2026-11-20T13:00:00Z', semana: SEG_A_SEX, meta: META, ateOntem: ATE_ONTEM, diaUtil: true, antes: 'Core 7 dias (20/11 útil, Meta de hoje) × Gestor 6 dias (corrigido)' },
  { nome: 'virada: 01/12 00h30 em Manaus (04h30 UTC), dezembro com 25/12, seg–sáb', agora: '2026-12-01T04:30:00Z', semana: SEG_A_SAB, meta: META, ateOntem: 0, diaUtil: true, antes: 'Core 27 dias × Gestor 26 dias (corrigido)' },
  // sem feriado no resto do mês: dias iguais; falta = 123.449 × 6 + 1 → Core ⌈⌉ 123.450 (R$ 1.235) × Gestor meio para cima 123.449 (R$ 1.234)
  { nome: 'segunda 23/11, seg–sex, sem feriado até o fim do mês (arredondamento)', agora: '2026-11-23T13:00:00Z', semana: SEG_A_SEX, meta: 1_000_000, ateOntem: 1_000_000 - (123_449 * 6 + 1), diaUtil: true, antes: 'Core R$ 1.235 (123.450 c) × Gestor R$ 1.234 (123.449 c) (corrigido)' },
  { nome: 'virada: 30/11 23h30 em Manaus (01/12 03h30 UTC), último dia útil, seg–sáb', agora: '2026-12-01T03:30:00Z', semana: SEG_A_SAB, meta: META, ateOntem: ATE_ONTEM, diaUtil: true, antes: null },
];

describe('T-0124 v1.0.1 — Core: Início = Metas = BKO Indicadores = RN-CORE-22/26 (mesmo tenant, mês e realizado)', () => {
  it.each(CASOS)('$nome', async (c) => {
    const t = await telas(c);
    const dias = diasPelaRegra(t.hoje, c.semana);
    const falta = c.meta - (t.hoje.endsWith('-01') ? 0 : c.ateOntem);
    const esperado = necessidadePelaRegra(falta, dias);
    // dias úteis restantes (hoje conta), semana do tenant, sem feriados
    expect(t.inicio.dias).toBe(dias);
    expect(t.metas.dias).toBe(dias);
    expect(restantesDoTexto(t.bko.texto)).toBe(dias);
    // Início: "Meta de hoje" (dia útil) e "por dia útil"; hoje sem venda, então os dois são a necessidade do mês
    expect(t.inicio.por_dia_util).toBe(esperado);
    if (c.diaUtil) {
      expect(t.inicio.meta_dia).toBe(esperado);
      expect(t.inicio.apoio).toBe(`Meta de hoje ${formatBRL0(esperado)}`);
    } else {
      expect(t.inicio.meta_dia).toBeNull();
      expect(t.inicio.apoio ?? '').not.toMatch(/Meta de hoje/);
    }
    // Metas e BKO: "Precisa de R$ X por dia útil (N restantes)."
    expect(t.metas.necessidade).toBe(esperado);
    expect(t.metas.texto).toBe(`Precisa de ${formatBRL0(esperado)} por dia útil (${dias} restantes).`);
    expect(CABECALHO[7]).toBe('Necessidade diária');
    expect(t.bko.texto).toBe(t.metas.texto);
  });
});

describe('T-0124 v1.0.1 — Ficha do Gestor "Precisa por dia" = Core (RN-CORE-22/26)', () => {
  // Corrigido pelo modulo-gestor em 08/11 (R-20261108-230904): `diasUteisDoMes` trata feriados [] como "sem cadastro" e
  // `calcularMeta` arredonda para cima. Os 6 casos que eram it.fails voltaram para it; o retrato dos números errados saiu.
  it.each(CASOS)('$nome', async (c) => {
    const t = await telas(c);
    expect(t.gestor.dias).toBe(t.metas.dias);
    expect(t.gestor.dias).toBe(diasPelaRegra(t.hoje, c.semana));
    expect(t.gestor.necessidade).toBe(t.metas.necessidade);
    expect(reais(t.gestor.texto)).toBe(reais(t.metas.texto));
    expect(reais(t.gestor.texto)).toBe(reais(t.bko.texto));
    expect(t.gestor.necessidade).toBe(t.inicio.por_dia_util);
  });
});
