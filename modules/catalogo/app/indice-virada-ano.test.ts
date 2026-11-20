/**
 * T-0096 (RN-CAT-12): faixa aberta de ano na virada do ano, com SQLite/FTS5 real e o relógio injetado do armazenamento.
 * Antes, o documento parava no ano atual + 1 e a versão levava o ano: na virada o índice inteiro era refeito e, até o
 * fim, "civic 2028" não achava "2018 em diante". Agora o índice guarda a faixa até o teto do domain e o corte no ano
 * atual + 1 é do ranking, na hora da consulta, no fuso do tenant: nada é reindexado na virada.
 */
import { criarRelogio, instanteNoFuso } from '@macuxi/comum/relogio';
import { criarArmazenamentoSqlite, type IndiceBusca, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { describe, expect, it } from 'vitest';
import { migracoesAparelho } from '../db/aparelho';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { pontuacaoTextual, type DocBusca } from '../domain/ranking';
import { INDICE_BUSCA_CATALOGO } from './indice';
import { ID_INDICE_BUSCA } from './lib/local';

const FUSO = 'America/Manaus';
const CIVIC = '00000000-0000-4000-8000-000000000001';
const OUTRO = '00000000-0000-4000-8000-000000000002';

describe('T-0096: faixa aberta de ano vale no ano novo sem reindexar (RN-CAT-12)', () => {
  it('31/12/2026 23:59 → 01/01/2027 00:01 no fuso do tenant: "civic 2028" acha "2018 em diante" sem refazer o índice', async () => {
    const relogio = criarRelogio({ agora: instanteNoFuso('2026-12-31', '23:59', FUSO), fuso: FUSO });
    let documentos = 0;
    const indice: IndiceBusca = {
      ...INDICE_BUSCA_CATALOGO,
      documento: (chave, ler, ctx) => {
        documentos++;
        return INDICE_BUSCA_CATALOGO.documento(chave, ler, ctx);
      },
    };
    const a = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: { catalogo: migracoesAparelho },
      entidades: [
        { nome: 'produto', modulo: 'core' },
        { nome: 'produto_atributo', modulo: 'catalogo' },
        { nome: 'produto_conteudo', modulo: 'catalogo' },
        { nome: 'produto_referencia', modulo: 'catalogo' },
        { nome: 'sinonimo', modulo: 'catalogo' },
        { nome: 'estoque_saldo', modulo: 'catalogo' },
        { nome: 'tabela_preco', modulo: 'catalogo' },
        { nome: 'tabela_preco_item', modulo: 'catalogo' },
        { nome: 'cliente_tabela_preco', modulo: 'catalogo' },
        { nome: 'deposito', modulo: 'catalogo' },
        { nome: 'produto_no', modulo: 'catalogo' },
        { nome: 'produto_relacao', modulo: 'catalogo' },
      ],
      indicesBusca: [indice],
      agora: () => relogio.agora(),
    });
    const base = { updated_at: relogio.iso(), deleted_at: null, external_id: null };
    const produto = (id: string, nome: string) => ({ id, ...base, sku: id.slice(-4), ean: null, nome, marca: 'M', categoria: 'Autopeças', unidade: 'UN', ativo: true }) as unknown as LinhaSync;
    const conteudo = (id: string, produtoId: string, aplicacao: string) => ({ id, ...base, produto_id: produtoId, aplicacao, campanha: false, descricao: null, argumentos: [], faq: [], etiquetas: [] }) as unknown as LinhaSync;

    await a.busca.conferirVersoes!({ fuso: FUSO });
    await a.linhas.aplicar('produto', [produto(CIVIC, 'Filtro de óleo'), produto(OUTRO, 'Pastilha de freio')], 'p1');
    await a.linhas.aplicar('produto_conteudo', [conteudo('c1', CIVIC, 'Honda Civic 2018 em diante'), conteudo('c2', OUTRO, 'Honda Civic 2010–2014')], 'c1');
    await a.busca.finalizar!();
    const indexados = documentos;
    expect(indexados).toBeGreaterThan(0);

    const civic2028 = () => a.busca.buscarComDesfecho(ID_INDICE_BUSCA, { grupos: [['civic'], ['2028']], prefixoNoUltimo: false, limite: 10 });
    // o ranking do domain corta a faixa no ano atual + 1 (fuso do tenant) na hora da consulta
    const termosCasados = () => {
      const doc: DocBusca = { id: CIVIC, sku: '0001', ean: null, nome: 'Filtro de óleo', marca: 'M', categoria: 'Autopeças', atributos: '', aplicacao: 'Honda Civic 2018 em diante', referencias: [], estoque: 0, vendas: 0, campanha: false, preco_cents: null };
      return pontuacaoTextual([['civic'], ['2028']], doc, { anoAtual: anoCivilNoFuso(relogio.agora(), FUSO) }).casados;
    };

    // 31/12/2026 23:59 em Manaus (01/01 03:59 em UTC): o FTS já pré-seleciona; o domain ainda corta 2028 (2026 + 1) e o grupo do
    // ano não casa (o ano da consulta fora da aplicação e nenhum outro campo com o ano)
    expect(relogio.hoje()).toBe('2026-12-31');
    expect(await civic2028()).toEqual({ buscou: true, resultados: [expect.objectContaining({ chave: CIVIC })] });
    expect(termosCasados()).toBe(1);

    relogio.avancar({ minutos: 2 });
    expect(relogio.hoje()).toBe('2027-01-01');
    await a.busca.conferirVersoes!({ fuso: FUSO });
    // 01/01/2027 00:01: acha na hora (nunca 'indexando') e o domain aceita 2028 (2027 + 1)
    expect(await civic2028()).toEqual({ buscou: true, resultados: [expect.objectContaining({ chave: CIVIC })] });
    expect(termosCasados()).toBe(2);
    await a.busca.finalizar!();
    expect(documentos).toBe(indexados); // nenhum documento refeito na virada
  });
});
