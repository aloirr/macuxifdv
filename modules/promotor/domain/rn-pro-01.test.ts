import { describe, expect, it } from 'vitest';
import { criarPermissoes, ehAcaoDePedido } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import * as dominio from './index';

// RN-PRO-01: o promotor nunca cria, edita, cancela, duplica ou exclui pedido (UI e API).
describe('RN-PRO-01: o módulo Promotor não tem nenhuma operação de pedido', () => {
  const VERBOS = /(pedido|order|orcamento|cart|carrinho)/i;

  it('RN-PRO-01: nenhuma função exportada do domain tem "pedido" no nome', () => {
    const nomes = Object.keys(dominio);
    expect(nomes.length).toBeGreaterThan(10);
    expect(nomes.filter((n) => VERBOS.test(n))).toEqual([]);
  });

  it('RN-PRO-01: nenhuma ação do manifesto é de pedido (criar, editar, cancelar, duplicar, excluir)', () => {
    const acoes = Object.keys(manifest.acoes);
    expect(acoes.length).toBeGreaterThan(0);
    expect(acoes.filter((a) => ehAcaoDePedido(a) || VERBOS.test(a))).toEqual([]);
  });

  it('RN-PRO-01: o manifesto também não sincroniza nem publica nada de pedido', () => {
    expect(manifest.sync.filter((s) => VERBOS.test(s))).toEqual([]);
    expect(manifest.publica.filter((e) => VERBOS.test(e))).toEqual([]);
  });

  it('RN-PRO-01: mesmo com o Vendedor ativo, o promotor continua sem ação de pedido (negada pela plataforma, 403 na API)', () => {
    const permissoes = criarPermissoes([manifest]);
    for (const verbo of ['criar', 'editar', 'cancelar', 'duplicar', 'excluir']) {
      expect(permissoes.pode(`pedido.${verbo}`, { perfil: 'promotor', modulosAtivos: ['core', 'vendedor', 'promotor'] })).toBe(false);
    }
    const todas = permissoes.acoesPermitidas({ perfil: 'promotor', modulosAtivos: ['core', 'promotor'] });
    expect(todas.length).toBeGreaterThan(0);
    expect(todas.filter((a) => ehAcaoDePedido(a))).toEqual([]);
  });
});
