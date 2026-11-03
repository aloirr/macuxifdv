/**
 * Endereços de entrega do cliente e unidades de venda do produto: leitura PÚBLICA para outros módulos (T-0061; RF-CORE-12,
 * RN-VEN-15, RN-VEN-17). O Vendedor (e o Cliente 360) lê as linhas do pull (`cliente_endereco`, `produto_unidade`) pelo motor
 * de sync e usa estas funções puras para ordenar com o padrão primeiro, sem ler tabela do Core. Mora em `contracts` porque o
 * módulo consumidor só pode importar `modules/core/contracts`; o `domain` do Core reexporta e testa as mesmas funções.
 *
 * - Endereço padrão (RN-VEN-17) = o `principal` vivo e ativo; se o ERP não mandou principal, o primeiro de entrega ativo.
 * - Unidade padrão (RN-VEN-15) = a marcada `padrao` viva e ativa; sem marcada, a unidade base do produto com fator 1.
 */
import { z } from 'zod';
import type { ClienteEnderecoSync, ProdutoUnidadeSync } from './sync';

// ---------- endereços ----------
export type EnderecoLinha = Pick<
  ClienteEnderecoSync,
  'id' | 'cliente_id' | 'tipo' | 'descricao' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep' | 'principal' | 'ativo' | 'deleted_at'
>;

/** Endereço do cliente pronto para exibir/escolher: o padrão vem marcado e `resumo` é a linha única legível. */
export type EnderecoDoCliente<L extends EnderecoLinha = ClienteEnderecoSync> = L & { padrao: boolean; resumo: string };

export const EnderecoClienteResumoSchema = z.object({
  id: z.string().uuid(),
  tipo: z.enum(['principal', 'entrega', 'cobranca']),
  descricao: z.string().nullable(),
  resumo: z.string(),
  padrao: z.boolean(),
});
export type EnderecoClienteResumo = z.infer<typeof EnderecoClienteResumoSchema>;

const vivo = (e: Pick<EnderecoLinha, 'ativo' | 'deleted_at'>) => e.ativo && !e.deleted_at;
const texto = (v: string | null | undefined) => (v ?? '').trim();

/** CEP em 8 dígitos vira `00000-000`; qualquer outra coisa volta como veio. */
export function formatarCep(cep: string | null | undefined): string {
  const d = texto(cep).replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : texto(cep);
}

/** "Rua A, 10 - Sala 2 - Centro - Boa Vista/RR - CEP 69300-000": linha única do endereço. */
export function resumoDoEndereco(e: Pick<EnderecoLinha, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'>): string {
  const rua = texto(e.numero) ? `${texto(e.logradouro)}, ${texto(e.numero)}` : texto(e.logradouro);
  const cidade = texto(e.cidade) && texto(e.uf) ? `${texto(e.cidade)}/${texto(e.uf)}` : texto(e.cidade) || texto(e.uf);
  const cep = texto(e.cep) ? `CEP ${formatarCep(e.cep)}` : '';
  return [rua, texto(e.complemento), texto(e.bairro), cidade, cep].filter(Boolean).join(' - ');
}

const ordemEndereco = (a: EnderecoLinha, b: EnderecoLinha) =>
  texto(a.descricao).localeCompare(texto(b.descricao), 'pt-BR') || texto(a.logradouro).localeCompare(texto(b.logradouro), 'pt-BR') || a.id.localeCompare(b.id);

/**
 * RN-VEN-17: o endereço padrão da entrega. O `principal` ativo vence; sem principal, o primeiro de entrega ativo (ordem
 * estável por descrição, logradouro e id); `cobranca` nunca é padrão de entrega. `null` = cliente sem endereço utilizável.
 */
export function enderecoPadrao<L extends EnderecoLinha>(enderecos: readonly L[]): L | null {
  const ativos = enderecos.filter(vivo);
  const principal = ativos.filter((e) => e.principal && e.tipo !== 'cobranca').sort(ordemEndereco)[0];
  if (principal) return principal;
  return ativos.filter((e) => e.tipo !== 'cobranca').sort(ordemEndereco)[0] ?? null;
}

/**
 * Endereços ativos do cliente, o padrão primeiro e o resto em ordem estável. `incluirCobranca` (padrão `true`) serve ao
 * Cliente 360; o Vendedor escolhe só entre os de entrega (`enderecosDeEntrega`). Linha removida ou inativa não entra.
 */
