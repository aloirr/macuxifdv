import { criarRelogio } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { INDICE_BUSCA_CATALOGO, PESOS_BUSCA_CATALOGO, textoIndiceAplicacao } from './indice';

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
            ? [linha({ id: 'c1', aplicacao: aplicacao, descricao: 'Limpa pisos pesados' })]
            : [linha({ id: 'r2', codigo: 'FB-0207', ordem: 2, marca_nome: 'Freiomax' }), linha({ id: 'r1', codigo: 'CB 3401', ordem: 1, marca_nome: 'Freiomax' }), linha({ id: 'r3', codigo: 'VELHA', ordem: 3, deleted_at: QUANDO })]) as L[],
    });
    const p = linha({ sku: 'DET-5L', ean: '7891000100103', nome: 'Detergente 5 L', marca: 'Brilho', categoria: 'Limpeza', unidade: 'UN', ativo: true, external_id: 'ERP-77' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(p))).toEqual({ sku: 'DET-5L', ean: '7891000100103', codigos: 'det5l erp77 cb3401 fb0207', nome: 'Detergente 5 L', marca: 'Brilho Freiomax', categoria: 'Limpeza', atributos: 'Fragrância Neutro Volume 5 L Limpa pisos pesados', aplicacao: `${aplicacao} 2011 2012 2013`, referencias: 'CB 3401 FB-0207' });
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler({ ...p, ativo: false } as LinhaSync))).toBeNull();
    expect(await INDICE_BUSCA_CATALOGO.documento(P, ler(null))).toBeNull();
  });

  it('T-0096: a faixa aberta vai até o teto do domain (início + 40) e o documento não depende do relógio', () => {
    const anos = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, k) => de + k);
    expect(textoIndiceAplicacao('Honda Civic 2018 em diante')).toBe(`Honda Civic 2018 em diante ${anos(2019, 2058).join(' ')}`);
    expect(textoIndiceAplicacao('Gol 2015>')).toBe(`Gol 2015> ${anos(2016, 2055).join(' ')}`);
    expect(textoIndiceAplicacao('a partir de 1990')).toBe(`a partir de 1990 ${anos(1991, 2030).join(' ')}`);
    // fechada, lista e texto sem ano: iguais ao domain
    expect(textoIndiceAplicacao('Fiat Uno 2010–2014')).toBe('Fiat Uno 2010–2014 2011 2012 2013');
    expect(textoIndiceAplicacao('Uno 2010/2012/2014')).toBe('Uno 2010/2012/2014');
    expect(textoIndiceAplicacao('Palio 1.0 flex')).toBe('Palio 1.0 flex');
    expect(textoIndiceAplicacao(null)).toBe('');
    // aberta + fechada + aberta em outra janela de 41 anos; anos literais não se repetem
    const t = 'Fusca 1960 em diante; Civic 2018 em diante; Fit 2015–2020';
    const extras = textoIndiceAplicacao(t).slice(t.length + 1).split(' ').map(Number);
    expect(extras).toEqual([...new Set([...anos(1961, 2000), ...anos(2016, 2017), ...anos(2019, 2058)])].sort((a, b) => a - b).filter((a) => a !== 2020));
    expect(INDICE_BUSCA_CATALOGO.versaoDocumentos?.({ agora: criarRelogio().agora(), fuso: 'America/Manaus' })).toBe('v6');
  });

  it('RN-CAT-16: o texto da aplicação no FTS5 traz os anos de "até", mês/ano e 2 dígitos, e não traz ano inválido nem polegada', () => {
    expect(textoIndiceAplicacao('Civic 2007 até 2011')).toBe('Civic 2007 até 2011 2008 2009 2010');
    expect(textoIndiceAplicacao('Civic 07–11')).toBe('Civic 07–11 2007 2008 2009 2010 2011');
    expect(textoIndiceAplicacao('Palio 06/2008–06/2012')).toBe('Palio 06/2008–06/2012 2009 2010 2011');
    expect(textoIndiceAplicacao('Roda 16" código 2035 e 1938')).toBe('Roda 16" código 2035 e 1938');
  });
});
