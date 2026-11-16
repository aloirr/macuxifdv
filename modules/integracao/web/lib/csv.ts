/**
 * CSV do monitor do Hub (T-0051): erros por linha do lote, gerados no navegador com o que a tela
 * mostra. Padrão do Excel brasileiro (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub: nenhum
 * valor de linha (o payload pode ter CPF/CNPJ) — §14 do hub-api.md.
 */
import { BOM_CSV, protegerFormula } from '@macuxi/comum/csv';
import type { LinhaErro, LoteListagemItem } from '../../contracts';

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
export const CSV_BOM = BOM_CSV;

type Celula = string | number | null | undefined;

/**
 * Escapa a célula: aspas quando houver `;`, `"` ou quebra de linha. Texto que começa com `=`, `+`, `-` ou `@` (código vindo do
 * ERP) (ou tabulação/retorno) ganha um apóstrofo na frente (`protegerFormula` de @macuxi/comum/csv) para o Excel não executar como fórmula.
 */
export function csvCell(v: Celula): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : protegerFormula(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<Celula>>): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export const ROTULO_MODO: Record<LoteListagemItem['modo'], string> = { completo: 'Carga completa', delta: 'Delta' };

export function errosParaCsv(erros: readonly LinhaErro[]): string {
  return toCsv([
    ['Linha', 'Código no ERP', 'Erro', 'Campo', 'Mensagem', 'Reprocessável', 'Origem'],
    ...erros.map((e) => [e.indice + 1, e.external_id, e.codigo, e.campo, e.mensagem, e.reprocessavel ? 'Sim' : 'Não', e.origem === 'conector' ? 'Conector' : 'Hub']),
  ]);
}
