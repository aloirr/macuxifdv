/**
 * Aparelhos no BKO (RN-CORE-15): listar, bloquear e desbloquear. O bloqueio vale para o TENANT inteiro: o aparelho
 * bloqueado não autentica nenhum usuário (login/refresh respondem 423 `DISPOSITIVO_BLOQUEADO` a quem acertou a
 * senha/tem sessão) e o app apaga os dados do tenant e a fila não enviada na próxima conexão. Só admin e analista
 * (ação `dispositivo.bloquear`); a mudança é auditada (RN-AUD-01). As sessões NÃO são revogadas aqui de propósito:
 * o refresh do aparelho precisa chegar à API para o app receber o 423 e limpar; ele revoga a família nesse momento.
 */
import { ErroNaoEncontrado } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { BloquearDispositivoRequestSchema, DispositivoItemSchema, DispositivoListaQuerySchema } from '../contracts';
import { auditar } from './auditoria';
const IdParam = z.object({ id: z.string().uuid() });
const naoEncontrado = () => new ErroNaoEncontrado('DISPOSITIVO_NAO_ENCONTRADO', 'Aparelho não encontrado. Atualize a lista e tente de novo.');
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
export const rotasDeDispositivos = [
    {
        metodo: 'GET',
        caminho: 'dispositivos',
        perfis: ['admin', 'analista'],
        carteira: 'nao_se_aplica',
        query: DispositivoListaQuerySchema,
        executar: async (ctx) => {
            const valores = [];
            const onde = ['d.deleted_at is null'];
            if (ctx.query.bloqueado)
                onde.push(ctx.query.bloqueado === 'true' ? 'd.bloqueado_em is not null' : 'd.bloqueado_em is null');
            if (ctx.query.q) {
                valores.push(`%${ctx.query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
                onde.push(`(u.nome ilike $1 or d.nome ilike $1)`);
            }
            const itens = await ctx.comTenant(async (db) => (await db.query(`select d.id, d.usuario_id, u.nome as usuario_nome, d.nome, d.plataforma,
                    to_char(d.ultimo_acesso_em at time zone 'UTC', ${ISO}) as ultimo_acesso_em,
                    to_char(d.bloqueado_em at time zone 'UTC', ${ISO}) as bloqueado_em
               from core.dispositivo d join core.usuario u on u.id = d.usuario_id
              where ${onde.join(' and ')}
              order by d.bloqueado_em desc nulls last, u.nome, d.id limit 500`, valores)).rows);
            return { itens: z.array(DispositivoItemSchema).parse(itens) };
        },
    },
    {
        metodo: 'PUT',
        caminho: 'dispositivos/:id/bloqueio',
        acao: 'dispositivo.bloquear',
        carteira: 'nao_se_aplica',
        params: IdParam,
        corpo: BloquearDispositivoRequestSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const antes = await db.query('select bloqueado_em from core.dispositivo where id = $1 and deleted_at is null', [ctx.params.id]);
            if (!antes.rows[0])
                throw naoEncontrado();
            // idempotente: bloquear de novo mantém o instante do primeiro bloqueio
            await db.query('update core.dispositivo set bloqueado_em = coalesce(bloqueado_em, now()) where id = $1', [ctx.params.id]);
            await auditar(db, ctx, {
                acao: 'dispositivo.bloquear',
                entidade: 'dispositivo',
                entidadeId: ctx.params.id,
                antes: { bloqueado: antes.rows[0].bloqueado_em !== null },
                depois: { bloqueado: true, motivo: ctx.corpo.motivo ?? null },
            });
            return { id: ctx.params.id, bloqueado: true };
        }),
    },
    {
        metodo: 'DELETE',
        caminho: 'dispositivos/:id/bloqueio',
        acao: 'dispositivo.bloquear',
        carteira: 'nao_se_aplica',
        params: IdParam,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const antes = await db.query('select bloqueado_em from core.dispositivo where id = $1 and deleted_at is null', [ctx.params.id]);
            if (!antes.rows[0])
                throw naoEncontrado();
            await db.query('update core.dispositivo set bloqueado_em = null where id = $1', [ctx.params.id]);
            await auditar(db, ctx, {
                acao: 'dispositivo.desbloquear',
                entidade: 'dispositivo',
                entidadeId: ctx.params.id,
                antes: { bloqueado: antes.rows[0].bloqueado_em !== null },
                depois: { bloqueado: false },
            });
            return { id: ctx.params.id, bloqueado: false };
        }),
    },
];
