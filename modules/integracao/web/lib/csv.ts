/**
 * CSV do monitor do Hub (T-0051): erros por linha do lote, gerados no navegador com o que a tela
 * mostra. Padrão do Excel brasileiro (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub: nenhum
 * valor de linha (o payload pode ter CPF/CNPJ) — §14 do hub-api.md.
 */
import { BOM_CSV, celulaCsvCompacta, type ValorCsv } from '@macuxi/comum/csv';
import type { LinhaErro, LoteListagemItem } from '../../contracts';

export function toCsv(rows: ReadonlyArray<ReadonlyArray<ValorCsv>>): string {
  return BOM_CSV + rows.map((r) => r.map(celulaCsvCompacta).join(';')).join('\r\n') + '\r\n';
}

export const ROTULO_MODO: Record<LoteListagemItem['modo'], string> = { completo: 'Carga completa', delta: 'Delta' };

export function errosParaCsv(erros: readonly LinhaErro[]): string {
  return toCsv([
    ['Linha', 'Código no ERP', 'Erro', 'Campo', 'Mensagem', 'Reprocessável', 'Origem'],
    ...erros.map((e) => [e.indice + 1, e.external_id, e.codigo, e.campo, e.mensagem, e.reprocessavel ? 'Sim' : 'Não', e.origem === 'conector' ? 'Conector' : 'Hub']),
  ]);
}
