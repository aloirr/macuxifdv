/**
 * `catalogo.estoque_filial@1` na API (T-0149; RN-VEN-20): só SQL em `catalogo.*`, na transação de quem consulta (RLS do
 * tenant). Quais depósitos valem e a soma são do domain.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_ESTOQUE_FILIAL } from '../contracts';
import { depositosDaFilial, saldoPorProdutoDaFilial, type DepositoFilial, type SaldoDeposito } from '../domain/estoque-filial';

export const consultaEstoqueFilial = implementarConsulta(CONSULTA_ESTOQUE_FILIAL, async (entrada, ctx) => {
  const filialId = entrada.filial_id ?? null;
  const d = await ctx.db.query(`select id, filial_id from catalogo.deposito where deleted_at is null`);
  const validos = depositosDaFilial(d.rows as unknown as DepositoFilial[], filialId);
  // Todos os saldos do tenant para os produtos: "sem controle" depende de não haver linha em depósito nenhum (RN-VEN-20).
  const s = await ctx.db.query(
    `select deposito_id, produto_id, quantidade::float8 as quantidade
       from catalogo.estoque_saldo where produto_id = any($1::uuid[]) and deleted_at is null`,
    [entrada.produto_ids],
  );
  return { itens: saldoPorProdutoDaFilial(entrada.produto_ids, validos, s.rows as unknown as SaldoDeposito[]) };
});
