/**
 * Central de notificações (RF-CORE-09; desenho T-0016 §5; ADR 0009). Cada usuário só enxerga as próprias (pull
 * `proprio`); o envio do BKO/Gestão vai a usuários do escopo (`usuariosVisiveis`, RN-CORE-04) e é idempotente pelo `id`
 * do envio (único por destinatário). A leitura pelo aparelho é `notificacao_leitura` (só envio, `somente_insercao`).
 * O evento `core.notificacao.criada@1` não leva título nem corpo (dado pessoal fica no banco). O push real (Expo)
 * fica atrás de `MACUXI_PUSH_ATIVO` (ver `push.ts`): sem a configuração nada é enviado e a caixa funciona igual.
 */
import { definirEntidadeSync, type ClienteBanco, ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ContextoBase, type ItemPush, type ProvedorSync, type ResultadoItemPush, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  EnviarNotificacaoRespostaSchema,
  EnviarNotificacaoSchema,
  EVENTO_NOTIFICACAO_CRIADA,
  LeituraNotificacaoSchema,
  NotificacaoListaQuerySchema,
  NotificacaoSyncSchema,
  PushTokenSchema,
  RecadoDoDiaCorpoSchema,
  RecadoDoDiaDesmarcadoSchema,
  RecadoDoDiaMarcadoSchema,
  RecadoDoDiaParamsSchema,
  RECADO_DO_DIA_JANELA_DIAS,
  RecadosEnviadosQuerySchema,
  RecadosEnviadosRespostaSchema,
  type EnviarNotificacao,
  type EnviarNotificacaoResposta,
  type LeituraNotificacao,
  type RecadoDoDiaDesmarcado,
  type RecadoDoDiaMarcado,
} from '../contracts';
import { dataLocal } from '../domain';
import { auditar } from './auditoria';
import { BASE, sqlDoPull, type Tabela } from './sync';

const IdParam = z.object({ id: z.string().uuid() });
import { JANELAS_CORE } from './janelas-sync';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const TABELA_NOTIFICACAO: Tabela = {
  tabela: 'core.notificacao',
  colunas: `usuario_id, tipo, titulo, corpo, link, origem_modulo, autor_id, prioridade, to_char(lida_em at time zone 'UTC', ${UTC}) as lida_em, to_char(expira_em at time zone 'UTC', ${UTC}) as expira_em, to_char(recado_do_dia, 'YYYY-MM-DD') as recado_do_dia, (select u.nome from core.usuario u where u.id = autor_id) as autor_nome, (select u.perfil from core.usuario u where u.id = autor_id) as autor_perfil, subtipo`,
  colunaCliente: null,
  colunaUsuario: 'usuario_id',
  // desenho T-0016 §2: criada há ≤ 30 dias e não expirada (removidas passam sempre)
  janela: "created_at >= now() - interval '30 days' and (expira_em is null or expira_em > now())",
};

export const entidadeNotificacao = definirEntidadeSync({ nome: 'notificacao', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: NotificacaoSyncSchema, naJanela: JANELAS_CORE.notificacao });
/** Leitura: comando só de envio; ler duas vezes mantém a primeira hora (ADR 0009). */
export const entidadeNotificacaoLeitura = definirEntidadeSync({ nome: 'notificacao_leitura', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: LeituraNotificacaoSchema });

async function receberLeituras(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    const p = item.payload as LeituraNotificacao;
    // dono pelo usuário da sessão: notificação de outro usuário responde igual à inexistente
    const feito = await ctx.comTenant(async (db) => {
      const r = await db.query('update core.notificacao set lida_em = coalesce(lida_em, $2::timestamptz) where id = $1 and usuario_id = $3 and deleted_at is null', [p.notificacao_id, p.lida_em, ctx.usuario.id]);
      return (r.rowCount ?? 0) > 0;
    });
    saida.push(feito ? { id: item.id, status: 'aceito' } : { id: item.id, status: 'rejeitado', codigo: 'NOTIFICACAO_NAO_ENCONTRADA', mensagem: 'Notificação não encontrada. Atualize a caixa.' });
  }
  return saida;
}

