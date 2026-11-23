/**
 * `integracao.cliente.retorno_erp@1` -> `core.cliente` (RN-CORE-78, RN-INT-22; ADR 0012 §5: consulta é só leitura, quem grava é o Core).
 * O ERP aprova o pré-cadastro: o Hub devolve o código (`vinculado`) ou a recusa (`rejeitado_erp`). A decisão é do domínio
 * (`decidirVinculoErp`, `decidirRecusaErp`).
 * - vinculado: grava `external_id`, `status_cadastro = 'aprovado'` e `aprovado_em` (quando o ERP aprovou); o mesmo código de novo (reentrega)
 *   não faz nada; código diferente (conflito) ou já usado por outro cliente não grava e fica na auditoria (ator Hub, só ids e regra).
 * - rejeitado_erp: grava `status_cadastro = 'recusado'` e `motivo_recusa` (até 500). O motivo nunca vai a log nem à auditoria.
 * Os dois publicam `core.cliente.atualizado@1` só quando gravam, para o app do vendedor receber.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_CLIENTE_ATUALIZADO } from '../contracts';
import { EVENTO_CLIENTE_RETORNO_ERP } from '../../integracao/contracts';
import type { ClienteParaVinculo } from '../domain';
import { decidirRecusaErp, decidirVinculoErp, motivoRecusaCortado } from '../domain';
import { auditar } from './auditoria';
import { carteiraDoEvento } from './rotas';

export const EventoIntegracaoClienteRetornoErp = eventoTolerante(EVENTO_CLIENTE_RETORNO_ERP);

function auditarSistema(ctx: ContextoConsumo, acao: string, clienteId: string, depois: Record<string, unknown>): Promise<void> {
  return auditar(ctx.db, { usuario: { id: null }, requestId: ctx.envelope.evento_id }, { acao, entidade: 'cliente', entidadeId: clienteId, antes: null, depois: { ...depois, regra: 'RN-CORE-78', ator: 'hub' } });
}

export const consumidorClienteRetornoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoClienteRetornoErp,
  async executar(p, ctx: ContextoConsumo) {
    if (p.status === 'rejeitado_erp') {
      const atual = (await ctx.db.query<ClienteParaVinculo>('select status_cadastro, external_id from core.cliente where id = $1 and deleted_at is null for update', [p.cliente_id])).rows[0] ?? null;
      const r = decidirRecusaErp(atual);
      if (r.acao === 'nada') return;
      await ctx.db.query("update core.cliente set status_cadastro = 'recusado', motivo_recusa = $2 where id = $1", [p.cliente_id, motivoRecusaCortado(p.motivo)]);
      await auditarSistema(ctx, 'cliente.rejeitado_erp', p.cliente_id, {});
      await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: p.cliente_id, campos: ['status_cadastro'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, p.cliente_id)) }, p.cliente_id);
      return;
    }
    const codigo = p.external_id?.trim();
    if (!codigo) return; // contrato exige o código em 'vinculado'; sem ele não há o que gravar
    const cliente = (await ctx.db.query<ClienteParaVinculo>('select status_cadastro, external_id from core.cliente where id = $1 and deleted_at is null for update', [p.cliente_id])).rows[0] ?? null;
    const emUso = cliente?.external_id === null && (await ctx.db.query('select 1 from core.cliente where external_id = $1 and id <> $2 and deleted_at is null limit 1', [codigo, p.cliente_id])).rows.length > 0;
    const d = decidirVinculoErp(cliente, codigo, emUso);
    if (d.acao === 'nada') return;
    if (d.acao === 'recusar') {
      if (d.resultado === 'conflito' || d.resultado === 'codigo_em_uso') {
        await auditarSistema(ctx, 'cliente.vinculo_erp_recusado', p.cliente_id, { external_id: codigo, resultado: d.resultado });
      }
      ctx.log.warn({ cliente_id: p.cliente_id, resultado: d.resultado }, 'retorno do ERP do cliente não gravado');
      return;
    }
    await ctx.db.query("update core.cliente set external_id = $2, status_cadastro = 'aprovado', aprovado_em = $3 where id = $1", [p.cliente_id, codigo, ctx.agora().toISOString()]);
    await auditarSistema(ctx, 'cliente.vincular_erp', p.cliente_id, { external_id: codigo });
    await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: p.cliente_id, campos: ['external_id', 'status_cadastro'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, p.cliente_id)) }, p.cliente_id);
  },
});
