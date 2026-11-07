/**
 * CSV para o Excel (UTF-8 com BOM, separador `;`), como os CSVs do BKO e do monitor do Hub.
 * `protegerFormula` evita a injeção de fórmula (CWE-1236): a célula que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de
 * carro ganha um apóstrofo na frente, e o Excel a mostra como texto. Era copiada em `modules/core/web/lib/farol.ts`,
 * `plano-rv.ts` e no `erros.csv` da Integração (R-20261106-062452, item 4).
 */
export const BOM_CSV = '﻿';

/** Prefixa com `'` a célula que o Excel leria como fórmula. */
export function protegerFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Célula entre aspas, com as aspas internas dobradas e a fórmula protegida. */
export function celulaCsv(v: string): string {
  return `"${protegerFormula(v).replace(/"/g, '""')}"`;
}
