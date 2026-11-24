/**
 * T-0140 lote 03 — possível defeito encaminhado pelo corretor-redundancias (R-20261109-101907, reteste 2, sem RD): o CSV de
 * resultados da Pesquisa (RF-PES-06; `modules/pesquisa/domain/exportacao.ts`) não protegia contra fórmula a célula que começa
 * com `-` seguido de dígito (CWE-1236). O Excel lê `-1+1` como fórmula (mostra 0) e `-2+3+cmd|' /C calc'!A0` é a carga
 * clássica de DDE.
 *
 * Veredito: DEFEITO (segurança, média; recado R-20261109-110153-testes), corrigido pelo modulo-pesquisa no mesmo dia (RD-0044).
 * Desde a v1.0.32 (RD-0051, RD-2746) o teste passa pelo `exportarRespostasCsv` da Pesquisa com uma resposta de texto digitada:
 * é o que o T-0140 garante. O `=1+1` já está em `modules/pesquisa/domain/exportacao.test.ts` e não se repete aqui.
 * Sem banco: roda local e no CI. Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { describe, expect, it } from 'vitest';
import { exportarRespostasCsv } from '../../modules/pesquisa/domain/exportacao';
import { item, publicada, QUEST, TENANT, texto, u } from '../../modules/pesquisa/domain/util-teste';
import type { ItemResposta, RespostaPesquisa } from '@macuxi/pesquisa/contracts';

const respostaBase = (versao_id: string, itens: ItemResposta[]): RespostaPesquisa => ({
  id: u(5000),
  questionario_id: QUEST,
  versao_id,
  cliente_id: u(51),
  visita_id: null,
  respondida_em: '2026-11-09T14:30:00Z',
  itens,
  tenant_id: TENANT,
  usuario_id: u(31),
  equipe_id: null,
  recebida_em: '2026-11-09T14:31:00Z',
  suspeita: false,
  motivos_suspeita: [],
});

/** O Excel mostra a célula como texto quando ela começa com apóstrofo (o CSV pode vir entre aspas). */
const protegida = (celula: string) => /^"?'/.test(celula);

/** Célula da única pergunta (texto livre), a última da linha: tudo depois do 11º `;` (as colunas fixas não têm `;`). */
function celulaDoTexto(valor: string): string {
  const v = publicada({ perguntas: [texto(1, { enunciado: 'Obs' })] });
  const csv = exportarRespostasCsv({ versoes: [v], respostas: [respostaBase(v.id, [item.texto(1, valor)])], fuso: 'America/Manaus' });
  const linha = csv.slice(1).split('\r\n')[1]!;
  let i = -1;
  for (let n = 0; n < 11; n++) i = linha.indexOf(';', i + 1);
  return linha.slice(i + 1);
}

describe('T-0140 lote 03 — CSV da Pesquisa: proteção de fórmula na resposta de texto (CWE-1236, RF-PES-06)', () => {
  it.each(['+1+1', '@SOMA(A1)', '-A1', '\t=1', '=HYPERLINK("http://x";"y")'])('P1. "%s" sai protegida (controle)', (v) => {
    const c = celulaDoTexto(v);
    expect(protegida(c), c).toBe(true);
  });

  // D-T0140-L03c (corrigido em 09/11): a regex antiga `/^-[^\d.,\s]/` deixava passar o `-` seguido de dígito, ponto, vírgula ou espaço
  it.each(['-1+1', "-2+3+cmd|' /C calc'!A0", '-1-1', '- 1+1', '-.5+1', '-,5+1'])('P2. "%s" (texto livre) sai protegida', (v) => {
    const c = celulaDoTexto(v);
    expect(protegida(c), c).toBe(true);
  });

  it('P3. texto comum, data e número positivo digitados não mudam', () => {
    for (const v of ['Loja do João', '09/11/2026 10:30', '3,5', 'Sim']) expect(celulaDoTexto(v)).toBe(v);
  });
});
