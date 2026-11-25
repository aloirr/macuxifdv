/** Exportação CSV do BKO de trade (padrão brasileiro do Excel: `;`, vírgula decimal, CRLF e BOM). */
import { BOM_CSV, celulaCsvCompacta } from '@macuxi/comum/csv';
import type { RelatorioRupturaApi, RelatorioShareApi } from '../../contracts';
import { ROTULO_COLUNA_RUPTURA } from '../../domain/ruptura';

export function paraCsv(linhas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return BOM_CSV + linhas.map((l) => l.map(celulaCsvCompacta).join(';')).join('\r\n') + '\r\n';
}

export const ROTULO_SITUACAO_SHARE: Readonly<Record<RelatorioShareApi['linhas'][number]['situacao'], string>> = {
  atingiu: 'Atingiu',
  abaixo: 'Abaixo da meta',
  sem_meta: 'Sem meta',
  sem_dados: 'Sem frentes',
};

export function shareCsv(r: RelatorioShareApi): string {
  return paraCsv([
    ['Loja', 'Categoria', 'Share (%)', 'Meta (%)', 'Atingimento (%)', 'Desvio (pp)', 'Situação', 'Medido em (UTC)'],
    ...r.linhas.map((l) => [l.cliente_nome ?? l.cliente_id, l.categoria_nome ?? l.categoria_gondola_id, l.share_pct, l.meta_pct, l.atingimento_pct, l.desvio_pp, ROTULO_SITUACAO_SHARE[l.situacao], l.medido_em]),
  ]);
}

export function rupturaCsv(r: RelatorioRupturaApi): string {
  return paraCsv([
    ['Loja', 'Itens do mix', 'Presentes', ROTULO_COLUNA_RUPTURA.falha_reposicao, ROTULO_COLUNA_RUPTURA.sem_estoque, `${ROTULO_COLUNA_RUPTURA.geral} (%)`, `${ROTULO_COLUNA_RUPTURA.falha_reposicao} (%)`, `${ROTULO_COLUNA_RUPTURA.sem_estoque} (%)`, 'Unidades repostas', 'Check-in (UTC)'],
    ...r.linhas.map((l) => [l.cliente_nome ?? l.cliente_id, l.total, l.presentes, l.ruptura_gondola, l.ruptura_total, l.ruptura_pct, l.falha_reposicao_pct, l.ruptura_total_pct, l.quantidade_reposta, l.checkin_em]),
  ]);
}
