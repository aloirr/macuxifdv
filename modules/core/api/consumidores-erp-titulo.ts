/**
 * `integracao.titulo.atualizado@1` -> `core.titulo` (financeiro do Cliente 360; T-0066; RN-INT-02/04). Upsert por
 * `external_id`; inativação = `deleted_at`. Cliente ainda ausente = `ReferenciaAusenteErp` (a outbox repete, sem órfão).
 * Depois de gravar, recalcula `core.cliente_financeiro.saldo_aberto_cents` (soma dos títulos abertos vivos).
 * `baixado` do Hub vira `liquidado`; título sem emissão usa o vencimento (a coluna é obrigatória).
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { situacaoTituloDoErp } from '../domain';
import { clientePorExternalId, recalcularSaldoFinanceiro, ReferenciaAusenteErp } from './erp-apoio';
import { EVENTO_ERP_TITULO_ATUALIZADO } from '../../integracao/contracts';

export const EventoIntegracaoTituloAtualizado = eventoTolerante(EVENTO_ERP_TITULO_ATUALIZADO);

export const consumidorTituloDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoTituloAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const r = p.registro;
    if (p.acao === 'inativado' || !r || r.ativo === false) {
      const x = await ctx.db.query<{ cliente_id: string }>('update core.titulo set deleted_at = $2 where external_id = $1 and deleted_at is null returning cliente_id', [p.external_id, ctx.agora()]);
      if (x.rows[0]) await recalcularSaldoFinanceiro(ctx.db, x.rows[0].cliente_id);
      return;
    }
    const clienteId = await clientePorExternalId(ctx.db, r.cliente_external_id);
    if (!clienteId) throw new ReferenciaAusenteErp('cliente');

    // T-0186 (0090, aditivo): NF e forma de pagamento (DESCRIÇÃO em texto, até 120 caracteres, como o ERP manda). Ausente = não informado = não altera; série só com o número.
    const novos = r as typeof r & { nf_numero?: string | null; nf_serie?: string | null; forma_pagamento?: string | null };
    const nfNumero = novos.nf_numero?.trim() || null;
    const nfSerie = nfNumero ? novos.nf_serie?.trim() || null : null;
    const forma = novos.forma_pagamento?.trim().slice(0, 120) || null;
    await ctx.db.query(
      `insert into core.titulo (tenant_id, external_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents, saldo_cents, situacao, liquidado_em, nf_numero, nf_serie, forma_pagamento)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, coalesce($5::date, $6::date), $6::date, $7, $8, $9, $10::timestamptz, $11, $12, $13)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set cliente_id = excluded.cliente_id, documento = excluded.documento, parcela = excluded.parcela, emissao = excluded.emissao,
                     vencimento = excluded.vencimento, valor_cents = excluded.valor_cents, saldo_cents = excluded.saldo_cents,
                     situacao = excluded.situacao, liquidado_em = excluded.liquidado_em,
                     nf_numero = coalesce(excluded.nf_numero, core.titulo.nf_numero),
                     nf_serie = case when excluded.nf_numero is null then core.titulo.nf_serie else excluded.nf_serie end,
                     forma_pagamento = coalesce(excluded.forma_pagamento, core.titulo.forma_pagamento)`,
      [
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
        nfNumero,
        nfSerie,
        forma,
      ],
    );
    await recalcularSaldoFinanceiro(ctx.db, clienteId);
  },
});
