/**
 * Quem vê preço de tabela e estoque no Catálogo (RN-CAT-04, RN-CAT-05). Todos os perfis do módulo consultam
 * (busca, ficha, fotos, "pergunte"); o promotor vê a ficha e as fotos SEM preço de tabela e SEM estoque, a menos
 * que o tenant ligue `promotor_ve_preco_estoque` — aí vê como o vendedor. A API aplica isto antes de responder
 * (vitrine, busca e ficha) e o app aplica de novo na tela; o ranking roda com os filtros já limpos.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { ParametrosCatalogo, type FiltrosInterpretados, type ItemVitrine } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

/** Perfis que sempre veem preço e estoque (espelho da ação `produto.ver_preco_estoque` do manifesto). */
export const PERFIS_PRECO_ESTOQUE = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const satisfies readonly Perfil[];

/** RN-CAT-05: o perfil vê preço de tabela e estoque? Promotor só com `promotor_ve_preco_estoque = true`. */
export function podeVerPrecoEstoque(perfil: Perfil, p: Pick<ParametrosCatalogo, 'promotor_ve_preco_estoque'>): boolean {
  if (perfil === 'promotor') return p.promotor_ve_preco_estoque;
  return (PERFIS_PRECO_ESTOQUE as readonly Perfil[]).includes(perfil);
}

/** RN-CAT-05: item da vitrine como o perfil pode ver. Sem permissão ⇒ ficha e fotos, `price` e `availability` nulos. */
export function itemVitrineParaPerfil(item: ItemVitrine, perfil: Perfil, p: Pick<ParametrosCatalogo, 'promotor_ve_preco_estoque'>): ItemVitrine {
  if (podeVerPrecoEstoque(perfil, p)) return item;
  return { ...item, price: null, availability: null, price_stock_visible: false };
}

/**
 * RN-CAT-05: sem preço/estoque visíveis, a busca não filtra nem ordena por preço ou estoque — senão a lista
 * revelaria o que a ficha esconde. Marca, categoria, código, medida e texto continuam.
 */
export function filtrosParaPerfil(f: FiltrosInterpretados, perfil: Perfil, p: Pick<ParametrosCatalogo, 'promotor_ve_preco_estoque'>): FiltrosInterpretados {
  if (podeVerPrecoEstoque(perfil, p)) return f;
  return { ...f, min_price_cents: null, max_price_cents: null, stock: null, sort: null };
}

/** Variante tolerante para quem lê parâmetros crus (API e aparelho): valor inválido cai no padrão (promotor sem preço). */
export function verPrecoDoPerfil(perfil: Perfil, parametros: Readonly<Record<string, unknown>> | undefined): boolean {
  const r = ParametrosCatalogo.safeParse({ ...PARAMETROS_PADRAO, ...(parametros ?? {}) });
  return podeVerPrecoEstoque(perfil, r.success ? r.data : PARAMETROS_PADRAO);
}

/**
 * RN-CAT-05 (T-0121 N3): valor que entra na `versao_escopo` das entidades de preço e estoque. Quando o perfil deixa de ver
 * (promotor_ve_preco_estoque de sim para não) o valor muda, o aparelho ressincroniza a entidade e o preço e o estoque que já
 * estavam nele somem; o pull só devolve linhas a quem vê, então a ressincronização traz a entidade vazia.
 */
export function variacaoEscopoPrecoEstoque(perfil: Perfil, parametros: Readonly<Record<string, unknown>> | undefined): string {
  return verPrecoDoPerfil(perfil, parametros) ? 'preco-estoque:visivel' : 'preco-estoque:oculto';
}
