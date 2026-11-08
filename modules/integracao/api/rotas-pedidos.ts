/**
 * Rotas do Conector para pedidos e sinal de vida (desenho T-0032 §4: A5, A6).
 *  - A5 `GET /pedidos/pendentes` (RN-INT-08): `for update skip locked`, `pendente → enviado`; só o Conector que recebe pedidos (P-7).
 *  - A5 `POST /pedidos/{uuid}/retorno` (RN-INT-08, P-4): uma transação; item faturado inválido NÃO recusa (200 + `itens_descartados`
 *    + `pedido_retorno_erro`); recusa só de pedido/estado/número (422). Evento `integracao.pedido.retorno_erp@1` na mesma transação.
 *  - A6 `POST /sinal` (RN-INT-11): grava o sinal e responde com a política de versão do tenant; liberada abaixo da mínima.
 */
import { ErroConector, type ContextoConector } from '@macuxi/platform-sdk';
import {
  CABECALHO_CONECTOR_VERSAO,
  ehCancelamentoRecusado,
  ParamsPedido,
  QueryPedidosPendentes,
  RetornoErp,
  type PedidosPendentes,
  type PoliticaVersaoConector,
  type RespostaSinal,
  type RetornoAceito,
  type SinalConector,
} from '../contracts';
import { aplicarCancelamentoRecusado, aplicarRetornoPedido, conectorAtendePedido, selecionarCancelamentos, selecionarPendentes, versaoInformada, type PedidoNaFila } from '../domain';
import { COLUNAS_CANCELAMENTO, paraCancelar } from './consumidores-pedido';
import type { ConectorHub } from './autenticacao';
import { EVENTO_PEDIDO_CANCELAMENTO_RECUSADO, EVENTO_PEDIDO_RETORNO_ERP } from './eventos';
import { lerParametrosHub } from './parametros';

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoConector<ConectorHub, C, Q, P>;

const iso = (v: Date | string | null | undefined): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export interface LinhaFila {
  pedido_uuid: string;
  estado: PedidoNaFila['estado'];
  payload: PedidoNaFila['payload'];
  enviado_em: Date | null;
  tentativas: number;
  numero_erp: string | null;
  motivo: string | null;
  notas_aplicadas: PedidoNaFila['notas_aplicadas'];
  itens_faturados_acumulados: PedidoNaFila['itens_faturados_acumulados'];
  retencao_codigo: PedidoNaFila['retencao_codigo'];
  retencao_mensagem?: string | null;
  deleted_at: Date | null;
}

export const naFila = (l: LinhaFila): PedidoNaFila => ({
  pedido_uuid: l.pedido_uuid,
  estado: l.estado,
  payload: l.payload,
  retencao_codigo: l.retencao_codigo,
  ...(l.retencao_mensagem !== undefined ? { retencao_mensagem: l.retencao_mensagem } : {}),
  enviado_em: iso(l.enviado_em),
  tentativas: l.tentativas,
  numero_erp: l.numero_erp,
  motivo: l.motivo,
  notas_aplicadas: l.notas_aplicadas ?? [],
  itens_faturados_acumulados: l.itens_faturados_acumulados ?? {},
  removido_em: iso(l.deleted_at),
});

const acessoNegadoSemPedidos = () =>
  new ErroConector(403, { codigo: 'acesso_negado', mensagem: 'Este Conector não recebe pedidos (na v1 só um Conector por empresa recebe os pedidos aprovados). Ajuste em Integração ERP > Conectores.' });

// ---------------------------------------------------------------------------------------------------------------- GET /pedidos/pendentes

