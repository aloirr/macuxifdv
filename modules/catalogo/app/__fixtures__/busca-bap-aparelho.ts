/**
 * Massa comum dos testes de busca da auditoria BAP no aparelho (RN-CAT-18 e RN-CAT-19): um leitor local com as linhas dadas e os dois
 * caminhos de busca (consulta do seletor e aba). A lista volta ordenada pelo nome.
 */
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { buscarLocal, type LeitorLocal } from '../lib/local';
import { consultaBuscaProdutosAparelho } from '../texto-consultas';

const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const uuid = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function aparelhoCom(linhas: readonly { nome: string; aplicacao: string }[]) {
  const tabelas: Record<string, unknown[]> = {
    produto: linhas.map((l, i) => ({ id: uuid(i + 1), ...base, sku: `SK-${i + 1}`, ean: null, nome: l.nome, marca: 'BAP', categoria: 'Linha', unidade: 'UN', ativo: true })),
    produto_atributo: [],
    produto_conteudo: linhas.map((l, i) => ({ id: uuid(1000 + i), ...base, produto_id: uuid(i + 1), aplicacao: l.aplicacao, campanha: false })),
    produto_referencia: [],
    sinonimo: [],
  };
  const nomeDe = new Map(linhas.map((l, i) => [uuid(i + 1), l.nome]));
  const leitor = () => ({ linhas: async (e: string) => tabelas[e] ?? [], versaoLinhas: () => 1, agora: () => new Date('2026-11-06T12:00:00Z'), usuario: () => null, parametros: () => ({}) });
  const pelaConsulta = async (q: string): Promise<string[]> => {
    const exec = consultaBuscaProdutosAparelho as unknown as { executar(e: unknown, c: ContextoConsultaAparelho): Promise<{ itens: { produto_id: string }[] }> };
    const { itens } = await exec.executar({ q, limite: 50 }, leitor() as unknown as ContextoConsultaAparelho);
    return itens.map((i) => nomeDe.get(i.produto_id)!).sort();
  };
  const pelaAba = async (q: string): Promise<string[]> => {
    const r = await buscarLocal(leitor() as unknown as LeitorLocal, { perfil: 'vendedor', parametros: {}, agora: '2026-11-06T12:00:00Z', clienteId: null, q, limit: 50, offset: 0, offline: false });
    return r.items.map((i) => nomeDe.get(i.id)!).sort();
  };
  return { pelaConsulta, pelaAba };
}
