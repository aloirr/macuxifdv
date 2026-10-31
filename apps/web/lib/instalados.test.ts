/** T-0004 critério 3 no BKO: os 8 módulos instalados pelo manifesto; o menu só traz módulos efetivos com páginas. */
import { criarShell, type ModuloShell } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS } from './instalados';

describe('shell web com os 8 módulos (T-0004)', () => {
  it('instala os 8 e o conjunto é válido', () => {
    expect(MANIFESTOS_INSTALADOS.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
    expect(() => criarShell('web', MANIFESTOS_INSTALADOS.map((m) => ({ manifesto: m })))).not.toThrow();
  });

  it('módulo efetivo sem web/ entra sem página; a página de exemplo só aparece com o módulo ativo', () => {
    const integracao = MANIFESTOS_INSTALADOS.find((m) => m.id === 'integracao')!;
    const pagina = { id: 'monitor', caminho: 'integracao', titulo: 'Integração ERP', navegacao: 'Integração ERP', componente: 'Monitor' };
    const modulos: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) => (m === integracao ? { manifesto: m, paginas: [pagina] } : { manifesto: m }));
    const shell = criarShell('web', modulos);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core', 'integracao'] }).navegacao.map((n) => n.testID)).toEqual(['nav-integracao-monitor']);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core'] }).navegacao).toEqual([]);
    expect(shell.montar({ perfil: 'admin', modulosAtivos: ['core'] }).pagina('integracao')).toBeNull();
  });
});
