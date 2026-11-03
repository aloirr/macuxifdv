/**
 * Cadastro de transportadoras e padrão do frete no BKO (`/v1/vendedor/transportadoras`, `/v1/vendedor/frete/parametros`;
 * RN-VEN-16, T-0061). Multi-tenant por RLS. A lista alimenta o FOB do pedido (a escolha é gravada como retrato no pedido) e o
 * pull do app; a transportadora digitada pelo vendedor fica só no pedido e aparece em `transportadoras/digitadas` para o BKO
 * cadastrar. CNPJ confere o dígito verificador (`@macuxi/comum`). Escrita auditada. Sem exclusão física: inativar.
 */
import { cnpjValido } from '@macuxi/comum';
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AtualizarTransportadoraRequest,
  CriarTransportadoraRequest,
  TransportadorasQuery,
  type Transportadora,
} from '../contracts';
import { modalidadePadraoDosParametros } from '../domain';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const COLUNAS = `id, nome, documento, inscricao_estadual, telefone, ativo, external_id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at`;
const ParamsId = z.object({ id: z.string().uuid() });
const NAO_ENCONTRADA = ['TRANSPORTADORA_NAO_ENCONTRADA', 'Transportadora não encontrada.'] as const;

const escaparLike = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

function validarCnpj(cnpj: string): void {
  if (!cnpjValido(cnpj)) throw new ErroRegraNegocio('CNPJ_INVALIDO', 'CNPJ inválido: confira os 14 dígitos.');
}

async function exigirDocumentoLivre(db: ClienteBanco, documento: string, exceto: string | null): Promise<void> {
  const r = await db.query('select 1 from vendedor.transportadora where documento = $1 and deleted_at is null and ($2::uuid is null or id <> $2)', [documento, exceto]);
  if (r.rows.length > 0) throw new ErroRegraNegocio('TRANSPORTADORA_DUPLICADA', 'Já existe uma transportadora com este CNPJ.');
}

async function ler(db: ClienteBanco, id: string): Promise<Transportadora | null> {
  return (await db.query<Transportadora>(`select ${COLUNAS} from vendedor.transportadora where id = $1 and deleted_at is null`, [id])).rows[0] ?? null;
}

/** GET /v1/vendedor/transportadoras — lista do tenant (busca por nome/CNPJ; `ativas=1` só as ativas). */
export const rotaListarTransportadoras: RotaModulo = {
  metodo: 'GET',
  caminho: 'transportadoras',
  acao: 'transportadora.ver',
  carteira: 'nao_se_aplica',
  query: TransportadorasQuery,
  executar: (ctx) => {
    const q = ctx.query as z.infer<typeof TransportadorasQuery>;
    const busca = q.q?.trim() ? `%${escaparLike(q.q.trim())}%` : null;
    return ctx.comTenant(async (db) => ({
      itens: (
        await db.query<Transportadora>(
          `select ${COLUNAS} from vendedor.transportadora
            where deleted_at is null and ($1::boolean is not true or ativo) and ($2::text is null or nome ilike $2 or documento like $2)
            order by ativo desc, lower(nome), id`,
          [q.ativas === '1' ? true : null, busca],
        )
      ).rows,
    }));
  },
};

/** GET /v1/vendedor/transportadoras/digitadas — as digitadas nos pedidos e ainda fora do cadastro (para o BKO cadastrar). */
export const rotaTransportadorasDigitadas: RotaModulo = {
  metodo: 'GET',
  caminho: 'transportadoras/digitadas',
  acao: 'transportadora.ver',
  carteira: 'nao_se_aplica',
  executar: (ctx) =>
    ctx.comTenant(async (db) => ({
      itens: (
        await db.query<{ nome: string; documento: string; telefone: string | null; pedidos: number }>(
          `select (array_agg(p.transportadora_nome order by p.created_at desc))[1] as nome, p.transportadora_documento as documento,
                  (array_agg(p.transportadora_telefone order by p.created_at desc))[1] as telefone, count(*)::int as pedidos
             from vendedor.pedido p
            where p.deleted_at is null and p.transportadora_digitada and p.transportadora_documento is not null
              and not exists (select 1 from vendedor.transportadora t where t.documento = p.transportadora_documento and t.deleted_at is null)
            group by p.transportadora_documento order by count(*) desc, 1 limit 200`,
        )
      ).rows,
    })),
};

