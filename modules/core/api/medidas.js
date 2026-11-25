/**
 * Medidas do produto no BKO e a consulta pública `core.medidas@1` (RN-CORE-19; RF-CORE-14; T-0063).
 * Rotas `/v1/core/medidas` (GET lista, POST cria, PUT `:id` edita descrição/sigla/ativo — o cliente web só tem GET/POST/PUT/DELETE —, DELETE `:id` apaga; listar: `produto.editar_preco`; criar, editar, apagar: `medida.gerenciar`, admin e analista).
 * Regras no domínio (`domain/medida.ts`). Medida não se apaga em uso: inativa-se (inativar é permitido mesmo em uso: o produto
 * mantém a sigla). Escrita idempotente: o `id` nasce no cliente e repetir o POST devolve a mesma medida. O banco também
 * protege (FK `(tenant_id, sigla)` no produto e bloqueio de apagar em uso); o erro dele vira 422 amigável, nunca 500.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_MEDIDAS, ERROS_MEDIDA, MedidaCriarSchema, MedidaEditarSchema, MedidaIdParamSchema, MedidasListaSchema, MedidaSchema } from '../contracts';
import { decidirApagarMedida, decidirTrocaDeSigla, normalizarSigla, validarMedida } from '../domain';
import { auditar } from './auditoria';
/** Produtos que usam a sigla (unidade, embalagem ou unidade de venda), sem repetir o produto. */
const SQL_EM_USO = `
  (select count(*)::int from (
     select p.id from core.produto p where p.deleted_at is null and (p.unidade = m.sigla or p.embalagem_medida = m.sigla)
     union
     select pu.produto_id from core.produto_unidade pu join core.produto p2 on p2.id = pu.produto_id and p2.deleted_at is null
      where pu.deleted_at is null and pu.unidade = m.sigla
   ) u) as em_uso`;
const COLUNAS = `m.id, m.sigla, m.descricao, m.ativo, ${SQL_EM_USO}`;
const IdParam = MedidaIdParamSchema;
/** Medida ativa ou não, com a contagem de uso, ou `undefined`. */
export async function medidaPorId(db, id) {
    return (await db.query(`select ${COLUNAS} from core.medida m where m.id = $1 and m.deleted_at is null`, [id])).rows[0];
}
/** Siglas do tenant (ativas e inativas) para o domínio conferir produto/embalagem. */
export async function medidasDoTenant(db) {
    const r = await db.query('select sigla, ativo from core.medida where deleted_at is null');
    return new Map(r.rows.map((l) => [l.sigla, { ativo: l.ativo }]));
}
const erroDoBanco = (e) => (typeof e === 'object' && e !== null ? e : {});
/**
 * Traduz erro do banco em 422 amigável (nunca 500): 23505 = sigla repetida no tenant; 23503 = sigla de medida inexistente
 * em produto; 23514 = formato da sigla; bloqueio de apagar/trocar medida em uso.
 */
