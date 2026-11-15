import { describe, expect, it } from 'vitest';
import { ConfirmarDigitando, codigoConfere, rotuloConfirmarDigitando } from './confirmar';
import { Button } from './ui';

// sem react-dom: os componentes (sem hooks) são chamados como função e a árvore é percorrida
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
  return texto((x as No).props.children);
}

const classes = (x: unknown) => String((x as No).props.className).split(/\s+/);

describe('codigoConfere (portal-config-enxuto §15.2)', () => {
  it('libera só quando o digitado bate com o código', () => {
    expect(codigoConfere('AM4821', 'AM4821')).toBe(true);
    expect(codigoConfere('AM482', 'AM4821')).toBe(false);
    expect(codigoConfere('AM48210', 'AM4821')).toBe(false);
    expect(codigoConfere('RR4821', 'AM4821')).toBe(false);
  });

  it('sem diferença de maiúsculas e de espaços nas pontas', () => {
    expect(codigoConfere('am4821', 'AM4821')).toBe(true);
    expect(codigoConfere('  Am4821 ', 'AM4821')).toBe(true);
    expect(codigoConfere('AM 4821', 'AM4821')).toBe(false);
  });

  it('vazio nunca confere, nem com código esperado vazio', () => {
    expect(codigoConfere('', 'AM4821')).toBe(false);
    expect(codigoConfere('   ', '')).toBe(false);
    expect(codigoConfere('', '')).toBe(false);
  });
});

describe('ConfirmarDigitando (web)', () => {
  const arvore = (valor: string) => nos(ConfirmarDigitando({ id: 'excluir-codigo', codigo: 'AM4821', valor, onChange: () => undefined, testID: 'empresa-excluir.codigo' }));

  it('rótulo "Digite {código} para confirmar", ligado ao campo', () => {
    const a = arvore('');
    const label = a.find((n) => n.type === 'label');
    expect(texto(label)).toBe('Digite AM4821 para confirmar');
    expect(rotuloConfirmarDigitando('AM4821')).toBe('Digite AM4821 para confirmar');
    expect(label?.props.htmlFor).toBe('excluir-codigo');
    const campo = a.find((n) => n.type === 'input');
    expect(campo?.props.id).toBe('excluir-codigo');
    expect(campo?.props['data-testid']).toBe('empresa-excluir.codigo');
  });

  it('campo sem corretor, sem preenchimento automático, com foco ao abrir e em fonte mono', () => {
    const campo = arvore('').find((n) => n.type === 'input');
    expect(campo?.props.autoComplete).toBe('off');
    expect(campo?.props.spellCheck).toBe(false);
    expect(campo?.props.autoFocus).toBe(true);
    expect(classes(campo)).toContain('font-mono');
    // o código no rótulo também em mono
    expect(arvore('').some((n) => n.type === 'span' && texto(n) === 'AM4821' && classes(n).includes('font-mono'))).toBe(true);
  });

  it('o estado do campo diz se confere (a tela usa codigoConfere para o botão)', () => {
    expect(arvore('').find((n) => n.type === 'input')?.props['data-confere']).toBe('nao');
    expect(arvore('am4821').find((n) => n.type === 'input')?.props['data-confere']).toBe('sim');
    expect(arvore('am4821').find((n) => n.type === 'input')?.props.value).toBe('am4821');
  });

  it('código errado não mostra mensagem de erro (só o botão fica desabilitado)', () => {
    const a = arvore('XX0000');
    expect(a.some((n) => n.props.role === 'alert')).toBe(false);
    expect(a.find((n) => n.type === 'input')?.props['aria-invalid']).toBeUndefined();
  });
});

describe('Button variant="danger-secondary" (portal-config-enxuto §15.4)', () => {
  it('contorno e texto em danger, fundo surface; hover em danger-soft com texto e borda danger', () => {
    const c = classes(Button({ variant: 'danger-secondary', children: 'Excluir' }));
    expect(c).toEqual(expect.arrayContaining(['border', 'border-danger', 'bg-surface', 'text-danger', 'hover:bg-danger-soft', 'hover:text-danger', 'hover:border-danger']));
    expect(c).not.toContain('bg-danger');
  });

  it('desabilitado como o secundário: borda e texto apagados, sem hover vermelho', () => {
    const c = classes(Button({ variant: 'danger-secondary', disabled: true, children: 'Excluir' }));
    expect(c).toEqual(expect.arrayContaining(['disabled:border-field', 'disabled:text-disabled', 'disabled:hover:bg-surface']));
  });

  it('o danger cheio usa o token no hover (sem cor solta)', () => {
    const c = classes(Button({ variant: 'danger', children: 'Excluir empresa' }));
    expect(c).toContain('hover:bg-danger/90');
    expect(c.some((x) => x.includes('#'))).toBe(false);
  });
});
