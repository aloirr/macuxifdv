/**
 * Performance só com o que está no aparelho (T-0170; desenho §7.1). Puro, sem relógio: `agora` vem de quem chama.
 * Junta as linhas do pull (visita, rota, rota_parada, meta, meta_produtividade, deslocamento_dia, parametro), a fila (check-in e
 * check-out ainda não enviados) e a cópia de `GET /v1/core/performance` do mesmo período, e chama as MESMAS funções do domain
 * que a API roda (N-A): `resultadosDoPeriodo`, `produtividadeDoPeriodo`, `calendarioDoPeriodo` e `metasProdutividadeVigentes`.
 * Período fora da janela do aparelho: a resposta inteira do servidor (`visaoDoServidor`).
 */
import type { ItemSobreposicao } from '@macuxi/platform-sdk';

import type { MetaSync, ParametroSync, RotaParadaSync, RotaSync, UsuarioSync, VisitaSync } from '../../../contracts';
import type { CalendarioPeriodo, Performance, ProdutividadeIndicador, RealizadoServidor, ResultadoIndicador } from '../../../contracts/performance';
import { almocoDoUsuario, almocoPadraoDasLinhas, aplicarPendentesVisita, calendarioDoTenant, dataLocal, type CalendarioTenant } from '../../../domain';
import type { HorarioAlmoco } from '../../../contracts';
import { calendarioDoPeriodo } from '../../../domain/performance/calendario';
import { metasProdutividadeVigentes, type EquipeArvore, type LinhaMetaProdutividade } from '../../../domain/performance/metas-produtividade';
import { produtividadeDoPeriodo, type DeslocamentoResumo } from '../../../domain/performance/produtividade';
import { resultadosDoPeriodo } from '../../../domain/performance/resultados';
import { pendentesDaFila } from '../../lib/rota-local';
import type { Intervalo } from './periodo-performance';

/**
 * Entidades do pull que a Performance lê. `meta_produtividade` e `deslocamento_dia` são registradas na costura (N-D); até lá
 * o aparelho não tem linhas delas e valem o padrão do FDV (D5) e o km "sem dado".
 */
export const ENTIDADES_PERFORMANCE = {
  visita: 'visita',
  rota: 'rota',
  paradas: 'rota_parada',
  metas: 'meta',
  parametros: 'parametro',
  metasProdutividade: 'meta_produtividade',
  deslocamentos: 'deslocamento_dia',
  usuarios: 'usuario',
} as const;

/** Chave da cópia de `GET /v1/core/performance` no armazenamento do Core: uma por período guardado (Este mês e Mês passado). */
export const chaveDaCopiaPerformance = (periodo: 'este_mes' | 'mes_passado'): string => `performance.${periodo}`;

export interface LinhasPerformance {
  visitas: readonly VisitaSync[];
  rotas: readonly Pick<RotaSync, 'id' | 'situacao' | 'deleted_at'>[];
  paradas: readonly RotaParadaSync[];
  metas: readonly MetaSync[];
  parametros: readonly ParametroSync[];
  metasProdutividade: readonly LinhaMetaProdutividade[];
  deslocamentos: readonly (DeslocamentoResumo & { usuario_id?: string })[];
  /** T-0180 (D5): a linha do próprio usuário traz o horário de almoço (nulo = padrão da empresa). */
  usuarios?: readonly Pick<UsuarioSync, 'id' | 'almoco_inicio_min' | 'almoco_fim_min' | 'deleted_at'>[];
  /** Árvore de equipes, para a meta da equipe de cima (RN-CORE-45). Vazia: só usuário, tenant e padrão. */
  equipes?: readonly EquipeArvore[];
}

export interface OpcoesPerformance {
  usuarioId: string;
  equipeId?: string | null;
  perfil: 'vendedor' | 'promotor';
  fuso: string;
  agora: Date;
  intervalo: Intervalo;
}

export interface VisaoPerformance {
  hoje: string;
  calendario: CalendarioPeriodo;
  resultados: ResultadoIndicador[];
  produtividade: ProdutividadeIndicador[];
  /** D6: nome do card de venda. */
  tipoMetaVenda: 'pedido' | 'faturamento' | null;
  /** Instante (UTC) da base do servidor usada nos cards de venda; null sem base. */
  baseEm: string | null;
}

const parametro = (ps: readonly ParametroSync[], chave: string): unknown =>
  ps.find((p) => p.modulo === 'core' && p.chave === chave && !p.deleted_at)?.valor;

/** RN-CORE-41: semana útil do Core e os feriados do tenant (`metas.feriados`); os nacionais o domain soma sempre (D4). */
export function calendarioDoAparelho(ps: readonly ParametroSync[]): CalendarioTenant {
  const base = calendarioDoTenant(ps.map((p) => ({ ...p, valor: p.valor })));
  const feriados = parametro(ps, 'metas.feriados');
  const validos = Array.isArray(feriados) ? feriados.filter((f): f is string => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f)) : [];
  return validos.length > 0 ? { ...base, feriados: validos } : base;
}