export async function pedidosPendentes(ctx: Ctx<unknown, ReturnType<typeof QueryPedidosPendentes.parse>>): Promise<PedidosPendentes> {
  if (!ctx.conector.recebe_pedidos) throw acessoNegadoSemPedidos();
  const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
  const limite = Math.min(ctx.query.limite, parametros.pedidosPorConsulta);
  const agora = ctx.agora().toISOString();
  const versaoConector = versaoInformada(ctx.cabecalhos?.[CABECALHO_CONECTOR_VERSAO.toLowerCase()], null);
  return ctx.comTenant(async (db) => {
    // ADR 0016: pedido que exige Conector mais novo fica na fila (sem travar os demais do `limit`); o alerta do monitor avisa
    const { rows: exigencias } = await db.query<{ exige_conector: string }>(
      "select distinct exige_conector from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null and estado in ('pendente', 'enviado') and exige_conector is not null",
      [ctx.tenantId],
    );
    const bloqueadas = exigencias.map((e) => e.exige_conector).filter((e) => !conectorAtendePedido(versaoConector, e));
    // pendentes + enviados vencidos (reentrega por timeout); quem outra consulta já travou fica de fora (skip locked)
    const { rows } = await db.query<LinhaFila>(
      `select pedido_uuid, estado, payload, enviado_em, tentativas, numero_erp, motivo, notas_aplicadas, itens_faturados_acumulados, retencao_codigo, deleted_at
         from integracao.pedido_fila_erp
        where tenant_id = $1 and deleted_at is null and retencao_codigo is null and payload is not null
          and (exige_conector is null or not (exige_conector = any($5::text[])))
          and (estado = 'pendente' or (estado = 'enviado' and enviado_em <= $2::timestamptz - ($3::float8 * interval '1 minute')))
        order by aprovado_em, pedido_uuid
        limit $4
        for update skip locked`,
      [ctx.tenantId, agora, parametros.timeoutEnvioMin, limite, bloqueadas],
    );
    // o domain repete o filtro pelo conteúdo do payload (linha antiga sem `exige_conector` gravado)
    const sel = selecionarPendentes(rows.map(naFila), agora, { limite, timeoutMin: parametros.timeoutEnvioMin, versaoConector });
    for (const a of sel.atualizacoes) {
      await db.query(
        `update integracao.pedido_fila_erp set estado = $3, enviado_em = $4, tentativas = $5, conector_id = $6 where tenant_id = $1 and pedido_uuid = $2`,
        [ctx.tenantId, a.pedido_uuid, a.estado, a.enviado_em, a.tentativas, ctx.conector.id],
      );
    }
    if (sel.entregar.length > 0) ctx.log.info({ entregues: sel.entregar.length, reenviados: sel.reenviados.length }, 'pedidos entregues ao Conector');
    // T-0114: cancelamentos so para o Conector que aceita (nada muda para os demais; o campo nem aparece)
    const { rows: cfg } = await db.query<{ aceita_cancelamento: boolean }>('select aceita_cancelamento from integracao.conector where tenant_id = $1 and id = $2', [ctx.tenantId, ctx.conector.id]);
    if (cfg[0]?.aceita_cancelamento !== true) return { pedidos: sel.entregar };
    const { rows: pend } = await db.query<Parameters<typeof paraCancelar>[0]>(
      `select ${COLUNAS_CANCELAMENTO} from integracao.pedido_fila_erp
        where tenant_id = $1 and deleted_at is null and estado <> 'cancelado' and cancelamento_estado in ('pendente', 'enviado')
        order by cancelamento_solicitado_em, pedido_uuid limit $2 for update skip locked`,
      [ctx.tenantId, limite],
    );
    const canc = selecionarCancelamentos(pend.map(paraCancelar), agora, { limite, timeoutMin: parametros.timeoutEnvioMin });
    for (const a of canc.atualizacoes) {
      await db.query(
        `update integracao.pedido_fila_erp set cancelamento_estado = 'enviado', cancelamento_enviado_em = $3, cancelamento_tentativas = $4 where tenant_id = $1 and pedido_uuid = $2`,
        [ctx.tenantId, a.pedido_uuid, a.cancelamento_enviado_em, a.cancelamento_tentativas],
      );
    }
    if (canc.entregar.length > 0) ctx.log.info({ cancelamentos: canc.entregar.length }, 'cancelamentos entregues ao Conector');
    return canc.entregar.length > 0 ? { pedidos: sel.entregar, cancelamentos: canc.entregar } : { pedidos: sel.entregar };
  });
}

// ---------------------------------------------------------------------------------------------------------------- POST /pedidos/{uuid}/retorno

