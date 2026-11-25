/**
 * Quantidade fracionária no Hub (ADR 0076, RN-VEN-02 v3 e RN-VEN-15): trava do lote e do retorno enquanto os apps 1.0.36 ainda não
 * são obrigatórios (D6) e conta exata em escala de 1/10.000 (D3). Funções puras; a API chama e transforma em 422.
 */
import { quantidadeDaEscala, quantidadeEmEscala, temFracao } from '@macuxi/comum/quantidade';
import { CODIGO_FRACAO_BLOQUEADA, CODIGO_FRACAO_INVALIDA, MENSAGEM_FRACAO_BLOQUEADA } from '@macuxi/platform-sdk';

export interface ErroFracao {
  codigo: string;
  campo: string;
  mensagem: string;
}
export type ResultadoFracao = { ok: true } | { ok: false; status: 422; codigo: ErroFracao['codigo']; mensagem: string; erros: ErroFracao[] };

const MENSAGEM_FRACAO_INVALIDA = 'A quantidade ou o fator aceita no máximo 4 casas decimais. Corrija o valor e reenvie.';

/** Tem casas decimais? Número inválido (não finito, mais de 4 casas) conta como "inválido", não como fração. */
function classificar(v: unknown): 'inteiro' | 'fracao' | 'invalido' {
  if (typeof v !== 'number') return 'inteiro';
  try {
    return temFracao(v) ? 'fracao' : 'inteiro';
  } catch {
    return 'invalido';
  }
}

function achar(valores: readonly { campo: string; valor: unknown }[], liberada: boolean): ResultadoFracao {
  const fracoes: string[] = [];
  const invalidos: string[] = [];
  for (const { campo, valor } of valores) {
    const c = classificar(valor);
    if (c === 'fracao') fracoes.push(campo);
    else if (c === 'invalido') invalidos.push(campo);
  }
  if (invalidos.length > 0) {
    const erros = invalidos.map((campo) => ({ codigo: CODIGO_FRACAO_INVALIDA, campo, mensagem: MENSAGEM_FRACAO_INVALIDA }));
    return { ok: false, status: 422, codigo: CODIGO_FRACAO_INVALIDA, mensagem: MENSAGEM_FRACAO_INVALIDA, erros };
  }
  if (liberada || fracoes.length === 0) return { ok: true };
  const erros = fracoes.map((campo) => ({ codigo: CODIGO_FRACAO_BLOQUEADA, campo, mensagem: MENSAGEM_FRACAO_BLOQUEADA }));
  return { ok: false, status: 422, codigo: CODIGO_FRACAO_BLOQUEADA, mensagem: MENSAGEM_FRACAO_BLOQUEADA, erros };
}

/** Lote: só `produto_unidade.fator` carrega número que pode ser fracionário (RN-VEN-15). `registros` ainda não validados por linha. */
export function avaliarFracaoLote(entidade: string, registros: readonly unknown[], liberada: boolean): ResultadoFracao {
  if (entidade !== 'produto_unidade') return { ok: true };
  const valores = registros.map((r, i) => ({
    campo: `registros[${i}].fator`,
    valor: r !== null && typeof r === 'object' ? (r as { fator?: unknown }).fator : undefined,
  }));
  return achar(valores, liberada);
}

/** Retorno: `itens_faturados[i].quantidade` (RN-INT-08). */
export function avaliarFracaoRetorno(itens: readonly { quantidade?: unknown }[] | null | undefined, liberada: boolean): ResultadoFracao {
  return achar((itens ?? []).map((f, i) => ({ campo: `itens_faturados[${i}].quantidade`, valor: f?.quantidade })), liberada);
}

/** Item do pedido para o ERP com `quantidade`, `quantidade_venda` ou `fator` fracionários (exige o Conector 1.6.0, D6). */
export function itemPedidoTemFracao(i: { quantidade: number; quantidade_venda?: number | null; fator?: number | null }): boolean {
  return [i.quantidade, i.quantidade_venda, i.fator].some((v) => typeof v === 'number' && classificar(v) === 'fracao');
}

/** Soma exata (escala de 1/10.000, D3): evita 0,1 + 0,2 = 0,30000000000000004 no acumulado faturado. */
export function somarQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) + quantidadeEmEscala(b));
}

/** Subtração exata (saldo a faturar), na mesma escala. */
export function subtrairQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) - quantidadeEmEscala(b));
}
