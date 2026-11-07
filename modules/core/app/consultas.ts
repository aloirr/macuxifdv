/**
 * Consulta `core.financeiro_cliente@1` no aparelho (T-0089; ADR 0012): lê só as linhas locais do Core (pull de
 * `cliente_financeiro` e `titulo`) e decide com o mesmo domain da API (RN-VEN-12/13). Vale offline.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_FINANCEIRO_CLIENTE, type ClienteFinanceiroSync, type TituloSync } from '../contracts';
import { dataLocal } from '../domain/checkin';
import { financeiroDoCliente } from '../domain/pagamento-cliente';
import { DEFAULT_TZ } from '@macuxi/ui/mobile/puro';

export const consultaFinanceiroClienteAparelho = implementarConsultaAparelho(CONSULTA_FINANCEIRO_CLIENTE, async (entrada, ctx) => {
  const [fin] = (await ctx.linhasPorCampo<ClienteFinanceiroSync>('cliente_financeiro', 'cliente_id', [entrada.cliente_id])).filter((l) => !l.deleted_at);
  if (!fin) return { financeiro: null };
  const titulos = (await ctx.linhasPorCampo<TituloSync>('titulo', 'cliente_id', [entrada.cliente_id])).filter((t) => !t.deleted_at && t.situacao === 'aberto');
  const hoje = dataLocal(ctx.agora(), ctx.usuario()?.fuso || DEFAULT_TZ);
  return { financeiro: financeiroDoCliente(fin, titulos, hoje) };
});
