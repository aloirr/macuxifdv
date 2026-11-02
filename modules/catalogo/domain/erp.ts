/**
 * Preço e estoque vindos do ERP (`integracao.preco|estoque.atualizado@1`; T-0066, RN-INT-02). Planos puros: o consumidor
 * da API só executa o plano. Inativação do ERP nunca apaga: o item sai da vitrine (soft delete) e volta se o ERP reativar.
 */
export interface EventoErpBase<R> {
  external_id: string;
  acao: 'criado' | 'atualizado' | 'inativado';
  registro?: (R & { ativo?: boolean | undefined }) | undefined;
}

export interface RegistroPrecoErp {
  tabela_external_id: string;
  tabela_nome: string;
  vigencia_inicio: string;
  vigencia_fim?: string | null | undefined;
  produto_external_id: string;
  preco_cents: number;
}
export interface RegistroEstoqueErp {
  deposito_external_id: string;
  deposito_nome?: string | null | undefined;
  produto_external_id: string;
  saldo: number;
}

export type PlanoPrecoErp =
  | { tipo: 'ignorar' }
  | { tipo: 'inativar'; external_id: string }
  | {
      tipo: 'upsert';
      linha: { external_id: string; tabela_external_id: string; tabela_nome: string; produto_external_id: string; preco_cents: number; vigencia_inicio: string; vigencia_fim: string | null };
    };

export function planejarPrecoDoErp(e: EventoErpBase<RegistroPrecoErp>): PlanoPrecoErp {
  if (e.acao === 'inativado') return { tipo: 'inativar', external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  // A tabela do Catálogo exige preço > 0: preço zerado no ERP = sem preço naquela tabela (RN-CAT-06).
  if (r.ativo === false || !(r.preco_cents > 0)) return { tipo: 'inativar', external_id: e.external_id };
  return {
    tipo: 'upsert',
    linha: {
      external_id: e.external_id,
      tabela_external_id: r.tabela_external_id,
      tabela_nome: r.tabela_nome.trim() || r.tabela_external_id,
      produto_external_id: r.produto_external_id,
      preco_cents: Math.round(r.preco_cents),
      vigencia_inicio: r.vigencia_inicio,
      vigencia_fim: r.vigencia_fim ?? null,
    },
  };
}

export type PlanoEstoqueErp =
  | { tipo: 'ignorar' }
  | { tipo: 'inativar'; external_id: string }
  | { tipo: 'upsert'; linha: { external_id: string; deposito_external_id: string; deposito_nome: string; produto_external_id: string; saldo: number } };

export function planejarEstoqueDoErp(e: EventoErpBase<RegistroEstoqueErp>): PlanoEstoqueErp {
  if (e.acao === 'inativado') return { tipo: 'inativar', external_id: e.external_id };
  const r = e.registro;
  if (!r) return { tipo: 'ignorar' };
  if (r.ativo === false) return { tipo: 'inativar', external_id: e.external_id };
  return {
    tipo: 'upsert',
    linha: {
      external_id: e.external_id,
      deposito_external_id: r.deposito_external_id,
      deposito_nome: r.deposito_nome?.trim() || r.deposito_external_id,
      produto_external_id: r.produto_external_id,
      saldo: r.saldo,
    },
  };
}
