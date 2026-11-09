/**
 * T-0140 lote 03 — possível defeito encaminhado pelo corretor-redundancias (R-20261109-101907, reteste 2, sem RD): o CSV de
 * resultados da Pesquisa (RF-PES-06; `modules/pesquisa/domain/exportacao.ts`, `celulaCsv`) não protege contra fórmula a célula
 * que começa com `-` seguido de dígito (CWE-1236). O Excel lê `-1+1` como fórmula (mostra 0) e `-2+3+cmd|' /C calc'!A0` é a
 * carga clássica de DDE. A regra do comum (`packages/comum/src/csv.ts`, `protegerFormula`) e os outros CSVs protegem todo `-`.
 *
 * Veredito: DEFEITO (segurança, média). Os casos P2 ficam em `it.fails` até a correção do modulo-pesquisa e voltam para `it`.
 * O número negativo puro (`-3,5`, resposta de pergunta numérica) fica fora da asserção: protegê-lo vira texto no Excel, e a
 * escolha é do dono (sugestão no recado: proteger o `-` salvo quando a célula inteira é um número).
 * Sem banco: roda local e no CI. Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { protegerFormula } from '@macuxi/comum/csv';
import { describe, expect, it } from 'vitest';
import { celulaCsv } from '../../modules/pesquisa/domain/exportacao';

/** O Excel mostra a célula como texto quando ela começa com apóstrofo (o CSV pode vir entre aspas). */
const protegida = (celula: string) => /^"?'/.test(celula);

describe('T-0140 lote 03 — CSV da Pesquisa: proteção de fórmula (CWE-1236, RF-PES-06)', () => {
  it.each(['=1+1', '+1+1', '@SOMA(A1)', '-A1', '\t=1', "=HYPERLINK(\"http://x\";\"y\")"])('P1. "%s" sai protegida (controle)', (v) => {
    expect(protegida(celulaCsv(v)), celulaCsv(v)).toBe(true);
    expect(protegida(protegerFormula(v))).toBe(true);
  });

  // D-T0140-L03c (modulo-pesquisa): `/^-[^\d.,\s]/` deixa passar o `-` seguido de dígito, ponto, vírgula ou espaço
  it.fails.each(['-1+1', "-2+3+cmd|' /C calc'!A0", '-1-1', '- 1+1', '-.5+1', '-,5+1'])('P2. "%s" (texto livre) sai protegida, como no comum', (v) => {
    expect(protegerFormula(v).startsWith("'"), 'regra do comum').toBe(true);
    expect(protegida(celulaCsv(v)), `celulaCsv devolveu ${celulaCsv(v)}`).toBe(true);
  });

  it('P3. texto comum, data e número positivo não mudam', () => {
    for (const v of ['Loja do João', '09/11/2026 10:30', '3,5', 'Sim']) expect(celulaCsv(v)).toBe(v);
  });
});
