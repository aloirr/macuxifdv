/**
 * Rotas do Conector para o cliente novo (RN-INT-22; mesmo padrão dos pedidos, RN-INT-08).
 *  - `GET /clientes/pendentes`: `for update skip locked`, `pendente → enviado`, reentrega do `enviado` vencido; só o Conector que recebe pedidos.
 *  - `POST /clientes/{uuid}/retorno`: uma transação; grava o código (`external_id`) ou a rejeição na fila, idempotente, e publica
 *    `integracao.cliente.retorno_erp@1` (o Core consome e grava o código).
 *  - v1.0.30 (ADR 0069): o GET entrega `revisao` e `hash` das colunas; o retorno informa a revisão (recusa de revisão antiga = 200
 *    `obsoleto`, sem gravar; código de revisão antiga vale) e, na recusa, os erros por campo (mascarados no domain). Motivo, erros e hash
 *    nunca vão a log.
 */
import { ErroConector, type ContextoConector } from '@macuxi/platform-sdk';
import { type ClientesPendentes, ParamsCliente, type QueryClientesPendentes, type RetornoCliente, type RetornoClienteAceito } from '../contracts';
import { aplicarRetornoCliente, selecionarClientesPendentes, type ClienteNaFila, type ErroRetornoCliente } from '../domain';
import type { ConectorHub } from './autenticacao';
import { iso } from './bko-comum';
import { EVENTO_CLIENTE_RETORNO_ERP } from './eventos';
import { lerParametrosHub } from './parametros';

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoConector<ConectorHub, C, Q, P>;

export interface LinhaClienteFila {
  cliente_uuid: string;
  estado: ClienteNaFila['estado'];
  payload: Record<string, unknown>;
  recebido_em: Date | string;
  enviado_em: Date | string | null;
  tentativas: number;
  external_id: string | null;
  motivo: string | null;
  deleted_at: Date | string | null;
  revisao: number;
  hash: string | null;
  erros: ErroRetornoCliente[] | null;
}

export const clienteNaFila = (l: LinhaClienteFila): ClienteNaFila => ({
  cliente_uuid: l.cliente_uuid,
  estado: l.estado,
  payload: l.payload,
  recebido_em: iso(l.recebido_em)!,
  enviado_em: iso(l.enviado_em),
  tentativas: l.tentativas,
  external_id: l.external_id,
  motivo: l.motivo,
  removido_em: iso(l.deleted_at),
  revisao: l.revisao,
  hash: l.hash,
  erros: l.erros,
});

const COLUNAS = 'cliente_uuid, estado, payload, recebido_em, enviado_em, tentativas, external_id, motivo, deleted_at, revisao, hash, erros';

const acessoNegado = () =>
  new ErroConector(403, { codigo: 'acesso_negado', mensagem: 'Este Conector não recebe clientes novos (na v1 só o Conector que recebe os pedidos aprovados também recebe os clientes). Ajuste em Integração ERP > Conectores.' });

export async function clientesPendentes(ctx: Ctx<unknown, QueryClientesPendentes>): Promise<ClientesPendentes> {
  if (!ctx.conector.recebe_pedidos) throw acessoNegado();
  const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
  const limite = Math.min(ctx.query.limite, parametros.pedidosPorConsulta);
  const agora = ctx.agora().toISOString();
  return ctx.comTenant(async (db) => {
    // pendentes + enviados vencidos (reentrega por timeout); quem outra consulta já travou fica de fora (skip locked)
    const { rows } = await db.query<LinhaClienteFila>(
      `select ${COLUNAS} from integracao.cliente_fila_erp
        where tenant_id = $1 and deleted_at is null
          and (estado = 'pendente' or (estado = 'enviado' and enviado_em <= $2::timestamptz - ($3::float8 * interval '1 minute')))
        order by recebido_em, cliente_uuid
        limit $4
        for update skip locked`,
      [ctx.tenantId, agora, parametros.timeoutEnvioMin, limite],
    );
    const sel = selecionarClientesPendentes(rows.map(clienteNaFila), agora, { limite, timeoutMin: parametros.timeoutEnvioMin });
    for (const a of sel.atualizacoes) {
      await db.query(
        'update integracao.cliente_fila_erp set estado = $3, enviado_em = $4, tentativas = $5, conector_id = $6 where tenant_id = $1 and cliente_uuid = $2',
        [ctx.tenantId, a.cliente_uuid, a.estado, a.enviado_em, a.tentativas, ctx.conector.id],
      );
    }
    if (sel.entregar.length > 0) ctx.log.info({ entregues: sel.entregar.length, reenviados: sel.reenviados.length }, 'clientes entregues ao Conector');
    return { clientes: sel.entregar } as ClientesPendentes;
  });
}

export async function retornoCliente(ctx: Ctx<RetornoCliente, unknown, ReturnType<typeof ParamsCliente.parse>>): Promise<RetornoClienteAceito> {
  const retorno = ctx.corpo;
  if (retorno.cliente_uuid !== ctx.params.cliente_uuid) {
    throw new ErroConector(400, {
      codigo: 'requisicao_invalida',
      mensagem: 'O cliente_uuid do corpo não é o da URL. Envie o retorno em /clientes/{cliente_uuid}/retorno com o mesmo cliente.',
      erros: [{ codigo: 'cliente_uuid_divergente', campo: 'cliente_uuid', mensagem: 'cliente_uuid do corpo diferente do da URL' }],
    });
  }
  if (!ctx.conector.recebe_pedidos) throw acessoNegado();

  return ctx.comTenant(async (db, tx) => {
    const { rows } = await db.query<LinhaClienteFila>(`select ${COLUNAS} from integracao.cliente_fila_erp where tenant_id = $1 and cliente_uuid = $2 for update`, [ctx.tenantId, retorno.cliente_uuid]);
    const linha = rows[0] ? clienteNaFila(rows[0]) : null;
    const r = aplicarRetornoCliente(linha, retorno);
    if (!r.ok) throw new ErroConector(422, { codigo: r.codigo, mensagem: r.mensagem, erros: r.erros });
    if (r.gravar) {
      await db.query(
        'update integracao.cliente_fila_erp set estado = $3, external_id = $4, motivo = $5, erros = $6::jsonb, conector_id = $7 where tenant_id = $1 and cliente_uuid = $2',
        [ctx.tenantId, retorno.cliente_uuid, r.atualizacao.estado, r.atualizacao.external_id, r.atualizacao.motivo, r.atualizacao.erros ? JSON.stringify(r.atualizacao.erros) : null, ctx.conector.id],
      );
    }
    if (r.publicar) await tx.publicar(EVENTO_CLIENTE_RETORNO_ERP, r.evento, retorno.cliente_uuid);
    // sem motivo, erros nem hash (regra 8)
    ctx.log.info({ cliente_uuid: retorno.cliente_uuid, revisao: r.evento.revisao, status: retorno.status, repetido: r.repetido, obsoleto: r.obsoleto }, 'retorno do cliente aplicado');
    return {
      cliente_uuid: retorno.cliente_uuid,
      estado: r.gravar ? r.atualizacao.estado : linha!.estado,
      repetido: r.repetido,
      revisao: r.revisao,
      ...(r.obsoleto ? { obsoleto: true as const } : {}),
    };
  });
}