/** POST /v1/vendedor/transportadoras — cadastra (nome e CNPJ obrigatórios; CNPJ único no tenant). */
export const rotaCriarTransportadora: RotaModulo = {
  metodo: 'POST',
  caminho: 'transportadoras',
  acao: 'transportadora.gerenciar',
  carteira: 'nao_se_aplica',
  corpo: CriarTransportadoraRequest,
  executar: (ctx) =>
    ctx.comTenant(async (db, tx) => {
      const c = ctx.corpo as z.infer<typeof CriarTransportadoraRequest>;
      validarCnpj(c.documento);
      await exigirDocumentoLivre(db, c.documento, null);
      const r = await db.query<{ id: string }>(
        `insert into vendedor.transportadora (tenant_id, nome, documento, inscricao_estadual, telefone)
         values (plataforma.tenant_atual(), $1, $2, $3, $4) returning id`,
        [c.nome.trim(), c.documento, c.inscricao_estadual?.trim() || null, c.telefone?.trim() || null],
      );
      const nova = (await ler(db, r.rows[0]!.id))!;
      await tx.auditar({ acao: 'transportadora.criar', entidade: 'transportadora', entidade_id: nova.id, antes: null, depois: { nome: nova.nome, ativo: nova.ativo } });
      return nova;
    }),
};

/** PATCH /v1/vendedor/transportadoras/:id — edita ou inativa/reativa. Registro vindo do ERP (`external_id`) não muda nome nem CNPJ. */
export const rotaAtualizarTransportadora: RotaModulo = {
  metodo: 'PATCH',
  caminho: 'transportadoras/:id',
  acao: 'transportadora.gerenciar',
  carteira: 'nao_se_aplica',
  params: ParamsId,
  corpo: AtualizarTransportadoraRequest,
  executar: (ctx) =>
    ctx.comTenant(async (db, tx: TransacaoTenant) => {
      const { id } = ctx.params as z.infer<typeof ParamsId>;
      const c = ctx.corpo as z.infer<typeof AtualizarTransportadoraRequest>;
      const antes = await ler(db, id);
      if (!antes) throw new ErroNaoEncontrado(...NAO_ENCONTRADA);
      if (antes.external_id && (c.nome !== undefined || c.documento !== undefined)) {
        throw new ErroRegraNegocio('TRANSPORTADORA_DO_ERP', 'Transportadora vinda do ERP: nome e CNPJ são alterados no ERP.');
      }
      if (c.documento !== undefined) {
        validarCnpj(c.documento);
        await exigirDocumentoLivre(db, c.documento, id);
      }
      await db.query(
        `update vendedor.transportadora set nome = coalesce($2, nome), documento = coalesce($3, documento),
            inscricao_estadual = case when $4::boolean then $5 else inscricao_estadual end,
            telefone = case when $6::boolean then $7 else telefone end, ativo = coalesce($8, ativo)
          where id = $1`,
        [id, c.nome?.trim() ?? null, c.documento ?? null, c.inscricao_estadual !== undefined, c.inscricao_estadual?.trim() || null, c.telefone !== undefined, c.telefone?.trim() || null, c.ativo ?? null],
      );
      const depois = (await ler(db, id))!;
      await tx.auditar({
        acao: c.ativo !== undefined && c.ativo !== antes.ativo ? (c.ativo ? 'transportadora.reativar' : 'transportadora.inativar') : 'transportadora.editar',
        entidade: 'transportadora',
        entidade_id: id,
        antes: { nome: antes.nome, ativo: antes.ativo },
        depois: { nome: depois.nome, ativo: depois.ativo },
      });
      return depois;
    }),
};

/**
 * GET /v1/vendedor/frete/parametros — padrão do tenant (CIF quando não configurado, RN-VEN-16). Só leitura: a escrita de
 * `plataforma.parametro` é do Core (tests/fundacao S0-014); a edição pelo BKO depende de rota do Core (recado ao modulo-core).
 */
export const rotaLerFreteParametros: RotaModulo = {
  metodo: 'GET',
  caminho: 'frete/parametros',
  acao: 'transportadora.ver',
  carteira: 'nao_se_aplica',
  executar: async (ctx) => ({ modalidade_padrao: modalidadePadraoDosParametros(ctx.parametros()) }),
};

/** PUT /v1/vendedor/transportadoras/:id — mesmo efeito do PATCH (o cliente web do shell não envia PATCH). */
export const rotaAtualizarTransportadoraPut: RotaModulo = { ...rotaAtualizarTransportadora, metodo: 'PUT' };

export const rotasTransportadoras: RotaModulo[] = [
  rotaListarTransportadoras,
  rotaTransportadorasDigitadas,
  rotaCriarTransportadora,
  rotaAtualizarTransportadora,
  rotaAtualizarTransportadoraPut,
  rotaLerFreteParametros,
];
