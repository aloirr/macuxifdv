import { criarRelogio } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { anoDe, INDICE_BUSCA_CATALOGO, PESOS_BUSCA_CATALOGO } from './indice';

const QUANDO = criarRelogio().iso();
const P = '00000000-0000-4000-8000-000000000001';
const linha = (o: Record<string, unknown>) => ({ id: P, updated_at: QUANDO, deleted_at: null, external_id: null, ...o }) as LinhaSync;

describe('índice FTS5 do Catálogo no aparelho (T-0008, pedido R-20261031-205433-banco-dados)', () => {
  it('colunas na ordem da DDL v1 e nomes das tabelas do banco-dados', () => {
    expect(Object.keys(PESOS_BUSCA_CATALOGO)).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(INDICE_BUSCA_CATALOGO).toMatchObject({ id: 'catalogo.produto', tabelaDoc: TABELAS_BUSCA_CATALOGO.doc, tabelaFts: TABELAS_BUSCA_CATALOGO.fts, colunaChave: 'produto_id', fontes: ['produto', 'produto_atributo', 'produto_conteudo', 'produto_referencia'] });
  });

  it('chave do documento: o próprio produto ou o produto do atributo', () => {
    expect(INDICE_BUSCA_CATALOGO.chaveDe('produto', linha({}))).toBe(P);
    expect(INDICE_BUSCA_CATALOGO.chaveDe('produto_atributo', linha({ id: 'a', produto_id: P }))).toBe(P);
  });

  it('documento: códigos compactos, atributos ordenados; inativo ou removido sai do índice (RN-CAT-01)', async () => {
    const aplicacao = 'Fiat Uno 1.0/1.4 2010–2014';
    const ler = (produto: LinhaSync | null) => ({
      porIds: async <L extends LinhaSync>() => (produto ? [produto] : []) as L[],
      porCampo: async <L extends LinhaSync>(entidade: string) =>
        (entidade === 'produto_atributo'
          ? [linha({ id: 'a2', nome: 'Volume', valor: '5 L' }), linha({ id: 'a1', nome: 'Fragrância', valor: 'Neutro' }), linha({ id: 'a3', nome: 'Velho', valor: 'x', deleted_at: QUANDO })]
          : entidade === 'produto_conteudo'
            ? [linha({ id: 'c1', aplicacao: aplicacao })]
            : [linha({ id: 'r2', codigo: 'FB-0207', ordem: 2 }), linha({ id: 'r1', codigo: 'CB 3401', ordem: 1 }), linha({ id: 'r3', codigo: 'VELHA', ordem: 3, deleted_at: QUANDO })]) as L[],
    });
    const p = linha({ sku: 'DET-5L', ean: '7891000100103', nome: 'Detergente 5 L', marca: 'Brilho', categoria: 'Limpeza', unidade: 'UN', ativo: true, external_id: 'ERP-77' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(p))).toEqual({ sku: 'DET-5L', ean: '7891000100103', codigos: 'det5l erp77 cb3401 fb0207', nome: 'Detergente 5 L', marca: 'Brilho', categoria: 'Limpeza', atributos: 'Fragrância Neutro Volume 5 L', aplicacao: `${aplicacao} 2011 2012 2013`, referencias: 'CB 3401 FB-0207' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler({ ...p, ativo: false } as LinhaSync))).toBeNull();
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(null))).toBeNull();
  });

  it('RN-CAT-12: "civic 2028" acha "2018 em diante" depois da virada do ano (versaoDocumentos muda; fuso do tenant)', async () => {
    const ler = (produto: LinhaSync) => ({
      porIds: async <L extends LinhaSync>() => [produto] as L[],
      porCampo: async <L extends LinhaSync>(entidade: string) => (entidade === 'produto_conteudo' ? [linha({ id: 'c1', aplicacao: 'Honda Civic 2018 em diante' })] : []) as L[],
    });
    const p = linha({ sku: 'X', ean: null, nome: 'Filtro', marca: 'M', categoria: 'C', unidade: 'UN', ativo: true });
    const em = (iso: string) => ({ agora: new Date(iso), fuso: 'America/Manaus' }) as never;
    const antes = await INDICE_BUSCA_CATALOGO.documento(P, ler(p), em('2026-12-31T12:00:00Z'));
    const depois = await INDICE_BUSCA_CATALOGO.documento(P, ler(p), em('2027-01-01T12:00:00Z'));
    expect(antes?.aplicacao).not.toContain('2028');
    expect(depois?.aplicacao).toContain('2028');
    expect(INDICE_BUSCA_CATALOGO.versaoDocumentos?.(em('2026-12-31T12:00:00Z'))).not.toBe(INDICE_BUSCA_CATALOGO.versaoDocumentos?.(em('2027-01-01T12:00:00Z')));
    // 01/01 02:00 UTC ainda é 31/12 em Manaus (UTC-4)
    expect(anoDe({ agora: new Date('2027-01-01T02:00:00Z'), fuso: 'America/Manaus' } as never)).toBe(2026);
  });
});
