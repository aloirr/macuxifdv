/**
 * Consumidores do cliente novo para o ERP (RN-INT-22; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `core.cliente.aprovado@1` (só ids): busca os aprovados sem código do ERP pela consulta do Core (`core.clientes_aprovados_sem_erp@1`,
 *    sem ler tabela do Core) e cria a linha `pendente` em `integracao.cliente_fila_erp` uma só vez (idempotente pelo cliente; também
 *    recompõe a fila se algum aprovado anterior faltar). Core desligado = a consulta falha e a outbox repete.
 *  - `integracao.cliente.retorno_erp@1` (publicado pela rota de retorno): `vinculado` pede ao Core o vínculo (`core.cliente_vincular_erp@1`);
 *    conflito, código em uso e afins marcam a fila como `rejeitado` com o motivo legível. `rejeitado_erp` nada pede ao Core.
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
import { CONSULTA_CLIENTE_VINCULAR_ERP, CONSULTA_CLIENTES_APROVADOS_SEM_ERP, EVENTO_CLIENTE_APROVADO, type ClienteAprovadoEvento, type ClientesAprovadosSemErpSaida } from '@macuxi/core/contracts';
import { EVENTO_CLIENTE_RETORNO_ERP, type ClienteRetornoErpEvento } from '../contracts';
import { decidirEntradaCliente, decidirResultadoVinculo } from '../domain';

/** Páginas da consulta por evento (100 clientes por página): um teto contra laço sem fim. */
const PAGINAS_MAX = 20;

export async function entrarClienteNaFila(e: Pick<ClienteAprovadoEvento, 'cliente_id'>, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  let depois: string | null = null;
  let criados = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const saida: ClientesAprovadosSemErpSaida = await ctx.consultar(CONSULTA_CLIENTES_APROVADOS_SEM_ERP, { limite: 100, depois_de: depois });
    const ids = saida.clientes.map((c) => c.cliente_id);
    const { rows: existentes } = ids.length
      ? await ctx.db.query<{ cliente_uuid: string }>('select cliente_uuid from integracao.cliente_fila_erp where tenant_id = $1 and cliente_uuid = any($2::uuid[])', [tenantId, ids])
      : { rows: [] as { cliente_uuid: string }[] };
    const ja = new Set(existentes.map((r) => r.cliente_uuid));
    for (const c of saida.clientes) {
      if (decidirEntradaCliente(ja.has(c.cliente_id) ? { cliente_uuid: c.cliente_id } : null).acao !== 'criar') continue;
      const { cliente_id, ...resto } = c;
      const { rowCount } = await ctx.db.query(
        `insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, estado, payload, aprovado_em)
         values ($1, $2, 'pendente', $3::jsonb, $4::timestamptz) on conflict (tenant_id, cliente_uuid) do nothing`,
        [tenantId, cliente_id, JSON.stringify({ cliente_uuid: cliente_id, ...resto }), c.aprovado_em],
      );
      criados += rowCount ?? 0;
    }
    if (saida.proximo === null) break;
    depois = saida.proximo;
  }
  ctx.log.info({ criados, cliente_id: e.cliente_id }, 'cliente aprovado tratado na fila do ERP');
}

export async function vincularCodigoDoErp(e: Pick<ClienteRetornoErpEvento, 'cliente_id' | 'status' | 'external_id'>, ctx: ContextoConsumo): Promise<void> {
  if (e.status !== 'vinculado' || e.external_id === null) return;
  const saida = await ctx.consultar(CONSULTA_CLIENTE_VINCULAR_ERP, { cliente_id: e.cliente_id, external_id: e.external_id });
  const d = decidirResultadoVinculo(saida.resultado);
  if (d.estado === 'rejeitado') {
    await ctx.db.query(
      "update integracao.cliente_fila_erp set estado = 'rejeitado', motivo = $3 where tenant_id = $1 and cliente_uuid = $2 and estado = 'vinculado'",
      [ctx.envelope.tenant_id, e.cliente_id, d.motivo],
    );
    ctx.log.warn({ cliente_id: e.cliente_id, resultado: saida.resultado }, 'o Core recusou o código do ERP; cliente rejeitado na fila');
    return;
  }
  ctx.log.info({ cliente_id: e.cliente_id, resultado: saida.resultado }, 'código do ERP gravado no cliente');
}

export const consumidorClienteAprovado = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_APROVADO), executar: entrarClienteNaFila });
export const consumidorClienteRetornoErp = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_RETORNO_ERP), executar: vincularCodigoDoErp });
