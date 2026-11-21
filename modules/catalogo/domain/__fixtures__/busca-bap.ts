/**
 * Massa comum dos testes de busca da auditoria BAP (RN-CAT-19 e RN-CAT-20, domínio): produto de teste, contexto da vitrine e os dois
 * caminhos de busca (lista inteira e pré-seleção do índice). anoAtual = 2026. A lista volta ordenada pelo nome.
 */
import { expect } from 'vitest';
import { interpretarConsulta } from '../consulta';
import { candidatosDaBusca } from '../indice-busca';
import { PARAMETROS_PADRAO } from '../parametros';
import { buscarProdutos, type ContextoVitrine, type ProdutoCatalogo } from '../vitrine';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let n = 0;
export const prod = (nome: string, aplicacao = '', extra: Partial<ProdutoCatalogo> = {}): ProdutoCatalogo => ({
  id: uuid(++n),
  sku: `SK${n}`,
  ean: null,
  nome,
  marca: 'BAP',
  categoria: 'Linha',
  unidade: 'UN',
  ativo: true,
  atributos: [],
  aplicacao,
  referencias: [],
  thumbnail_url: null,
  campanha: false,
  vendas: 0,
  ...extra,
});
export const contexto: ContextoVitrine = { perfil: 'vendedor', parametros: PARAMETROS_PADRAO, agora: '2026-11-08T12:00:00.000Z', clienteId: null, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: new Map(), filiais: null, filiaisFolha: [] };

export type Buscar = (t: readonly ProdutoCatalogo[], q: string) => string[];

export function caminhos(limit: number): [string, Buscar][] {
  const nomes = (todos: readonly ProdutoCatalogo[], itens: { id: string }[]) => itens.map((i) => todos.find((p) => p.id === i.id)!.nome).sort();
  const pelaLista: Buscar = (todos, q) => {
    const filtros = interpretarConsulta(q, { marcas: [], linhas: [] });
    return nomes(todos, buscarProdutos({ produtos: todos, contexto, filtros, sinonimos: [], limit, offset: 0, anoAtual: 2026 } as Parameters<typeof buscarProdutos>[0]).items);
  };
  const pelaPreSelecao: Buscar = (todos, q) => {
    const filtros = interpretarConsulta(q, { marcas: [], linhas: [] });
    const c = candidatosDaBusca({ produtos: todos, contexto, filtros, sinonimos: [], minimo: 0, anoAtual: 2026 });
    expect(c).not.toBeNull();
    return nomes(todos, buscarProdutos({ produtos: c!.produtos, contexto, filtros, sinonimos: [], limit, offset: 0, anoAtual: 2026, maxVendas: c!.maxVendas, veiculos: c!.veiculos } as Parameters<typeof buscarProdutos>[0]).items);
  };
  return [
    ['lista inteira', pelaLista],
    ['pré-seleção do índice', pelaPreSelecao],
  ];
}
