/**
 * CSV para o Excel (UTF-8 com BOM, separador `;`), como os CSVs do BKO e do monitor do Hub.
 * `protegerFormula` evita a injeção de fórmula (CWE-1236): a célula que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de
 * carro ganha um apóstrofo na frente, e o Excel a mostra como texto. Era copiada em `modules/core/web/lib/farol.ts`,
 * `plano-rv.ts` e no `erros.csv` da Integração (R-20261106-062452, item 4).
 * Há dois formatos de célula, ambos com a fórmula protegida: `celulaCsv` e `celulaCsvCompacta` (RD-0051).
 * Nas duas, nulo vira célula vazia e o número sai com vírgula decimal; número não passa pela proteção: `-5` continua número.
 */
export const BOM_CSV = '﻿';

/** Prefixa com `'` a célula que o Excel leria como fórmula. */
export function protegerFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export type ValorCsv = string | number | null | undefined;

function textoDaCelula(v: ValorCsv): string {
  if (v == null) return '';
  return typeof v === 'number' ? String(v).replace('.', ',') : protegerFormula(v);
}

/** Célula entre aspas, com as aspas internas dobradas e a fórmula protegida. */
export function celulaCsv(v: ValorCsv): string {
  return `"${textoDaCelula(v).replace(/"/g, '""')}"`;
}

/** Célula com aspas só quando há `;`, `"`, `\n` ou `\r`; a fórmula é protegida antes do teste. */
export function celulaCsvCompacta(v: ValorCsv): string {
  const s = textoDaCelula(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
