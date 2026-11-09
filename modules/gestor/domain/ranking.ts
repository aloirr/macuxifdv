/**
 * Ranking da equipe por indicador e período (RF-GES-03), calculado no servidor sobre o estado da projeção.
 *
 * DESEMPATE (ordem total, posições 1, 2, 3… sem repetir):
 *   1) valor do indicador (maior melhor; para `ruptura_pct`, menor melhor);
 *   2) maior venda no período (centavos);
 *   3) mais pedidos no período;
 *   4) nome (pt-BR, sem diferenciar acento/caixa);
 *   5) id do usuário.
 * Quem não tem dado no período (valor `null`) vai ao fim, sem posição, em ordem de nome e id. Valor 0 é dado.
 */
import type { IndicadorRanking, MembroEquipe, PeriodoRanking, RankingEquipe, LinhaRanking } from '../contracts';
import { escopoDoUsuario, podeVer } from './equipe';
import { exigirDataCivil } from '@macuxi/comum';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { compararTexto, percentual } from './numeros';
import { tradeDoPeriodo, vendasDoPeriodo, visitasDoPeriodo } from './painel';
import { resolverParametros, type ParametrosGestor } from './parametros';
import type { EstadoProjecao } from './projecao';


export interface DefinicaoIndicador {
  rotulo: string;
  sentido: 'maior' | 'menor';
  /** Perfis que participam do ranking do indicador. */
  perfis: readonly MembroEquipe['perfil'][];
  /** Módulo opcional que alimenta o indicador; desativado ⇒ ranking vazio. */
  modulo: 'vendedor' | 'promotor' | 'core';
}

export const INDICADORES: Readonly<Record<IndicadorRanking, DefinicaoIndicador>> = {
  vendas_cents: { rotulo: 'Vendas', sentido: 'maior', perfis: ['vendedor'], modulo: 'vendedor' },
  pedidos: { rotulo: 'Pedidos', sentido: 'maior', perfis: ['vendedor'], modulo: 'vendedor' },
  positivados: { rotulo: 'Clientes positivados', sentido: 'maior', perfis: ['vendedor'], modulo: 'vendedor' },
  ticket_medio_cents: { rotulo: 'Ticket médio', sentido: 'maior', perfis: ['vendedor'], modulo: 'vendedor' },
  atingimento_meta_pct: { rotulo: 'Atingimento da meta (mensal)', sentido: 'maior', perfis: ['vendedor'], modulo: 'vendedor' },
  cobertura_pct: { rotulo: 'Cobertura de rota', sentido: 'maior', perfis: ['vendedor', 'promotor'], modulo: 'core' },
  conformidade_pct: { rotulo: 'Conformidade de gôndola', sentido: 'maior', perfis: ['promotor'], modulo: 'promotor' },
  ruptura_pct: { rotulo: 'Ruptura', sentido: 'menor', perfis: ['promotor'], modulo: 'promotor' },
};

