/**
 * T-0072 (PR #92, visual do Treinamento) — quiz com questão em branco pede confirmação (decisão do Alexandre,
 * R-20261104-231218; testIDs no R-20261104-233840). A tela importa React Native (não roda no Node), então o roteiro de
 * toques é conferido NO FONTE de modules/treinamento/app/screens/quiz-screen.tsx, como em promotor-sem-pedido.test.ts:
 * - incompleto: `treinar-quiz-enviar` só abre a folha; o envio passa por `treinar-quiz-enviar-assim`;
 *   `treinar-quiz-revisar` fecha a folha sem enviar (volta ao quiz com as marcações);
 * - completo: `treinar-quiz-enviar` envia direto (sem folha);
 * - nenhuma resposta: botão desligado;
 * - `treinar-voltar-trilha` antes do envio e depois do resultado (aprovado ou reprovado).
 * Roteiro manual do aparelho: docs/testes/T-0072.md.
 *
 * ORDEM DE MERGE: este arquivo só passa com o #92 (nuvem/T-0072-visual-treinamento, 6fe1a6f) no main. Antes do merge ele
 * falha (a tela do main não tem a folha). Para conferir o fonte do PR sem mesclar:
 *   git show origin/nuvem/T-0072-visual-treinamento:modules/treinamento/app/screens/quiz-screen.tsx > <arquivo>
 *   MACUXI_T0072_QUIZ=<arquivo> pnpm vitest run --config tests/vitest.config.ts tests/modulos/treinamento-quiz-t0072.test.ts
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const CAMINHO = process.env.MACUXI_T0072_QUIZ ?? 'modules/treinamento/app/screens/quiz-screen.tsx';
const TELA = readFileSync(isAbsolute(CAMINHO) ? CAMINHO : join(RAIZ, CAMINHO), 'utf8');

/** Do `<Componente` que contém o testID até o fechamento do elemento (`/>` ou `</Componente>`). */
function elementoComTestId(fonte: string, testId: string): string {
  const i = fonte.indexOf(`testID="${testId}"`);
  if (i < 0) throw new Error(`testID ${testId} não está na tela`);
  const inicio = fonte.lastIndexOf('<', i);
  const fim = fonte.indexOf('/>', i);
  return fonte.slice(inicio, fim + 2);
}

/** Bloco da folha de confirmação (`<Folha` … `</Folha>`). */
function folha(fonte: string): string {
  const inicio = fonte.indexOf('<Folha');
  const fim = fonte.indexOf('</Folha>', inicio);
  if (inicio < 0 || fim < 0) throw new Error('a tela não tem a folha de confirmação');
  return fonte.slice(inicio, fim + '</Folha>'.length);
}

describe('T-0072 — quiz incompleto pede confirmação (treinar-quiz-enviar-assim / treinar-quiz-revisar)', () => {
  it('Q-1 incompleto: "Enviar" só abre a folha; completo: envia direto; sem resposta: desligado', () => {
    const enviar = elementoComTestId(TELA, 'treinar-quiz-enviar');
    expect(enviar).toMatch(/onPress=\{\(\) => \(respondidas < questoes\.length \? setConfirmando\(true\) : void enviar\(\)\)\}/);
    expect(enviar).toMatch(/desligado=\{respondidas === 0\}/);
    expect(enviar).toMatch(/`Enviar \(\$\{respondidas\} de \$\{questoes\.length\}\)`/);
  });

  it('Q-2 a folha abre com o estado `confirmando` e o envio dela é treinar-quiz-enviar-assim (chama o mesmo enviar)', () => {
    const f = folha(TELA);
    expect(f).toMatch(/visivel=\{confirmando\}/);
    const assim = elementoComTestId(f, 'treinar-quiz-enviar-assim');
    expect(assim).toMatch(/onPress=\{\(\) => void enviar\(\)\}/);
    expect(assim).toMatch(/rotulo="Enviar assim"/);
    expect(assim).toMatch(/ocupado=\{enviando\}/);
    // o envio fecha a folha antes de ir para a fila (não fica aberta por cima do resultado)
    expect(TELA).toMatch(/const enviar = async \(\) => \{\s*setConfirmando\(false\);/);
  });

  it('Q-3 treinar-quiz-revisar e o fechar da folha só voltam ao quiz (não enviam, não limpam as marcações)', () => {
    const f = folha(TELA);
    expect(f).toMatch(/rodape=\{\{ rotulo: 'Voltar ao quiz', onPress: \(\) => setConfirmando\(false\), testID: 'treinar-quiz-revisar' \}\}/);
    expect(f).toMatch(/onFechar=\{\(\) => setConfirmando\(false\)\}/);
    const rodape = /rodape=\{\{[^}]*\}\}/.exec(f)![0];
    expect(rodape).not.toMatch(/enviar|setMarcadas/);
  });

  it('Q-4 o texto da folha diz quantas ficaram em branco e que contam como erradas (singular e plural)', () => {
    const f = folha(TELA);
    expect(f).toMatch(/questoes\.length - respondidas === 1/);
    expect(f).toContain("'1 em branco conta como errada'");
    expect(f).toContain('em branco contam como erradas');
  });

  it('Q-5 treinar-voltar-trilha aparece antes do envio e depois do resultado; tentar de novo limpa as marcações', () => {
    expect(TELA.match(/testID="treinar-voltar-trilha"/g)).toHaveLength(2);
    for (const bloco of TELA.split('testID="treinar-voltar-trilha"').slice(1)) {
      expect(bloco.slice(0, bloco.indexOf('/>'))).toMatch(/onPress=\{\(\) => irParaTrilha\(trilha\.id\)\}/);
    }
    const deNovo = TELA.slice(TELA.indexOf('testID="treinar-quiz-de-novo"'));
    expect(deNovo.slice(0, deNovo.indexOf('/>'))).toMatch(/setRetorno\(null\);\s*setMarcadas\(\{\}\);/);
  });
});
