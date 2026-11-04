/**
 * Sugestões da aba Detalhes do novo pedido (T-0071; desenho §4). Funções puras, offline: usam só dados que o aparelho já
 * tem (linhas do pedido, medidas do Core, preços do Catálogo e pedidos da carteira). RN-VEN-15 (medida e preço da
 * embalagem), RN-VEN-21 (mesma medida soma a quantidade), RN-CAT-06 (sem preço não se sugere).
 */
import type { AjusteItem, UnidadeDeVendaDoProduto } from './preco-pedido';

const LIMITE_PADRAO = 5;

export interface LinhaDoPedido {
  /** identifica a linha: produto|medida (RN-VEN-21) */
  chave: string;
  product_id: string;
  unidade: string;
  fator: number;
  quantity: number;
  ajuste: AjusteItem;
}

/** Preço da unidade base do cliente e, quando houver, o preço próprio por embalagem (catalogo.precos_cliente@1). */
export type PrecosComEmbalagem = Record<string, { base_cents: number; embalagens?: ReadonlyArray<{ unidade: string; preco_cents: number }> }>;

export interface SugestaoEmbalagemMaior {
  produto_id: string;
  de_unidade: string;
  para_unidade: string;
  para_fator: number;
  preco_cents: number;
  /** inteiro; ≥ 1 mostra o selo "−5%", senão mostra o preço */
  economia_pct: number;
}

/**
 * RN-VEN-15: só a PRÓXIMA embalagem ATIVA com fator maior que o da linha e estoque ≥ fator. Economia = 1 − (preço da
 * embalagem ÷ fator) ÷ preço da unidade base, inteiro, meia para cima (nunca negativa).
 */
export function sugestoesEmbalagemMaior(
  linhas: readonly LinhaDoPedido[],
  unidades: Readonly<Record<string, readonly UnidadeDeVendaDoProduto[]>>,
  precos: PrecosComEmbalagem,
  estoque_base: Readonly<Record<string, number>>,
): SugestaoEmbalagemMaior[] {
  const out: SugestaoEmbalagemMaior[] = [];
  for (const l of linhas) {
    const preco = precos[l.product_id];
    const saldo = estoque_base[l.product_id];
    if (!preco || saldo === undefined) continue;
    const proxima = (unidades[l.product_id] ?? [])
      .filter((u) => u.ativo && u.fator > l.fator)
      .sort((a, b) => a.fator - b.fator)[0];
    if (!proxima || saldo < proxima.fator) continue;
    if (linhas.some((x) => x.product_id === l.product_id && x.unidade === proxima.unidade)) continue;
    const proprio = preco.embalagens?.find((e) => e.unidade === proxima.unidade)?.preco_cents;
    const preco_cents = proprio ?? preco.base_cents * proxima.fator;
    const cheio = preco.base_cents * proxima.fator;
    const economia_pct = cheio > 0 ? Math.max(0, Math.floor(((cheio - preco_cents) * 200 + cheio) / (2 * cheio))) : 0;
    out.push({ produto_id: l.product_id, de_unidade: l.unidade, para_unidade: proxima.unidade, para_fator: proxima.fator, preco_cents, economia_pct });
  }
  return out;
}

/**
 * Ação ⇄ (RN-VEN-15): troca a medida da linha. Quantidade nova = teto(quantidade_base ÷ fator) ("leve mais": 12 UN → 1 CX;
 * 15 UN → 2 CX). O ajuste do item é ZERADO. Já existindo linha do mesmo produto na medida nova, soma (RN-VEN-21).
 */
export function trocarParaEmbalagem<R extends { linhas: LinhaDoPedido[] }>(rascunho: R, chave: string, para: { unidade: string; fator: number }): R {
  const origem = rascunho.linhas.find((l) => l.chave === chave);
  if (!origem) return rascunho;
  const quantity = Math.ceil((origem.quantity * origem.fator) / para.fator);
  const nova: LinhaDoPedido = { ...origem, chave: `${origem.product_id}|${para.unidade}`, unidade: para.unidade, fator: para.fator, quantity, ajuste: null };
  const soma = rascunho.linhas.some((l) => l !== origem && l.chave === nova.chave);
  const linhas = soma
    ? rascunho.linhas.filter((l) => l !== origem).map((l) => (l.chave === nova.chave ? { ...l, quantity: l.quantity + quantity } : l))
    : rascunho.linhas.map((l) => (l === origem ? nova : l));
  return { ...rascunho, linhas };
}

const STATUS_FORA = new Set(['cancelled', 'rejected']);

