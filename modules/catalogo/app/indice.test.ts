import { criarRelogio } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { compacto, INDICE_BUSCA_CATALOGO, PESOS_BUSCA_CATALOGO } from './indice';

const QUANDO = criarRelogio().iso();
const P = '00000000-0000-4000-8000-000000000001';
const linha = (o: Record<string, unknown>) => ({ id: P, updated_at: QUANDO, deleted_at: null, external_id: null, ...o }) as LinhaSync;

describe('índice FTS5 do Catálogo no aparelho (T-0008, pedido R-20261031-205433-banco-dados)', () => {
  it('colunas na ordem da DDL v1 e nomes das tabelas do banco-dados', () => {
    expect(Object.keys(PESOS_BUSCA_CATALOGO)).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(INDICE_BUSCA_CATALOGO).toMatchObject({ id: 'catalogo.produto', tabelaDoc: TABELAS_BUSCA_CATALOGO.doc, tabelaFts: TABELAS_BUSCA_CATALOGO.fts, colunaChave: 'produto_id', fontes: ['produto', 'produto_atributo'] });
  });

  it('chave do documento: o próprio produto ou o produto do atributo', () => {
    expect(INDICE_BUSCA_CATALOGO.chaveDe('produto', linha({}))).toBe(P);
    expect(INDICE_BUSCA_CATALOGO.chaveDe('produto_atributo', linha({ id: 'a', produto_id: P }))).toBe(P);
  });

  it('documento: códigos compactos, atributos ordenados; inativo ou removido sai do índice (RN-CAT-01)', async () => {
    const ler = (produto: LinhaSync | null) => ({
      porIds: async <L extends LinhaSync>() => (produto ? [produto] : []) as L[],
      porCampo: async <L extends LinhaSync>() => [linha({ id: 'a2', nome: 'Volume', valor: '5 L' }), linha({ id: 'a1', nome: 'Fragrância', valor: 'Neutro' }), linha({ id: 'a3', nome: 'Velho', valor: 'x', deleted_at: QUANDO })] as L[],
    });
    const p = linha({ sku: 'DET-5L', ean: '7891000100103', nome: 'Detergente 5 L', marca: 'Brilho', categoria: 'Limpeza', unidade: 'UN', ativo: true, external_id: 'ERP-77' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(p))).toEqual({ sku: 'DET-5L', ean: '7891000100103', codigos: 'det5l erp77', nome: 'Detergente 5 L', marca: 'Brilho', categoria: 'Limpeza', atributos: 'Fragrância Neutro Volume 5 L' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler({ ...p, ativo: false } as LinhaSync))).toBeNull();
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(null))).toBeNull();
    expect(compacto(null)).toBe('');
  });
});
