import type { ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { provedoresSyncCatalogo } from './sync';

const ctxDe = (perfil: string, parametros: Record<string, unknown>) => ({ usuario: { perfil }, parametros: () => parametros }) as unknown as ContextoBase;
const PRECO_ESTOQUE = ['tabela_preco', 'tabela_preco_item', 'tabela_escalonada', 'cliente_tabela_preco', 'deposito', 'estoque_saldo'];
const nome = (p: (typeof provedoresSyncCatalogo)[number]) => p.entidade.nome.replace(/^catalogo\./, '');

describe('RN-CAT-05: variacaoEscopo dos provedores de preço e estoque (T-0121 N3)', () => {
  const provedores = provedoresSyncCatalogo.filter((p) => PRECO_ESTOQUE.includes(nome(p)));

  it('RN-CAT-05: as 6 entidades de preço e estoque declaram variacaoEscopo', () => {
    expect(provedores.map(nome).sort()).toEqual([...PRECO_ESTOQUE].sort());
    for (const p of provedores) expect(p.variacaoEscopo, nome(p)).toBeTypeOf('function');
  });

  it('RN-CAT-05: promotor com promotor_ve_preco_estoque de sim para não muda a variação (aparelho ressincroniza e apaga o preço)', async () => {
    for (const p of provedores) {
      const antes = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: true }));
      const depois = await p.variacaoEscopo!(ctxDe('promotor', { promotor_ve_preco_estoque: false }));
      expect(antes, nome(p)).not.toBe(depois);
    }
  });

  it('RN-CAT-05: vendedor não muda com o parâmetro do promotor; entidades de conteúdo não declaram variação', async () => {
    for (const p of provedores) {
      expect(await p.variacaoEscopo!(ctxDe('vendedor', { promotor_ve_preco_estoque: true }))).toBe(await p.variacaoEscopo!(ctxDe('vendedor', { promotor_ve_preco_estoque: false })));
    }
    for (const p of provedoresSyncCatalogo.filter((x) => !PRECO_ESTOQUE.includes(nome(x)))) expect(p.variacaoEscopo, nome(p)).toBeUndefined();
  });
});
