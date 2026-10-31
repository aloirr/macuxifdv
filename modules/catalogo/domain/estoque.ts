/**
 * Estoque visível (RF-CAT-03): saldo só das filiais/depósitos do usuário, em faixas (disponível, baixo, sem
 * estoque) parametrizáveis, com a hora da atualização e, se o tenant preferir, sem o número exato.
 * O saldo é o do ERP; reservas de pedido são descontadas pelo Vendedor (RN-VEN-20), não aqui.
 */
import type { EstoqueVisivel, FaixaEstoque, StockByBranch } from '../contracts';
import type { ParametrosCatalogo } from './parametros';

export interface OpcoesEstoque {
  /** Filiais/depósitos do usuário. `null` = todas (analista, assistente, admin: escopo do tenant, RN-CORE-04). */
  filiais: readonly string[] | null;
  /** Instante da consulta (ISO UTC). */
  agora: string;
  parametros: Pick<ParametrosCatalogo, 'estoque_baixo_ate' | 'estoque_mostrar_quantidade' | 'estoque_defasado_horas'>;
}

/** 0 ou menos = sem estoque; de 1 até `baixoAte` = baixo; acima = disponível. */
export function faixaDeEstoque(quantidade: number, baixoAte: number): FaixaEstoque {
  if (quantidade <= 0) return 'sem_estoque';
  return quantidade <= baixoAte ? 'baixo' : 'disponivel';
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function estoqueVisivel(produtoId: string, saldos: readonly StockByBranch[], opcoes: OpcoesEstoque): EstoqueVisivel {
  const agora = Date.parse(opcoes.agora);
  if (Number.isNaN(agora)) throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
  const { estoque_baixo_ate: baixoAte, estoque_mostrar_quantidade: mostrar, estoque_defasado_horas: horas } = opcoes.parametros;
  const permitidas = opcoes.filiais === null ? null : new Set(opcoes.filiais);

  const porFilial = new Map<string, { nome: string; quantidade: number; atualizado: number | null; semHora: boolean }>();
  for (const s of saldos) {
    if (permitidas && !permitidas.has(s.branch_id)) continue;
    const q = Number.isFinite(s.quantity) ? Math.max(0, Math.trunc(s.quantity)) : 0;
    const t = s.updated_at ? Date.parse(s.updated_at) : NaN;
    const atual = porFilial.get(s.branch_id) ?? { nome: s.branch_name, quantidade: 0, atualizado: null, semHora: false };
    atual.quantidade += q;
    if (Number.isNaN(t)) atual.semHora = true;
    else atual.atualizado = atual.atualizado === null ? t : Math.min(atual.atualizado, t);
    porFilial.set(s.branch_id, atual);
  }

  const filiais = [...porFilial.entries()].sort(([ia, a], [ib, b]) => cmp(a.nome, b.nome) || cmp(ia, ib));
  const total = filiais.reduce((acc, [, f]) => acc + f.quantidade, 0);
  const horas_conhecidas = filiais.map(([, f]) => f.atualizado).filter((t): t is number => t !== null);
  const maisAntiga = horas_conhecidas.length > 0 ? Math.min(...horas_conhecidas) : null;
  const algumSemHora = filiais.some(([, f]) => f.semHora);

  return {
    product_id: produtoId,
    band: faixaDeEstoque(total, baixoAte),
    quantity: mostrar ? total : null,
    by_branch: filiais.map(([id, f]) => ({
      branch_id: id,
      branch_name: f.nome,
      band: faixaDeEstoque(f.quantidade, baixoAte),
      quantity: mostrar ? f.quantidade : null,
    })),
    updated_at: maisAntiga === null ? null : new Date(maisAntiga).toISOString(),
    stale: filiais.length > 0 && (algumSemHora || (maisAntiga !== null && agora - maisAntiga > horas * 3_600_000)),
  };
}
