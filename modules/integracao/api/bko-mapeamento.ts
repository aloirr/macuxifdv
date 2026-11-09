/**
 * De-para de códigos ERP ↔ Macuxi no BKO (T-0120, RN-INT-08; hub-api.md A9): `GET/PUT/DELETE /v1/integracao/mapeamentos` e
 * `POST /v1/integracao/pedidos/reprocessar-retidos`. Ler é do monitor (`monitor.ver`); gravar, apagar e reprocessar é
 * `mapeamento.editar` (admin ou analista, pelo manifesto/motor de permissões; a API revalida no domain). Gravar a condição de
 * pagamento reavalia os pedidos RETIDOS por falta de de-para na mesma transação: os que passam a montar entram na fila.
 * O monitor da página mostra as condições sem correspondente (o que cadastrar) a partir dos próprios pedidos retidos.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { Mapeamento, type GravarMapeamentoResposta, type MapeamentoItem, type MapeamentosResposta } from '../contracts';
import { condicoesSemCorrespondente, liberarRetidosPorMapeamento, validarMapeamento, exigeConector, type MapeamentoGravado, type PedidoRetido } from '../domain';
import { iso } from './bko-comum';

const Params = z.object({ id: z.string().uuid('UUID inválido') });

interface LinhaMapeamento {
  id: string;
  tipo: MapeamentoItem['tipo'];
  codigo_erp: string;
  codigo_macuxi: string;
  descricao: string | null;
  ativo: boolean;
  updated_at: Date;
}

const COLUNAS = 'id, tipo, codigo_erp, codigo_macuxi, descricao, ativo, updated_at';
const item = (l: LinhaMapeamento): MapeamentoItem => ({ id: l.id, tipo: l.tipo, codigo_erp: l.codigo_erp, codigo_macuxi: l.codigo_macuxi, descricao: l.descricao, ativo: l.ativo, atualizado_em: iso(l.updated_at) as string });

async function lerMapeamentos(db: ClienteBanco, tenantId: string): Promise<LinhaMapeamento[]> {
  const { rows } = await db.query<LinhaMapeamento>(`select ${COLUNAS} from integracao.mapeamento where tenant_id = $1 and deleted_at is null order by tipo, codigo_erp`, [tenantId]);
  return rows;
}

async function lerRetidos(db: ClienteBanco, tenantId: string): Promise<PedidoRetido[]> {
  const { rows } = await db.query<{ pedido_uuid: string; payload_origem: PedidoRetido['origem'] }>(
    `select pedido_uuid, payload_origem from integracao.pedido_fila_erp
      where tenant_id = $1 and deleted_at is null and payload is null and payload_origem is not null
        and retencao_codigo in ('mapeamento_ausente', 'mapeamento_ambiguo') and estado = 'pendente' and tentativas = 0
      order by aprovado_em nulls last, pedido_uuid limit 1000`,
    [tenantId],
  );
  return rows.map((r) => ({ pedido_uuid: r.pedido_uuid, origem: r.payload_origem }));
}

const paraGravado = (l: LinhaMapeamento): MapeamentoGravado => ({ id: l.id, tipo: l.tipo, codigo_erp: l.codigo_erp, codigo_macuxi: l.codigo_macuxi, ativo: l.ativo });

/** Reavalia os retidos com o de-para atual: libera os que montam e atualiza o motivo dos que continuam. Devolve quantos saíram da retenção. */
export async function reprocessarRetidos(db: ClienteBanco, tenantId: string): Promise<number> {
  const mapas = (await lerMapeamentos(db, tenantId)).map(paraGravado);
  const r = liberarRetidosPorMapeamento(await lerRetidos(db, tenantId), mapas);
  for (const l of r.liberados) {
    await db.query(
      `update integracao.pedido_fila_erp set payload = $3::jsonb, retencao_codigo = null, retencao_mensagem = null, exige_conector = $4
        where tenant_id = $1 and pedido_uuid = $2 and payload is null and deleted_at is null`,
      [tenantId, l.pedido_uuid, JSON.stringify(l.pedido), exigeConector(l.pedido)],
    );
  }
  for (const c of r.continuamRetidos) {
    await db.query(
      `update integracao.pedido_fila_erp set retencao_codigo = $3, retencao_mensagem = $4
        where tenant_id = $1 and pedido_uuid = $2 and payload is null and deleted_at is null and (retencao_codigo is distinct from $3 or retencao_mensagem is distinct from $4)`,
      [tenantId, c.pedido_uuid, c.codigo, c.mensagem],
    );
  }
  return r.liberados.length;
}

