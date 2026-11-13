/**
 * Período da Performance (T-0170; desenho `docs/desenho/performance-produtividade.md` §1.1 e §7; filtro do kit, modelo A de
 * `docs/design/pedidos-filtro-periodo.md`). Puro, sem relógio: "hoje" (data civil no fuso do tenant) chega por parâmetro.
 * - atalhos Hoje · Ontem · Esta semana (segunda a domingo, RN-TRE-03) · Este mês (padrão) · Mês passado · Este ano, e o dia, mês
 *   ou ano escolhido na folha;
 * - cada escolha vira o intervalo `[de, ate]` que `resultadosDoPeriodo` e `produtividadeDoPeriodo` recebem;
 * - janela do aparelho (§7.2): de `min(hoje − 40, início do mês anterior)` até hoje. Período que começa antes dela vai ao
 *   servidor, com sinal.
 */
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { MONTHS, WEEKDAYS } from '@macuxi/comum/fuso';
import type { EscolhaPeriodo } from '@macuxi/ui/mobile/puro';

import { ultimoDiaDoMes } from '../../../domain/performance/tempo';

export type AtalhoPerformance = 'hoje' | 'ontem' | 'esta_semana' | 'este_mes' | 'mes_passado' | 'este_ano';

/** Ordem e rótulos da folha (os mesmos de Pedidos). */
export const ATALHOS_PERFORMANCE: ReadonlyArray<{ id: AtalhoPerformance; rotulo: string; testID: string }> = [
  { id: 'hoje', rotulo: 'Hoje', testID: 'performance-periodo-hoje' },
  { id: 'ontem', rotulo: 'Ontem', testID: 'performance-periodo-ontem' },
  { id: 'esta_semana', rotulo: 'Esta semana', testID: 'performance-periodo-esta-semana' },
  { id: 'este_mes', rotulo: 'Este mês', testID: 'performance-periodo-este-mes' },
  { id: 'mes_passado', rotulo: 'Mês passado', testID: 'performance-periodo-mes-passado' },
  { id: 'este_ano', rotulo: 'Este ano', testID: 'performance-periodo-este-ano' },
];

export const ATALHO_PADRAO: AtalhoPerformance = 'este_mes';

export type SelecaoPeriodo = { tipo: 'atalho'; id: AtalhoPerformance } | { tipo: 'escolha'; escolha: EscolhaPeriodo };

export const SELECAO_PADRAO: SelecaoPeriodo = { tipo: 'atalho', id: ATALHO_PADRAO };

export interface Intervalo {
  de: string;
  ate: string;
}

export function ehAtalhoPerformance(id: string): id is AtalhoPerformance {
  return ATALHOS_PERFORMANCE.some((a) => a.id === id);
}

