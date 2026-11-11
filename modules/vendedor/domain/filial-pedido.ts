/**
 * Filial do pedido (RN-CORE-39; T-0149; ADR 0040): o pedido não escolhe filial; o servidor grava o retrato da filial EFETIVA do
 * cliente no recebimento (como recalcula o preço, RN-VEN-02). `filial_id` e `filial` vão sempre juntos (CHECK pedido_filial_coerente)
 * e `filial.id` em minúsculas, pois o banco compara com `filial_id::text`.
 */
export interface FilialOrigem {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  padrao: boolean;
  external_id: string | null;
}

export interface RetratoFilial {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  external_id: string | null;
  padrao: boolean;
}

export function retratoFilialDoPedido(f: FilialOrigem): { filial_id: string; filial: RetratoFilial } {
  const id = f.id.toLowerCase();
  return {
    filial_id: id,
    filial: { id, codigo: f.codigo, nome: f.nome, cidade: f.cidade ?? null, uf: f.uf ?? null, external_id: f.external_id ?? null, padrao: f.padrao },
  };
}

/** Texto da linha "Filial" no detalhe e nos PDFs: "0002 · Boa Vista/RR"; vazio quando o pedido é anterior à filial. */
export function nomeDaFilialDoPedido(f: { codigo?: unknown; nome?: unknown; uf?: unknown } | null | undefined): string {
  if (!f || typeof f.codigo !== 'string' || !f.codigo) return '';
  const nome = typeof f.nome === 'string' && f.nome ? f.nome : '';
  const uf = typeof f.uf === 'string' && f.uf ? `/${f.uf}` : '';
  return `${f.codigo}${nome ? ` · ${nome}${uf}` : ''}`;
}
