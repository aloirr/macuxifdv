/**
 * Estoque por filial na ficha do BKO (RN-CORE-39, RN-CAT-07; T-0149): uma linha por filial que o usuário vê. Sem cliente no
 * contexto o BKO lista as filiais do usuário (analista, assistente e admin: todas); a decisão do que cada perfil vê é do domain
 * (`estoqueVisivel`) e da API, aqui só o texto.
 */
import type { EstoqueVisivel } from '../../contracts';
import { ROTULO_FAIXA_ESTOQUE } from '../../domain/estoque';

export interface LinhaEstoqueFilial {
  id: string;
  /** "Boa Vista: Estoque baixo · 7" (número em pt-BR quando o tenant o mostra). */
  texto: string;
}

export function linhasEstoquePorFilial(estoque: EstoqueVisivel | null | undefined): LinhaEstoqueFilial[] {
  if (!estoque) return [];
  return estoque.by_branch.map((b) => {
    const faixa = ROTULO_FAIXA_ESTOQUE[b.band];
    return { id: b.branch_id, texto: `${b.branch_name}: ${b.quantity !== null && b.band !== 'sem_estoque' ? `${faixa} · ${b.quantity.toLocaleString('pt-BR')}` : faixa}` };
  });
}