const diaDaSemana = (data: string): number => new Date(`${data}T12:00:00Z`).getUTCDay();
const mesAnterior = (anoMes: string): string => {
  const [a, m] = anoMes.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
const mesInteiro = (anoMes: string): Intervalo => ({ de: `${anoMes}-01`, ate: ultimoDiaDoMes(anoMes) });

/** O intervalo `[de, ate]` (datas civis) da escolha. Esta semana vai de segunda a domingo; o fim pode passar de hoje. */
export function intervaloDaSelecao(sel: SelecaoPeriodo, hoje: string): Intervalo {
  if (sel.tipo === 'escolha') {
    const { tipo, valor } = sel.escolha;
    if (tipo === 'dia') return { de: valor, ate: valor };
    if (tipo === 'mes') return mesInteiro(valor);
    return { de: `${valor}-01-01`, ate: `${valor}-12-31` };
  }
  switch (sel.id) {
    case 'hoje':
      return { de: hoje, ate: hoje };
    case 'ontem': {
      const ontem = somarDiasCivis(hoje, -1);
      return { de: ontem, ate: ontem };
    }
    case 'esta_semana': {
      const segunda = somarDiasCivis(hoje, -((diaDaSemana(hoje) + 6) % 7));
      return { de: segunda, ate: somarDiasCivis(segunda, 6) };
    }
    case 'este_mes':
      return mesInteiro(hoje.slice(0, 7));
    case 'mes_passado':
      return mesInteiro(mesAnterior(hoje.slice(0, 7)));
    case 'este_ano':
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` };
  }
}

/** Atalho com ✓ na folha (null quando vale um dia, mês ou ano escolhido). */
export const atalhoEmVigor = (sel: SelecaoPeriodo): AtalhoPerformance | null => (sel.tipo === 'atalho' ? sel.id : null);

/** Escolha em vigor (a folha abre direto na aba dela). */
export const escolhaEmVigor = (sel: SelecaoPeriodo): EscolhaPeriodo | null => (sel.tipo === 'escolha' ? sel.escolha : null);

/** Selo do botão: 0 no padrão (Este mês), 1 com outro período. */
export const contarFiltros = (sel: SelecaoPeriodo): number => (sel.tipo === 'atalho' && sel.id === ATALHO_PADRAO ? 0 : 1);

const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Nome do período na linha de cima dos cards (é o único lugar em que ele aparece: a tela não repete numa etiqueta).
 * Mês: "Novembro" (no ano de hoje) ou "Setembro de 2025"; ano: "2026"; dia: "Seg, 02/11/2026"; atalhos curtos pelo nome.
 */
export function rotuloDoPeriodo(sel: SelecaoPeriodo, hoje: string): string {
  const { de } = intervaloDaSelecao(sel, hoje);
  const ehMes = (sel.tipo === 'atalho' && (sel.id === 'este_mes' || sel.id === 'mes_passado')) || (sel.tipo === 'escolha' && sel.escolha.tipo === 'mes');
  if (ehMes) {
    const nome = maiuscula(MONTHS[Number(de.slice(5, 7)) - 1] ?? '');
    return de.slice(0, 4) === hoje.slice(0, 4) ? nome : `${nome} de ${de.slice(0, 4)}`;
  }
  if (sel.tipo === 'atalho') {
    if (sel.id === 'este_ano') return de.slice(0, 4);
    return ATALHOS_PERFORMANCE.find((a) => a.id === sel.id)!.rotulo;
  }
  if (sel.escolha.tipo === 'ano') return sel.escolha.valor;
  const [a, m, d] = de.split('-');
  return `${(WEEKDAYS[diaDaSemana(de)] ?? '').slice(0, 3)}, ${d}/${m}/${a}`;
}

/** Início da janela do aparelho (§7.2): o mais antigo entre hoje − 40 e o dia 1 do mês anterior. */
export function inicioDaJanela(hoje: string): string {
  const quarenta = somarDiasCivis(hoje, -40);
  const mesPassado = `${mesAnterior(hoje.slice(0, 7))}-01`;
  return quarenta < mesPassado ? quarenta : mesPassado;
}

/** O período começa antes da janela do aparelho: a conta vai ao servidor (com sinal). */
export const foraDaJanela = (i: Intervalo, hoje: string): boolean => i.de < inicioDaJanela(hoje);

/** Linha curta da folha quando o período escolhido sai da janela (como em Pedidos). */
export const AJUDA_FORA_DA_JANELA = 'Este período precisa de internet';

/** Cópias da resposta do servidor guardadas no aparelho (§7.1): Este mês e Mês passado. */
export function chaveDaCopia(i: Intervalo, hoje: string): 'este_mes' | 'mes_passado' | null {
  const este = intervaloDaSelecao({ tipo: 'atalho', id: 'este_mes' }, hoje);
  const passado = intervaloDaSelecao({ tipo: 'atalho', id: 'mes_passado' }, hoje);
  if (i.de === este.de && i.ate === este.ate) return 'este_mes';
  if (i.de === passado.de && i.ate === passado.ate) return 'mes_passado';
  return null;
}

/** Situação da consulta ao servidor de um período fora da janela (o cartão no lugar dos números, como em Pedidos). */
export type EstadoDoServidor = 'sem_sinal' | 'carregando' | 'erro';

export function mensagemDoServidor(e: EstadoDoServidor): string {
  if (e === 'sem_sinal') return 'Sem sinal: este período precisa de internet.';
  if (e === 'carregando') return 'Buscando no servidor…';
  return 'Não foi possível consultar o servidor. Puxe para baixo para tentar de novo.';
}
