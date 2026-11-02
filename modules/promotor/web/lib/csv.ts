/** Exportação CSV do BKO de trade (padrão brasileiro do Excel: `;`, vírgula decimal, CRLF e BOM). */
import type { RelatorioRupturaApi, RelatorioShareApi } from '../../contracts';

export const CSV_BOM = '﻿';

export function csvCelula(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paraCsv(linhas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return CSV_BOM + linhas.map((l) => l.map(csvCelula).join(';')).join('\r\n') + '\r\n';
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
    ['Loja', 'Itens do mix', 'Presentes', 'Falta na gôndola (reposição)', 'Ruptura total', 'Ruptura (%)', 'Falha de reposição (%)', 'Ruptura total (%)', 'Unidades repostas', 'Check-in (UTC)'],
    ...r.linhas.map((l) => [l.cliente_nome ?? l.cliente_id, l.total, l.presentes, l.ruptura_gondola, l.ruptura_total, l.ruptura_pct, l.falha_reposicao_pct, l.ruptura_total_pct, l.quantidade_reposta, l.checkin_em]),
  ]);
}