/** Diário = o dia; semanal = segunda a domingo da semana da data; mensal = mês civil. Tudo em datas civis do fuso do tenant. */
export function intervaloDoPeriodo(tipo: PeriodoRanking, dataRef: string): { inicio: string; fim: string } {
  exigirDataCivil(dataRef);
  if (tipo === 'diario') return { inicio: dataRef, fim: dataRef };
  if (tipo === 'semanal') {
    const dow = new Date(`${dataRef}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const inicio = somarDiasCivis(dataRef, -((dow + 6) % 7));
    return { inicio, fim: somarDiasCivis(inicio, 6) };
  }
  const [ano, mes] = [Number(dataRef.slice(0, 4)), Number(dataRef.slice(5, 7))];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { inicio: `${dataRef.slice(0, 7)}-01`, fim: `${dataRef.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` };
}

export interface EntradaOrdenacao {
  usuario_id: string;
  nome: string;
  perfil: MembroEquipe['perfil'];
  valor: number | null;
  vendas_cents: number;
  pedidos: number;
}

/** Aplica o desempate documentado no cabeçalho. */
export function ordenarRanking(entradas: readonly EntradaOrdenacao[], sentido: 'maior' | 'menor'): LinhaRanking[] {
  const comDado = entradas.filter((x) => x.valor !== null);
  const semDado = entradas.filter((x) => x.valor === null);
  const fator = sentido === 'maior' ? -1 : 1;
  comDado.sort(
    (a, b) =>
      fator * (a.valor! - b.valor!) ||
      b.vendas_cents - a.vendas_cents ||
      b.pedidos - a.pedidos ||
      compararTexto(a.nome, b.nome) ||
      compararTexto(a.usuario_id, b.usuario_id),
  );
  semDado.sort((a, b) => compararTexto(a.nome, b.nome) || compararTexto(a.usuario_id, b.usuario_id));
  return [
    ...comDado.map((x, i) => ({ ...x, posicao: i + 1 })),
    ...semDado.map((x) => ({ ...x, posicao: null })),
  ];
}

export interface EntradaRankingEquipe {
  estado: EstadoProjecao;
  membros: readonly MembroEquipe[];
  viewer: { id: string; perfil: MembroEquipe['perfil'] };
  indicador: IndicadorRanking;
  periodo: PeriodoRanking;
  /** Data civil (fuso do tenant) que define o dia/semana/mês. */
  data_ref: string;
  modulos: ReadonlySet<string>;
  params?: Partial<ParametrosGestor>;
  agora: string;
}

function valorDoIndicador(e: EntradaRankingEquipe, membro: MembroEquipe, inicio: string, fim: string, params: ParametrosGestor): number | null {
  const { estado } = e;
  switch (e.indicador) {
    case 'vendas_cents':
      return vendasDoPeriodo(estado, membro.id, inicio, fim, params).vendas_cents;
    case 'pedidos':
      return vendasDoPeriodo(estado, membro.id, inicio, fim, params).pedidos;
    case 'positivados':
      return vendasDoPeriodo(estado, membro.id, inicio, fim, params).clientes_positivados;
    case 'ticket_medio_cents':
      return vendasDoPeriodo(estado, membro.id, inicio, fim, params).ticket_medio_cents;
    case 'atingimento_meta_pct': {
      if (e.periodo !== 'mensal') return null; // a meta é mensal
      const meta = estado.metas[`${membro.id}|${inicio.slice(0, 7)}`]?.meta_cents ?? null;
      return meta ? percentual(vendasDoPeriodo(estado, membro.id, inicio, fim, params).vendas_cents, meta) : null;
    }
    case 'cobertura_pct':
      return visitasDoPeriodo(estado, { id: membro.id, perfil: membro.perfil }, inicio, fim, params).cobertura_pct;
    case 'conformidade_pct':
      return tradeDoPeriodo(estado, membro.id, inicio, fim, params).conformidade_pct;
    case 'ruptura_pct':
      return tradeDoPeriodo(estado, membro.id, inicio, fim, params).ruptura_pct;
  }
}

/** Ranking do indicador/período para o que o `viewer` pode ver (RN-CORE-04). Módulo do indicador desativado ⇒ linhas vazias. */
export function rankingDaEquipe(e: EntradaRankingEquipe): RankingEquipe {
  const params = resolverParametros(e.params);
  const def = INDICADORES[e.indicador];
  const { inicio, fim } = intervaloDoPeriodo(e.periodo, e.data_ref);
  const escopo = escopoDoUsuario(e.viewer, e.membros);
  const moduloAtivo = def.modulo === 'core' || e.modulos.has(def.modulo);
  const participantes = moduloAtivo ? e.membros.filter((x) => x.ativo && def.perfis.includes(x.perfil) && podeVer(escopo, x.id)) : [];
  const entradas: EntradaOrdenacao[] = participantes.map((x) => {
    const v = vendasDoPeriodo(e.estado, x.id, inicio, fim, params);
    return {
      usuario_id: x.id,
      nome: x.nome,
      perfil: x.perfil,
      valor: valorDoIndicador(e, x, inicio, fim, params),
      vendas_cents: x.perfil === 'vendedor' && e.modulos.has('vendedor') ? v.vendas_cents : 0,
      pedidos: x.perfil === 'vendedor' && e.modulos.has('vendedor') ? v.pedidos : 0,
    };
  });
  return { indicador: e.indicador, periodo: e.periodo, inicio, fim, sentido: def.sentido, linhas: ordenarRanking(entradas, def.sentido), calculado_em: e.agora };
}