export const rotaListarMapeamentos: RotaModulo = {
  metodo: 'GET',
  caminho: 'mapeamentos',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  executar: async (ctx: ContextoRota): Promise<MapeamentosResposta> =>
    ctx.comTenant(async (db) => {
      const tenantId = ctx.usuario.tenant_id;
      const linhas = await lerMapeamentos(db, tenantId);
      return { itens: linhas.map(item), condicoes_sem_correspondente: condicoesSemCorrespondente(await lerRetidos(db, tenantId), linhas.map(paraGravado)) };
    }),
};

export const rotaGravarMapeamento: RotaModulo = {
  metodo: 'PUT',
  caminho: 'mapeamentos',
  acao: 'mapeamento.editar',
  carteira: 'nao_se_aplica',
  corpo: Mapeamento,
  executar: async (ctx: ContextoRota<Mapeamento>): Promise<GravarMapeamentoResposta> => {
    const tenantId = ctx.usuario.tenant_id;
    const e = ctx.corpo;
    return ctx.comTenant(async (db, tx) => {
      const existentes = await lerMapeamentos(db, tenantId);
      const v = validarMapeamento(e, existentes.map(paraGravado));
      if (!v.ok) throw new ErroRegraNegocio('RN-INT-08', v.mensagem);
      const descricao = e.descricao?.trim() ? e.descricao.trim() : null;
      let linha: LinhaMapeamento | undefined;
      if (v.acao === 'criar') {
        linha = (
          await db.query<LinhaMapeamento>(
            `insert into integracao.mapeamento (tenant_id, tipo, codigo_erp, codigo_macuxi, descricao, ativo) values ($1, $2, $3, $4, $5, $6) returning ${COLUNAS}`,
            [tenantId, e.tipo, e.codigo_erp, e.codigo_macuxi, descricao, e.ativo],
          )
        ).rows[0];
      } else {
        linha = (
          await db.query<LinhaMapeamento>(
            `update integracao.mapeamento set codigo_macuxi = $3, descricao = $4, ativo = $5 where tenant_id = $1 and id = $2 and deleted_at is null returning ${COLUNAS}`,
            [tenantId, v.id, e.codigo_macuxi, descricao, e.ativo],
          )
        ).rows[0];
      }
      if (!linha) throw new ErroNaoEncontrado('MAPEAMENTO_NAO_ENCONTRADO', 'O de-para não existe mais. Atualize a lista em Integração ERP > Mapeamento.');
      await tx.auditar({
        acao: v.acao === 'criar' ? 'mapeamento.criar' : 'mapeamento.atualizar',
        entidade: 'mapeamento',
        entidade_id: linha.id,
        depois: { tipo: e.tipo, codigo_erp: e.codigo_erp, codigo_macuxi: e.codigo_macuxi, ativo: e.ativo },
      });
      const liberados = e.tipo === 'condicao_pagamento' ? await reprocessarRetidos(db, tenantId) : 0;
      return { item: item(linha), pedidos_liberados: liberados };
    });
  },
};

export const rotaApagarMapeamento: RotaModulo = {
  metodo: 'DELETE',
  caminho: 'mapeamentos/:id',
  acao: 'mapeamento.editar',
  carteira: 'nao_se_aplica',
  params: Params,
  executar: async (ctx: ContextoRota<unknown, unknown, z.infer<typeof Params>>): Promise<{ apagado: true }> => {
    const tenantId = ctx.usuario.tenant_id;
    return ctx.comTenant(async (db, tx) => {
      const { rows } = await db.query<LinhaMapeamento>(
        `update integracao.mapeamento set deleted_at = now() where tenant_id = $1 and id = $2 and deleted_at is null returning ${COLUNAS}`,
        [tenantId, ctx.params.id],
      );
      const l = rows[0];
      if (!l) throw new ErroNaoEncontrado('MAPEAMENTO_NAO_ENCONTRADO', 'O de-para não existe mais. Atualize a lista em Integração ERP > Mapeamento.');
      await tx.auditar({ acao: 'mapeamento.apagar', entidade: 'mapeamento', entidade_id: l.id, antes: { tipo: l.tipo, codigo_erp: l.codigo_erp, codigo_macuxi: l.codigo_macuxi, ativo: l.ativo } });
      return { apagado: true as const };
    });
  },
};

export const rotaReprocessarRetidos: RotaModulo = {
  metodo: 'POST',
  caminho: 'pedidos/reprocessar-retidos',
  acao: 'mapeamento.editar',
  carteira: 'nao_se_aplica',
  executar: async (ctx: ContextoRota): Promise<{ pedidos_liberados: number }> =>
    ctx.comTenant(async (db, tx) => {
      const n = await reprocessarRetidos(db, ctx.usuario.tenant_id);
      await tx.auditar({ acao: 'mapeamento.reprocessar_retidos', entidade: 'pedido_fila_erp', entidade_id: null, depois: { pedidos_liberados: n } });
      return { pedidos_liberados: n };
    }),
};
