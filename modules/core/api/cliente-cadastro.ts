/**
 * Cliente novo no ERP (RF-CORE-10; RN-CORE-78, RN-INT-22): pré-cadastro idempotente pelo id, decisão no BKO (aprovar publica
 * `core.cliente.aprovado@1` na mesma transação) e a consulta que o Hub usa para buscar os aprovados (o código do ERP volta pelo evento de retorno do Hub).
 * As colunas `origem_cadastro`, `status_cadastro`, `aprovado_em` e `aprovado_por` vêm da migração 0095 (banco-dados).
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, implementarConsulta, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  CONSULTA_CLIENTES_APROVADOS_SEM_ERP,
  DecidirCadastroClienteSchema,
  EVENTO_CLIENTE_APROVADO,
  PreCadastroClienteSchema,
  type ClienteAprovadoParaErp,
  type ClientesAprovadosSemErpSaida,
} from '../contracts';
import { decidirCadastro, type ClienteParaDecisao } from '../domain';
import { auditar } from './auditoria';

const IdParam = z.object({ id: z.string().uuid() });
const naoEncontrado = () => new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado. Atualize a lista e tente de novo.');
const ERROS_DECISAO = {
  CLIENTE_DO_ERP: 'Este cliente veio do ERP e não precisa de aprovação.',
  CADASTRO_JA_DECIDIDO: 'Este cadastro já foi decidido. Atualize a lista para ver o resultado.',
} as const;

type StatusCadastro = NonNullable<ClienteParaDecisao['status_cadastro']>;

export const rotasDeClienteCadastro: RotaModulo[] = [
  {
    // Idempotente pelo id do corpo: repetir devolve o cliente existente com `ja_existia: true`, sem regravar.
    metodo: 'POST',
    caminho: 'clientes/pre-cadastro',
    acao: 'cliente.pre_cadastrar',
    carteira: 'nao_se_aplica',
    corpo: PreCadastroClienteSchema,
    status: 200,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof PreCadastroClienteSchema>;
        const existente = (await db.query<{ status_cadastro: StatusCadastro | null }>('select status_cadastro from core.cliente where id = $1 and deleted_at is null', [c.id])).rows[0];
        if (existente) return { id: c.id, status_cadastro: existente.status_cadastro ?? 'aprovado', ja_existia: true };
        if (c.documento) {
          const igual = (await db.query('select 1 from core.cliente where documento = $1 and deleted_at is null', [c.documento])).rows[0];
          if (igual) throw new ErroHttpModulo(409, 'DOCUMENTO_JA_CADASTRADO', 'Já existe um cliente com este CPF/CNPJ. Procure-o na lista de clientes.');
        }
        // Id que já existe em outro tenant (RLS esconde no select acima): a unicidade estoura; responde 409 sem dizer onde está.
        await db.query('savepoint pre_cadastro');
        try {
          await db.query(
          `insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, documento, inscricao_estadual, telefone, email, logradouro, numero, bairro, cidade, uf, cep, latitude, longitude, filial_id, origem_cadastro, status_cadastro)
           values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pendente')`,
          [c.id, c.razao_social, c.nome_fantasia ?? null, c.documento ?? null, c.inscricao_estadual ?? null, c.telefone ?? null, c.email ?? null, c.logradouro ?? null, c.numero ?? null, c.bairro ?? null, c.cidade ?? null, c.uf ?? null, c.cep ?? null, c.latitude ?? null, c.longitude ?? null, c.filial_id ?? null, c.origem],
          );
          await db.query('release savepoint pre_cadastro');
        } catch (e) {
          if ((e as { code?: string }).code !== '23505') throw e;
          await db.query('rollback to savepoint pre_cadastro');
          throw new ErroHttpModulo(409, 'CADASTRO_INDISPONIVEL', 'Não foi possível gravar este cadastro. Abra um novo cadastro e tente de novo.');
        }
        if (ctx.usuario.perfil === 'vendedor' && ctx.usuario.id) {
          await db.query("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'vendedor')", [c.id, ctx.usuario.id]);
        }
        await auditar(db, ctx, { acao: 'cliente.pre_cadastrar', entidade: 'cliente', entidadeId: c.id, antes: null, depois: { origem: c.origem, status_cadastro: 'pendente' } });
        return { id: c.id, status_cadastro: 'pendente' as const, ja_existia: false };
      }),
  },
  {
    // RN-CORE-78: só analista/admin; aprovar grava aprovado_em/por, audita e publica o evento na mesma transação.
    metodo: 'POST',
    caminho: 'clientes/:id/cadastro',
    acao: 'cliente.aprovar_cadastro',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: DecidirCadastroClienteSchema,
    status: 200,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const { id } = ctx.params as z.infer<typeof IdParam>;
        const { decisao } = ctx.corpo as z.infer<typeof DecidirCadastroClienteSchema>;
        const cliente = (await db.query<{ origem_cadastro: 'erp' | 'campo' | 'bko'; status_cadastro: StatusCadastro | null }>('select origem_cadastro, status_cadastro from core.cliente where id = $1 and deleted_at is null for update', [id])).rows[0];
        if (!cliente) throw naoEncontrado();
        const r = decidirCadastro(cliente, decisao);
        if (!r.ok) throw new ErroRegraNegocio(r.codigo, ERROS_DECISAO[r.codigo]);
        const em = ctx.agora().toISOString();
        const por = ctx.usuario.id;
        if (!por) throw new ErroRegraNegocio('USUARIO_OBRIGATORIO', 'Entre com seu usuário para decidir o cadastro.');
        if (r.status === 'aprovado') await db.query("update core.cliente set status_cadastro = 'aprovado', aprovado_em = $2, aprovado_por = $3 where id = $1", [id, em, por]);
        else await db.query("update core.cliente set status_cadastro = 'recusado' where id = $1", [id]);
        await auditar(db, ctx, { acao: 'cliente.aprovar_cadastro', entidade: 'cliente', entidadeId: id, antes: { status_cadastro: cliente.status_cadastro }, depois: { status_cadastro: r.status } });
        if (r.status === 'aprovado') await tx.publicar(EVENTO_CLIENTE_APROVADO, { cliente_id: id, aprovado_em: em, aprovado_por: por }, id);
        return { id, status_cadastro: r.status };
      }),
  },
];

/** RN-INT-22: o Hub lê os aprovados sem código do ERP, em ordem de aprovação, paginados por `depois_de` (id do último recebido). */
export const consultaClientesAprovadosSemErp = implementarConsulta(CONSULTA_CLIENTES_APROVADOS_SEM_ERP, async (entrada, ctx): Promise<ClientesAprovadosSemErpSaida> => {
  const valores: unknown[] = [];
  const param = (v: unknown) => `$${valores.push(v)}`;
  const depois = entrada.depois_de ? `and (c.aprovado_em, c.id) > (select aprovado_em, id from core.cliente where id = ${param(entrada.depois_de)})` : '';
  const r = await ctx.db.query<ClienteAprovadoParaErp & { aprovado_em: Date | string }>(
    `select c.id as cliente_id, c.aprovado_em, c.razao_social, c.nome_fantasia, c.documento, c.inscricao_estadual, c.telefone, c.email,
            c.logradouro, c.numero, null::text as complemento, c.bairro, c.cidade, c.uf, c.cep,
            c.latitude::float8 as latitude, c.longitude::float8 as longitude, f.external_id as filial_external_id
       from core.cliente c left join core.filial f on f.id = c.filial_id and f.deleted_at is null
      where c.external_id is null and c.aprovado_em is not null and c.deleted_at is null ${depois}
      order by c.aprovado_em, c.id limit ${param(entrada.limite + 1)}`,
    valores,
  );
  const pagina = r.rows.slice(0, entrada.limite).map((l) => ({ ...l, aprovado_em: new Date(l.aprovado_em).toISOString() }));
  return { clientes: pagina, proximo: r.rows.length > entrada.limite ? pagina[pagina.length - 1]!.cliente_id : null };
});
