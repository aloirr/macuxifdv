/**
 * Dica do campo em foco no `CampoBusca` (spec docs/design/catalogo-campo-v2/spec.md §5 e filtro-veiculo/spec.md §3):
 * linha de apoio 14 `ink2` embaixo do campo, só com o campo em foco e vazio; o leitor de tela lê a dica como `accessibilityHint`.
 * Sem a prop `dica`, o `CampoBusca` fica como era. Parte pura testada aqui; o desenho é conferido pelo texto do arquivo.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { mostrarDicaDaBusca } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');
const DICA = 'Também acha por marca, aplicação e referência cruzada.';

describe('CampoBusca com dica: parte pura', () => {
  it('mostra a dica só com o campo em foco e vazio', () => {
    expect(mostrarDicaDaBusca({ dica: DICA, emFoco: true, valor: '' })).toBe(true);
    expect(mostrarDicaDaBusca({ dica: DICA, emFoco: false, valor: '' })).toBe(false);
  });

  it('some ao digitar (só espaço conta como vazio)', () => {
    expect(mostrarDicaDaBusca({ dica: DICA, emFoco: true, valor: 'paf' })).toBe(false);
    expect(mostrarDicaDaBusca({ dica: DICA, emFoco: true, valor: '   ' })).toBe(true);
  });

  it('sem dica (ausente ou em branco) nunca mostra', () => {
    expect(mostrarDicaDaBusca({ emFoco: true, valor: '' })).toBe(false);
    expect(mostrarDicaDaBusca({ dica: '', emFoco: true, valor: '' })).toBe(false);
    expect(mostrarDicaDaBusca({ dica: '  ', emFoco: true, valor: '' })).toBe(false);
  });
});

describe('CampoBusca com dica: conferência estática', () => {
  const form = ler('./formulario.tsx');
  const inicio = form.indexOf('export function CampoBusca(');
  const campo = form.slice(inicio, form.indexOf('// ---------- RotuloSecao', inicio));

  it('a prop é opcional e o texto vem do módulo', () => {
    expect(campo).toMatch(/dica\?: string;/);
    expect(campo).not.toContain(DICA);
  });

  it('o leitor de tela lê a dica como accessibilityHint', () => {
    expect(campo).toContain('accessibilityHint={dicaLimpa}');
  });

  it('acompanha o foco do campo sem perder o onFocus/onBlur de ninguém', () => {
    expect(campo).toContain('onFocus={');
    expect(campo).toContain('onBlur={');
    expect(campo).toContain('mostrarDicaDaBusca(');
  });

  it('linha de apoio 14 ink2 embaixo do campo', () => {
    expect(campo).toMatch(/style=\{s\.buscaDica\}/);
    expect(form).toMatch(/buscaDica: \{[^}]*\.\.\.t\.sub/);
  });

  it('sem a prop, devolve a mesma caixa de antes (sem invólucro)', () => {
    expect(campo).toMatch(/if \(!dicaLimpa\) return caixa;/);
  });
});
