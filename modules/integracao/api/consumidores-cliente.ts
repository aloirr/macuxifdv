/**
 * Consumidores do cliente novo para o ERP (RN-INT-22; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `core.cliente.aprovado@1` (só ids): busca os aprovados sem código do ERP pela consulta do Core (`core.clientes_aprovados_sem_erp@1`,
 *    sem ler tabela do Core) e cria a linha `pendente` em `integracao.cliente_fila_erp` uma só vez (idempotente pelo cliente; também
 *    recompõe a fila se algum aprovado anterior faltar). Core desligado = a consulta falha e a outbox repete.
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
import { CONSULTA_CLIENTES_APROVADOS_SEM_ERP, EVENTO_CLIENTE_APROVADO, type ClienteAprovadoEvento, type ClientesAprovadosSemErpSaida } from '@macuxi/core/contracts';

/** Páginas da consulta por evento (100 clientes por página): um teto contra laço sem fim. */
const PAGINAS_MAX = 20;

export async function entrarClienteNaFila(e: Pick<ClienteAprovadoEvento, 'cliente_id'>, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  let depois: string | null = null;
  let criados = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const saida: ClientesAprovadosSemErpSaida = await ctx.consultar(CONSULTA_CLIENTES_APROVADOS_SEM_ERP, { limite: 100, depois_de: depois });
    for (const c of saida.clientes) {
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

export const consumidorClienteAprovado = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_APROVADO), executar: entrarClienteNaFila });
