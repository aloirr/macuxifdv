/**
 * Cliente novo no ERP (RF-CORE-10; RN-CORE-78, RN-CORE-79, RN-INT-22): pré-cadastro idempotente pelo id, que revalida os campos obrigatórios do
 * parâmetro da empresa e publica `core.cliente.pre_cadastrado@1` na mesma transação (quem aprova é o ERP), e a consulta que o Hub usa para buscar
 * os pendentes sem código (o código do ERP volta pelo evento de retorno do Hub). As colunas vêm das migrações 0095 e 0097 (banco-dados).
 */
import { ErroHttpModulo, ErroRegraNegocio, implementarConsulta, type RotaModulo } from '@macuxi/platform-sdk';
import { type z } from 'zod';
import {
  CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP,
  EVENTO_CLIENTE_PRE_CADASTRADO,
  PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
  PreCadastroClienteSchema,
  ROTULOS_CAMPOS_PRE_CADASTRO,
  obrigatoriosPreCadastroDasLinhas,
  type ClientePreCadastroParaErp,
  type ClientesPreCadastroSemErpSaida,
} from '../contracts';
import { camposFaltantesPreCadastro } from '../domain';
import { auditar } from './auditoria';
import { lerParametroCore } from './parametro-tenant';

type StatusCadastro = 'pendente' | 'aprovado' | 'recusado';

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
      ctx.comTenant(async (db, tx) => {
        const c = ctx.corpo as z.infer<typeof PreCadastroClienteSchema>;
        const existente = (await db.query<{ status_cadastro: StatusCadastro | null }>('select status_cadastro from core.cliente where id = $1 and deleted_at is null', [c.id])).rows[0];
        if (existente) return { id: c.id, status_cadastro: existente.status_cadastro ?? 'aprovado', ja_existia: true };
        // RN-CORE-79: obrigatórios do parâmetro da empresa; só as chaves vão nos detalhes da resposta, nunca os valores.
        const faltantes = camposFaltantesPreCadastro(c, obrigatoriosPreCadastroDasLinhas(await lerParametroCore(db, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS)));
        if (faltantes.length > 0) {
          throw new ErroRegraNegocio('CAMPOS_OBRIGATORIOS', `Preencha: ${faltantes.map((f) => ROTULOS_CAMPOS_PRE_CADASTRO[f].toLowerCase()).join(', ')}.`, { campos: faltantes });
        }
        {
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
        await tx.publicar(EVENTO_CLIENTE_PRE_CADASTRADO, { cliente_id: c.id, recebido_em: ctx.agora().toISOString() }, c.id);
        return { id: c.id, status_cadastro: 'pendente' as const, ja_existia: false };
      }),
  },
];

/** RN-INT-22: o Hub lê os pré-cadastros pendentes sem código do ERP, em ordem de chegada, paginados por `depois_de` (id do último recebido). */
export const consultaClientesPreCadastroSemErp = implementarConsulta(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, async (entrada, ctx): Promise<ClientesPreCadastroSemErpSaida> => {
  const valores: unknown[] = [];
  const param = (v: unknown) => `$${valores.push(v)}`;
  const depois = entrada.depois_de ? `and (c.created_at, c.id) > (select created_at, id from core.cliente where id = ${param(entrada.depois_de)})` : '';
  const r = await ctx.db.query<Omit<ClientePreCadastroParaErp, 'recebido_em'> & { recebido_em: Date | string }>(
    `select c.id as cliente_id, c.created_at as recebido_em, c.razao_social, c.nome_fantasia, c.documento, c.inscricao_estadual, c.telefone, c.email,
            c.logradouro, c.numero, null::text as complemento, c.bairro, c.cidade, c.uf, c.cep,
            c.latitude::float8 as latitude, c.longitude::float8 as longitude, f.external_id as filial_external_id
       from core.cliente c left join core.filial f on f.id = c.filial_id and f.deleted_at is null
      where c.external_id is null and c.status_cadastro = 'pendente' and c.deleted_at is null ${depois}
      order by c.created_at, c.id limit ${param(entrada.limite + 1)}`,
    valores,
  );
  const pagina = r.rows.slice(0, entrada.limite).map((l) => ({ ...l, recebido_em: new Date(l.recebido_em).toISOString() }));
  return { clientes: pagina, proximo: r.rows.length > entrada.limite ? pagina[pagina.length - 1]!.cliente_id : null };
});
