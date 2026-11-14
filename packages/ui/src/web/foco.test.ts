import { describe, expect, it } from 'vitest';
import { CLASSES_DESTAQUE } from './cores';
import { SelectField } from './ui';

// MC-0027 (marca, BKO): o campo em foco mostra o contorno Azul noite do kit, não o padrão do navegador.
// Sem react-dom: o componente é chamado como função e a árvore de elementos é percorrida.
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string } };

function acharPorTipo(no: unknown, tipo: string): No | undefined {
  if (Array.isArray(no)) {
    for (const filho of no) {
      const achado = acharPorTipo(filho, tipo);
      if (achado) return achado;
    }
    return undefined;
  }
  if (!no || typeof no !== 'object' || !('props' in no)) return undefined;
  const n = no as No;
  if (n.type === tipo) return n;
  return acharPorTipo(n.props.children, tipo);
}

describe('foco dos campos do kit web (MC-0027)', () => {
  it('o select do SelectField leva o foco Azul noite e mantém a classe de quem chama', () => {
    const arvore = SelectField({ label: 'Situação', className: 'w-[200px]', children: null });
    const select = acharPorTipo(arvore, 'select');
    expect(select).toBeDefined();
    const classes = String(select?.props.className).split(/\s+/);
    for (const c of CLASSES_DESTAQUE.foco.split(' ')) expect(classes).toContain(c);
    expect(classes).toContain('w-[200px]');
  });
});
