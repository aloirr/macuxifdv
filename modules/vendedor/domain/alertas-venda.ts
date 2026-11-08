/**
 * RF-VEN-11 (T-0136): caixa "Alertas" da aba Venda do Novo pedido. Decide QUAIS alertas valem para o cliente e o pedido; os textos
 * ficam em `app/lib/textos-venda.ts`. Função pura, só dados que o aparelho já tem (vale offline).
 *  - RN-VEN-13: cliente bloqueado, inativo ou com cadastro incompleto (só orçamento) e título vencido (só à vista ou aprovação);
 *  - RN-VEN-12: crédito excedido (o total do pedido passa do disponível; vai para aprovação).
 * Ordem: o que impede o pedido (erro) antes do que só manda para aprovação (aviso).
 */
import type { SituacaoCliente } from './orcamento';

export type AlertaDaVenda =
  | { tipo: 'bloqueado' }
  | { tipo: 'inativo' }
  | { tipo: 'cadastro_incompleto'; campos: readonly string[] }
  | { tipo: 'vencido'; titulos: number; valor_cents: number; dias: number }
  | { tipo: 'credito_excedido'; disponivel_cents: number };

export type TomDoAlerta = 'erro' | 'aviso';

/** Bloqueado, inativo e cadastro incompleto são erro (só orçamento); vencido e crédito excedido são aviso (aprovação). */
export function tomDoAlerta(a: AlertaDaVenda): TomDoAlerta {
  return a.tipo === 'vencido' || a.tipo === 'credito_excedido' ? 'aviso' : 'erro';
}

export interface EntradaAlertasDaVenda {
  cliente: SituacaoCliente;
  /** títulos vencidos (financeiro do cliente); `null` ou 0 títulos = nenhum */
  vencidos: { titulos: number; valor_cents: number; dias: number } | null;
  /** limite disponível (RN-VEN-12); `null` = sem dados de crédito (não há como dizer que excedeu) */
  disponivel_cents: number | null;
  /** total do pedido em centavos */
  total_cents: number;
}

export function alertasDaVenda(e: EntradaAlertasDaVenda): AlertaDaVenda[] {
  const r: AlertaDaVenda[] = [];
  if (e.cliente.bloqueado) r.push({ tipo: 'bloqueado' });
  if (!e.cliente.ativo) r.push({ tipo: 'inativo' });
  if (e.cliente.cadastro_incompleto) r.push({ tipo: 'cadastro_incompleto', campos: e.cliente.campos_faltantes });
  if (e.vencidos && e.vencidos.titulos > 0) r.push({ tipo: 'vencido', titulos: e.vencidos.titulos, valor_cents: e.vencidos.valor_cents, dias: e.vencidos.dias });
  if (e.disponivel_cents !== null && e.total_cents > Math.max(0, e.disponivel_cents)) r.push({ tipo: 'credito_excedido', disponivel_cents: e.disponivel_cents });
  return r.map((a, i) => ({ a, i })).sort((x, y) => Number(tomDoAlerta(x.a) === 'aviso') - Number(tomDoAlerta(y.a) === 'aviso') || x.i - y.i).map((x) => x.a);
}
