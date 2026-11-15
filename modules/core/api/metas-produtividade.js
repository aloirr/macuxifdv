/**
 * Metas de produtividade do BKO (RN-CORE-45; T-0170; desenho `docs/desenho/performance-produtividade.md` §6 e §7.3):
 * - `GET /v1/core/metas-produtividade`: as linhas vivas do escopo de quem lê (`{ itens }`), para a tela resolver "Vale hoje".
 * - `PUT /v1/core/metas-produtividade` (lote, ação `meta_produtividade.editar`): grava os indicadores do alvo (empresa, equipe
 *   ou usuário) a partir da vigência. Idempotente por (alvo, indicador, vigência): repetir o mesmo corpo não muda nada.
 * - `DELETE /v1/core/metas-produtividade/:id` ("voltar a herdar"): apaga a linha do alvo (`deleted_at`) e passa a valer o nível de cima.
 * A validação (faixas, vigência ≥ mês de hoje, ordem dos check-ins na meta resolvida) é do domain (`validarMetaProdutividade`);
 * a API só confere a existência e o escopo de quem edita (RN-CORE-04): empresa só para quem enxerga o tenant (analista e
 * admin); equipe só abaixo de quem edita (gerente); usuário só do escopo. Erro de negócio: 422 `META_PRODUTIVIDADE_INVALIDA`
 * com `detalhes.campo` e `detalhes.erros`. Auditoria `meta_produtividade.editar` com antes e depois de cada linha (RN-AUD-01).
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ESCOPOS_META_PRODUTIVIDADE, MetaProdutividadeSchema, MetasProdutividadePutSchema } from '../contracts/performance';
import { dataLocal } from '../domain';
import { validarMetaProdutividade } from '../domain/performance/metas-produtividade';
import { auditar } from './auditoria';
import { EQUIPES_DO_RESPONSAVEL } from './carteira';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const IdParam = z.object({ id: z.string().uuid() }).strict();
const ListaQuerySchema = z
    .object({ escopo: z.enum(ESCOPOS_META_PRODUTIVIDADE).optional(), alvo_id: z.string().uuid().optional(), vigencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
    .strict();
const COLUNAS = `id, escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, to_char(deleted_at at time zone 'UTC', ${UTC}) as deleted_at`;
const foraDoEscopo = () => new ErroHttpModulo(403, 'FORA_DO_ESCOPO', 'Você só pode definir metas da sua empresa, das equipes abaixo de você ou de pessoas da sua equipe. Revise o alvo.');
const usuarioNaoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
const equipeNaoEncontrada = () => new ErroNaoEncontrado('EQUIPE_NAO_ENCONTRADA', 'Equipe não encontrada. Atualize a lista e tente de novo.');
async function equipesDaArvore(db) {
    return (await db.query('select id, equipe_pai_id from core.equipe where deleted_at is null')).rows;
}
/** Equipes que o usuário responde e as abaixo delas (RN-CORE-04). */
async function equipesDoEditor(db, editorId) {
    const r = await db.query(`${EQUIPES_DO_RESPONSAVEL} select id from eq`, [editorId]);
    return new Set(r.rows.map((l) => l.id));
}
/** Confere a existência e o escopo de edição do alvo; devolve a equipe do usuário-alvo (para a meta herdada). */
async function conferirAlvo(db, editorId, visiveis, a) {
    const tenantInteiro = visiveis === 'tenant';
    if (a.escopo === 'tenant') {
        if (!tenantInteiro)
            throw foraDoEscopo();
        return { equipe_do_usuario: null };
    }
    if (a.escopo === 'equipe') {
        const e = await db.query('select 1 from core.equipe where id = $1 and deleted_at is null', [a.equipe_id]);
        if (e.rows.length === 0)
            throw equipeNaoEncontrada();
        if (!tenantInteiro && !(await equipesDoEditor(db, editorId)).has(a.equipe_id))
            throw foraDoEscopo();
        return { equipe_do_usuario: null };
    }
    const u = (await db.query('select perfil, ativo, equipe_id from core.usuario where id = $1 and deleted_at is null', [a.usuario_id])).rows[0];
    if (!u)
        throw usuarioNaoEncontrado();
    if (!tenantInteiro && !visiveis.has(a.usuario_id))
        throw foraDoEscopo();
    if (u.perfil !== 'vendedor' && u.perfil !== 'promotor') {
        throw new ErroRegraNegocio('META_PRODUTIVIDADE_INVALIDA', 'Meta de produtividade só vale para vendedor ou promotor. Escolha outro usuário.', {
            campo: 'usuario_id',
            erros: [{ campo: 'usuario_id', mensagem: 'Meta de produtividade só vale para vendedor ou promotor.' }],
        });
    }
    return { equipe_do_usuario: u.equipe_id };
}
const alvoDoCorpo = (c) => c.escopo === 'tenant' ? { escopo: 'tenant' } : c.escopo === 'equipe' ? { escopo: 'equipe', equipe_id: c.equipe_id } : { escopo: 'usuario', usuario_id: c.usuario_id };
const chaveDoAlvo = (a) => (a.escopo === 'tenant' ? 'tenant' : a.escopo === 'equipe' ? `equipe:${a.equipe_id}` : `usuario:${a.usuario_id}`);
async function linhasVivas(db) {
    return (await db.query('select escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio from core.meta_produtividade where deleted_at is null')).rows;
}
export const rotasDeMetasProdutividade = [
    {
        // o recorte é o do escopo: empresa para todos; equipe e usuário só do escopo, mais as equipes acima (a herança aparece na tela)
        metodo: 'GET',
        caminho: 'metas-produtividade',
        acao: 'meta.ver',
        carteira: 'filtrar_no_dominio',
        query: ListaQuerySchema,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const q = ctx.query;
            return ctx.comTenant(async (db) => {
                const lista = visiveis === 'tenant' ? null : [...visiveis];
                const r = await db.query(`with recursive proprias as (
             select distinct equipe_id as id from core.usuario where deleted_at is null and equipe_id is not null and ($1::uuid[] is null or id = any($1::uuid[]))
           ), arvore as (
             select e.id, e.equipe_pai_id from core.equipe e join proprias p on p.id = e.id where e.deleted_at is null
             union
             select e.id, e.equipe_pai_id from core.equipe e join arvore a on a.equipe_pai_id = e.id where e.deleted_at is null
           )
           select ${COLUNAS} from core.meta_produtividade m
            where m.deleted_at is null
              and (m.escopo = 'tenant'
                   or ($1::uuid[] is null)
                   or (m.escopo = 'usuario' and m.usuario_id = any($1::uuid[]))
                   or (m.escopo = 'equipe' and m.equipe_id in (select id from arvore)))
              and ($2::text is null or m.escopo = $2)
              and ($3::uuid is null or m.equipe_id = $3 or m.usuario_id = $3)
              and ($4::text is null or m.vigencia_inicio <= $4)
            order by m.escopo, m.indicador, m.vigencia_inicio, m.id`, [lista, q.escopo ?? null, q.alvo_id ?? null, q.vigencia ?? null]);
                return { itens: z.array(MetaProdutividadeSchema).parse(r.rows) };
            });
        },
    },
    {
        metodo: 'PUT',
        caminho: 'metas-produtividade',
        acao: 'meta_produtividade.editar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        corpo: MetasProdutividadePutSchema,
        executar: async (ctx) => {
            const c = ctx.corpo;
            const visiveis = await ctx.usuariosVisiveis();
            const mesHoje = dataLocal(ctx.agora(), ctx.fuso()).slice(0, 7);
            return ctx.comTenant(async (db) => {
                const alvo = alvoDoCorpo(c);
                await db.query('select pg_advisory_xact_lock(hashtext($1))', [`meta_produtividade:${chaveDoAlvo(alvo)}`]);
                const { equipe_do_usuario } = await conferirAlvo(db, ctx.usuario.id, visiveis, alvo);
                const v = validarMetaProdutividade({
                    edicao: { escopo: c.escopo, equipe_id: c.equipe_id, usuario_id: c.usuario_id, vigencia_inicio: c.vigencia_inicio, metas: c.metas },
                    mes_hoje: mesHoje,
                    linhas: await linhasVivas(db),
                    equipes: await equipesDaArvore(db),
                    equipe_do_usuario,
                });
                if (!v.ok) {
                    const primeiro = v.erros[0];
                    throw new ErroRegraNegocio(v.codigo, primeiro.mensagem, { campo: primeiro.campo, erros: v.erros });
                }
                const antes = [];
                const depois = [];
                const ids = [];
                for (const m of c.metas) {
                    const atual = (await db.query(`select id, valor from core.meta_produtividade
                where deleted_at is null and escopo = $1 and coalesce(equipe_id, usuario_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, $3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                  and indicador = $4 and vigencia_inicio = $5`, [c.escopo, c.equipe_id, c.usuario_id, m.indicador, c.vigencia_inicio])).rows[0];
                    if (atual && atual.valor === m.valor) {
                        ids.push(atual.id);
                        continue;
                    }
                    if (atual) {
                        await db.query('update core.meta_produtividade set valor = $2, atualizado_por = $3 where id = $1', [atual.id, m.valor, ctx.usuario.id]);
                        ids.push(atual.id);
                    }
                    else {
                        const n = await db.query(`insert into core.meta_produtividade (tenant_id, escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio, atualizado_por)
               values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7) returning id`, [c.escopo, c.equipe_id, c.usuario_id, m.indicador, m.valor, c.vigencia_inicio, ctx.usuario.id]);
                        ids.push(n.rows[0].id);
                    }
                    antes.push({ indicador: m.indicador, valor: atual?.valor ?? null });
                    depois.push({ indicador: m.indicador, valor: m.valor });
                }
                if (depois.length > 0) {
                    await auditar(db, ctx, {
                        acao: 'meta_produtividade.editar',
                        entidade: 'meta_produtividade',
                        entidadeId: c.usuario_id ?? c.equipe_id ?? ctx.usuario.tenant_id,
                        antes: { escopo: c.escopo, vigencia_inicio: c.vigencia_inicio, metas: antes },
                        depois: { escopo: c.escopo, vigencia_inicio: c.vigencia_inicio, metas: depois },
                    });
                }
                const r = await db.query(`select ${COLUNAS} from core.meta_produtividade where id = any($1::uuid[]) order by indicador`, [ids]);
                return { itens: z.array(MetaProdutividadeSchema).parse(r.rows), gravadas: depois.length, inalteradas: c.metas.length - depois.length };
            });
        },
    },
    {
        metodo: 'DELETE',
        caminho: 'metas-produtividade/:id',
        acao: 'meta_produtividade.editar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        params: IdParam,
        executar: async (ctx) => {
            const { id } = ctx.params;
            const visiveis = await ctx.usuariosVisiveis();
            return ctx.comTenant(async (db) => {
                const m = (await db.query('select escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio, deleted_at from core.meta_produtividade where id = $1', [id])).rows[0];
                if (!m)
                    throw new ErroNaoEncontrado('META_NAO_ENCONTRADA', 'Meta não encontrada. Atualize a lista e tente de novo.');
                if (m.deleted_at !== null)
                    return { id, removida: true };
                const alvo = m.escopo === 'tenant' ? { escopo: 'tenant' } : m.escopo === 'equipe' ? { escopo: 'equipe', equipe_id: m.equipe_id } : { escopo: 'usuario', usuario_id: m.usuario_id };
                // "voltar a herdar" também vale para quem saiu da equipe ou virou outro perfil: só o escopo conta
                if (alvo.escopo === 'usuario') {
                    if (visiveis !== 'tenant' && !visiveis.has(alvo.usuario_id))
                        throw foraDoEscopo();
                }
                else
                    await conferirAlvo(db, ctx.usuario.id, visiveis, alvo);
                await db.query('update core.meta_produtividade set deleted_at = now(), atualizado_por = $2 where id = $1', [id, ctx.usuario.id]);
                await auditar(db, ctx, {
                    acao: 'meta_produtividade.editar',
                    entidade: 'meta_produtividade',
                    entidadeId: id,
                    antes: { escopo: m.escopo, indicador: m.indicador, valor: m.valor, vigencia_inicio: m.vigencia_inicio },
                    depois: null,
                });
                return { id, removida: true };
            });
        },
    },
];
