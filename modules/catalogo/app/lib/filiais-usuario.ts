/**
 * ADAPTADOR (único lugar do app que lê as filiais da linha `usuario` do sync): o contrato do Core (T-0176, RN-CORE-39) está em proposta
 * e o nome pode mudar. Hoje `{ filial_cadastro_id, filial_venda_ids, sem_filial }`; aceita também o `filial_ids` anterior (df8cf17).
 * O Catálogo usa SÓ as filiais de VENDA; a de cadastro nunca é lida aqui. Linha ausente ou sem lista = `null` (estoque como recebido).
 */
export interface FiliaisDeVendaLocal {
  filiaisVenda: readonly string[];
  semFilial: boolean;
}

export function lerFiliaisDeVendaDaLinha(linha: unknown): FiliaisDeVendaLocal | null {
  const o = (linha ?? {}) as { filial_venda_ids?: unknown; filial_ids?: unknown; sem_filial?: unknown };
  const lista = Array.isArray(o.filial_venda_ids) ? o.filial_venda_ids : Array.isArray(o.filial_ids) ? o.filial_ids : null;
  if (lista === null && o.sem_filial !== true) return null;
  const ids = [...new Set((lista ?? []).filter((x): x is string => typeof x === 'string'))];
  return { filiaisVenda: ids, semFilial: o.sem_filial === true || ids.length === 0 };
}
