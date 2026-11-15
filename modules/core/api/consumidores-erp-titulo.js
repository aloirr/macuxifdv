/**
 * `integracao.titulo.atualizado@1` -> `core.titulo` (financeiro do Cliente 360; T-0066; RN-INT-02/04). Upsert por
 * `external_id`; inativação = `deleted_at`. Cliente ainda ausente = `ReferenciaAusenteErp` (a outbox repete, sem órfão).
 * Depois de gravar, recalcula `core.cliente_financeiro.saldo_aberto_cents` (soma dos títulos abertos vivos).
 * `baixado` do Hub vira `liquidado`; título sem emissão usa o vencimento (a coluna é obrigatória).
 */
import { definirConsumidor, eventoTolerante } from '@macuxi/platform-sdk';
import { situacaoTituloDoErp } from '../domain';
import { clientePorExternalId, recalcularSaldoFinanceiro, ReferenciaAusenteErp } from './erp-apoio';
import { EVENTO_ERP_TITULO_ATUALIZADO } from '../../integracao/contracts';
export const EventoIntegracaoTituloAtualizado = eventoTolerante(EVENTO_ERP_TITULO_ATUALIZADO);
export const consumidorTituloDoErp = definirConsumidor({
    evento: EventoIntegracaoTituloAtualizado,
    async executar(p, ctx) {
        const r = p.registro;
        if (p.acao === 'inativado' || !r || r.ativo === false) {
            const x = await ctx.db.query('update core.titulo set deleted_at = $2 where external_id = $1 and deleted_at is null returning cliente_id', [p.external_id, ctx.agora()]);
            if (x.rows[0])
                await recalcularSaldoFinanceiro(ctx.db, x.rows[0].cliente_id);
            return;
        }
        const clienteId = await clientePorExternalId(ctx.db, r.cliente_external_id);
        if (!clienteId)
            throw new ReferenciaAusenteErp('cliente');
        await ctx.db.query(`insert into core.titulo (tenant_id, external_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents, saldo_cents, situacao, liquidado_em)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, coalesce($5::date, $6::date), $6::date, $7, $8, $9, $10::timestamptz)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set cliente_id = excluded.cliente_id, documento = excluded.documento, parcela = excluded.parcela, emissao = excluded.emissao,
                     vencimento = excluded.vencimento, valor_cents = excluded.valor_cents, saldo_cents = excluded.saldo_cents,
                     situacao = excluded.situacao, liquidado_em = excluded.liquidado_em`, [
            r.external_id,
            clienteId,
            r.numero.trim(),
            r.parcela == null ? null : String(r.parcela),
            r.emissao ?? null,
            r.vencimento,
            r.valor_cents,
            r.saldo_cents,
            situacaoTituloDoErp(r.situacao),
            r.baixado_em ?? null,
        ]);
        await recalcularSaldoFinanceiro(ctx.db, clienteId);
    },
});
