/**
 * Consulta de lotes no BKO `/v1/integracao` (monitor, `monitor.ver`): o resultado do lote e a lista paginada de erros por linha.
 *  - `GET lotes/:id`       → `LoteResultadoBko` (contagens, erros, inativação);
 *  - `GET lotes/:id/erros` → `ErrosLoteResposta` paginado (a gaveta de erros do monitor consome).
 * O lote chega pelo Conector ou pela API (`POST /lotes`); a carga por arquivo do BKO saiu na v1.0.22.
 */
import { ErroNaoEncontrado, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import type { z } from 'zod';
import { ErrosLoteQuery, ParamsLote, QueryConsultaLote, type ErrosLoteResposta, type LinhaErro, type LoteResultadoBko } from '../contracts';
import { lerResultadoLote } from './rotas-lotes';

export const rotaLote: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsLote,
  query: QueryConsultaLote,
  executar: async (ctx: ContextoRota<unknown, z.infer<typeof QueryConsultaLote>, z.infer<typeof ParamsLote>>): Promise<LoteResultadoBko> =>
    ctx.comTenant(async (db) => {
      const r = await lerResultadoLote(db, ctx.usuario.tenant_id, ctx.params.id, { limiteErros: ctx.query.limite_erros });
      if (!r) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote não encontrado. Atualize a lista em Integração ERP > Lotes.');
      return r;
    }),
};

async function loteExiste(db: ClienteBanco, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>('select id from integracao.lote where tenant_id = $1 and id = $2', [tenantId, id]);
  return rows.length > 0;
}

export const rotaErrosLote: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/:id/erros',
  acao: 'monitor.ver',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  params: ParamsLote,
  query: ErrosLoteQuery,
  executar: async (ctx: ContextoRota<unknown, z.infer<typeof ErrosLoteQuery>, z.infer<typeof ParamsLote>>): Promise<ErrosLoteResposta> => {
    const tenantId = ctx.usuario.tenant_id;
    const q = ctx.query;
    return ctx.comTenant(async (db) => {
      if (!(await loteExiste(db, tenantId, ctx.params.id))) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote não encontrado. Atualize a lista em Integração ERP > Lotes.');
      const filtros = [q.codigo ?? null, q.reprocessavel ?? null];
      const { rows: total } = await db.query<{ n: string }>(
        `select count(*)::text as n from integracao.lote_linha_erro
          where tenant_id = $1 and lote_id = $2 and ($3::text is null or codigo = $3) and ($4::boolean is null or reprocessavel = $4)`,
        [tenantId, ctx.params.id, ...filtros],
      );
      const { rows } = await db.query<LinhaErro>(
        `select indice, external_id, codigo, campo, mensagem, reprocessavel, origem from integracao.lote_linha_erro
          where tenant_id = $1 and lote_id = $2 and ($3::text is null or codigo = $3) and ($4::boolean is null or reprocessavel = $4)
          order by indice, origem limit $5 offset $6`,
        [tenantId, ctx.params.id, ...filtros, q.por_pagina, (q.pagina - 1) * q.por_pagina],
      );
      return { itens: rows, total: Number(total[0]?.n ?? 0) };
    });
  },
};