export async function retornoPedido(ctx: Ctx<RetornoErp, unknown, ReturnType<typeof ParamsPedido.parse>>): Promise<RetornoAceito> {
  const retorno = ctx.corpo;
  if (retorno.pedido_uuid !== ctx.params.pedido_uuid) {
    throw new ErroConector(400, {
      codigo: 'requisicao_invalida',
      mensagem: 'O pedido_uuid do corpo não é o da URL. Envie o retorno em /pedidos/{pedido_uuid}/retorno com o mesmo pedido.',
      erros: [{ codigo: 'pedido_uuid_divergente', campo: 'pedido_uuid', mensagem: 'pedido_uuid do corpo diferente do da URL' }],
    });
  }
  if (!ctx.conector.recebe_pedidos) throw acessoNegadoSemPedidos();

  if (ehCancelamentoRecusado(retorno)) return cancelamentoRecusado(ctx, retorno);

  return ctx.comTenant(async (db, tx) => {
    const { rows } = await db.query<LinhaFila>(
      `select pedido_uuid, estado, payload, enviado_em, tentativas, numero_erp, motivo, notas_aplicadas, itens_faturados_acumulados, retencao_codigo, deleted_at
         from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2 for update`,
      [ctx.tenantId, retorno.pedido_uuid],
    );
    const r = aplicarRetornoPedido(rows[0] ? naFila(rows[0]) : null, retorno);
    if (!r.ok) {
      throw new ErroConector(422, { codigo: r.codigo, mensagem: r.mensagem, erros: r.erros });
    }
    const nota = retorno.nota ?? null;
    const notaNumero = nota?.numero.trim() ?? null;
    const notaSerie = nota?.serie?.trim() || null;

    if (!r.repetido) {
      const a = r.atualizacao;
      await db.query(
        `update integracao.pedido_fila_erp set
           cancelamento_estado = case when $3 = 'cancelado' and cancelamento_estado is not null then 'confirmado' else cancelamento_estado end,
           estado = $3, numero_erp = $4, motivo = $5, notas_aplicadas = $6::jsonb, itens_faturados_acumulados = $7::jsonb,
           ultimo_retorno_em = $8, conector_id = $9,
           nota_numero = case when $10::boolean then $11 else nota_numero end,
           nota_serie = case when $10::boolean then $12 else nota_serie end,
           nota_emitida_em = case when $10::boolean then $13::timestamptz else nota_emitida_em end,
           nota_total_cents = case when $10::boolean then $14::bigint else nota_total_cents end
         where tenant_id = $1 and pedido_uuid = $2`,
        [
          ctx.tenantId,
          retorno.pedido_uuid,
          a.estado,
          a.numero_erp,
          a.motivo,
          JSON.stringify(a.notas_aplicadas),
          JSON.stringify(a.itens_faturados_acumulados),
          a.ultimo_retorno_em,
          ctx.conector.id,
          nota !== null,
          notaNumero,
          notaSerie,
          nota?.emitida_em ?? null,
          nota?.total_cents ?? null,
        ],
      );
    }

    // trilha do retorno (segunda guarda da idempotência: único por pedido, status e nota) — só se não repetido
    let retornoId: string | null = null;
    if (!r.repetido) {
      const { rows: t } = await db.query<{ id: string }>(
        `insert into integracao.pedido_retorno
           (tenant_id, pedido_uuid, status, numero_erp, motivo, nota_numero, nota_serie, nota_emitida_em, nota_total_cents, itens_faturados, ocorrido_em, conector_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         on conflict do nothing
         returning id`,
        [
          ctx.tenantId,
          retorno.pedido_uuid,
          retorno.status,
          r.atualizacao.numero_erp,
          retorno.motivo?.trim() || null,
          notaNumero,
          notaSerie,
          nota?.emitida_em ?? null,
          nota?.total_cents ?? null,
          r.evento.itens_faturados ? JSON.stringify(r.evento.itens_faturados) : null,
          retorno.ocorrido_em,
          ctx.conector.id,
        ],
      );
      retornoId = t[0]?.id ?? null;
    }

    // P-4: um erro por item descartado (monitor e alerta das últimas 24 h)
    for (const e of r.erros_monitor) {
      await db.query(
        `insert into integracao.pedido_retorno_erro
           (tenant_id, pedido_uuid, pedido_retorno_id, status, numero_erp, nota_numero, nota_serie, ocorrido_em, indice, sequencia,
            produto_external_id, quantidade, codigo, codigos, campo, motivo, conector_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text[], $15, $16, $17)`,
        [
          ctx.tenantId,
          e.pedido_uuid,
          retornoId,
          e.status,
          e.numero_erp,
          e.nota_numero,
          e.nota_serie,
          e.ocorrido_em,
          e.indice,
          e.sequencia,
          e.produto_external_id,
          e.quantidade,
          e.codigo,
          e.codigos,
          e.campo.slice(0, 200),
          e.motivo.slice(0, 1000),
          ctx.conector.id,
        ],
      );
    }

    if (r.publicar) await tx.publicar(EVENTO_PEDIDO_RETORNO_ERP, r.evento, retorno.pedido_uuid);
    if (r.itens_descartados.length > 0) ctx.log.warn({ pedido_uuid: retorno.pedido_uuid, descartados: r.itens_descartados.length }, 'retorno aceito com itens faturados descartados');

    return {
      pedido_uuid: retorno.pedido_uuid,
      status: r.atualizacao.estado,
      repetido: r.repetido,
      ...(r.itens_descartados.length > 0 ? { itens_descartados: r.itens_descartados } : {}),
    } as RetornoAceito;
  });
}

