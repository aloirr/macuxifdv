/**
 * Cliente novo no ERP (RF-CORE-10; RN-CORE-16, RN-CORE-78, RN-CORE-79, RN-INT-22; ADR 0069): pré-cadastro idempotente pelo id, pela
 * função compartilhada com o push e a correção do BKO (`gravarPreCadastro`, em pre-cadastro-receber.ts), e a consulta que o Hub usa para
 * buscar os pendentes sem código, com a revisão e o hash dos dados dela (o código do ERP volta pelo evento de retorno do Hub). Colunas das
 * migrações 0095, 0097 e 0098 (banco-dados).
 */
import { implementarConsulta, type RotaModulo } from '@macuxi/platform-sdk';
import { type z } from 'zod';
import {
  CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP,
  PreCadastroClienteSaidaSchema,
  PreCadastroClienteSchema,
  type ClientePreCadastroParaErp,
  type ClientesPreCadastroSemErpSaida,
} from '../contracts';
import { gravarPreCadastro, hashPreCadastro } from './pre-cadastro-receber';

export const rotasDeClienteCadastro: RotaModulo[] = [
  {
    // Idempotente pelo id do corpo: repetir devolve o cliente existente com `ja_existia: true`, sem regravar. Com `revisao_base`, corrige o recusado.
    metodo: 'POST',
    caminho: 'clientes/pre-cadastro',
    acao: 'cliente.pre_cadastrar',
    carteira: 'nao_se_aplica',
    corpo: PreCadastroClienteSchema,
    status: 200,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => PreCadastroClienteSaidaSchema.parse(await gravarPreCadastro(db, tx, ctx, ctx.corpo as z.infer<typeof PreCadastroClienteSchema>))),
  },
];

/** RN-INT-22: o Hub lê os pré-cadastros pendentes sem código do ERP, em ordem de chegada, paginados por `depois_de` (id do último recebido). */
export const consultaClientesPreCadastroSemErp = implementarConsulta(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, async (entrada, ctx): Promise<ClientesPreCadastroSemErpSaida> => {
  const valores: unknown[] = [];
  const param = (v: unknown) => `$${valores.push(v)}`;
  const depois = entrada.depois_de ? `and (c.created_at, c.id) > (select created_at, id from core.cliente where id = ${param(entrada.depois_de)})` : '';
  const r = await ctx.db.query<Omit<ClientePreCadastroParaErp, 'recebido_em' | 'hash'> & { recebido_em: Date | string; filial_id: string | null }>(
    `select c.id as cliente_id, c.created_at as recebido_em, coalesce(c.revisao_cadastro, 1) as revisao, c.filial_id, c.razao_social, c.nome_fantasia, c.documento, c.inscricao_estadual, c.telefone, c.email,
            c.logradouro, c.numero, null::text as complemento, c.bairro, c.cidade, c.uf, c.cep,
            c.latitude::float8 as latitude, c.longitude::float8 as longitude, f.external_id as filial_external_id
       from core.cliente c left join core.filial f on f.id = c.filial_id and f.deleted_at is null
      where c.external_id is null and c.status_cadastro = 'pendente' and c.deleted_at is null ${depois}
      order by c.created_at, c.id limit ${param(entrada.limite + 1)}`,
    valores,
  );
  // ADR 0069 §C: o hash é o dos dados atuais, que são os da revisão atual; sai só para o Hub, nunca a log.
  const pagina = r.rows.slice(0, entrada.limite).map(({ filial_id, recebido_em, ...l }) => ({ ...l, recebido_em: new Date(recebido_em).toISOString(), hash: hashPreCadastro({ ...l, filial_id }) }));
  return { clientes: pagina, proximo: r.rows.length > entrada.limite ? pagina[pagina.length - 1]!.cliente_id : null };
});
