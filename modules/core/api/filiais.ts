/**
 * Filial (RN-CORE-39; RF-CORE-16; T-0149; ADR 0040): consulta pública `core.filiais@1` e rotas do BKO.
 * Rotas `/v1/core/filiais` (GET lista: todos os perfis do Core; POST cria, PUT `:id` edita e DELETE apaga: `filial.editar`,
 * admin e analista) e `PUT /v1/core/clientes/:id/filial` (`cliente.filial_editar`; cliente do ERP recusa com 422 `RN-CORE-39`).
 * Regras no domínio (`domain/filial.ts`). Escrita idempotente: o `id` nasce no cliente. O banco também protege (índice único
 * da padrão e do código); o erro dele vira 422 amigável, nunca 500.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, implementarConsulta, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  CAMPOS_FISCAIS_FILIAL,
  CONSULTA_FILIAIS,
  ClienteFilialPutSchema,
  ERROS_FILIAL,
  EVENTO_CLIENTE_ATUALIZADO,
  FilialCriarSchema,
  FilialEditarSchema,
  FilialIdParamSchema,
  FilialListaItemSchema,
  FiliaisListaSchema,
  type Filial,
  type FiliaisSaida,
} from '../contracts';
import { decidirApagarFilial, faltasNoCadastroDaFilial, filialEfetiva, podeEditarFilialDoCliente, validarFilial } from '../domain';
import { auditar } from './auditoria';
import { carteiraNoBanco } from './carteira';

const COLUNAS = 'f.id, f.codigo, f.nome, f.cidade, f.uf, f.padrao, f.ativo, f.external_id, f.cnpj, f.logradouro, f.numero, f.complemento, f.bairro, f.cep, f.telefone';

/** Filiais vivas do tenant (ativas e inativas), a padrão primeiro. RLS do tenant de quem chama. */
export async function filiaisDoTenant(db: ClienteBanco): Promise<Filial[]> {
  return (await db.query<Filial>(`select ${COLUNAS} from core.filial f where f.deleted_at is null order by f.padrao desc, f.codigo, f.id`)).rows;
}

/**
 * `core.filiais@1` (T-0149): as filiais, a filial EFETIVA dos clientes pedidos (nula, apagada ou inativa = padrão), o casamento por
 * `external_id` e, com `escopo: 'carteira'`, as filiais efetivas da carteira de quem consulta mais a padrão (`null` = tenant inteiro).
 */
export const consultaFiliais = implementarConsulta(CONSULTA_FILIAIS, async (entrada, ctx): Promise<FiliaisSaida> => {
  const filiais = await filiaisDoTenant(ctx.db);
  const padrao = filiais.find((f) => f.padrao);
  if (!padrao) throw new ErroRegraNegocio(ERROS_FILIAL.padrao, 'A empresa está sem filial padrão. Cadastre uma filial e marque-a como padrão.');
  const efetiva = (filialId: string | null) => filialEfetiva(filialId, filiais).id;
  const filialDosClientes = async (ids: readonly string[] | null) =>
    (await ctx.db.query<{ id: string; filial_id: string | null }>('select id, filial_id from core.cliente where deleted_at is null and ($1::uuid[] is null or id = any($1::uuid[]))', [ids])).rows;

  const clientes = entrada.cliente_ids.length === 0 ? [] : (await filialDosClientes(entrada.cliente_ids)).map((c) => ({ cliente_id: c.id, filial_id: efetiva(c.filial_id) }));
  const porExterno = new Map(filiais.filter((f) => f.external_id !== null).map((f) => [f.external_id!, f.id]));
  const por_external_id = [...new Set(entrada.external_ids)].filter((e) => porExterno.has(e)).map((e) => ({ external_id: e, filial_id: porExterno.get(e)! }));

  let da_carteira: string[] | null = null;
  if (entrada.escopo === 'carteira') {
    const visiveis = await carteiraNoBanco(ctx.db, ctx.usuario, { agora: () => ctx.agora(), fuso: ctx.fuso() });
    if (visiveis !== 'tenant') {
      const doEscopo = visiveis.size === 0 ? [] : await filialDosClientes([...visiveis]);
      da_carteira = [...new Set([padrao.id, ...doEscopo.map((c) => efetiva(c.filial_id))])];
    }
  }
  return { padrao_id: padrao.id, filiais, clientes, por_external_id, da_carteira };
});

const IdParam = FilialIdParamSchema;
const ClienteIdParam = z.object({ id: z.string().uuid() });