/**
 * T-0114: `cancelamento_recusado` — o ERP recusou o cancelamento pedido. Não muda o estado do pedido nem entra em `pedido_retorno`
 * nem no evento `retorno_erp@1`: grava a recusa na linha da fila e publica `integracao.pedido.cancelamento_recusado@1` na mesma transação.
 */
async function cancelamentoRecusado(ctx: Ctx<RetornoErp, unknown, ReturnType<typeof ParamsPedido.parse>>, retorno: RetornoErp): Promise<RetornoAceito> {
  return ctx.comTenant(async (db, tx) => {
    const { rows } = await db.query<Parameters<typeof paraCancelar>[0] & { cancelamento_recusa_motivo: string | null; estado: PedidoNaFila['estado'] }>(
      `select ${COLUNAS_CANCELAMENTO}, cancelamento_recusa_motivo from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2 for update`,
      [ctx.tenantId, retorno.pedido_uuid],
    );
    const linha = rows[0];
    const r = aplicarCancelamentoRecusado(linha ? { ...paraCancelar(linha), cancelamento_recusa_motivo: linha.cancelamento_recusa_motivo } : null, { motivo: retorno.motivo, ocorrido_em: retorno.ocorrido_em });
    if (!r.ok) throw new ErroConector(422, { codigo: r.codigo, mensagem: r.mensagem, erros: [{ codigo: r.codigo, campo: null, mensagem: r.mensagem }] });
    if (!r.repetido) {
      await db.query(
        `update integracao.pedido_fila_erp set cancelamento_estado = 'recusado', cancelamento_recusa_motivo = $3, cancelamento_recusado_em = $4::timestamptz, conector_id = $5
          where tenant_id = $1 and pedido_uuid = $2`,
        [ctx.tenantId, retorno.pedido_uuid, r.atualizacao.cancelamento_recusa_motivo, r.atualizacao.cancelamento_recusado_em, ctx.conector.id],
      );
      await tx.publicar(EVENTO_PEDIDO_CANCELAMENTO_RECUSADO, r.evento, retorno.pedido_uuid);
      ctx.log.warn({ pedido_uuid: retorno.pedido_uuid }, 'o ERP recusou o cancelamento do pedido');
    }
    return { pedido_uuid: retorno.pedido_uuid, status: linha?.estado ?? 'integrado', repetido: r.repetido } as RetornoAceito;
  });
}

// ---------------------------------------------------------------------------------------------------------------- POST /sinal

export async function sinalDeVida(ctx: Ctx<SinalConector>, politica: PoliticaVersaoConector | null | undefined): Promise<RespostaSinal> {
  const s = ctx.corpo;
  const agora = ctx.agora();
  const deriva = Math.round((agora.getTime() - Date.parse(s.em)) / 1000);
  await ctx.comTenant((db) =>
    db.query(
      `update integracao.conector set versao_conector = $3, versao_contrato = $4, ultimo_sinal_em = $5, parado_por_versao = $6,
              sinal_resumo = $7::jsonb, deriva_relogio_s = $8
        where tenant_id = $1 and id = $2`,
      [
        ctx.tenantId,
        ctx.conector.id,
        s.versao_conector.slice(0, 40),
        s.versao_contrato.slice(0, 10),
        agora.toISOString(),
        s.parado_por_versao === true,
        JSON.stringify({ fila: s.fila, entidades: s.entidades }),
        Number.isSafeInteger(deriva) && Math.abs(deriva) < 2_000_000_000 ? deriva : null,
      ],
    ),
  );
  return {
    ...(politica ? { politica_versao: politica } : {}),
    conector_id: ctx.conector.identificador,
    recebido_em: agora.toISOString(),
  };
}
