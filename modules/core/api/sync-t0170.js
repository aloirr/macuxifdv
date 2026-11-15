/**
 * Provedores de sync da T-0170 (SEM registrar: a costura do PC acrescenta `provedoresSyncT0170` em `sync: [...]` do `index.ts`):
 * - `tarefa` (pull, escopo `proprio`): a linha do destinatário com os dados da tarefa; abertas e não canceladas SEMPRE, concluídas
 *   ou canceladas por 30 dias (desenho `tarefas-consultor.md` §5). `tarefa_conclusao` (push, comando, `somente_insercao`).
 * - `frase_dia` (pull, escopo tenant, inclui removidas) — RN-CORE-41.
 * - `usuario_avatar` (pull com escopo de usuários visíveis + push do próprio usuário) — RN-CORE-42.
 * - `meta_produtividade` (pull, tenant, todas as vivas, sem janela) e `deslocamento_dia` (pull, usuários visíveis, janela do mês
 *   passado inteiro) — RN-CORE-45/46 (`performance-produtividade.md` §7.2).
 * Todos seguem o padrão de `sync.ts`: `updated_at < pedido.ate`, `(updated_at, id) > desde`, `limit`, removidos incluídos.
 */
import { diasAntes, definirEntidadeSync } from '@macuxi/platform-sdk';
import { UsuarioAvatarPushSchema, UsuarioAvatarSyncSchema } from '../contracts/avatar';
import { FraseDiaSyncSchema } from '../contracts/frases';
import { DeslocamentoDiaSchema, MetaProdutividadeSchema } from '../contracts/performance';
import { ConclusaoTarefaSchema, TarefaSyncSchema } from '../contracts/tarefa';
import { dataLocal } from '../domain';
import { receberAvatares } from './avatar';
import { dataDesdeMesAnteriorOu40, janelaMesAnteriorOu40 } from './janelas-sync';
import { sqlDoPull } from './sync';
import { receberConclusoesTarefa } from './tarefas';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
export const TABELAS_SYNC_T0170 = {
    // a linha do destinatário com os dados da tarefa; `deleted_at` = o da linha ou o da tarefa (o aparelho apaga nos dois casos)
    tarefa: {
        tabela: `(select d.id, d.updated_at, coalesce(d.deleted_at, t.deleted_at) as deleted_at, d.external_id, d.usuario_id, d.tarefa_id, t.titulo, t.descricao,
        to_char(t.prazo, 'YYYY-MM-DD') as prazo, t.tipo, t.cliente_id,
        (select coalesce(c.nome_fantasia, c.razao_social) from core.cliente c where c.id = t.cliente_id) as cliente_nome, t.questionario_id,
        (select u.nome from core.usuario u where u.id = t.autor_id) as autor_nome, (select u.perfil from core.usuario u where u.id = t.autor_id) as autor_perfil,
        to_char(d.concluida_em at time zone 'UTC', ${UTC}) as concluida_em, to_char(t.cancelada_em at time zone 'UTC', ${UTC}) as cancelada_em,
        d.concluida_em as concluida_ts, t.cancelada_em as cancelada_ts
      from core.tarefa_destinatario d join core.tarefa t on t.tenant_id = d.tenant_id and t.id = d.tarefa_id) as tarefa`,
        colunas: 'usuario_id, tarefa_id, titulo, descricao, prazo, tipo, cliente_id, cliente_nome, questionario_id, autor_nome, autor_perfil, concluida_em, cancelada_em',
        colunaCliente: null,
        colunaUsuario: 'usuario_id',
        // abertas e não canceladas passam sempre; concluída ou cancelada, até 30 dias depois
        janela: '((concluida_ts is null and cancelada_ts is null) or greatest(concluida_ts, cancelada_ts)::date >= {{hoje}} - 30)',
    },
    frase_dia: { tabela: 'core.frase_dia', colunas: 'texto, ativa, ordem, padrao_codigo', colunaCliente: null },
    usuario_avatar: {
        tabela: 'core.usuario_avatar',
        colunas: `usuario_id, tipo, avatar_codigo, arquivo_id, to_char(alterado_em at time zone 'UTC', ${UTC}) as alterado_em, alterado_por`,
        colunaCliente: null,
        colunaUsuario: 'usuario_id',
    },
    meta_produtividade: { tabela: 'core.meta_produtividade', colunas: 'escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio', colunaCliente: null },
    deslocamento_dia: {
        tabela: 'core.deslocamento_dia',
        colunas: "usuario_id, to_char(data, 'YYYY-MM-DD') as data, metros, pontos, origem",
        colunaCliente: null,
        colunaUsuario: 'usuario_id',
        // a janela das visitas passa a ser data >= least(hoje − 40, início do mês anterior), para o Mês passado inteiro (§7.2)
        janela: janelaMesAnteriorOu40('data'),
    },
};
const texto = (v) => (typeof v === 'string' ? v : null);
/** Poda local (ADR 0009 §5): espelha a `janela` de cada tabela e devolve `true` na dúvida. */
export const JANELAS_T0170 = {
    /** `tarefa`: aberta e não cancelada sempre; senão a mais recente entre `concluida_em` e `cancelada_em` ≥ hoje − 30. */
    tarefa: (l, h) => {
        const c = texto(l.concluida_em);
        const x = texto(l.cancelada_em);
        if (c === null && x === null)
            return true;
        const ultima = [c, x].filter((v) => v !== null).sort().pop().slice(0, 10);
        return ultima >= diasAntes(h, 30);
    },
    /** `data >= least(hoje − 40, início do mês anterior)` */
    deslocamento_dia: dataDesdeMesAnteriorOu40('data'),
};
function puxarDe(t, soProprio = false) {
    return async (ctx, pedido) => {
        const visiveis = soProprio ? new Set([ctx.usuario.id]) : t.colunaUsuario ? await ctx.usuariosVisiveis() : 'tenant';
        const { sql, valores } = sqlDoPull(t, pedido, visiveis, dataLocal(ctx.agora(), ctx.fuso()));
        return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows);
    };
}
const pull = (nome, schema, naJanela) => definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema, ...(naJanela ? { naJanela } : {}) });
export const entidadeTarefa = pull('tarefa', TarefaSyncSchema, JANELAS_T0170.tarefa);
/** Conclusão: comando só de envio (ADR 0009); vale a primeira conclusão. */
export const entidadeTarefaConclusao = definirEntidadeSync({ nome: 'tarefa_conclusao', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: ConclusaoTarefaSchema });
export const entidadeFraseDia = pull('frase_dia', FraseDiaSyncSchema);
/** Avatar: o aparelho envia a troca (`UsuarioAvatarPushSchema`) e recebe a linha (`UsuarioAvatarSyncSchema`). */
export const entidadeUsuarioAvatar = definirEntidadeSync({ nome: 'usuario_avatar', modulo: 'core', direcao: 'ambos', conflito: 'servidor_vence', schema: UsuarioAvatarPushSchema, schemaLinha: UsuarioAvatarSyncSchema });
export const entidadeMetaProdutividade = pull('meta_produtividade', MetaProdutividadeSchema);
export const entidadeDeslocamentoDia = pull('deslocamento_dia', DeslocamentoDiaSchema, JANELAS_T0170.deslocamento_dia);
export const provedoresSyncT0170 = [
    { entidade: entidadeTarefa, escopo: 'proprio', puxar: puxarDe(TABELAS_SYNC_T0170.tarefa, true) },
    { entidade: entidadeTarefaConclusao, receber: receberConclusoesTarefa },
    { entidade: entidadeFraseDia, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC_T0170.frase_dia) },
    { entidade: entidadeUsuarioAvatar, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC_T0170.usuario_avatar), receber: receberAvatares },
    { entidade: entidadeMetaProdutividade, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC_T0170.meta_produtividade) },
    { entidade: entidadeDeslocamentoDia, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC_T0170.deslocamento_dia) },
];