interface LinhaLista extends Filial {
  clientes_ativos: number;
}
const SQL_LISTA = `select ${COLUNAS},
    (select count(*)::int from core.cliente c where c.filial_id = f.id and c.deleted_at is null and c.ativo) as clientes_ativos
  from core.filial f where f.deleted_at is null`;

const item = (l: LinhaLista) => FilialListaItemSchema.parse({ ...l, incompleta: faltasNoCadastroDaFilial(l).length > 0 });
const lerFilial = async (db: ClienteBanco, id: string): Promise<LinhaLista | undefined> => (await db.query<LinhaLista>(`${SQL_LISTA} and f.id = $1`, [id])).rows[0];

function recusar(r: { codigo: string; mensagem: string }): never {
  throw new ErroRegraNegocio(r.codigo, r.mensagem);
}
const naoEncontrada = () => new ErroNaoEncontrado(ERROS_FILIAL.naoEncontrada, 'Filial não encontrada. Atualize a lista e tente de novo.');

/** 23505 = CNPJ ou código repetido ou segunda padrão; 23514 = padrão inativa. Nunca 500. */
async function comErroDeFilial<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
    const constraint = typeof e === 'object' && e !== null ? (e as { constraint?: string }).constraint : undefined;
    if (code === '23505' && constraint === 'filial_cnpj_uk') throw new ErroRegraNegocio(ERROS_FILIAL.duplicada, 'Já existe uma filial com este CNPJ. Confira o CNPJ ou edite a existente.');
    if (code === '23505') throw new ErroRegraNegocio(ERROS_FILIAL.duplicada, 'Já existe uma filial com este código. Use outro código ou edite a existente.');
    if (code === '23514') throw new ErroRegraNegocio(ERROS_FILIAL.padrao, 'A filial padrão não pode ser inativada. Marque outra como padrão antes.');
    throw e;
  }
}