export function listarEnderecosDoCliente<L extends EnderecoLinha>(linhas: readonly L[], clienteId: string, opcoes: { incluirCobranca?: boolean } = {}): Array<EnderecoDoCliente<L>> {
  const incluirCobranca = opcoes.incluirCobranca ?? true;
  const doCliente = linhas.filter((e) => e.cliente_id === clienteId && vivo(e) && (incluirCobranca || e.tipo !== 'cobranca'));
  const padrao = enderecoPadrao(doCliente);
  return [...doCliente]
    .sort((a, b) => Number(b.id === padrao?.id) - Number(a.id === padrao?.id) || ordemEndereco(a, b))
    .map((e) => ({ ...e, padrao: e.id === padrao?.id, resumo: resumoDoEndereco(e) }));
}

/** RN-VEN-17: opções de endereço de entrega do cliente para o pedido (padrão primeiro; sem cobrança). */
export function enderecosDeEntrega<L extends EnderecoLinha>(linhas: readonly L[], clienteId: string): Array<EnderecoDoCliente<L>> {
  return listarEnderecosDoCliente(linhas, clienteId, { incluirCobranca: false });
}

// ---------- unidades de venda ----------
export type UnidadeLinha = Pick<ProdutoUnidadeSync, 'id' | 'produto_id' | 'unidade' | 'fator' | 'padrao' | 'ativo' | 'deleted_at'>;

export type UnidadeDoProduto<L extends UnidadeLinha = ProdutoUnidadeSync> = L & { rotulo: string };

export const UnidadeProdutoResumoSchema = z.object({
  unidade: z.string(),
  fator: z.number().int().positive(),
  padrao: z.boolean(),
  ativo: z.boolean(),
  ean: z.string().nullable().optional(),
  /** "UN" (fator 1) ou "CX c/ 12" (RN-CORE-19). */
  rotulo: z.string(),
});
export type UnidadeProdutoResumo = z.infer<typeof UnidadeProdutoResumoSchema>;

/** RN-VEN-15: fator inteiro maior que zero (quantidade de unidades base em uma desta embalagem). */
export function fatorValido(fator: unknown): fator is number {
  return typeof fator === 'number' && Number.isInteger(fator) && fator > 0;
}

/** Fator 1 mostra só a sigla ("UN"); fator > 1 mostra "CX c/ 12" (RN-CORE-19, mesma regra do PDF do pedido). */
export function rotuloDaUnidade(unidade: string, fator: number): string {
  return fator > 1 ? `${unidade} c/ ${fator}` : unidade;
}

const vivaUnidade = (u: Pick<UnidadeLinha, 'ativo' | 'deleted_at'>) => u.ativo && !u.deleted_at;

/**
 * RN-VEN-15: a unidade padrão de venda do produto = a marcada `padrao` (viva e ativa); sem marcada, a unidade base
 * (`unidadeBase`, "UN" se o produto não informar) com fator 1. Nunca devolve fator inválido.
 */
export function unidadePadraoDoProduto(unidades: readonly UnidadeLinha[], unidadeBase: string | null | undefined = 'UN'): { unidade: string; fator: number } {
  const marcada = unidades.find((u) => u.padrao && vivaUnidade(u) && fatorValido(u.fator));
  if (marcada) return { unidade: marcada.unidade, fator: marcada.fator };
  return { unidade: texto(unidadeBase) || 'UN', fator: 1 };
}

/**
 * Unidades de venda ativas do produto, a padrão primeiro, depois por fator crescente e sigla. Produto sem linha
 * cadastrada devolve a unidade base (fator 1) como padrão, para a tela sempre ter ao menos uma opção.
 */
export function unidadesDoProduto(linhas: readonly UnidadeLinha[], produtoId: string, unidadeBase: string | null | undefined = 'UN'): Array<UnidadeDoProduto<UnidadeLinha>> {
  const doProduto = linhas.filter((u) => u.produto_id === produtoId && vivaUnidade(u) && fatorValido(u.fator));
  if (doProduto.length === 0) {
    const base = unidadePadraoDoProduto([], unidadeBase);
    return [{ id: `base:${produtoId}`, produto_id: produtoId, unidade: base.unidade, fator: 1, padrao: true, ativo: true, deleted_at: null, rotulo: base.unidade }];
  }
  const padrao = unidadePadraoDoProduto(doProduto, unidadeBase);
  const ehPadrao = (u: UnidadeLinha) => u.padrao && u.unidade === padrao.unidade && u.fator === padrao.fator;
  return [...doProduto]
    .sort((a, b) => Number(ehPadrao(b)) - Number(ehPadrao(a)) || a.fator - b.fator || a.unidade.localeCompare(b.unidade))
    .map((u) => ({ ...u, rotulo: rotuloDaUnidade(u.unidade, u.fator) }));
}