export const provedoresDeNotificacao: readonly ProvedorSync[] = [
  {
    entidade: entidadeNotificacao,
    escopo: 'proprio',
    // RF-CORE-09: só as do próprio usuário, mesmo para quem enxerga a equipe
    puxar: (ctx, pedido) => {
      const { sql, valores } = sqlDoPull(TABELA_NOTIFICACAO, pedido, new Set([ctx.usuario.id]));
      return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as never);
    },
  },
  { entidade: entidadeNotificacaoLeitura, receber: receberLeituras },
];

const naoEncontrada = () => new ErroNaoEncontrado('NOTIFICACAO_NAO_ENCONTRADA', 'Notificação não encontrada. Atualize a lista e tente de novo.');
const recadoNaoEncontrado = () => new ErroNaoEncontrado('RECADO_NAO_ENCONTRADO', 'Recado não encontrado na sua equipe. Atualize a lista e tente de novo.');
const foraDoEscopo = () => new ErroHttpModulo(403, 'FORA_DO_ESCOPO', 'Você só pode enviar recados para pessoas da sua equipe. Revise os destinatários.');

/** Linhas (uma por destinatário) do envio de recado que estão no escopo de quem marca; `na_janela` = ainda vai ao aparelho (RN-CORE-26). */
async function linhasDoEnvio(db: ClienteBanco, envioId: string, visiveis: ReadonlySet<string> | 'tenant', agora: Date) {
  const lista = visiveis === 'tenant' ? null : [...visiveis];
  const r = await db.query<{ id: string; usuario_id: string; na_janela: boolean }>(
    `select id, usuario_id, (created_at >= $3::timestamptz - interval '${RECADO_DO_DIA_JANELA_DIAS} days' and (expira_em is null or expira_em > $3::timestamptz)) as na_janela
       from core.notificacao
      where envio_id = $1 and tipo = 'recado' and deleted_at is null and ($2::uuid[] is null or usuario_id = any($2::uuid[]))
      order by id`,
    [envioId, lista, agora.toISOString()],
  );
  return r.rows;
}

