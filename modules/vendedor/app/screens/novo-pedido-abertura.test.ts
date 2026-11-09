import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Relato do dono do produto (08/11): "Novo pedido" na ficha de qualquer cliente mostrava "Cliente não encontrado" e o app
 * fechava. O editor tem a própria instância do `useVendedor` (começa vazia) e chamava hooks depois dos `return` antecipados:
 * o 1º render saía cedo, o 2º chamava mais hooks e o React lançava (sem tela de erro no build, o Android fecha o app).
 * A regra dos hooks agora é do lint (`react-hooks/rules-of-hooks`, packages/config/eslint.mjs); aqui fica a espera da carga.
 * As telas importam react-native e não rodam no Node: confere no fonte (mesmo padrão de telas-t0101.test.ts).
 */
const fonte = readFileSync(join(__dirname, 'new-order-screen.tsx'), 'utf8');
const editor = fonte.slice(fonte.indexOf('function OrderEditor('));

describe('Novo pedido: abertura pela ficha do cliente', () => {
  it('espera a carga do aparelho antes de decidir "Cliente não encontrado"', () => {
    const espera = editor.indexOf('if (!app.carregado) return <Loading />;');
    const naoEncontrado = editor.indexOf("titulo=\"Cliente não encontrado\"");
    expect(espera).toBeGreaterThan(0);
    expect(naoEncontrado).toBeGreaterThan(espera);
  });
  it('nenhum hook depois do primeiro return antecipado do editor', () => {
    const primeiroReturn = editor.indexOf('if (!app.carregado) return');
    const fimDoEditor = editor.indexOf('\nfunction ', 1);
    const depois = editor.slice(primeiroReturn, fimDoEditor > 0 ? fimDoEditor : undefined);
    expect(depois).not.toMatch(/\buse(State|Ref|Effect|Memo|Callback|FocusEffect|LayoutEffect)\(/);
  });
});
