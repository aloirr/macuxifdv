import { describe, expect, it } from 'vitest';
import { RegrasDaSenha } from './senha';

// sem react-dom: o componente (sem hooks) é chamado como função e a árvore é percorrida
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function nos(x: unknown): No[] {
  if (Array.isArray(x)) return x.flatMap(nos);
  if (!x || typeof x !== 'object' || !('props' in x)) return [];
  const n = x as No;
  return [n, ...nos(n.props.children)];
}

function texto(x: unknown): string {
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (Array.isArray(x)) return x.map(texto).join('');
  if (!x || typeof x !== 'object' || !('props' in x)) return '';
  const n = x as No;
  return n.props['aria-hidden'] === 'true' ? '' : texto(n.props.children);
}

type Props = Parameters<typeof RegrasDaSenha>[0];
/** As telas passam `minimo={SENHA_MIN_CARACTERES}` e `resumo={mensagemDaSenha(faltas)}` do Core; aqui, dados de teste. */
const arvore = (props: Omit<Props, 'minimo' | 'resumo'> & Partial<Pick<Props, 'minimo' | 'resumo'>>) =>
  nos(RegrasDaSenha({ minimo: 8, resumo: null, ...props }));
const porTestId = (a: No[], id: string) => a.find((n) => n.props['data-testid'] === id);

describe('RegrasDaSenha (web)', () => {
  it('lista as quatro regras com o estado de cada uma', () => {
    const a = arvore({ faltas: ['numero', 'especial'] });
    const itens = a.filter((n) => n.type === 'li');
    expect(itens.map((n) => n.props['data-estado'])).toEqual(['ok', 'ok', 'falta', 'falta']);
    expect(a.find((n) => n.type === 'ul')?.props['aria-label']).toBe('A senha precisa ter');
  });

  it('o leitor de tela ouve "ok" ou "falta" em cada regra (não depende da cor) e não lê os símbolos do exemplo', () => {
    const a = arvore({ faltas: ['numero', 'especial'] });
    const falado = a.filter((n) => n.type === 'li').map((n) => texto(n.props.children));
    expect(falado).toEqual(['8 caracteres ou mais: ok', 'Uma letra: ok', 'Um número: falta', 'Um caractere especial: falta']);
    // o mínimo vem da tela (RD-0021)
    expect(texto(porTestId(arvore({ faltas: [], minimo: 12 }), 'regras-da-senha.caracteres')?.props.children)).toBe('12 caracteres ou mais: ok');
  });

  it('a região viva educada traz o resumo que a tela passa (frase do Core); null = atende às regras', () => {
    const r = porTestId(arvore({ faltas: ['numero', 'especial'], resumo: 'Faltam um número e um caractere especial.' }), 'regras-da-senha.resumo');
    expect(r?.props['aria-live']).toBe('polite');
    expect(r?.props.role).toBe('status');
    expect(texto(r)).toBe('Faltam um número e um caractere especial.');
    expect(texto(porTestId(arvore({ faltas: [] }), 'regras-da-senha.resumo'))).toBe('A senha atende às regras.');
    expect(texto(porTestId(arvore({ faltas: ['letra'], resumo: 'Frase do Core.' }), 'regras-da-senha.resumo'))).toBe('Frase do Core.');
  });

  it('destacar marca as faltas como erro; o id liga ao aria-describedby do campo', () => {
    const a = arvore({ faltas: ['caracteres'], destacar: true, id: 'senha-regras' });
    expect(porTestId(a, 'regras-da-senha')?.props.id).toBe('senha-regras');
    expect(porTestId(a, 'regras-da-senha.caracteres')?.props['data-estado']).toBe('erro');
    expect(porTestId(a, 'regras-da-senha.letra')?.props['data-estado']).toBe('ok');
  });

  it('T-0094: sem repeticao não há a linha de conferência (portal e formulário de usuário ficam iguais)', () => {
    const a = arvore({ faltas: [], id: 'senha-regras' });
    expect(porTestId(a, 'regras-da-senha.repeticao')).toBeUndefined();
    expect(texto(porTestId(a, 'regras-da-senha.resumo'))).toBe('A senha atende às regras.');
  });

  it('T-0094: "As duas senhas iguais" fica fora da lista, com id para o aria-describedby, "falta" falado, e entra na região viva', () => {
    const a = arvore({ faltas: ['numero'], resumo: 'Falta um número.', repeticao: 'diferente', id: 'senha-regras' });
    const linha = porTestId(a, 'regras-da-senha.repeticao');
    expect(linha?.type).toBe('p');
    expect(linha?.props.id).toBe('senha-regras-repeticao');
    expect(linha?.props['data-estado']).toBe('falta');
    expect(texto(linha)).toBe('As duas senhas iguais: falta');
    expect(a.filter((n) => n.type === 'li')).toHaveLength(4);
    expect(texto(porTestId(a, 'regras-da-senha.resumo'))).toBe('Falta um número. As duas senhas iguais: falta.');
  });

  it('R-20261115-080000-alexandre: o item aparece desde o início (vazia = círculo vazio) e o id do aria-describedby existe sempre', () => {
    const vazia = porTestId(arvore({ faltas: [], repeticao: 'vazia', id: 'senha-regras' }), 'regras-da-senha.repeticao');
    expect(vazia?.props['data-estado']).toBe('falta');
    expect(vazia?.props.id).toBe('senha-regras-repeticao');
  });

  it('T-0094: depois de tentar salvar, diferente e vazia viram erro (✕); igual fica ok (✓)', () => {
    expect(porTestId(arvore({ faltas: [], repeticao: 'diferente', destacar: true }), 'regras-da-senha.repeticao')?.props['data-estado']).toBe('erro');
    const vazia = porTestId(arvore({ faltas: [], repeticao: 'vazia', destacar: true }), 'regras-da-senha.repeticao');
    expect(vazia?.props['data-estado']).toBe('erro');
    expect(texto(vazia)).toBe('As duas senhas iguais: falta');
    const igual = arvore({ faltas: [], repeticao: 'igual', destacar: true });
    expect(porTestId(igual, 'regras-da-senha.repeticao')?.props['data-estado']).toBe('ok');
    expect(texto(porTestId(igual, 'regras-da-senha.repeticao'))).toBe('As duas senhas iguais: ok');
    expect(texto(porTestId(igual, 'regras-da-senha.resumo'))).toBe('A senha atende às regras. As duas senhas iguais: ok.');
  });
});