/** RN-CORE-44 (D5): o horário de almoço do usuário ou, sem ele, o padrão da empresa (`jornada.almoco_padrao`). */
export function almocoDoAparelho(ps: readonly ParametroSync[], eu?: { almoco_inicio_min?: number | null; almoco_fim_min?: number | null } | null): HorarioAlmoco {
  return almocoDoUsuario(eu, almocoPadraoDasLinhas(ps));
}

/** D6: o tipo da meta de venda; a cópia do servidor manda, senão a meta do mês de hoje. */
function tipoDaMetaDeVenda(copia: RealizadoServidor | null, metas: readonly MetaSync[], mes: string): 'pedido' | 'faturamento' | null {
  if (copia) return copia.tipo_meta_venda;
  const meta = metas.find((m) => !m.deleted_at && m.periodo === mes && m.indicador === 'venda_cents');
  return meta ? (meta.tipo ?? 'pedido') : null;
}

/**
 * A visão da Performance do período, calculada no aparelho. `copia` é a última resposta do servidor para o MESMO período
 * (só os números de venda saem dela; o resto o aparelho recalcula com o "hoje" dele).
 */
export function montarPerformance(
  l: LinhasPerformance,
  copia: Performance | null,
  fila: readonly ItemSobreposicao[],
  o: OpcoesPerformance,
): VisaoPerformance {
  const hoje = dataLocal(o.agora, o.fuso);
  const { de, ate } = o.intervalo;
  const calendario = calendarioDoAparelho(l.parametros);
  const minhas = l.visitas.filter((v) => !v.deleted_at && v.usuario_id === o.usuarioId);
  const visitas = aplicarPendentesVisita([...minhas], pendentesDaFila(fila), { usuario_id: o.usuarioId, fuso: o.fuso });
  const copiaValida = copia && copia.de === de && copia.ate === ate && copia.usuario_id === o.usuarioId ? copia : null;
  const realizado = copiaValida?.realizado_servidor ?? null;

  const resultados = resultadosDoPeriodo({
    de,
    ate,
    hoje,
    calendario,
    perfil: o.perfil,
    metas: l.metas.filter((m) => m.usuario_id === o.usuarioId),
    realizado,
    visitas,
  });

  const produtividade = produtividadeDoPeriodo({
    de,
    ate,
    hoje,
    fuso: o.fuso,
    visitas,
    paradas: l.paradas.filter((p) => p.usuario_id === o.usuarioId),
    rotas: l.rotas,
    deslocamentos: l.deslocamentos.filter((d) => !d.usuario_id || d.usuario_id === o.usuarioId),
    metas: metasProdutividadeVigentes({
      linhas: l.metasProdutividade,
      equipes: l.equipes ?? [],
      alvo: { usuario_id: o.usuarioId, equipe_id: o.equipeId ?? null },
      mes: ate.slice(0, 7),
    }),
    almoco: almocoDoAparelho(l.parametros, (l.usuarios ?? []).find((u) => u.id === o.usuarioId && !u.deleted_at)),
  });

  return {
    hoje,
    calendario: calendarioDoPeriodo(de, ate, hoje, calendario),
    resultados,
    produtividade,
    tipoMetaVenda: tipoDaMetaDeVenda(realizado, l.metas, hoje.slice(0, 7)),
    baseEm: copiaValida?.base_em ?? null,
  };
}

/** Período fora da janela do aparelho: a resposta do servidor já vem calculada pelas mesmas funções (§7.1). */
export function visaoDoServidor(p: Performance): VisaoPerformance {
  return {
    hoje: p.hoje,
    calendario: p.calendario,
    resultados: p.resultados,
    produtividade: p.produtividade,
    tipoMetaVenda: p.realizado_servidor.tipo_meta_venda,
    baseEm: p.base_em,
  };
}

/** Caminho da consulta ao servidor (contrato `PerformanceQuerySchema`). */
export const caminhoDaPerformance = (i: Intervalo): string => `/v1/core/performance?de=${i.de}&ate=${i.ate}`;

/**
 * "base de 12/11, 20:22" quando a base de vendas é de um dia anterior ao de hoje (o dia virou sem sinal, §7.1 e RN-CORE-26);
 * null com a base de hoje ou sem base.
 */
export function textoDaBase(baseEm: string | null, hoje: string, fuso: string, formatarHora: (iso: string, tz: string) => string): string | null {
  if (!baseEm) return null;
  const dia = dataLocal(baseEm, fuso);
  if (dia >= hoje) return null;
  return `base de ${dia.slice(8, 10)}/${dia.slice(5, 7)}, ${formatarHora(baseEm, fuso)}`;
}
