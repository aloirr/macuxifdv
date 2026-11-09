/**
 * CSV do monitor do Hub (T-0051): lotes, erros por linha e a pendência de inativação em massa, gerados no navegador com o que a tela
 * mostra. Padrão do Excel brasileiro (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub: nenhum
 * valor de linha (o payload pode ter CPF/CNPJ) — §14 do hub-api.md.
 */
import { protegerFormula } from '@macuxi/comum/csv';
import { DEFAULT_TZ, formatDateTimeFull } from '@macuxi/ui/web';
import type { LinhaErro, LoteListagemItem, PendenciaInativacao } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_STATUS_LOTE } from './apresentacao';

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
export const CSV_BOM = '﻿';

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

const decimal = (n: number) => n.toFixed(2).replace('.', ',');

export const ROTULO_MODO: Record<LoteListagemItem['modo'], string> = { completo: 'Carga completa', delta: 'Delta' };

export function lotesParaCsv(lotes: readonly LoteListagemItem[], tz = DEFAULT_TZ): string {
  return toCsv([
    ['Lote', 'Conector', 'Entidade', 'Modo', 'Status', 'Recebidas', 'Novas', 'Atualizadas', 'Inalteradas', 'Obsoletas', 'Com erro', 'Inativadas', 'Recebido em', 'Concluído em'],
    ...lotes.map((l) => [
      l.lote_id,
      l.conector_id,
      ROTULO_ENTIDADE[l.entidade],
      ROTULO_MODO[l.modo],
      ROTULO_STATUS_LOTE[l.status],
      l.recebidas,
      l.novas,
      l.atualizadas,
      l.inalteradas,
      l.obsoletas,
      l.com_erro,
      l.inativadas,
      formatDateTimeFull(l.recebido_em, tz),
      formatDateTimeFull(l.concluido_em, tz),
    ]),
  ]);
}

export function errosParaCsv(erros: readonly LinhaErro[]): string {
  return toCsv([
    ['Linha', 'Código no ERP', 'Erro', 'Campo', 'Mensagem', 'Reprocessável', 'Origem'],
    ...erros.map((e) => [e.indice + 1, e.external_id, e.codigo, e.campo, e.mensagem, e.reprocessavel ? 'Sim' : 'Não', e.origem === 'conector' ? 'Conector' : 'Hub']),
  ]);
}

/**
 * Resumo da pendência e a amostra (até 50 códigos do ERP), uma linha por código. A lista completa dos candidatos é recalculada no
 * servidor (hub-api.md, tabela `pendencia_inativacao`) e ainda não tem rota no BKO.
 */
export function pendenciaParaCsv(p: PendenciaInativacao, tz = DEFAULT_TZ): string {
  const resumo: Celula[] = [
    ROTULO_ENTIDADE[p.entidade],
    p.conector_id,
    p.lote_id,
    p.candidatos,
    p.total_ativos,
    decimal(p.percentual),
    decimal(p.limite_pct),
    formatDateTimeFull(p.criada_em, tz),
    formatDateTimeFull(p.expira_em, tz),
  ];
  const codigos = p.amostra.length > 0 ? p.amostra : [null];
  return toCsv([
    ['Entidade', 'Conector', 'Lote', 'Inativaria', 'Ativos', 'Percentual', 'Limite', 'Criada em', 'Vale até', 'Código no ERP'],
    ...codigos.map((c) => [...resumo, c]),
  ]);
}
