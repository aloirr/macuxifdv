/**
 * Ranking por XP no período, por equipe/regional/geral (RF-TRE-04, RN-TRE-03). Calculado no servidor
 * (`ranking_periodo`); função pura sobre usuários, lançamentos e conclusões de trilha.
 *
 * Ordem (total, sem empate de posição): 1) mais XP no período; 2) quem atingiu esse XP primeiro
 * (RN-TRE-03); 3) mais trilhas concluídas no período; 4) nome; 5) id.
 */
import { localDate } from '@macuxi/comum';
import { instanteMs, somarDias } from './numeros';
import { PARAMETROS_PADRAO } from './parametros';
import type { LancamentoXp } from './xp';

export const PERIODOS_RANKING = ['semanal', 'mensal', 'acumulado'] as const;
export type PeriodoRanking = (typeof PERIODOS_RANKING)[number];

export interface IntervaloPeriodo {
  tipo: PeriodoRanking;
  /** Primeiro dia (data civil, inclusive); null = sem limite. */
  inicio: string | null;
  fim: string | null;
}

/** Semanal = segunda a domingo da semana da data; mensal = mês civil; acumulado = sem limites. */
export function intervaloDoPeriodo(tipo: PeriodoRanking, dataRef: string): IntervaloPeriodo {
  if (tipo === 'acumulado') return { tipo, inicio: null, fim: null };
  somarDias(dataRef, 0); // valida
  if (tipo === 'semanal') {
    const dow = new Date(`${dataRef}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const inicio = somarDias(dataRef, -((dow + 6) % 7));
    return { tipo, inicio, fim: somarDias(inicio, 6) };
  }
  const inicio = `${dataRef.slice(0, 7)}-01`;
  const [ano, mes] = [Number(dataRef.slice(0, 4)), Number(dataRef.slice(5, 7))];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { tipo, inicio, fim: `${dataRef.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` };
}

export interface UsuarioRanking {
  id: string;
  tenant_id: string;
  nome: string;
  perfil: string;
  equipe_id: string | null;
  regional_id: string | null;
  ativo: boolean;
}

export interface ConclusaoTrilha {
  tenant_id: string;
  usuario_id: string;
  trilha_id: string;
  /** Instante UTC da conclusão. */
  concluida_em: string;
}

export type EscopoRanking = { tipo: 'geral' } | { tipo: 'equipe'; equipe_id: string } | { tipo: 'regional'; regional_id: string };

export interface LinhaRanking {
  posicao: number;
  usuario_id: string;
  nome: string;
  pontos: number;
  trilhas_concluidas: number;
  /** Instante em que o usuário chegou ao XP do período (último lançamento com pontos); null sem XP. */
  atingiu_em: string | null;
}

export interface EntradaRanking {
  tenant_id: string;
  usuarios: readonly UsuarioRanking[];
  lancamentos: readonly LancamentoXp[];
  conclusoes: readonly ConclusaoTrilha[];
  periodo: PeriodoRanking;
  /** Data civil (no fuso do tenant) que define a semana/o mês. */
  data_ref: string;
  escopo: EscopoRanking;
  /** Perfis que participam; padrão `perfis_ranking` do tenant. */
  perfis?: readonly string[];
  fuso?: string;
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

export function calcularRanking(e: EntradaRanking): LinhaRanking[] {
  const intervalo = intervaloDoPeriodo(e.periodo, e.data_ref);
  const fuso = e.fuso ?? PARAMETROS_PADRAO.fuso;
  const perfis = e.perfis ?? PARAMETROS_PADRAO.perfis_ranking;
  const noPeriodo = (dia: string) => (intervalo.inicio === null || dia >= intervalo.inicio) && (intervalo.fim === null || dia <= intervalo.fim);

  const participantes = e.usuarios.filter(
    (u) =>
      u.tenant_id === e.tenant_id &&
      u.ativo &&
      perfis.includes(u.perfil) &&
      (e.escopo.tipo === 'geral' || (e.escopo.tipo === 'equipe' ? u.equipe_id === e.escopo.equipe_id : u.regional_id === e.escopo.regional_id)),
  );

  const linhas = participantes.map((u) => {
    const meus = e.lancamentos.filter((l) => l.tenant_id === e.tenant_id && l.usuario_id === u.id && noPeriodo(l.dia));
    const comPontos = meus.filter((l) => l.pontos > 0);
    const atingiu = comPontos.length === 0 ? null : comPontos.reduce((m, l) => (instanteMs(l.ocorrido_em) > instanteMs(m.ocorrido_em) ? l : m)).ocorrido_em;
    const trilhas = new Set(
      e.conclusoes.filter((c) => c.tenant_id === e.tenant_id && c.usuario_id === u.id && noPeriodo(localDate(new Date(c.concluida_em), fuso))).map((c) => c.trilha_id),
    );
    return { usuario_id: u.id, nome: u.nome, pontos: meus.reduce((s, l) => s + l.pontos, 0), trilhas_concluidas: trilhas.size, atingiu_em: atingiu };
  });

  linhas.sort((a, b) => {
    if (a.pontos !== b.pontos) return b.pontos - a.pontos;
    if (a.atingiu_em !== b.atingiu_em) {
      if (a.atingiu_em === null) return 1;
      if (b.atingiu_em === null) return -1;
      const d = instanteMs(a.atingiu_em) - instanteMs(b.atingiu_em);
      if (d !== 0) return d;
    }
    if (a.trilhas_concluidas !== b.trilhas_concluidas) return b.trilhas_concluidas - a.trilhas_concluidas;
    return compararTexto(a.nome, b.nome) || compararTexto(a.usuario_id, b.usuario_id);
  });
  return linhas.map((l, i) => ({ posicao: i + 1, ...l }));
}

/** RF-TRE-04: a linha do usuário no ranking (posição própria); null se não participa. */
export function posicaoDoUsuario(ranking: readonly LinhaRanking[], usuarioId: string): LinhaRanking | null {
  return ranking.find((l) => l.usuario_id === usuarioId) ?? null;
}
