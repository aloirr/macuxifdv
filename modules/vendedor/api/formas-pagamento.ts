/**
 * Formas de pagamento e prazos no BKO, só consulta (`GET /v1/vendedor/formas-pagamento`; RN-VEN-24, ADR 0072) e a consulta
 * `vendedor.formas_pagamento@1` (ADR 0019) para a ficha do cliente do Core. Multi-tenant por RLS. Formas e prazos vêm só do ERP
 * pelo Hub (`formas-erp.ts`): as rotas PUT de forma e prazo respondem 403 `FORMAS_DO_ERP`.
 */
import { ErroHttpModulo, implementarConsulta, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CONSULTA_FORMAS_PAGAMENTO, type FormaPagamento, type PrazoPagamento } from '../contracts';
import { COLUNA_PERCENTUAL_AJUSTE } from './pagamento';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const COLUNAS_FORMA = `id, codigo, nome, ativo, ordem, external_id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at`;
const COLUNAS_PRAZO = `id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ${COLUNA_PERCENTUAL_AJUSTE}, ativo, ordem, external_id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at`;
const ParamsId = z.object({ id: z.string().uuid() });

/** GET /v1/vendedor/formas-pagamento — formas e prazos do tenant (ativos e inativos), por ordem. */
export const rotaListarFormasEPrazos: RotaModulo = {
  metodo: 'GET',
  caminho: 'formas-pagamento',
  acao: 'forma_pagamento.ver',
  carteira: 'nao_se_aplica',
  executar: (ctx) =>
    ctx.comTenant(async (db) => ({
      formas: (await db.query<FormaPagamento>(`select ${COLUNAS_FORMA} from vendedor.forma_pagamento where deleted_at is null order by ordem, codigo`)).rows,
      prazos: (await db.query<PrazoPagamento>(`select ${COLUNAS_PRAZO} from vendedor.prazo_pagamento where deleted_at is null order by ordem, codigo`)).rows,
    })),
};

const MSG_FORMAS_DO_ERP = 'Formas e prazos vêm do ERP. Altere no ERP e aguarde a próxima sincronização.';

/** ADR 0072: o BKO só consulta; a escrita de forma e prazo é recusada com 403 `FORMAS_DO_ERP` (a fonte é o ERP, pelo Hub). */
const recusarEscrita = (caminho: string): RotaModulo => ({
  metodo: 'PUT',
  caminho,
  acao: 'forma_pagamento.ver',
  carteira: 'nao_se_aplica',
  params: ParamsId,
  executar: () => {
    throw new ErroHttpModulo(403, 'FORMAS_DO_ERP', MSG_FORMAS_DO_ERP);
  },
});

/** PUT /v1/vendedor/formas-pagamento/:id — recusada (ADR 0072). */
export const rotaSalvarForma: RotaModulo = recusarEscrita('formas-pagamento/:id');
/** PUT /v1/vendedor/prazos-pagamento/:id — recusada (ADR 0072). */
export const rotaSalvarPrazo: RotaModulo = recusarEscrita('prazos-pagamento/:id');

export const rotasFormasPagamento: RotaModulo[] = [rotaListarFormasEPrazos, rotaSalvarForma, rotaSalvarPrazo];

/** Consulta `vendedor.formas_pagamento@1` (ADR 0019): só código, nome e situação das formas, para a ficha do cliente do Core. */
export const consultaFormasPagamento = implementarConsulta(CONSULTA_FORMAS_PAGAMENTO, async (_entrada, ctx) => {
  const r = await ctx.db.query<{ codigo: string; nome: string; ativo: boolean }>(
    'select codigo, nome, ativo from vendedor.forma_pagamento where deleted_at is null order by ordem, codigo limit 200',
  );
  return { formas: r.rows };
});
