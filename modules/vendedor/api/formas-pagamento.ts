/**
 * Formas de pagamento e prazos no BKO (`/v1/vendedor/formas-pagamento`, `/v1/vendedor/prazos-pagamento`; RN-VEN-24, T-0089)
 * e a consulta `vendedor.formas_pagamento@1` (ADR 0019) para a ficha do cliente do Core. Multi-tenant por RLS; escrita
 * idempotente (o `id` vem do BKO, regra 4) e auditada; sem exclusão física: inativar. O `prazo_medio_dias` é calculado aqui
 * (`prazoMedioDias`, arredondado para cima) e gravado; o banco só confere a faixa. Registro vindo do ERP (`external_id`) não
 * muda código nem parcelas. Quem inativa a forma não apaga os prazos: o pedido antigo guarda o retrato.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, implementarConsulta, type ClienteBanco, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CONSULTA_FORMAS_PAGAMENTO, SalvarFormaRequest, SalvarPrazoRequest, type FormaPagamento, type PrazoPagamento } from '../contracts';
import { descricaoPrazo, prazoMedioDias } from '../domain';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const COLUNAS_FORMA = `id, codigo, nome, ativo, ordem, external_id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at`;
const COLUNAS_PRAZO = `id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem, external_id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at`;
const ParamsId = z.object({ id: z.string().uuid() });

async function lerForma(db: ClienteBanco, id: string): Promise<FormaPagamento | null> {
  return (await db.query<FormaPagamento>(`select ${COLUNAS_FORMA} from vendedor.forma_pagamento where id = $1 and deleted_at is null`, [id])).rows[0] ?? null;
}
async function lerPrazo(db: ClienteBanco, id: string): Promise<PrazoPagamento | null> {
  return (await db.query<PrazoPagamento>(`select ${COLUNAS_PRAZO} from vendedor.prazo_pagamento where id = $1 and deleted_at is null`, [id])).rows[0] ?? null;
}

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

/** PUT /v1/vendedor/formas-pagamento/:id — cria ou edita (idempotente pelo `id`). */
export const rotaSalvarForma: RotaModulo = {
  metodo: 'PUT',
  caminho: 'formas-pagamento/:id',
  acao: 'forma_pagamento.gerenciar',
  carteira: 'nao_se_aplica',
  params: ParamsId,
  corpo: SalvarFormaRequest,
  executar: (ctx) =>
    ctx.comTenant(async (db, tx: TransacaoTenant) => {
      const { id } = ctx.params as z.infer<typeof ParamsId>;
      const c = ctx.corpo as z.infer<typeof SalvarFormaRequest>;
      if (c.id !== id) throw new ErroRegraNegocio('PAYLOAD_INVALIDO', 'O identificador da forma não confere com o endereço.');
      const antes = await lerForma(db, id);
      const codigo = c.codigo.toUpperCase();
      const dup = await db.query('select 1 from vendedor.forma_pagamento where codigo = $1 and deleted_at is null and id <> $2', [codigo, id]);
      if (dup.rows.length > 0) throw new ErroRegraNegocio('FORMA_DUPLICADA', 'Já existe uma forma de pagamento com este código.');
      if (antes) {
        if (antes.external_id && antes.codigo !== codigo) throw new ErroRegraNegocio('FORMA_DO_ERP', 'Forma vinda do ERP: o código é alterado no ERP.');
        await db.query('update vendedor.forma_pagamento set codigo = $2, nome = $3, ativo = $4, ordem = $5 where id = $1', [id, codigo, c.nome.trim(), c.ativo, c.ordem]);
      } else {
        const r = await db.query(
          `insert into vendedor.forma_pagamento (id, tenant_id, codigo, nome, ativo, ordem) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5)
           on conflict (id) do nothing returning id`,
          [id, codigo, c.nome.trim(), c.ativo, c.ordem],
        );
        if (r.rows.length === 0) throw new ErroRegraNegocio('ID_EM_USO', 'Este identificador já pertence a outro registro.');
      }
      const depois = (await lerForma(db, id))!;
      await tx.auditar({
        acao: !antes ? 'forma_pagamento.criar' : antes.ativo !== depois.ativo ? (depois.ativo ? 'forma_pagamento.reativar' : 'forma_pagamento.inativar') : 'forma_pagamento.editar',
        entidade: 'forma_pagamento',
        entidade_id: id,
        antes: antes ? { codigo: antes.codigo, nome: antes.nome, ativo: antes.ativo } : null,
        depois: { codigo: depois.codigo, nome: depois.nome, ativo: depois.ativo },
      });
      return depois;
    }),
};