export function traduzirErroDeMedida(e) {
    const { code, message, constraint } = erroDoBanco(e);
    if (code === '23505')
        throw new ErroRegraNegocio(ERROS_MEDIDA.duplicada, 'Já existe uma medida com esta sigla. Use outra sigla ou edite a existente.');
    if (code === '23503') {
        // FK violada na própria `medida` = mexeram (apagar/trocar sigla) numa medida que produto ainda referencia; no `produto` = sigla inexistente.
        // (o `table` do erro do Postgres é a tabela que TEM a FK, o produto; quem mexeu é dito na mensagem.)
        if (/update or delete on table "?medida/i.test(message ?? '') || constraint === 'medida_em_uso' || /em uso|in use/i.test(message ?? ''))
            throw new ErroRegraNegocio(ERROS_MEDIDA.emUso, 'Medida em uso por produto(s): inative em vez de apagar.');
        throw new ErroRegraNegocio(ERROS_MEDIDA.naoCadastrada, 'Medida não cadastrada neste tenant. Cadastre-a em Parâmetros → Produtos → Medidas ou escolha outra.');
    }
    if (code === '23514')
        throw new ErroRegraNegocio(ERROS_MEDIDA.invalida, 'A sigla da medida deve ter de 1 a 4 letras maiúsculas. Corrija e tente de novo.');
    if (/em uso|in use/i.test(message ?? ''))
        throw new ErroRegraNegocio(ERROS_MEDIDA.emUso, 'Medida em uso por produto(s): inative em vez de apagar.');
    throw e;
}
/** Executa o SQL de escrita e converte erro de restrição do banco em 422. */
export async function comErroDeMedida(fn) {
    try {
        return await fn();
    }
    catch (e) {
        return traduzirErroDeMedida(e);
    }
}
function recusar(r) {
    throw new ErroRegraNegocio(r.codigo, r.mensagem);
}
export const rotasDeMedidas = [
    {
        metodo: 'GET',
        caminho: 'medidas',
        acao: 'produto.editar_preco',
        carteira: 'nao_se_aplica',
        executar: (ctx) => ctx.comTenant(async (db) => {
            const r = await db.query(`select ${COLUNAS} from core.medida m where m.deleted_at is null order by m.sigla, m.id`);
            return MedidasListaSchema.parse({ itens: r.rows });
        }),
    },
    {
        metodo: 'POST',
        caminho: 'medidas',
        acao: 'medida.gerenciar',
        carteira: 'nao_se_aplica',
        status: 201,
        corpo: MedidaCriarSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const c = ctx.corpo;
            const v = validarMedida(c);
            if (!v.ok)
                recusar(v);
            // Idempotência: o mesmo id já gravado devolve a medida existente, sem nova escrita nem nova auditoria.
            const existente = await medidaPorId(db, c.id);
            if (existente)
                return MedidaSchema.parse(existente);
            const igual = (await db.query('select id, deleted_at from core.medida where sigla = $1', [v.medida.sigla])).rows[0];
            if (igual && igual.deleted_at === null && igual.id === c.id) {
                // Corrida: a outra requisição com o MESMO id gravou entre a leitura por id e a leitura por sigla; devolve a medida dela.
                const jaCriada = await medidaPorId(db, c.id);
                if (jaCriada)
                    return MedidaSchema.parse(jaCriada);
            }
            if (igual && igual.deleted_at === null)
                throw new ErroRegraNegocio(ERROS_MEDIDA.duplicada, `Já existe a medida ${v.medida.sigla}. Use outra sigla ou edite a existente.`);
            const gravou = await comErroDeMedida(async () => {
                if (igual) {
                    // A sigla de uma medida apagada volta a ser usada: a linha apagada (sem uso) é reaproveitada com o id do cliente.
                    // Atenção: troca o PK; um aparelho que não sincronizou entre apagar e recriar guarda a medida antiga até o próximo
                    // pull completo (impacto baixo: o app procura a medida por sigla).
                    await db.query('update core.medida set id = $1, descricao = $3, ativo = true, deleted_at = null where id = $2', [c.id, igual.id, v.medida.descricao]);
                    return true;
                }
                // `on conflict (id) do nothing`: dois POST concorrentes com o MESMO id (retentativa do aparelho) devolvem a medida já criada
                // pela outra requisição; outro id com a mesma sigla bate no único `(tenant_id, sigla)` e vira 422 MEDIDA_DUPLICADA.
                const r = await db.query('insert into core.medida (id, tenant_id, sigla, descricao, ativo) values ($1, plataforma.tenant_atual(), $2, $3, true) on conflict (id) do nothing', [c.id, v.medida.sigla, v.medida.descricao]);
                return (r.rowCount ?? 0) > 0;
            });
            const criada = await medidaPorId(db, c.id);
            if (!criada)
                throw new ErroRegraNegocio(ERROS_MEDIDA.duplicada, `Já existe a medida ${v.medida.sigla}. Use outra sigla ou edite a existente.`);
            if (!gravou)
                return MedidaSchema.parse(criada); // a outra requisição já criou e auditou
            await auditar(db, ctx, { acao: 'medida.criar', entidade: 'medida', entidadeId: c.id, antes: null, depois: v.medida });
            return MedidaSchema.parse(criada);
        }),
    },
    {
        metodo: 'PUT',
        caminho: 'medidas/:id',
        acao: 'medida.gerenciar',
        carteira: 'nao_se_aplica',
        params: IdParam,
        corpo: MedidaEditarSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const c = ctx.corpo;
            const id = ctx.params.id;
            const antes = await medidaPorId(db, id);
            if (!antes)
                throw new ErroNaoEncontrado('MEDIDA_NAO_ENCONTRADA', 'Medida não encontrada. Atualize a lista e tente de novo.');
            const v = validarMedida({ sigla: c.sigla ?? antes.sigla, descricao: c.descricao ?? antes.descricao });
            if (!v.ok)
                recusar(v);
            const troca = decidirTrocaDeSigla({ siglaAtual: antes.sigla, siglaNova: v.medida.sigla, emUso: antes.em_uso });
            if (!troca.ok)
                recusar(troca);
            if (v.medida.sigla !== antes.sigla) {
                const duplicada = await db.query('select 1 from core.medida where sigla = $1 and id <> $2', [v.medida.sigla, id]);
                if ((duplicada.rowCount ?? 0) > 0)
                    throw new ErroRegraNegocio(ERROS_MEDIDA.duplicada, `Já existe a medida ${v.medida.sigla}. Use outra sigla.`);
            }
            const ativo = c.ativo ?? antes.ativo;
            // Sem mudança nenhuma (repetição do mesmo pedido): devolve como está, sem escrita nem auditoria.
            if (v.medida.sigla === antes.sigla && v.medida.descricao === antes.descricao && ativo === antes.ativo)
                return MedidaSchema.parse(antes);
            await comErroDeMedida(() => db.query('update core.medida set sigla = $2, descricao = $3, ativo = $4 where id = $1', [id, v.medida.sigla, v.medida.descricao, ativo]));
            const acao = ativo !== antes.ativo ? (ativo ? 'medida.reativar' : 'medida.inativar') : 'medida.editar';
            await auditar(db, ctx, { acao, entidade: 'medida', entidadeId: id, antes: { sigla: antes.sigla, descricao: antes.descricao, ativo: antes.ativo }, depois: { ...v.medida, ativo } });
            return MedidaSchema.parse(await medidaPorId(db, id));
        }),
    },
    {
        metodo: 'DELETE',
        caminho: 'medidas/:id',
        acao: 'medida.gerenciar',
        carteira: 'nao_se_aplica',
        status: 204,
        params: IdParam,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const id = ctx.params.id;
            const antes = await medidaPorId(db, id);
            if (!antes)
                throw new ErroNaoEncontrado('MEDIDA_NAO_ENCONTRADA', 'Medida não encontrada. Atualize a lista e tente de novo.');
            const d = decidirApagarMedida({ emUso: antes.em_uso });
            if (!d.ok)
                recusar(d);
            await comErroDeMedida(() => db.query('update core.medida set deleted_at = now() where id = $1', [id]));
            await auditar(db, ctx, { acao: 'medida.apagar', entidade: 'medida', entidadeId: id, antes: { sigla: antes.sigla, descricao: antes.descricao, ativo: antes.ativo }, depois: null });
            return null;
        }),
    },
];
/** `core.medidas@1` (RN-CORE-19): quais das siglas citadas existem no tenant (ativas e inativas). RLS do tenant de quem chama. */
export const consultaMedidas = implementarConsulta(CONSULTA_MEDIDAS, async (entrada, ctx) => {
    const siglas = [...new Set(entrada.siglas.map(normalizarSigla).filter((s) => s !== ''))];
    if (siglas.length === 0)
        return { medidas: [] };
    const r = await ctx.db.query('select sigla, descricao, ativo from core.medida where deleted_at is null and sigla = any($1::text[]) order by sigla', [siglas]);
    return { medidas: r.rows.map(({ sigla, descricao, ativo }) => ({ sigla, descricao, ativo })) };
});
