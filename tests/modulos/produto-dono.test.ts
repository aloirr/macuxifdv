/**
 * T-0007 critério 4 — ADR-0005 + RN-CORE-03 com os MANIFESTOS REAIS dos 8 módulos (`modules/<m>/manifest.ts`):
 * o Vendedor depende do Catálogo (preço e estoque), então desativar o Catálogo desativa o Vendedor;
 * Promotor, Pesquisa e Gestor usam só o produto do Core e continuam ativos.
 */
import { describe, expect, it } from 'vitest';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { modulosEfetivos, ordenarPorDependencia, validarConjunto, type ModuloId, type Perfil } from '@macuxi/platform-sdk';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';

const MANIFESTOS = [core, catalogo, vendedor, promotor, pesquisa, gestor, treinamento, integracao];
const TODOS = MANIFESTOS.map((m) => m.id);

function efetivos(perfil: Perfil, ativosNoTenant: readonly ModuloId[] = TODOS, removidosDoUsuario: readonly ModuloId[] = []) {
  return modulosEfetivos({
    manifestos: MANIFESTOS,
    ativosNoTenant,
    doPerfil: MANIFESTOS.filter((m) => m.perfis.includes(perfil)).map((m) => m.id),
    removidosDoUsuario,
  });
}

describe('ADR-0005 — produto no dono definitivo (manifestos reais)', () => {
  it('conjunto dos 8 manifestos é coerente e instala core → catálogo → vendedor', () => {
    expect(validarConjunto(MANIFESTOS)).toEqual([]);
    expect(vendedor.depende).toEqual(['core', 'catalogo']);
    const ordem = ordenarPorDependencia(MANIFESTOS).map((m) => m.id);
    expect(ordem.indexOf('core')).toBeLessThan(ordem.indexOf('catalogo'));
    expect(ordem.indexOf('catalogo')).toBeLessThan(ordem.indexOf('vendedor'));
  });

  it('o produto (cadastro base) não é sincronizado pelo Catálogo; preço e estoque são', () => {
    expect(catalogo.sync).not.toContain('produto');
    expect(catalogo.sync).toEqual(expect.arrayContaining(['tabela_preco', 'tabela_preco_item', 'deposito', 'estoque_saldo']));
  });

  it('com o Catálogo ativo, o vendedor e o assistente de BKO têm o Vendedor', () => {
    expect(efetivos('vendedor')).toEqual(expect.arrayContaining(['core', 'catalogo', 'vendedor']));
    expect(efetivos('assistente')).toEqual(expect.arrayContaining(['core', 'catalogo', 'vendedor']));
  });

  it('RN-CORE-03: Catálogo desativado no tenant desativa o Vendedor', () => {
    const semCatalogo = TODOS.filter((m) => m !== 'catalogo');
    for (const perfil of ['vendedor', 'analista', 'assistente'] as const) {
      const r = efetivos(perfil, semCatalogo);
      expect(r).not.toContain('catalogo');
      expect(r).not.toContain('vendedor');
      expect(r).toContain('core');
    }
  });

  it('RN-CORE-03: Catálogo removido do usuário (exceção) também desativa o Vendedor', () => {
    expect(efetivos('vendedor', TODOS, ['catalogo'])).not.toContain('vendedor');
  });

  it('Promotor, Pesquisa e Gestor usam só o produto do Core: continuam ativos sem o Catálogo', () => {
    const semCatalogo = TODOS.filter((m) => m !== 'catalogo');
    expect(efetivos('promotor', semCatalogo)).toEqual(expect.arrayContaining(['core', 'promotor', 'pesquisa']));
    expect(efetivos('supervisor', semCatalogo)).toEqual(expect.arrayContaining(['core', 'gestor', 'promotor', 'pesquisa']));
  });
});