/** PUT /v1/vendedor/prazos-pagamento/:id — cria ou edita (idempotente pelo `id`); calcula o prazo médio e a descrição. */
export const rotaSalvarPrazo: RotaModulo = {
  metodo: 'PUT',
  caminho: 'prazos-pagamento/:id',
  acao: 'forma_pagamento.gerenciar',
  carteira: 'nao_se_aplica',
  params: ParamsId,
  corpo: SalvarPrazoRequest,
  executar: (ctx) =>
    ctx.comTenant(async (db, tx: TransacaoTenant) => {
      const { id } = ctx.params as z.infer<typeof ParamsId>;
      const c = ctx.corpo as z.infer<typeof SalvarPrazoRequest>;
      if (c.id !== id) throw new ErroRegraNegocio('PAYLOAD_INVALIDO', 'O identificador do prazo não confere com o endereço.');
      if (!(await lerForma(db, c.forma_pagamento_id))) throw new ErroNaoEncontrado('FORMA_NAO_ENCONTRADA', 'Forma de pagamento não encontrada.');
      const antes = await lerPrazo(db, id);
      const codigo = c.codigo.toUpperCase();
      const dup = await db.query('select 1 from vendedor.prazo_pagamento where codigo = $1 and deleted_at is null and id <> $2', [codigo, id]);
      if (dup.rows.length > 0) throw new ErroRegraNegocio('PRAZO_DUPLICADO', 'Já existe um prazo com este código.');
      if (antes?.external_id && (antes.codigo !== codigo || antes.parcelas_dias.join() !== c.parcelas_dias.join())) {
        throw new ErroRegraNegocio('PRAZO_DO_ERP', 'Prazo vindo do ERP: código e parcelas são alterados no ERP.');
      }
      const medio = prazoMedioDias(c.parcelas_dias);
      const descricao = c.descricao ?? descricaoPrazo(c.parcelas_dias);
      if (antes) {
        await db.query(
          'update vendedor.prazo_pagamento set forma_pagamento_id = $2, codigo = $3, descricao = $4, parcelas_dias = $5::int[], prazo_medio_dias = $6, ativo = $7, ordem = $8 where id = $1',
          [id, c.forma_pagamento_id, codigo, descricao, c.parcelas_dias, medio, c.ativo, c.ordem],
        );
      } else {
        const r = await db.query(
          `insert into vendedor.prazo_pagamento (id, tenant_id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem)
           values ($1, plataforma.tenant_atual(), $2, $3, $4, $5::int[], $6, $7, $8) on conflict (id) do nothing returning id`,
          [id, c.forma_pagamento_id, codigo, descricao, c.parcelas_dias, medio, c.ativo, c.ordem],
        );
        if (r.rows.length === 0) throw new ErroRegraNegocio('ID_EM_USO', 'Este identificador já pertence a outro registro.');
      }
      const depois = (await lerPrazo(db, id))!;
      await tx.auditar({
        acao: !antes ? 'prazo_pagamento.criar' : antes.ativo !== depois.ativo ? (depois.ativo ? 'prazo_pagamento.reativar' : 'prazo_pagamento.inativar') : 'prazo_pagamento.editar',
        entidade: 'prazo_pagamento',
        entidade_id: id,
        antes: antes ? { codigo: antes.codigo, parcelas_dias: antes.parcelas_dias, ativo: antes.ativo } : null,
        depois: { codigo: depois.codigo, parcelas_dias: depois.parcelas_dias, prazo_medio_dias: depois.prazo_medio_dias, ativo: depois.ativo },
      });
      return depois;
    }),
};

export const rotasFormasPagamento: RotaModulo[] = [rotaListarFormasEPrazos, rotaSalvarForma, rotaSalvarPrazo];

/** Consulta `vendedor.formas_pagamento@1` (ADR 0019): só código, nome e situação das formas, para a ficha do cliente do Core. */
export const consultaFormasPagamento = implementarConsulta(CONSULTA_FORMAS_PAGAMENTO, async (_entrada, ctx) => {
  const r = await ctx.db.query<{ codigo: string; nome: string; ativo: boolean }>(
    'select codigo, nome, ativo from vendedor.forma_pagamento where deleted_at is null order by ordem, codigo limit 200',
  );
  return { formas: r.rows };
});
