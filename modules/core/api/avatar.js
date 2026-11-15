/**
 * Foto ou avatar do usuário (RN-CORE-42; T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §1.2, §1.3 e §2.2 a §2.4).
 * Uma linha por troca em `core.usuario_avatar`; a viva é a escolha atual. A decisão (idempotência, a última troca vence pelo
 * `alterado_em`, relógio adiantado) é do domain (`aplicarTrocaAvatar`); aqui se lê e se grava, tudo na mesma transação.
 * - Aparelho: `receberAvatares` (push `usuario_avatar`, ação `usuario_avatar.trocar`): só o próprio usuário (403 `FORA_DO_ESCOPO`).
 * - BKO: `PUT /v1/core/usuarios/:id/avatar` (ação `usuario_avatar.trocar_outro`), recortado pelo escopo de `usuariosVisiveis`
 *   (fora dele = 404). A foto vai depois por `PUT /v1/arquivos/:arquivo_id` (teto de 300 KB na rota de arquivos, RN-CORE-42).
 * A foto é registrada com `tx.registrarArquivo` (finalidade `avatar`, sem `cliente_id`); ao trocar, a linha anterior e o arquivo
 * dela ficam apagados logicamente. Sem evento. Sem dado pessoal em log: só ids.
 */
import { ErroHttpModulo, ErroNaoEncontrado } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { UsuarioAvatarPushSchema } from '../contracts/avatar';
import { aplicarTrocaAvatar } from '../domain/frase-avatar/avatar';
import { idDoPayloadConfere } from '../domain/idempotencia';
import { auditar } from './auditoria';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const UsuarioParam = z.object({ id: z.string().uuid() }).strict();
const foraDoEscopo = () => new ErroHttpModulo(403, 'FORA_DO_ESCOPO', 'Você só pode trocar a foto da sua própria conta. Abra o seu perfil e tente de novo.');
/** Grava uma troca na transação do tenant. Lança `ErroHttpModulo` (403, 404, 409); o chamador decide a resposta. */
export async function aplicarTrocaNoBanco(db, tx, troca, c) {
    // serializa as trocas do mesmo usuário (uma viva por usuário)
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`usuario_avatar:${troca.usuario_id}`]);
    const dono = (await db.query('select usuario_id from core.usuario_avatar where id = $1', [troca.id])).rows[0];
    if (dono && dono.usuario_id !== troca.usuario_id)
        throw new ErroHttpModulo(409, 'ID_EM_USO', 'Este identificador de troca já pertence a outro registro. Gere um novo e tente de novo.');
    const existe = await db.query('select 1 from core.usuario where id = $1 and deleted_at is null', [troca.usuario_id]);
    if (existe.rows.length === 0)
        throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
    const viva = (await db.query(`select id, usuario_id, tipo, avatar_codigo, arquivo_id, to_char(alterado_em at time zone 'UTC', ${UTC}) as alterado_em from core.usuario_avatar where usuario_id = $1 and deleted_at is null`, [troca.usuario_id])).rows[0] ?? null;
    const d = aplicarTrocaAvatar(viva, dono ? [troca.id] : [], troca, { usuario_id: c.usuario_id, pode_trocar_outro: c.pode_trocar_outro, agora: c.agora });
    if (d.acao === 'recusar')
        throw foraDoEscopo();
    if (d.acao === 'nada')
        return 'ja_existia';
    if (d.acao === 'substituir') {
        if (d.apagar_id)
            await db.query('update core.usuario_avatar set deleted_at = now() where id = $1', [d.apagar_id]);
        if (d.apagar_arquivo_id)
            await db.query("update plataforma.arquivo set deleted_at = now() where id = $1 and entidade = 'usuario_avatar' and deleted_at is null", [d.apagar_arquivo_id]);
    }
    await db.query(`insert into core.usuario_avatar (id, tenant_id, usuario_id, tipo, avatar_codigo, arquivo_id, alterado_em, alterado_por, deleted_at)
     values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6::timestamptz, $7, case when $8 then now() else null end)`, [troca.id, troca.usuario_id, troca.tipo, troca.avatar_codigo, troca.arquivo_id, d.alterado_em, c.usuario_id, d.acao === 'gravar_superada']);
    if (troca.tipo === 'foto' && troca.arquivo_id) {
        await tx.registrarArquivo({ id: troca.arquivo_id, finalidade: 'avatar', entidade: 'usuario_avatar', entidade_id: troca.id, cliente_id: null, tipo: 'image/jpeg' });
    }
    return d.acao === 'substituir' ? 'aplicada' : 'superada';
}
const rejeitado = (id, codigo, mensagem) => ({ id, status: 'rejeitado', codigo, mensagem });
/** Push `usuario_avatar`: comando do aparelho (o usuário só troca a própria). Idempotente pelo `id` da troca. */
export async function receberAvatares(ctx, itens) {
    const saida = [];
    for (const item of itens) {
        if (item.operacao === 'remover') {
            saida.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'A troca de foto não pode ser removida. Escolha as iniciais para voltar ao padrão.'));
            continue;
        }
        if (!idDoPayloadConfere(item.id, item.payload)) {
            saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.'));
            continue;
        }
        const valido = UsuarioAvatarPushSchema.safeParse(item.payload);
        if (!valido.success) {
            saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'Os dados da troca de foto estão incompletos. Atualize o app e tente de novo.'));
            continue;
        }
        const troca = valido.data;
        try {
            await ctx.comTenant((db, tx) => aplicarTrocaNoBanco(db, tx, troca, { usuario_id: ctx.usuario.id, pode_trocar_outro: false, agora: ctx.agora() }));
            saida.push({ id: item.id, status: 'aceito' });
        }
        catch (e) {
            if (!(e instanceof ErroHttpModulo) || e.status >= 500)
                throw e;
            saida.push(rejeitado(item.id, e.codigo, e.message));
        }
    }
    return saida;
}
export const rotasDeAvatar = [
    {
        // BKO: troca a foto ou o avatar de um usuário do escopo (RN-CORE-42). O corpo é o mesmo comando do aparelho.
        metodo: 'PUT',
        caminho: 'usuarios/:id/avatar',
        acao: 'usuario_avatar.trocar_outro',
        superficie: 'bko',
        carteira: 'nao_se_aplica',
        params: UsuarioParam,
        corpo: UsuarioAvatarPushSchema,
        executar: async (ctx) => {
            const { id } = ctx.params;
            const troca = ctx.corpo;
            if (troca.usuario_id !== id)
                throw new ErroHttpModulo(422, 'AVATAR_USUARIO_DIFERENTE', 'O usuário do corpo não é o da página. Recarregue a página e tente de novo.');
            const visiveis = await ctx.usuariosVisiveis();
            // fora do escopo é 404, como nas outras rotas do BKO: não revela quem existe fora da equipe
            if (visiveis !== 'tenant' && !visiveis.has(id))
                throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');
            return ctx.comTenant(async (db, tx) => {
                const resultado = await aplicarTrocaNoBanco(db, tx, troca, { usuario_id: ctx.usuario.id, pode_trocar_outro: true, agora: ctx.agora() });
                if (resultado !== 'ja_existia')
                    await auditar(db, ctx, { acao: 'usuario_avatar.trocar_outro', entidade: 'usuario', entidadeId: id, antes: null, depois: { troca_id: troca.id, tipo: troca.tipo, resultado } });
                ctx.log.info({ usuario_id: id, troca_id: troca.id, resultado }, 'avatar trocado pelo BKO');
                return { id: troca.id, usuario_id: id, tipo: troca.tipo, avatar_codigo: troca.avatar_codigo, arquivo_id: troca.arquivo_id, resultado };
            });
        },
    },
];
