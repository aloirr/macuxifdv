/**
 * ADAPTADOR (único lugar do app que lê as filiais da linha `usuario` do sync): o contrato do Core (T-0176, RN-CORE-39) está em proposta
 * e o nome pode mudar. Hoje `{ filial_cadastro_id, filial_venda_ids, sem_filial }`; aceita também o `filial_ids` anterior (df8cf17).
 * O estoque e o preço usam SÓ as filiais de VENDA; a de CADASTRO serve apenas à faixa do cabeçalho (decisão 2 do R-20261115-100000). Linha ausente ou sem lista = `null` (estoque como recebido).
 */
export interface FiliaisDeVendaLocal {
  filiaisVenda: readonly string[];
  /** Filial de cadastro do usuário (`filial_cadastro_id`), só para a faixa; nunca entra na soma do estoque. */
  filialCadastro: string | null;
  semFilial: boolean;
}

export function lerFiliaisDeVendaDaLinha(linha: unknown): FiliaisDeVendaLocal | null {
  const o = (linha ?? {}) as { filial_cadastro_id?: unknown; filial_venda_ids?: unknown; filial_ids?: unknown; sem_filial?: unknown };
  const lista = Array.isArray(o.filial_venda_ids) ? o.filial_venda_ids : Array.isArray(o.filial_ids) ? o.filial_ids : null;
  if (lista === null && o.sem_filial !== true) return null;
  const ids = [...new Set((lista ?? []).filter((x): x is string => typeof x === 'string'))];
  return { filiaisVenda: ids, filialCadastro: typeof o.filial_cadastro_id === 'string' ? o.filial_cadastro_id : null, semFilial: o.sem_filial === true || ids.length === 0 };
}
