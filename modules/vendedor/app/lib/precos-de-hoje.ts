/**
 * Folha "Preços de hoje" (RN-VEN-18, T-0141 G; spec docs/design/pedido-v3.md §G). O orçamento não vence; só o preço congelado vale
 * 7 dias. Passado esse prazo, Transformar usa a tabela do dia e, se o total mudou, mostra esta folha antes de transformar.
 * Funções puras: quem calcula o total de cada item é o domain (`reconferirOrcamento`); aqui só o que a folha escreve.
 */
import { formatBRL } from '@macuxi/comum';

import type { ItemAntesHoje, MudancaNaConversao } from '../../domain/orcamento';

export const TEXTOS_PRECOS_DE_HOJE = {
  titulo: 'Preços de hoje',
  hoje: 'Hoje',
  diferenca: 'Diferença',
  mudaram: 'Mudaram',
  semPrecoHoje: 'Sem preço hoje',
  acao: 'Transformar com os preços de hoje',
  acaoSemUm: 'Transformar sem este item',
  acaoSemVarios: 'Transformar sem estes itens',
  apoioDoBotao: 'Entra pelos preços de hoje',
  voltar: 'Voltar',
} as const;

/** Quantos itens que mudaram a folha mostra antes de "Ver os N itens". */
export const LIMITE_ITENS_DA_FOLHA = 8;

/** O que o estado guarda da conferência para montar a folha (o nome do produto é o da descrição, sem o código). */
export interface DadosDosPrecosDeHoje {
  preco_vale: boolean;
  r: { itens_hoje: readonly ItemAntesHoje[]; total_orcado_cents: number; total_hoje_cents: number; mudancas: readonly MudancaNaConversao[]; bloqueio: string | null };
  nomes: Readonly<Record<string, string>>;
}

export interface FolhaPrecosDeHoje {
  titulo: string;
  totais: Array<{ id: 'orcamento' | 'hoje' | 'diferenca'; rotulo: string; valor: string; tom?: 'sucesso' }>;
  mudaram: Array<{ id: string; rotulo: string; valor: string }>;
  /** "Ver os 12 itens" quando há mais do que cabem; `null` caso contrário */
  verTodos: string | null;
  /** nomes dos itens que saem do pedido por falta de preço hoje */
  semPreco: string[];
  acao: string;
}

const dinheiroComSinal = (cents: number) => `${cents < 0 ? '−' : '+'}${formatBRL(Math.abs(cents))}`;

/**
 * `null` = transforma direto (preço ainda vale, total igual e nenhum item sai) ou a conferência com bloqueio, que tem a folha
 * dela. `todos`: o vendedor tocou em "Ver os N itens".
 */
export function folhaPrecosDeHoje(a: {
  preco_vale: boolean;
  /** "09/11": o dia em que o preço do orçamento foi congelado */
  preco_data: string;
  r: { itens_hoje: readonly ItemAntesHoje[]; total_orcado_cents: number; total_hoje_cents: number; mudancas: readonly MudancaNaConversao[]; bloqueio: string | null };
  nome: (produtoId: string) => string;
  todos?: boolean;
}): FolhaPrecosDeHoje | null {
  const { r } = a;
  if (a.preco_vale || r.bloqueio !== null) return null;
  const semPreco = r.mudancas.filter((m): m is Extract<MudancaNaConversao, { tipo: 'sem_preco' }> => m.tipo === 'sem_preco').map((m) => a.nome(m.produto_id));
  const diferenca = r.total_hoje_cents - r.total_orcado_cents;
  if (diferenca === 0 && semPreco.length === 0) return null;
  const mudaram = r.itens_hoje.filter((i) => i.antes_cents !== i.hoje_cents);
  const visiveis = a.todos ? mudaram : mudaram.slice(0, LIMITE_ITENS_DA_FOLHA);
  return {
    titulo: TEXTOS_PRECOS_DE_HOJE.titulo,
    totais: [
      { id: 'orcamento', rotulo: `Orçamento (preço de ${a.preco_data})`, valor: formatBRL(r.total_orcado_cents) },
      { id: 'hoje', rotulo: TEXTOS_PRECOS_DE_HOJE.hoje, valor: formatBRL(r.total_hoje_cents) },
      { id: 'diferenca', rotulo: TEXTOS_PRECOS_DE_HOJE.diferenca, valor: dinheiroComSinal(diferenca), ...(diferenca < 0 ? { tom: 'sucesso' as const } : {}) },
    ],
    mudaram: visiveis.map((i) => ({ id: `${i.product_id}@${i.unidade}`, rotulo: `${a.nome(i.product_id)} · ${i.quantity} ${i.unidade}`, valor: `${formatBRL(i.antes_cents)} → ${formatBRL(i.hoje_cents)}` })),
    verTodos: !a.todos && mudaram.length > LIMITE_ITENS_DA_FOLHA ? `Ver os ${mudaram.length} itens` : null,
    semPreco,
    acao: semPreco.length === 0 ? TEXTOS_PRECOS_DE_HOJE.acao : semPreco.length === 1 ? TEXTOS_PRECOS_DE_HOJE.acaoSemUm : TEXTOS_PRECOS_DE_HOJE.acaoSemVarios,
  };
}
