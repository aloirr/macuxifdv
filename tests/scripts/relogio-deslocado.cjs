/**
 * Preload de varredura (agente testes): desloca o relógio do processo Node para MACUXI_RELOGIO_ALVO
 * (instante ISO 8601) e deixa o tempo correr a partir dali. Só `Date.now()` e `new Date()` sem argumento
 * mudam; `new Date(x)`, `Date.parse` e `Date.UTC` ficam iguais. O Postgres NÃO é deslocado (o now() do banco
 * segue real): use sem banco (MACUXI_PG_PORTA=1) para achar teste que compara data fixa com o relógio do Node.
 *
 * Uso: NODE_OPTIONS="--require <caminho>/tests/scripts/relogio-deslocado.cjs" MACUXI_RELOGIO_ALVO=2026-12-01T03:59:30Z vitest run
 * Runner pronto: node tests/scripts/varrer-relogio.mjs (tests/plano/relogio-varredura.md).
 */
'use strict';
const alvo = process.env.MACUXI_RELOGIO_ALVO;
if (alvo) {
  const Real = Date;
  const desloc = Real.parse(alvo) - Real.now();
  if (!Number.isFinite(desloc)) throw new Error(`MACUXI_RELOGIO_ALVO inválido (esperado instante ISO 8601): ${alvo}`);
  class DataDeslocada extends Real {
    constructor(...args) {
      if (args.length === 0) super(Real.now() + desloc);
      else super(...args);
    }
    static now() {
      return Real.now() + desloc;
    }
  }
  DataDeslocada.parse = Real.parse;
  DataDeslocada.UTC = Real.UTC;
  globalThis.Date = DataDeslocada;
}
