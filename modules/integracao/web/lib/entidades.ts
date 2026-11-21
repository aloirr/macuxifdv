/**
 * Monitor da Integração ERP, uma linha por entidade (RF-INT-04; RN-INT-15). Funções puras que agregam os lotes recentes do
 * `MonitorResumo`: a regra de "reprocessável", "em andamento" e "linhas integradas" vem do domain; aqui só se compõe a linha e o texto.
 */
import { formatDataHoraCurta, formatDateTime, formatInt, formatTime } from '@macuxi/ui/web';
import type { Entidade, LoteListagemItem, MonitorResumo } from '../../contracts';
import { integradasDoLote, podeCancelarLote, podeReprocessarLote } from '../../domain';

export interface LinhaEntidade {
  entidade: Entidade;
  /** Lotes da entidade, do mais recente para o mais antigo. */
  lotes: LoteListagemItem[];
  ultimaCargaEm: string;
  comFalha: boolean;
  /** Hora (UTC) em que falhou o lote mais recente, quando ele falhou; nulo nos outros casos. */
  falhaEm: string | null;
  /** Ids dos lotes que a tela pode reprocessar (RN-INT-15), do mais antigo para o mais recente. */
  reprocessaveis: string[];
}

const maisRecente = (a: LoteListagemItem, b: LoteListagemItem) =>
  Date.parse(b.recebido_em) - Date.parse(a.recebido_em);

/** Quando o lote falhou (conclusão, ou recebimento se não houver); nulo se não falhou. */
export const falhouEm = (l: LoteListagemItem): string | null =>
  l.status === 'falhou' ? (l.concluido_em ?? l.recebido_em) : null;

export function agruparPorEntidade(lotes: readonly LoteListagemItem[]): LinhaEntidade[] {
  const porEntidade = new Map<Entidade, LoteListagemItem[]>();
  for (const l of lotes) porEntidade.set(l.entidade, [...(porEntidade.get(l.entidade) ?? []), l]);
  const linhas = [...porEntidade].map(([entidade, grupo]): LinhaEntidade => {
    const ordenados = [...grupo].sort(maisRecente);
    const falhos = ordenados.filter((l) => podeReprocessarLote(l.status));
    const recente = ordenados[0] as LoteListagemItem;
    return {
      entidade,
      lotes: ordenados,
      ultimaCargaEm: recente.recebido_em,
      comFalha: falhos.length > 0,
      falhaEm: falhouEm(recente),
      reprocessaveis: falhos.map((l) => l.lote_id).reverse(),
    };
  });
  return linhas.sort(
    (a, b) =>
      Number(b.comFalha) - Number(a.comFalha) || Date.parse(b.ultimaCargaEm) - Date.parse(a.ultimaCargaEm),
  );
}

/** "x de y" linhas integradas; em andamento e cancelado a célula fica vazia: o lote cancelado não aplicou linha nenhuma (RN-INT-15). */
export const textoLinhas = (
  estado: LoteListagemItem['status'],
  recebidas: number,
  comErro: number,
): string =>
  podeCancelarLote(estado) || estado === 'cancelado'
    ? ''
    : `${formatInt(integradasDoLote(estado, recebidas, comErro))} de ${formatInt(recebidas)}`;

/** Hora da falha no fuso do tenant; se cair em outro dia que o do recebimento, leva a data. */
export function horaDaFalha(quando: string, recebidoEm: string, tz: string): string {
  const outroDia =
    formatDataHoraCurta(quando, tz).slice(0, 5) !== formatDataHoraCurta(recebidoEm, tz).slice(0, 5);
  return outroDia ? formatDataHoraCurta(quando, tz) : formatTime(quando, tz);
}

/** "15/11 às 01:02 · falhou 01:03" ou "15/11 às 01:02 · 4 lotes": a data aparece uma vez por linha. */
export function textoUltimaCarga(linha: LinhaEntidade, tz: string): string {
  const partes = [formatDateTime(linha.ultimaCargaEm, tz)];
  if (linha.falhaEm) partes.push(`falhou ${horaDaFalha(linha.falhaEm, linha.ultimaCargaEm, tz)}`);
  else if (linha.lotes.length > 1) partes.push(`${linha.lotes.length} lotes`);
  return partes.join(' · ');
}

/** "‹conector› · v‹versão› · última carga recebida 15/11 às 01:02"; vazio se não há lote. O conector é o do lote mais recente. */
export function cabecalhoDoMonitor(
  lotes: readonly LoteListagemItem[],
  conectores: MonitorResumo['conectores'],
  tz: string,
): string {
  const recente = [...lotes].sort(maisRecente)[0];
  if (!recente) return '';
  const versao = conectores.find((c) => c.conector_id === recente.conector_id)?.versao_conector;
  return [
    recente.conector_id,
    versao ? `v${versao}` : null,
    `última carga recebida ${formatDateTime(recente.recebido_em, tz)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
