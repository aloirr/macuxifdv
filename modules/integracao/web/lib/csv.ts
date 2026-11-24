/**
 * CSV do monitor do Hub (T-0051): erros por linha do lote, gerados no navegador com o que a tela
 * mostra. Padrão do Excel brasileiro (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub: nenhum
 * valor de linha (o payload pode ter CPF/CNPJ) — §14 do hub-api.md.
 */
import { BOM_CSV, celulaCsvCompacta } from '@macuxi/comum/csv';
import type { LinhaErro, LoteListagemItem } from '../../contracts';

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
export const CSV_BOM = BOM_CSV;

type Celula = string | number | null | undefined;

/**
 * Célula de texto pela `celulaCsvCompacta` de @macuxi/comum/csv (aspas só com `;`, `"` ou quebra; fórmula vinda do ERP
 * protegida com apóstrofo). Número fica fora da proteção: `-3` continua `-3`.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<Celula>>): string {
  const celula = (v: Celula) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : celulaCsvCompacta(v));
  return CSV_BOM + rows.map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';
}

export const ROTULO_MODO: Record<LoteListagemItem['modo'], string> = { completo: 'Carga completa', delta: 'Delta' };

export function errosParaCsv(erros: readonly LinhaErro[]): string {
  return toCsv([
    ['Linha', 'Código no ERP', 'Erro', 'Campo', 'Mensagem', 'Reprocessável', 'Origem'],
    ...erros.map((e) => [e.indice + 1, e.external_id, e.codigo, e.campo, e.mensagem, e.reprocessavel ? 'Sim' : 'Não', e.origem === 'conector' ? 'Conector' : 'Hub']),
  ]);
}
