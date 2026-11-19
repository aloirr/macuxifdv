/**
 * Consulta `vendedor.preco_prazo_padrao@1` na API (ADR 0012; RN-VEN-43): formas e prazos de `vendedor.*` (RLS do tenant) e os
 * limites do cliente em `core.cadastro_resumo@1`, que só devolve cliente da carteira de quem consulta. Cliente fora da carteira
 * ou sem prazo padrão: valores iguais (nada do cadastro vaza). A regra é `ajustarCentsPeloPrazoPadrao`, a mesma do aparelho.
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { implementarConsulta, type ClienteBanco } from '@macuxi/platform-sdk';
import { ajustarCentsPeloPrazoPadrao, CONSULTA_PRECO_PRAZO_PADRAO } from '../contracts';
import type { FormaDePagamento, PrazoDePagamento } from '../domain';
import { COLUNA_PERCENTUAL_AJUSTE } from './pagamento';

export interface ConsultaCadastro {
  (entrada: { cliente_ids: string[] }): Promise<{ clientes: { id: string; formas_pagamento?: string[] | null }[] }>;
}

/** Núcleo testável: recebe o banco e a busca do cadastro (sem a consulta do Core). */
export async function precoPrazoPadrao(db: ClienteBanco, cadastro: ConsultaCadastro, clienteId: string, cents: readonly number[]): Promise<number[]> {
  if (cents.length === 0) return [];
  const cad = await cadastro({ cliente_ids: [clienteId] });
  const cliente = cad.clientes.find((c) => c.id === clienteId);
  if (!cliente) return [...cents];
  const formas = (await db.query<FormaDePagamento>('select id, codigo, nome, ativo, ordem from vendedor.forma_pagamento where deleted_at is null')).rows;
  const prazos = (
    await db.query<PrazoDePagamento>(
      `select id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ${COLUNA_PERCENTUAL_AJUSTE}, ativo, ordem from vendedor.prazo_pagamento where deleted_at is null`,
    )
  ).rows;
  return ajustarCentsPeloPrazoPadrao(cents, { cliente: { formas_pagamento: cliente.formas_pagamento ?? null }, formas, prazos });
}

export const consultaPrecoPrazoPadrao = implementarConsulta(CONSULTA_PRECO_PRAZO_PADRAO, async (entrada, ctx) => {
  const cadastro: ConsultaCadastro = (e) => {
    if (!ctx.consultar) throw new Error('vendedor.preco_prazo_padrao@1: ctx.consultar ausente');
    return ctx.consultar(CONSULTA_CADASTRO_RESUMO, { ...e, produto_ids: [], usuario_ids: [], endereco_ids: [] });
  };
  return { cents: await precoPrazoPadrao(ctx.db, cadastro, entrada.cliente_id, entrada.cents) };
});
