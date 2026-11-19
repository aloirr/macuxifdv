/**
 * Estoque visível (RF-CAT-03, RN-CAT-07): saldo só das filiais/depósitos do usuário, em faixas (disponível, baixo
 * até [10], sem estoque), número exato visível por padrão, "desatualizado" depois de [24] h e sempre com o
 * instante da atualização para a tela mostrar "atualizado às hh:mm" (`rotuloCargaEstoque`, `estoque-campo.ts`).
 * O saldo é o do ERP; reservas de pedido são descontadas pelo Vendedor (RN-VEN-20), não aqui.
 */
import type { EstoqueVisivel, FaixaEstoque, StockByBranch } from '../contracts';
import type { ParametrosCatalogo } from './parametros';

/** Nome da filial no estoque; sem nome conhecido, o código curto do id ("Filial 0f000000"). */
export const nomeDaFilialOuCodigo = (id: string, nome?: string | null): string => nome || `Filial ${id.slice(0, 8)}`;

export const ROTULO_SEM_HORA = 'Sem hora de atualização';

export interface OpcoesEstoque {
  /** Filiais/depósitos do usuário. `null` = todas (analista, assistente, admin: escopo do tenant, RN-CORE-04). */
  filiais: readonly string[] | null;
  /** catalogo-campo-v2 §4: filiais listadas na folha "Estoque por filial" (`null` = todas). Ausente = as mesmas de `filiais`; o total (N) soma só `filiais`. */
  filiaisFolha?: readonly string[] | null;
  /** catalogo-campo-v2 §2.1: filial de CADASTRO do usuário; vem primeiro na folha (as outras, em ordem alfabética). */
  filialCadastro?: string | null;
  /** Nome das filiais (id → nome) para a filial de venda sem linha de saldo (RN-CORE-39), que aparece com 0. */
  nomesFilial?: Readonly<Record<string, string>>;
  /** Instante da consulta (ISO UTC). */
  agora: string;
  parametros: Pick<ParametrosCatalogo, 'estoque_baixo_ate' | 'estoque_mostrar_quantidade' | 'estoque_defasado_horas'>;
}

/** Texto da faixa para as telas (app e BKO usam o mesmo). */
export const ROTULO_FAIXA_ESTOQUE: Record<FaixaEstoque, string> = { disponivel: 'Disponível', baixo: 'Estoque baixo', sem_estoque: 'Sem estoque' };

/** 0 ou menos = sem estoque; de 1 até `baixoAte` = baixo; acima = disponível. */
export function faixaDeEstoque(quantidade: number, baixoAte: number): FaixaEstoque {
  if (quantidade <= 0) return 'sem_estoque';
  return quantidade <= baixoAte ? 'baixo' : 'disponivel';
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ordem alfabética (pt-BR) por nome, a única das listas de filial. */
export const ordemPorNome = (a: { nome: string }, b: { nome: string }): number => a.nome.localeCompare(b.nome, 'pt-BR');

export function estoqueVisivel(produtoId: string, saldos: readonly StockByBranch[], opcoes: OpcoesEstoque): EstoqueVisivel {
  const agora = Date.parse(opcoes.agora);
  if (Number.isNaN(agora)) throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
  const { estoque_baixo_ate: baixoAte, estoque_mostrar_quantidade: mostrar, estoque_defasado_horas: horas } = opcoes.parametros;
  const permitidas = opcoes.filiais === null ? null : new Set(opcoes.filiais);
  const daFolha = opcoes.filiaisFolha === undefined ? permitidas : opcoes.filiaisFolha === null ? null : new Set(opcoes.filiaisFolha);

  const porFilial = new Map<string, { nome: string; quantidade: number; atualizado: number | null; semHora: boolean }>();
  for (const s of saldos) {
    if (daFolha && !daFolha.has(s.branch_id)) continue;
    // catalogo-campo-v2 §2.1: o saldo negativo do ERP aparece com o sinal (a faixa é "sem estoque")
    const q = Number.isFinite(s.quantity) ? Math.trunc(s.quantity) : 0;
    const t = s.updated_at ? Date.parse(s.updated_at) : NaN;
    const atual = porFilial.get(s.branch_id) ?? { nome: s.branch_name, quantidade: 0, atualizado: null, semHora: false };
    atual.quantidade += q;
    if (Number.isNaN(t)) atual.semHora = true;
    else atual.atualizado = atual.atualizado === null ? t : Math.min(atual.atualizado, t);
    porFilial.set(s.branch_id, atual);
  }

  // RN-CORE-39: filial de venda sem linha de saldo aparece na folha com 0 (o N soma 0 dela)
  if (daFolha) {
    for (const id of daFolha) {
      if (!porFilial.has(id)) porFilial.set(id, { nome: nomeDaFilialOuCodigo(id, opcoes.nomesFilial?.[id]), quantidade: 0, atualizado: null, semHora: false });
    }
  }
  const cadastro = opcoes.filialCadastro ?? null;
  // catalogo-campo-v2 §2.1: a de cadastro primeiro; as outras em ordem alfabética
  const filiais = [...porFilial.entries()].sort(([ia, a], [ib, b]) => Number(ib === cadastro) - Number(ia === cadastro) || ordemPorNome(a, b) || cmp(ia, ib));
  const doTotal = filiais.filter(([id]) => !permitidas || permitidas.has(id));
  const total = doTotal.reduce((acc, [, f]) => acc + f.quantidade, 0);
  const horas_conhecidas = doTotal.map(([, f]) => f.atualizado).filter((t): t is number => t !== null);
  const maisAntiga = horas_conhecidas.length > 0 ? Math.min(...horas_conhecidas) : null;
  const algumSemHora = doTotal.some(([, f]) => f.semHora);

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
    stale: doTotal.length > 0 && (algumSemHora || (maisAntiga !== null && agora - maisAntiga > horas * 3_600_000)),
  };
}
