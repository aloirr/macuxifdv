/** JSON canônico (chaves em ordem alfabética, `undefined` e `null` de objeto omitidos): base da chave de idempotência do lote. */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const x = o[k];
      if (x === undefined || x === null) continue;
      saida[k] = ordenar(x);
    }
    return saida;
  }
  return v;
}