export const rotasDeNotificacoes: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'notificacoes',
    carteira: 'nao_se_aplica',
    query: NotificacaoListaQuerySchema,
    executar: async (ctx) => {
      const onde = ['usuario_id = $1', 'deleted_at is null', '(expira_em is null or expira_em > now())'];
      if (ctx.query.nao_lidas === 'true') onde.push('lida_em is null');
      if (ctx.query.nao_lidas === 'false') onde.push('lida_em is not null');
      const itens = await ctx.comTenant(
        async (db) =>
          (
            await db.query(`select ${BASE}, ${TABELA_NOTIFICACAO.colunas} from core.notificacao where ${onde.join(' and ')} order by created_at desc, id limit $2`, [ctx.usuario.id, ctx.query.limite])
          ).rows,
      );
      return { itens: z.array(NotificacaoSyncSchema).parse(itens) };
    },
  },
  {
    // Quem enviou (ou tem escopo sobre o destinatário, RN-CORE-04) vê a leitura por destinatário (T-0016 §5.5)
    metodo: 'GET',
    caminho: 'notificacoes/enviadas',
    acao: 'notificacao.enviar',
    carteira: 'nao_se_aplica',
    query: RecadosEnviadosQuerySchema,
    executar: async (ctx) => {
      const visiveis = await ctx.usuariosVisiveis();
      const lista = visiveis === 'tenant' ? null : [...visiveis];
      const itens = await ctx.comTenant(
        async (db) =>
          (
            await db.query(
              `select n.id, n.envio_id, n.titulo, n.prioridade, n.autor_id, n.usuario_id as destinatario_id, u.nome as destinatario_nome,
                      to_char(n.created_at at time zone 'UTC', ${UTC}) as enviada_em, to_char(n.lida_em at time zone 'UTC', ${UTC}) as lida_em, to_char(n.recado_do_dia, 'YYYY-MM-DD') as recado_do_dia
                 from core.notificacao n join core.usuario u on u.id = n.usuario_id
                where n.tipo = 'recado' and n.deleted_at is null
                  and (n.autor_id = $1 or (n.usuario_id <> $1 and ($2::uuid[] is null or n.usuario_id = any($2::uuid[]))))
                order by n.created_at desc, n.id limit $3`,
              [ctx.usuario.id, lista, ctx.query.limite],
            )
          ).rows,
      );
      return RecadosEnviadosRespostaSchema.parse({ itens });
    },
  },
  {
    metodo: 'POST',
    caminho: 'notificacoes',
    acao: 'notificacao.enviar',
    carteira: 'nao_se_aplica',
    corpo: EnviarNotificacaoSchema,
    executar: async (ctx): Promise<EnviarNotificacaoResposta> => {
      const c = ctx.corpo as EnviarNotificacao;
      const visiveis = await ctx.usuariosVisiveis();
      const alvos = await ctx.comTenant(async (db) => {
        if (c.usuario_ids) return [...new Set(c.usuario_ids)];
        return (await db.query<{ id: string }>('select id from core.usuario where equipe_id = $1 and deleted_at is null', [c.equipe_id])).rows.map((r) => r.id);
      });
      if (alvos.length === 0) throw new ErroHttpModulo(422, 'DESTINATARIO_VAZIO', 'A equipe escolhida não tem ninguém. Escolha outros destinatários.');
      if (visiveis !== 'tenant' && alvos.some((u) => !visiveis.has(u))) throw foraDoEscopo();
      return ctx.comTenant(async (db, tx) => {
        const existentes = await db.query<{ id: string }>('select id from core.usuario where id = any($1::uuid[]) and deleted_at is null', [alvos]);
        if (existentes.rows.length !== alvos.length) throw foraDoEscopo(); // inexistente ou de outro tenant (RLS): mesma resposta
        let criadas = 0;
        for (const uid of alvos) {
          const r = await db.query<{ id: string }>(
            `insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, autor_id, prioridade)
             values (plataforma.tenant_atual(), $1, 'recado', $2, $3, $4, 'core', $5, $6, $7)
             on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
             returning id`,
            [uid, c.titulo, c.corpo, c.link ?? null, c.id, ctx.usuario.id, c.prioridade],
          );
          if (r.rows[0]) {
            criadas++;
            await tx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: r.rows[0].id, usuario_id: uid, tipo: 'recado', prioridade: c.prioridade }, r.rows[0].id);
          }
        }
        if (criadas > 0) await auditar(db, ctx, { acao: 'notificacao.enviar', entidade: 'notificacao', entidadeId: c.id, antes: null, depois: { destinatarios: criadas, prioridade: c.prioridade } });
        return EnviarNotificacaoRespostaSchema.parse({ criadas, ja_existentes: alvos.length - criadas });
      });
    },
  },
  {
    // RN-CORE-26: marca o envio como recado do dia de HOJE (fuso do tenant, decidido aqui) para os destinatários do escopo
    metodo: 'PUT',
    caminho: 'notificacoes/envios/:envioId/recado-do-dia',
    acao: 'notificacao.recado_do_dia',
    carteira: 'filtrar_no_dominio',
    params: RecadoDoDiaParamsSchema,
    corpo: RecadoDoDiaCorpoSchema,
    executar: async (ctx): Promise<RecadoDoDiaMarcado> => {
      const visiveis = await ctx.usuariosVisiveis();
      const hoje = dataLocal(ctx.agora(), ctx.fuso());
      const envioId = ctx.params.envioId;
      return ctx.comTenant(async (db) => {
        const linhas = await linhasDoEnvio(db, envioId, visiveis, ctx.agora());
        if (linhas.length === 0) throw recadoNaoEncontrado();
        // só se marca recado que ainda vai ao aparelho (criado há ≤ 30 dias e não expirado)
        const alvo = linhas.filter((l) => l.na_janela);
        if (alvo.length === 0) throw new ErroRegraNegocio('RN-CORE-26', 'Este recado é antigo demais para virar recado do dia. Envie um recado novo.');
        const usuarios = [...new Set(alvo.map((l) => l.usuario_id))];
        // um por pessoa por dia: a marcação de hoje de OUTRO envio sai dos mesmos destinatários, antes de gravar esta (índice único da 0021)
        const outras = await db.query(
          `update core.notificacao set recado_do_dia = null, recado_do_dia_por = null
            where usuario_id = any($1::uuid[]) and recado_do_dia = $2::date and envio_id is distinct from $3::uuid and deleted_at is null`,
          [usuarios, hoje, envioId],
        );
        const nova = await db.query('update core.notificacao set recado_do_dia = $2::date, recado_do_dia_por = $3 where id = any($1::uuid[]) and recado_do_dia is distinct from $2::date', [alvo.map((l) => l.id), hoje, ctx.usuario.id]);
        const desmarcadas_outras = outras.rowCount ?? 0;
        if ((nova.rowCount ?? 0) > 0 || desmarcadas_outras > 0) {
          await auditar(db, ctx, { acao: 'notificacao.recado_do_dia', entidade: 'notificacao', entidadeId: envioId, antes: null, depois: { envio_id: envioId, dia: hoje, marcadas: alvo.length, desmarcadas_outras } });
        }
        return RecadoDoDiaMarcadoSchema.parse({ envio_id: envioId, dia: hoje, marcadas: alvo.length, desmarcadas_outras });
      });
    },
  },
  {
    metodo: 'DELETE',
    caminho: 'notificacoes/envios/:envioId/recado-do-dia',
    acao: 'notificacao.recado_do_dia',
    carteira: 'filtrar_no_dominio',
    params: RecadoDoDiaParamsSchema,
    executar: async (ctx): Promise<RecadoDoDiaDesmarcado> => {
      const visiveis = await ctx.usuariosVisiveis();
      const hoje = dataLocal(ctx.agora(), ctx.fuso());
      const envioId = ctx.params.envioId;
      return ctx.comTenant(async (db) => {
        const linhas = await linhasDoEnvio(db, envioId, visiveis, ctx.agora());
        if (linhas.length === 0) throw recadoNaoEncontrado();
        const r = await db.query('update core.notificacao set recado_do_dia = null, recado_do_dia_por = null where id = any($1::uuid[]) and recado_do_dia = $2::date', [linhas.map((l) => l.id), hoje]);
        const desmarcadas = r.rowCount ?? 0;
        if (desmarcadas > 0) await auditar(db, ctx, { acao: 'notificacao.recado_do_dia', entidade: 'notificacao', entidadeId: envioId, antes: { envio_id: envioId, dia: hoje, marcadas: desmarcadas }, depois: { envio_id: envioId, dia: null, marcadas: 0 } });
        return RecadoDoDiaDesmarcadoSchema.parse({ envio_id: envioId, desmarcadas });
      });
    },
  },
  {
    metodo: 'POST',
    caminho: 'notificacoes/:id/lida',
    acao: 'notificacao.ler',
    carteira: 'nao_se_aplica',
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const r = await db.query('update core.notificacao set lida_em = coalesce(lida_em, now()) where id = $1 and usuario_id = $2 and deleted_at is null', [ctx.params.id, ctx.usuario.id]);
        if ((r.rowCount ?? 0) === 0) throw naoEncontrada();
        return { id: ctx.params.id, lida: true };
      }),
  },
  {
    // Token do Expo do aparelho; só grava (o envio real depende do build EAS e de MACUXI_PUSH_ATIVO)
    metodo: 'PUT',
    caminho: 'dispositivos/atual/push',
    acao: 'dispositivo.registrar_push',
    carteira: 'nao_se_aplica',
    corpo: PushTokenSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        // O token é só do usuário da sessão: sai de qualquer outro aparelho/usuário do tenant (mesma transação)
        await db.query('update core.dispositivo set push_token = null, push_plataforma = null where push_token = $1 and id <> $2', [ctx.corpo.token, ctx.corpo.dispositivo_id]);
        const r = await db.query(
          'update core.dispositivo set push_token = $2, push_plataforma = $3, push_atualizado_em = now() where id = $1 and usuario_id = $4 and bloqueado_em is null and deleted_at is null',
          [ctx.corpo.dispositivo_id, ctx.corpo.token, ctx.corpo.plataforma, ctx.usuario.id],
        );
        if ((r.rowCount ?? 0) === 0) throw new ErroNaoEncontrado('DISPOSITIVO_NAO_ENCONTRADO', 'Aparelho não encontrado. Entre de novo no app e tente outra vez.');
        return { ok: true };
      }),
  },
  {
    // Logout do app: apaga o token do aparelho do usuário da sessão (idempotente)
    metodo: 'DELETE',
    caminho: 'dispositivos/atual/push',
    acao: 'dispositivo.registrar_push',
    carteira: 'nao_se_aplica',
    query: z.object({ dispositivo_id: z.string().uuid() }).strict(),
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        await db.query('update core.dispositivo set push_token = null, push_plataforma = null where id = $1 and usuario_id = $2', [ctx.query.dispositivo_id, ctx.usuario.id]);
        return { ok: true };
      }),
  },
];
