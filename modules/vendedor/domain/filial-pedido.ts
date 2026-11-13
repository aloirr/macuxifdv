import { CAMPOS_FISCAIS_FILIAL as CAMPOS_FISCAIS, type Filial } from '@macuxi/core/contracts';

/**
 * Filial do pedido (RN-CORE-39; T-0149; ADR 0040): o pedido não escolhe filial; o servidor grava o retrato da filial EFETIVA do
 * cliente no recebimento (como recalcula o preço, RN-VEN-02). `filial_id` e `filial` vão sempre juntos (CHECK pedido_filial_coerente)
 * e `filial.id` em minúsculas, pois o banco compara com `filial_id::text`.
 */
/** Filial de origem e retrato gravado: o `Filial` do Core (RN-CORE-39); o retrato não leva `ativo`. */
export type FilialOrigem = Omit<Filial, 'ativo'> & { ativo?: boolean };
export type RetratoFilial = Omit<Filial, 'ativo'>;

export function retratoFilialDoPedido(f: FilialOrigem): { filial_id: string; filial: RetratoFilial } {
  const id = f.id.toLowerCase();
  return {
    filial_id: id,
    filial: { id, codigo: f.codigo, nome: f.nome, cidade: f.cidade ?? null, uf: f.uf ?? null, external_id: f.external_id ?? null, padrao: f.padrao,
      // T-0159: dados fiscais da filial no retrato; o PDF do pedido mostra os da data do pedido, mesmo que o cadastro mude depois
      ...Object.fromEntries(CAMPOS_FISCAIS.filter((k) => f[k]).map((k) => [k, f[k]])) },
  };
}

/** T-0159: dados fiscais do retrato para o contrato e o PDF (CNPJ, endereço, telefone); nulo quando o retrato não tem nenhum. */
export function dadosFiscaisDaFilial(f: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!f) return null;
  const r: Record<string, string> = {};
  for (const k of [...CAMPOS_FISCAIS, 'nome', 'cidade', 'uf']) {
    const v = f[k];
    if (typeof v === 'string' && v.trim()) r[k] = v.trim();
  }
  return r.cnpj || r.logradouro || r.telefone ? r : null;
}

/** T-0159 (0060): marca do produto no retrato do item: aparada e cortada em 100; vazia = nulo (o PDF deixa a célula vazia). */
export function marcaDoRetrato(marca: string | null | undefined): string | null {
  const m = (marca ?? '').trim().slice(0, 100).trim();
  return m || null;
}

/** Texto da linha "Filial" no detalhe e nos PDFs: "0002 · Boa Vista/RR"; vazio quando o pedido é anterior à filial. */
export function nomeDaFilialDoPedido(f: { codigo?: unknown; nome?: unknown; uf?: unknown } | null | undefined): string {
  if (!f || typeof f.codigo !== 'string' || !f.codigo) return '';
  const nome = typeof f.nome === 'string' && f.nome ? f.nome : '';
  const uf = typeof f.uf === 'string' && f.uf ? `/${f.uf}` : '';
  return `${f.codigo}${nome ? ` · ${nome}${uf}` : ''}`;
}
