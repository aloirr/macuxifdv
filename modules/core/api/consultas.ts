/** Consultas do Core a outros módulos (ADR 0012). SQL só em `core.*`, na transação de quem chama (RLS do tenant). */
import { implementarConsulta } from '@macuxi/platform-sdk';
import {
  CONSULTA_CADASTRO_CLIENTE,
  CONSULTA_CADASTRO_RESUMO,
  CONSULTA_PROMOTOR_VE_PEDIDOS,
  CONSULTA_USUARIOS_RESUMO,
  type UsuariosResumoSaida,
  PARAMETRO_CAMPOS_OBRIGATORIOS,
  type CadastroClienteSaida,
  type CadastroResumoSaida,
} from '../contracts';
import { cadastroCompleto, camposExigidos } from '../domain/cadastro';
import { lerPromotorVePedidos } from './promotor-pedidos';

export const consultaCadastroResumo = implementarConsulta(CONSULTA_CADASTRO_RESUMO, async (entrada, ctx): Promise<CadastroResumoSaida> => {
  // Sequencial: um único cliente de banco na transação.
  const lista = async (ids: string[], sql: string, extra: unknown[] = []) => (ids.length === 0 ? [] : (await ctx.db.query(sql, [ids, ...extra])).rows);
  const clientes = await lista(
    entrada.cliente_ids,
    'select id, razao_social, nome_fantasia, documento, logradouro, numero, bairro, cidade, uf, ativo, external_id, inscricao_estadual, cep, cadastro_incompleto, cadastro_campos_faltantes from core.cliente where deleted_at is null and id = any($1::uuid[]) order by id',
  );
  const produtos = (
    entrada.produto_ids.length === 0 && entrada.produto_external_ids.length === 0
      ? []
      : (
          await ctx.db.query(
            'select id, sku, nome, unidade, ativo, external_id from core.produto where deleted_at is null and (id = any($1::uuid[]) or external_id = any($2::text[])) order by id',
            [entrada.produto_ids, entrada.produto_external_ids],
          )
        ).rows
  ) as Array<CadastroResumoSaida['produtos'][number]>;
  if (produtos.length > 0) {
    const unidades = await lista(
      produtos.map((p) => p.id),
      'select produto_id, unidade, fator, padrao, ativo, external_id from core.produto_unidade where deleted_at is null and produto_id = any($1::uuid[]) order by produto_id, unidade',
    );
    for (const p of produtos) {
      p.unidades = unidades.filter((u) => u.produto_id === p.id).map(({ produto_id: _p, ...u }) => u) as NonNullable<typeof p.unidades>;
    }
  }
  const usuarios = await lista(entrada.usuario_ids, 'select id, nome, perfil, external_id from core.usuario where deleted_at is null and id = any($1::uuid[]) order by id');
  // Endereços: os pedidos em endereco_ids e, sempre, o principal de cada cliente pedido (T-0061 §4.1).
  const enderecos =
    entrada.cliente_ids.length === 0 && entrada.endereco_ids.length === 0
      ? []
      : (
          await ctx.db.query(
            `select id, cliente_id, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep, principal, ativo, external_id
               from core.cliente_endereco
              where deleted_at is null and (id = any($1::uuid[]) or (principal and cliente_id = any($2::uuid[])))
              order by cliente_id, id`,
            [entrada.endereco_ids, entrada.cliente_ids],
          )
        ).rows;
  return { clientes, produtos, usuarios, enderecos } as CadastroResumoSaida;
});

/** RN-CORE-16 / RN-INT-14: confere o lote contra os campos exigidos do tenant. Pura; devolve só chave e nomes de campo. */
export const consultaCadastroCliente = implementarConsulta(CONSULTA_CADASTRO_CLIENTE, async (entrada, ctx): Promise<CadastroClienteSaida> => {
  const exigidos = camposExigidos(ctx.parametros()[PARAMETRO_CAMPOS_OBRIGATORIOS]);
  return {
    resultados: entrada.clientes.map(({ chave, ...dados }) => {
      const r = cadastroCompleto(dados, exigidos);
      return { chave, completo: r.completo, campos_faltantes: r.campos_faltantes };
    }),
  };
});

/**
 * RN-CORE-01 / RN-PRO-01 (T-0061): o promotor vê pedidos neste tenant? Lida do banco a CADA chamada, na transação de quem
 * pergunta (RLS): sem cache e sem valor em JWT/sessão. Sem registro = ligado.
 */
export const consultaPromotorVePedidos = implementarConsulta(CONSULTA_PROMOTOR_VE_PEDIDOS, async (_entrada, ctx) => ({ ligado: await lerPromotorVePedidos(ctx.db) }));

/** RN-TRE-07 (T-0058): usuários do tenant sob RLS, até 500 por página (cursor por id). Sem e-mail/senha; removido fora, inativo dentro. */
export const consultaUsuariosResumo = implementarConsulta(CONSULTA_USUARIOS_RESUMO, async (entrada, ctx): Promise<UsuariosResumoSaida> => {
  const ids = entrada.usuario_ids ?? [];
  const porIds = ids.length > 0;
  const limite = porIds ? Math.min(ids.length, 500) : entrada.limite;
  const rows = (
    await ctx.db.query(
      `select id, nome, perfil, equipe_id, null::uuid as regional_id, ativo
         from core.usuario
        where deleted_at is null
          and ($1::uuid[] is null or id = any($1::uuid[]))
          and ($2::uuid is null or id > $2::uuid)
        order by id
        limit $3`,
      [porIds ? ids : null, porIds ? null : (entrada.apos_id ?? null), limite + 1],
    )
  ).rows as UsuariosResumoSaida['usuarios'];
  const temMais = !porIds && rows.length > limite;
  const usuarios = temMais ? rows.slice(0, limite) : rows;
  return { usuarios, proximo_cursor: temMais ? usuarios[usuarios.length - 1]!.id : null };
});
