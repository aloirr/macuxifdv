import { describe, expect, it } from 'vitest';

import { CampoSenha, type CampoSenhaProps } from './campo-senha';
import { IconEye, IconEyeOff } from './icons';

// sem react-dom: o componente (sem hooks) é chamado como função e a árvore é percorrida
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function nos(x: unknown): No[] {
  if (Array.isArray(x)) return x.flatMap(nos);
  if (!x || typeof x !== 'object' || !('props' in x)) return [];
  const n = x as No;
  return [n, ...nos(n.props.children)];
}

const arvore = (p: Partial<CampoSenhaProps> = {}) => nos(CampoSenha({ id: 'senha', rotulo: 'Senha', visivel: false, onAlternar: () => {}, testId: 'entrar.senha', ...p }));
const campo = (a: No[]) => a.find((n) => n.type === 'input')!;
const olho = (a: No[]) => a.find((n) => n.type === 'button');

describe('CampoSenha (web; R-20261115-071000, docs/design/campo-senha/spec.md)', () => {
  it('oculta: type password, olho aberto e "Mostrar senha"; o botão não envia o formulário', () => {
    const a = arvore();
    expect(campo(a).props.type).toBe('password');
    const b = olho(a)!;
    expect(b.props['aria-label']).toBe('Mostrar senha');
    expect(b.props.type).toBe('button');
    expect(b.props['data-testid']).toBe('entrar.senha.olho');
    expect(a.some((n) => n.type === IconEye)).toBe(true);
    expect(a.some((n) => n.type === IconEyeOff)).toBe(false);
  });

  it('visível: type text, olho riscado e "Ocultar senha"', () => {
    const a = arvore({ visivel: true });
    expect(campo(a).props.type).toBe('text');
    expect(olho(a)!.props['aria-label']).toBe('Ocultar senha');
    expect(a.some((n) => n.type === IconEyeOff)).toBe(true);
    expect(a.some((n) => n.type === IconEye)).toBe(false);
  });

  it('o clique no olho chama onAlternar (a tela troca o estado)', () => {
    let vezes = 0;
    const b = olho(arvore({ onAlternar: () => (vezes += 1) }))!;
    (b.props.onClick as () => void)();
    expect(vezes).toBe(1);
  });

  it('sem texto visível no botão: só o ícone (área de 44 px)', () => {
    const b = olho(arvore())!;
    const filhos = nos(b.props.children);
    expect(filhos.every((n) => n.type === IconEye || n.type === IconEyeOff)).toBe(true);
    expect(typeof b.props.children).not.toBe('string');
    expect(String(b.props.className)).toContain('h-11 w-11');
  });

  it('teclado de senha: sem corretor nem maiúscula; current-password no login e new-password na criação', () => {
    const p = campo(arvore()).props;
    expect([p.spellCheck, p.autoCapitalize, p.autoCorrect, p.autoComplete]).toEqual([false, 'none', 'off', 'current-password']);
    expect(campo(arvore({ finalidade: 'criacao' })).props.autoComplete).toBe('new-password');
  });

  it('sem onAlternar não há olho (campo "Repita a senha" segue o olho do campo de cima)', () => {
    const a = arvore({ onAlternar: undefined, visivel: true });
    expect(olho(a)).toBeUndefined();
    expect(campo(a).props.type).toBe('text');
  });

  it('rótulo ligado ao campo; erro e regras no aria-describedby', () => {
    const a = arvore({ erro: 'Senha incorreta.', descrito: 'senha-regras' });
    expect(a.find((n) => n.type === 'label')?.props.htmlFor).toBe('senha');
    expect(campo(a).props['aria-describedby']).toBe('senha-regras senha-erro');
    expect(campo(a).props['aria-invalid']).toBe(true);
    expect(a.find((n) => n.props.id === 'senha-erro')?.props.children).toBe('Senha incorreta.');
    expect(campo(arvore()).props['aria-describedby']).toBeUndefined();
  });
});
