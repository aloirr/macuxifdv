/**
 * Consumidores do cliente novo para o ERP (RN-INT-22; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `core.cliente.pre_cadastrado@1` (só ids e carimbo): busca os pré-cadastros sem código do ERP pela consulta do Core
 *    (`core.clientes_pre_cadastro_sem_erp@1`, sem ler tabela do Core) e cria a linha `pendente` em `integracao.cliente_fila_erp` uma só vez
 *    (idempotente pelo cliente; também recompõe a fila se algum pré-cadastro anterior, inclusive o aprovado no BKO da v1.0.27, faltar). Core desligado = a consulta falha e a outbox repete.
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
import { CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, EVENTO_CLIENTE_PRE_CADASTRADO, type ClientePreCadastradoEvento, type ClientesPreCadastroSemErpSaida } from '@macuxi/core/contracts';

/** Páginas da consulta por evento (100 clientes por página): um teto contra laço sem fim. */
const PAGINAS_MAX = 20;

export async function entrarClienteNaFila(e: Pick<ClientePreCadastradoEvento, 'cliente_id'>, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  let depois: string | null = null;
  let criados = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const saida: ClientesPreCadastroSemErpSaida = await ctx.consultar(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, { limite: 100, depois_de: depois });
    for (const c of saida.clientes) {
      const { cliente_id, ...resto } = c;
      const { rowCount } = await ctx.db.query(
        `insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, estado, payload, recebido_em)
         values ($1, $2, 'pendente', $3::jsonb, $4::timestamptz) on conflict (tenant_id, cliente_uuid) do nothing`,
        [tenantId, cliente_id, JSON.stringify({ cliente_uuid: cliente_id, ...resto }), c.recebido_em],
      );
      criados += rowCount ?? 0;
    }
    if (saida.proximo === null) break;
    depois = saida.proximo;
  }
  ctx.log.info({ criados, cliente_id: e.cliente_id }, 'pré-cadastro tratado na fila do ERP');
}

export const consumidorClientePreCadastrado = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_PRE_CADASTRADO), executar: entrarClienteNaFila });
