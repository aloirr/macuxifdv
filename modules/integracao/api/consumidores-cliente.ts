/**
 * Consumidores do cliente novo para o ERP (RN-INT-22; ADR 0007: efeito e `evento_consumo` na mesma transação).
 *  - `core.cliente.pre_cadastrado@1` (só ids e carimbo): busca os pré-cadastros sem código do ERP pela consulta do Core
 *    (`core.clientes_pre_cadastro_sem_erp@1`, sem ler tabela do Core) e cria a linha `pendente` em `integracao.cliente_fila_erp` uma só vez
 *    (idempotente pelo cliente; também recompõe a fila se algum pré-cadastro 'pendente' anterior faltar; os aprovados da v1.0.27 já entraram na fila quando foram aprovados). Core desligado = a consulta falha e a outbox repete.
 *  - `core.cliente.pre_cadastro_revisado@1` (ADR 0069): a mesma função; a revisão nova reabre a MESMA linha (`rejeitado → pendente`,
 *    revisão, hash e payload novos, tentativas zeradas), pela `decidirEntradaClienteNaFila` do domain. `vinculado` nunca reabre.
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
import {
  CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP,
  EVENTO_CLIENTE_PRE_CADASTRADO,
  EVENTO_CLIENTE_PRE_CADASTRO_REVISADO,
  type ClientePreCadastradoEvento,
  type ClientesPreCadastroSemErpSaida,
} from '@macuxi/core/contracts';
import { decidirEntradaClienteNaFila, type EstadoClienteNaFila } from '../domain';

/** Páginas da consulta por evento (100 clientes por página): um teto contra laço sem fim. */
const PAGINAS_MAX = 20;

export async function entrarClienteNaFila(e: Pick<ClientePreCadastradoEvento, 'cliente_id'>, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  let depois: string | null = null;
  let criados = 0;
  let reabertos = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const saida: ClientesPreCadastroSemErpSaida = await ctx.consultar(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, { limite: 100, depois_de: depois });
    const ids = saida.clientes.map((c) => c.cliente_id);
    // a linha atual de cada cliente da página, travada até o fim da transação (corrida entre dois consumidores)
    const { rows: atuais } = ids.length
      ? await ctx.db.query<{ cliente_uuid: string; revisao: number; estado: EstadoClienteNaFila }>(
          'select cliente_uuid, revisao, estado from integracao.cliente_fila_erp where tenant_id = $1 and cliente_uuid = any($2::uuid[]) and deleted_at is null for update',
          [tenantId, ids],
        )
      : { rows: [] };
    const porId = new Map(atuais.map((a) => [a.cliente_uuid, a]));
    for (const c of saida.clientes) {
      // revisao e hash ficam nas colunas (fonte do GET /clientes/pendentes), não no payload
      const { cliente_id, revisao: revisaoConsulta, hash: hashConsulta, ...resto } = c;
      const revisao = revisaoConsulta ?? 1;
      const hash = hashConsulta ?? null;
      const payload = JSON.stringify({ cliente_uuid: cliente_id, ...resto });
      const decisao = decidirEntradaClienteNaFila(porId.get(cliente_id) ?? null, { revisao });
      if (decisao === 'inserir') {
        const { rowCount } = await ctx.db.query(
          `insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, estado, payload, recebido_em, revisao, hash)
           values ($1, $2, 'pendente', $3::jsonb, $4::timestamptz, $5, $6) on conflict (tenant_id, cliente_uuid) do nothing`,
          [tenantId, cliente_id, payload, c.recebido_em, revisao, hash],
        );
        criados += rowCount ?? 0;
      } else if (decisao === 'reabrir') {
        // recebido_em fica o do primeiro recebimento (mantém a ordem da fila)
        const { rowCount } = await ctx.db.query(
          `update integracao.cliente_fila_erp
              set estado = 'pendente', revisao = $3, hash = $4, payload = $5::jsonb, tentativas = 0, enviado_em = null, motivo = null, erros = null
            where tenant_id = $1 and cliente_uuid = $2 and revisao < $3 and estado <> 'vinculado' and deleted_at is null`,
          [tenantId, cliente_id, revisao, hash, payload],
        );
        reabertos += rowCount ?? 0;
      }
    }
    if (saida.proximo === null) break;
    depois = saida.proximo;
  }
  ctx.log.info({ criados, reabertos, cliente_id: e.cliente_id }, 'pré-cadastro tratado na fila do ERP');
}

export const consumidorClientePreCadastrado = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_PRE_CADASTRADO), executar: entrarClienteNaFila });
export const consumidorClientePreCadastroRevisado = definirConsumidor({ evento: eventoTolerante(EVENTO_CLIENTE_PRE_CADASTRO_REVISADO), executar: entrarClienteNaFila });
