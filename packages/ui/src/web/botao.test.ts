import { describe, expect, it } from 'vitest';
import { Button, classesDoBotao } from './ui';

// RD-2619 (docs/design/componentes.md, "Botão desabilitado no web"): Névoa #ECEEF1 com texto #5B6673 (5,03:1),
// sem transparência; sai o bg-disabled #8B96A3 com texto branco (3,00:1). Sem react-dom: o Button é chamado como função.
type No = { type: unknown; props: Record<string, unknown> & { className?: string } };
const classes = (v: Parameters<typeof classesDoBotao>[0]) => classesDoBotao(v).split(/\s+/);

describe('Button: desabilitado', () => {
  for (const v of ['primary', 'secondary', 'danger'] as const) {
    it(`${v}: Névoa com texto de apoio e cursor not-allowed, sem o cinza de 3:1`, () => {
      const c = classes(v);
      expect(c).toEqual(expect.arrayContaining(['disabled:bg-neutral-soft', 'disabled:text-texto-apoio', 'disabled:cursor-not-allowed']));
      expect(c).not.toContain('disabled:bg-disabled');
      expect(c.some((x) => x.startsWith('disabled:opacity'))).toBe(false);
    });
  }
  it('link: só o texto de apoio, sem sublinhado', () => {
    expect(classes('link')).toEqual(expect.arrayContaining(['disabled:text-texto-apoio', 'disabled:no-underline', 'disabled:cursor-not-allowed']));
  });
  it('habilitado continua igual (principal Azul noite com texto branco)', () => {
    expect(classes('primary')).toEqual(expect.arrayContaining(['bg-accent', 'text-white']));
  });
  it('disabled e aria-disabled andam juntos', () => {
    const des = Button({ variant: 'primary', disabled: true, children: 'Gravar' }) as unknown as No;
    expect(des.props.disabled).toBe(true);
    expect(des.props['aria-disabled']).toBe(true);
    const hab = Button({ variant: 'primary', children: 'Gravar' }) as unknown as No;
    expect(hab.props['aria-disabled']).toBeUndefined();
  });
  it('mantém a classe de quem chama', () => {
    const b = Button({ className: 'w-full', children: 'Ok' }) as unknown as No;
    expect(String(b.props.className).split(/\s+/)).toContain('w-full');
  });
});