export const rotasDeFiliais: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'filiais',
    acao: 'filial.ver',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const r = await db.query<LinhaLista>(`${SQL_LISTA} order by f.padrao desc, f.codigo, f.id`);
        return FiliaisListaSchema.parse({ itens: r.rows.map(item) });
      }),
  },
  {
    metodo: 'POST',
    caminho: 'filiais',
    acao: 'filial.editar',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: FilialCriarSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof FilialCriarSchema>;
        // Idempotência: o mesmo id já gravado devolve a filial existente, sem nova escrita nem nova auditoria.
        const existente = await lerFilial(db, c.id);
        if (existente) return item(existente);
        const todas = await filiaisDoTenant(db);
        const v = validarFilial(c, todas);
        if (!v.ok) recusar(v);
        await comErroDeFilial(() =>
          db.query('insert into core.filial (id, tenant_id, codigo, nome, cidade, uf, cnpj, logradouro, numero, complemento, bairro, cep, telefone, padrao, ativo) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, true) on conflict (id) do nothing', [c.id, v.filial.codigo, v.filial.nome, v.filial.cidade, v.filial.uf, v.filial.cnpj, v.filial.logradouro, v.filial.numero, v.filial.complemento, v.filial.bairro, v.filial.cep, v.filial.telefone]),
        );
        await auditar(db, ctx, { acao: 'filial.criar', entidade: 'filial', entidadeId: c.id, antes: null, depois: v.filial });
        return item((await lerFilial(db, c.id))!);
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'filiais/:id',
    acao: 'filial.editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: FilialEditarSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof FilialEditarSchema>;
        const id = (ctx.params as z.infer<typeof IdParam>).id;
        const antes = await lerFilial(db, id);
        if (!antes) throw naoEncontrada();
        const ativo = c.ativo ?? antes.ativo;
        const todas = await filiaisDoTenant(db);
        // RN-CORE-39 (T-0159): mexer em dado do cadastro exige CNPJ e endereço completos; só situação/padrão de filial antiga passa sem eles.
        const mexeuNoCadastro = ['codigo', 'nome', 'cidade', 'uf', ...CAMPOS_FISCAIS_FILIAL].some((k) => k in c);
        const fiscais = Object.fromEntries(CAMPOS_FISCAIS_FILIAL.map((k) => [k, k in c ? c[k as keyof typeof c] : antes[k]]));
        const v = validarFilial({ id, codigo: c.codigo ?? antes.codigo, nome: c.nome ?? antes.nome, cidade: c.cidade ?? antes.cidade, uf: c.uf ?? antes.uf, ativo, ...fiscais }, todas, { clientesAtivos: antes.clientes_ativos, exigirCadastro: mexeuNoCadastro });
        if (!v.ok) recusar(v);
        if (c.padrao && !ativo) recusar({ codigo: ERROS_FILIAL.invalida, mensagem: 'A filial padrão precisa estar ativa.' });
        const f = v.filial;
        const mudouDado = f.codigo !== antes.codigo || f.nome !== antes.nome || f.cidade !== antes.cidade || f.uf !== antes.uf || ativo !== antes.ativo || CAMPOS_FISCAIS_FILIAL.some((k) => (k in c ? f[k] !== (antes[k] ?? null) : false));
        const viraPadrao = c.padrao === true && !antes.padrao;
        // Sem mudança nenhuma (repetição do mesmo pedido): devolve como está, sem escrita nem auditoria.
        if (!mudouDado && !viraPadrao) return item(antes);
        await comErroDeFilial(async () => {
          // Uma e só uma padrão viva (índice único parcial): desmarca a anterior antes de marcar a nova.
          if (viraPadrao) await db.query('update core.filial set padrao = false where padrao and deleted_at is null and id <> $1', [id]);
          await db.query('update core.filial set codigo = $2, nome = $3, cidade = $4, uf = $5, ativo = $6, padrao = padrao or $7, cnpj = $8, logradouro = $9, numero = $10, complemento = $11, bairro = $12, cep = $13, telefone = $14 where id = $1', [id, f.codigo, f.nome, f.cidade, f.uf, ativo, viraPadrao, f.cnpj, f.logradouro, f.numero, f.complemento, f.bairro, f.cep, f.telefone]);
        });
        const acao = viraPadrao ? 'filial.definir_padrao' : ativo !== antes.ativo ? (ativo ? 'filial.reativar' : 'filial.inativar') : 'filial.editar';
        await auditar(db, ctx, { acao, entidade: 'filial', entidadeId: id, antes: { codigo: antes.codigo, nome: antes.nome, cidade: antes.cidade, uf: antes.uf, ativo: antes.ativo, padrao: antes.padrao }, depois: { ...f, padrao: antes.padrao || viraPadrao } });
        return item((await lerFilial(db, id))!);
      }),
  },
  {
    metodo: 'DELETE',
    caminho: 'filiais/:id',
    acao: 'filial.editar',
    carteira: 'nao_se_aplica',
    status: 204,
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const id = (ctx.params as z.infer<typeof IdParam>).id;
        const antes = await lerFilial(db, id);
        if (!antes) throw naoEncontrada();
        const d = decidirApagarFilial(antes, antes.clientes_ativos);
        if (!d.ok) recusar(d);
        await comErroDeFilial(() => db.query('update core.filial set deleted_at = now() where id = $1', [id]));
        await auditar(db, ctx, { acao: 'filial.apagar', entidade: 'filial', entidadeId: id, antes: { codigo: antes.codigo, nome: antes.nome }, depois: null });
        return null;
      }),
  },
  {
    // RN-CORE-39: o BKO troca a filial do cliente que NÃO veio do ERP; do ERP, a filial é a do ERP (422 RN-CORE-39).
    metodo: 'PUT',
    caminho: 'clientes/:id/filial',
    acao: 'cliente.filial_editar',
    carteira: 'nao_se_aplica',
    params: ClienteIdParam,
    corpo: ClienteFilialPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const { id } = ctx.params as z.infer<typeof ClienteIdParam>;
        const { filial_id } = ctx.corpo as z.infer<typeof ClienteFilialPutSchema>;
        const cliente = (await db.query<{ external_id: string | null; filial_id: string | null }>('select external_id, filial_id from core.cliente where id = $1 and deleted_at is null', [id])).rows[0];
        if (!cliente) throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado. Atualize a lista e tente de novo.');
        if (!podeEditarFilialDoCliente(cliente)) throw new ErroRegraNegocio(ERROS_FILIAL.doErp, 'A filial deste cliente vem do ERP. Altere no ERP e aguarde a próxima carga.');
        const destino = (await filiaisDoTenant(db)).find((f) => f.id === filial_id);
        if (!destino) throw naoEncontrada();
        if (!destino.ativo) throw new ErroRegraNegocio(ERROS_FILIAL.invalida, 'A filial está inativa. Escolha uma filial ativa.');
        if (cliente.filial_id === filial_id) return { filial_id };
        await db.query('update core.cliente set filial_id = $2 where id = $1', [id, filial_id]);
        await auditar(db, ctx, { acao: 'cliente.filial_editar', entidade: 'cliente', entidadeId: id, antes: { filial_id: cliente.filial_id }, depois: { filial_id } });
        await tx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: id, campos: ['filial_id'], origem: 'bko' }, id);
        return { filial_id };
      }),
  },
];