/**
 * "Combina com o pedido" por clientes parecidos: mesmo segmento (não nulo) na carteira, menos o próprio cliente. Conta só
 * pedido (não orçamento) não cancelado nem rejeitado na janela (90 dias). Pontuação = nº de clientes parecidos distintos que
 * compraram. Tira o que o próprio cliente comprou na janela. Segmento nulo → [].
 */
export function sugestoesClientesParecidos(e: {
  cliente_id: string;
  segmento: string | null;
  clientes: ReadonlyArray<{ id: string; segmento: string | null }>;
  pedidos: ReadonlyArray<{ cliente_id: string; tipo: string; status: string; criado_em: string; produto_ids: readonly string[] }>;
  agora: Date;
  dias?: number;
}): string[] {
  if (!e.segmento) return [];
  const parecidos = new Set(e.clientes.filter((c) => c.segmento === e.segmento && c.id !== e.cliente_id).map((c) => c.id));
  const desde = e.agora.getTime() - (e.dias ?? 90) * 86_400_000;
  const validos = e.pedidos.filter((p) => p.tipo === 'pedido' && !STATUS_FORA.has(p.status) && Date.parse(p.criado_em) >= desde && Date.parse(p.criado_em) <= e.agora.getTime());
  const meus = new Set(validos.filter((p) => p.cliente_id === e.cliente_id).flatMap((p) => p.produto_ids));
  const compradores = new Map<string, Set<string>>();
  for (const p of validos) {
    if (!parecidos.has(p.cliente_id)) continue;
    for (const id of p.produto_ids) {
      if (meus.has(id)) continue;
      const s = compradores.get(id) ?? new Set<string>();
      s.add(p.cliente_id);
      compradores.set(id, s);
    }
  }
  return [...compradores.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

// ---------- mesclar ----------
export interface SugestaoDoCatalogo {
  produto_id: string;
  tipo: 'complementar' | 'superior';
  origem_produto_id: string;
  preco_cents: number;
}
export type SugestaoDaTela =
  | { origem: 'complementar' | 'clientes_parecidos' | 'superior'; produto_id: string; preco_cents: number }
  | ({ origem: 'embalagem_maior'; preco_cents: number } & SugestaoEmbalagemMaior);

/**
 * Junta e limita. Combina: complementares, depois clientes parecidos. Leve mais: embalagem maior, depois versão superior. Sem
 * o que já está no pedido (exceto a troca de embalagem, que é do próprio item), sem repetidos, sem produto sem preço para o
 * cliente (RN-CAT-06) nem com estoque ≤ 0, no máximo `limite` (5) em cada bloco.
 */
export function mesclarSugestoes(e: {
  no_pedido: readonly string[];
  complementares: readonly SugestaoDoCatalogo[];
  clientes_parecidos: readonly string[];
  embalagem_maior: readonly SugestaoEmbalagemMaior[];
  superiores: readonly SugestaoDoCatalogo[];
  vendaveis: Readonly<Record<string, { preco_cents: number | null; estoque_base: number | null }>>;
  limite?: number;
}): { combina: SugestaoDaTela[]; leve_mais: SugestaoDaTela[] } {
  const limite = e.limite ?? LIMITE_PADRAO;
  const noPedido = new Set(e.no_pedido);
  const vendavel = (id: string): number | null => {
    const v = e.vendaveis[id];
    return v && v.preco_cents != null && (v.estoque_base ?? 0) > 0 ? v.preco_cents : null;
  };
  const bloco = (fontes: Array<Array<{ origem: 'complementar' | 'clientes_parecidos' | 'superior'; id: string }>>): SugestaoDaTela[] => {
    const vistos = new Set<string>();
    const out: SugestaoDaTela[] = [];
    for (const f of fontes.flat()) {
      if (noPedido.has(f.id) || vistos.has(f.id)) continue;
      const preco = vendavel(f.id);
      if (preco == null) continue;
      vistos.add(f.id);
      out.push({ origem: f.origem, produto_id: f.id, preco_cents: preco });
      if (out.length >= limite) break;
    }
    return out;
  };
  const combina = bloco([
    e.complementares.map((s) => ({ origem: 'complementar' as const, id: s.produto_id })),
    e.clientes_parecidos.map((id) => ({ origem: 'clientes_parecidos' as const, id })),
  ]);
  const embalagens: SugestaoDaTela[] = e.embalagem_maior.map((s) => ({ origem: 'embalagem_maior' as const, ...s }));
  const superiores = bloco([e.superiores.map((s) => ({ origem: 'superior' as const, id: s.produto_id }))]);
  return { combina, leve_mais: [...embalagens, ...superiores].slice(0, limite) };
}
