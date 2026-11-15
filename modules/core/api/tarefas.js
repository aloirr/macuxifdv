/**
 * Tarefas do consultor (RF-CORE-18 proposto; RN-CORE-TAR-01..12; T-0170; desenho `docs/desenho/tarefas-consultor.md` §3 a §6).
 * - BKO (`/v1/core/tarefas`): criar (idempotente pelo `id`), listar, detalhar, editar prazo e descrição, cancelar, resumo por
 *   consultor e a lista de questionários da Pesquisa. Escopo `usuariosVisiveis` (RN-CORE-04); fora do escopo = 403
 *   `FORA_DO_ESCOPO` ao criar e 404 `TAREFA_NAO_ENCONTRADA` ao ler, editar ou cancelar.
 * - Aparelho: `receberConclusoesTarefa` (push `tarefa_conclusao`, comando do ADR 0009, `somente_insercao`) e o passo
 *   `concluirTarefaPorResposta` do consumidor de `pesquisa.resposta.registrada@1`, que conclui a tarefa do tipo pesquisa (§4.3).
 * - O aviso ao consultor é uma `core.notificacao` (`tipo = 'sistema'`, `subtipo = 'tarefa'`, `tarefa_id`) gravada na mesma
 *   transação; o push sai pelo consumidor de `core.notificacao.criada@1` que já existe.
 * As regras estão no domain (`domain/tarefas/`); aqui só se lê e se grava. Sem dado pessoal em log (só ids e contagens).
 */
import { ConsultaIndisponivel, ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CONSULTA_QUESTIONARIOS_PARA_TAREFA } from '../../pesquisa/contracts/consulta-tarefa';
import { EVENTO_NOTIFICACAO_CRIADA, EVENTO_TAREFA_CANCELADA, EVENTO_TAREFA_CONCLUIDA, EVENTO_TAREFA_CRIADA } from '../contracts/eventos';
import { CancelarTarefaSchema, ConclusaoTarefaSchema, CriarTarefaRespostaSchema, CriarTarefaSchema, EditarTarefaSchema, ERROS_TAREFA, TAREFA_DESTINATARIOS_MAX, TarefaListaQuerySchema, } from '../contracts/tarefa';
import { dataLocal } from '../domain';
import { idDoPayloadConfere } from '../domain/idempotencia';
import { efetivosPelasDependencias } from '../domain/licencas';
import { avisoDaTarefa } from '../domain/tarefas/aviso';
import { decidirConclusao } from '../domain/tarefas/conclusao';
import { expandirDestinatarios } from '../domain/tarefas/destinatarios';
import { prazoAceito, situacaoTarefa } from '../domain/tarefas/situacao';
import { auditar } from './auditoria';
import { dependenciasDoContexto, lerEstadoDeLicencas } from './licencas';
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const IdParam = z.object({ id: z.string().uuid() }).strict();
const iso = (d) => new Date(d).toISOString();
const naoEncontrada = () => new ErroNaoEncontrado(ERROS_TAREFA.naoEncontrada, 'Tarefa não encontrada na sua equipe. Atualize a lista e tente de novo.');
/** Mensagens (pt-BR, com a ação seguinte) das recusas do domain. Os nomes das pessoas vão em `detalhes.nomes`. */
const MENSAGEM_DESTINATARIOS = {
    [ERROS_TAREFA.foraDoEscopo]: 'Você só pode enviar tarefas para pessoas da sua equipe. Revise os destinatários.',
    [ERROS_TAREFA.inativo]: 'Há destinatário inativo. Tire essas pessoas da lista e envie de novo.',
    [ERROS_TAREFA.destinatarios]: 'Tarefa só vai para vendedor ou promotor, de 1 a 500 pessoas. Revise os destinatários.',
    [ERROS_TAREFA.promotor]: 'Este tipo de tarefa não vale para promotor. Tire essas pessoas da lista e envie de novo.',
    [ERROS_TAREFA.cliente]: 'O cliente escolhido não está na carteira de todos os destinatários. Revise o cliente ou os destinatários.',
    [ERROS_TAREFA.pesquisa]: 'Há destinatário sem a Pesquisa ou fora do público do questionário. Revise o questionário ou os destinatários.',
    [ERROS_TAREFA.destinatarioVazio]: 'Nenhum consultor recebe esta tarefa. Escolha outra equipe, outro cliente ou outras pessoas.',
};
/** Usuários do escopo (`visiveis`), vivos; `'tenant'` = todos. */
async function usuariosDoEscopo(db, visiveis, extras = []) {
    const lista = visiveis === 'tenant' ? null : [...new Set([...visiveis, ...extras])];
    const r = await db.query('select id, nome, perfil, ativo, equipe_id from core.usuario where deleted_at is null and ($1::uuid[] is null or id = any($1::uuid[])) order by nome, id', [lista]);
    return r.rows;
}
/** Quem tem o cliente na carteira vigente hoje (RN-CORE-TAR-04). */
async function donosDoCliente(db, clienteId, hoje) {
    const r = await db.query('select distinct usuario_id from core.carteira where cliente_id = $1 and deleted_at is null and (inicio is null or inicio <= $2::date) and (fim is null or fim >= $2::date)', [clienteId, hoje]);
    return new Set(r.rows.map((l) => l.usuario_id));
}
/** Módulos efetivos por usuário: a Pesquisa só vale para quem tem licença do tenant e do perfil, sem exceção (RN-CORE-01/03). */
async function usuariosComPesquisa(db, ctx, usuarios) {
    const e = await lerEstadoDeLicencas(db, dependenciasDoContexto(ctx));
    const ativosNoTenant = e.modulos.filter((m) => e.tenant[m]);
    const dono = new Map(e.usuarios.map((u) => [u.id, u]));
    const ok = new Set();
    for (const u of usuarios) {
        const efetivos = efetivosPelasDependencias({
            modulos: e.modulos,
            dependencias: e.dependencias,
            ativosNoTenant,
            doPerfil: e.perfis[u.perfil] ?? [],
            removidosDoUsuario: dono.get(u.id)?.removidos ?? [],
        });
        if (efetivos.includes('pesquisa'))
            ok.add(u.id);
    }
    return ok;
}
async function pesquisaAtivaNoTenant(db) {
    const r = await db.query("select 1 from plataforma.tenant_modulo where modulo = 'pesquisa' and ativo and deleted_at is null limit 1");
    return r.rows.length > 0;
}
/** Consulta opcional da Pesquisa (ADR 0019): `null` = módulo indisponível. */
async function questionariosDaPesquisa(tx, usuarioIds) {
    if (typeof tx?.consultar !== 'function')
        return null;
    try {
        return await tx.consultar(CONSULTA_QUESTIONARIOS_PARA_TAREFA, { usuario_ids: usuarioIds });
    }
    catch (e) {
        if (e instanceof ConsultaIndisponivel)
            return null;
        // Enquanto a Pesquisa não oferece a consulta (T-0170), o SDK recusa por não estar declarada: trata como indisponível
        if (e instanceof Error && /a declara em usaConsultas/.test(e.message))
            return null;
        throw e;
    }
}
const COLUNAS_TAREFA = `t.id, t.autor_id, t.titulo, t.descricao, t.tipo, to_char(t.prazo, 'YYYY-MM-DD') as prazo, t.alvo, t.equipe_id,
  (select e.nome from core.equipe e where e.id = t.equipe_id) as equipe_nome,
  to_char(t.cancelada_em at time zone 'UTC', ${UTC}) as cancelada_em, t.motivo_cancelamento`;
async function destinatariosDe(db, tarefaIds, visiveis) {
    if (tarefaIds.length === 0)
        return [];
    const lista = visiveis === 'tenant' ? null : [...visiveis];
    const r = await db.query(`select d.id, d.tarefa_id, d.usuario_id, u.nome, (u.ativo and u.deleted_at is null) as ativo,
            to_char(d.concluida_em at time zone 'UTC', ${UTC}) as concluida_em, to_char(d.recebida_em at time zone 'UTC', ${UTC}) as recebida_em,
            d.observacao, d.suspeita,
            (select count(*)::int from plataforma.arquivo a where a.entidade = 'tarefa_destinatario' and a.entidade_id = d.id and a.finalidade = 'tarefa' and a.deleted_at is null) as fotos
       from core.tarefa_destinatario d join core.usuario u on u.id = d.usuario_id
      where d.tarefa_id = any($1::uuid[]) and d.deleted_at is null and ($2::uuid[] is null or d.usuario_id = any($2::uuid[]))
      order by u.nome, d.id`, [tarefaIds, lista]);
    return r.rows;
}
function situacaoDaLinha(t, d, hoje, fuso, pesquisaAtiva) {
    return situacaoTarefa({ prazo: t.prazo, concluida_em: d.concluida_em, cancelada_em: t.cancelada_em, recebida_em: d.recebida_em }, { hoje, fuso, consultor_ativo: d.ativo, modulo_ativo: t.tipo === 'pesquisa' ? pesquisaAtiva : true });
}
/** Situação da tarefa inteira, para o filtro da lista: cancelada; atrasada (alguma linha atrasada); aberta (alguma linha por fazer); senão concluída. */
function situacaoGeral(cancelada, linhas) {
    if (cancelada)
        return ['canceladas'];
    const s = [];
    const pendente = linhas.filter((x) => x === 'aberta' || x === 'atrasada' || x === 'sem_modulo' || x === 'sem_consultor_ativo');
    if (pendente.length > 0)
        s.push('abertas');
    if (linhas.includes('atrasada'))
        s.push('atrasadas');
    if (pendente.length === 0 && linhas.length > 0)
        s.push('concluidas');
    return s;
}
function resumoDaTarefa(t, linhas) {
    const cancelada = t.cancelada_em !== null;
    return {
        id: t.id,
        titulo: t.titulo,
        tipo: t.tipo,
        prazo: t.prazo,
        alvo: t.alvo,
        equipe_nome: t.equipe_nome,
        total: linhas.length,
        // RN-CORE-TAR-08: na tarefa cancelada só conta o que foi feito antes do cancelamento
        feitas: linhas.filter((l) => l.situacao === 'feita_no_prazo' || l.situacao === 'feita_com_atraso').length,
        atrasadas: cancelada ? 0 : linhas.filter((l) => l.situacao === 'atrasada').length,
        cancelada_em: t.cancelada_em,
    };
}
/** A tarefa é do escopo de quem edita: ele é o autor ou TODAS as pessoas dela (vivas) estão no escopo (RN-CORE-04). */
async function tarefaDoEscopoParaEditar(db, id, usuarioId, visiveis) {
    const t = (await db.query(`select ${COLUNAS_TAREFA} from core.tarefa t where t.id = $1 and t.deleted_at is null`, [id])).rows[0];
    if (!t)
        throw naoEncontrada();
    if (t.autor_id === usuarioId || visiveis === 'tenant')
        return t;
    const fora = await db.query('select 1 from core.tarefa_destinatario where tarefa_id = $1 and deleted_at is null and not (usuario_id = any($2::uuid[])) limit 1', [id, [...visiveis]]);
    const dentro = await db.query('select 1 from core.tarefa_destinatario where tarefa_id = $1 and deleted_at is null and usuario_id = any($2::uuid[]) limit 1', [id, [...visiveis]]);
    if (fora.rows.length > 0 || dentro.rows.length === 0)
        throw naoEncontrada();
    return t;
}
// ---------------------------------------------------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------------------------------------------------
async function criarTarefa(ctx, visiveis, c) {
    const agora = ctx.agora();
    const hoje = dataLocal(agora, ctx.fuso());
    if (!prazoAceito(c.prazo, hoje))
        throw new ErroRegraNegocio(ERROS_TAREFA.prazo, 'O prazo não pode ser anterior a hoje. Escolha hoje ou uma data depois.');
    return ctx.comTenant(async (db, tx) => {
        // serializa reenvios simultâneos do mesmo id (idempotência)
        await db.query('select pg_advisory_xact_lock(hashtext($1))', [`tarefa:${c.id}`]);
        const ja = (await db.query('select t.autor_id, (select count(*)::int from core.tarefa_destinatario d where d.tarefa_id = t.id and d.deleted_at is null) as n from core.tarefa t where t.id = $1', [c.id])).rows[0];
        if (ja) {
            if (ja.autor_id !== ctx.usuario.id)
                throw new ErroHttpModulo(409, 'ID_EM_USO', 'Este identificador de tarefa já pertence a outro registro. Gere um novo e tente de novo.');
            return CriarTarefaRespostaSchema.parse({ tarefa_id: c.id, destinatarios: ja.n, ja_existia: true });
        }
        if (c.cliente_id) {
            const cli = await db.query('select 1 from core.cliente where id = $1 and deleted_at is null', [c.cliente_id]);
            if (cli.rows.length === 0)
                throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado. Atualize a lista e tente de novo.');
        }
        if (c.destino.alvo === 'equipe') {
            const eq = await db.query('select 1 from core.equipe where id = $1 and deleted_at is null', [c.destino.equipe_id]);
            if (eq.rows.length === 0)
                throw new ErroNaoEncontrado('EQUIPE_NAO_ENCONTRADA', 'Equipe não encontrada. Atualize a lista e tente de novo.');
        }
        const usuarios = await usuariosDoEscopo(db, visiveis);
        const nomeDe = new Map(usuarios.map((u) => [u.id, u.nome]));
        const com_cliente_na_carteira = c.cliente_id ? await donosDoCliente(db, c.cliente_id, hoje) : null;
        let podem;
        if (c.tipo === 'pesquisa') {
            // RN-CORE-TAR-03: a Pesquisa ativa para cada destinatário (licença é do Core) e o questionário vigente e do público (consulta)
            const licenciados = await usuariosComPesquisa(db, ctx, usuarios);
            const escolhidos = c.destino.alvo === 'usuarios' ? c.destino.usuario_ids : usuarios.filter((u) => u.perfil === 'vendedor' || u.perfil === 'promotor').map((u) => u.id);
            const consultados = escolhidos.filter((id) => nomeDe.has(id)).slice(0, TAREFA_DESTINATARIOS_MAX);
            const q = await questionariosDaPesquisa(tx, consultados.length > 0 ? consultados : [ctx.usuario.id]);
            const quest = q?.find((x) => x.questionario_id === c.questionario_id);
            if (!quest)
                throw new ErroRegraNegocio(ERROS_TAREFA.pesquisa, 'O questionário não está disponível para tarefa. Escolha um questionário publicado da Pesquisa.');
            const fora = new Set(quest.fora_do_publico);
            podem = new Set([...licenciados].filter((id) => !fora.has(id)));
        }
        const r = expandirDestinatarios({
            destino: c.destino,
            tipo: c.tipo,
            visiveis: usuarios.map((u) => ({ id: u.id, perfil: u.perfil, ativo: u.ativo, equipe_id: u.equipe_id })),
            com_cliente_na_carteira,
            podem_responder_pesquisa: podem,
        });
        if (!r.ok) {
            const mensagem = MENSAGEM_DESTINATARIOS[r.codigo] ?? 'Revise os destinatários da tarefa.';
            const detalhes = r.usuario_ids.length > 0 ? { nomes: r.usuario_ids.map((id) => nomeDe.get(id) ?? 'Usuário fora do escopo').filter((n, i, l) => l.indexOf(n) === i) } : undefined;
            // fora do escopo: nome só de quem está no escopo (nunca revela quem é de fora)
            const detalhesSeguros = r.codigo === ERROS_TAREFA.foraDoEscopo ? undefined : detalhes;
            throw new ErroHttpModulo(r.status, r.codigo, mensagem, detalhesSeguros);
        }
        const equipeId = c.destino.alvo === 'equipe' ? c.destino.equipe_id : null;
        await db.query(`insert into core.tarefa (id, tenant_id, autor_id, titulo, descricao, prazo, cliente_id, tipo, questionario_id, alvo, equipe_id)
       values ($1, plataforma.tenant_atual(), $2, $3, $4, $5::date, $6, $7, $8, $9, $10)`, [c.id, ctx.usuario.id, c.titulo, c.descricao, c.prazo, c.cliente_id, c.tipo, c.questionario_id, c.destino.alvo, equipeId]);
        const aviso = avisoDaTarefa({ id: c.id, titulo: c.titulo, prazo: c.prazo });
        for (const uid of r.usuario_ids) {
            await db.query(`insert into core.tarefa_destinatario (tenant_id, tarefa_id, usuario_id) values (plataforma.tenant_atual(), $1, $2)
         on conflict (tenant_id, tarefa_id, usuario_id) where deleted_at is null do nothing`, [c.id, uid]);
            const n = await db.query(`insert into core.notificacao (tenant_id, usuario_id, tipo, subtipo, tarefa_id, titulo, corpo, origem_modulo, autor_id, prioridade)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, 'core', $7, $8)
         on conflict (tenant_id, usuario_id, tarefa_id) where tarefa_id is not null do nothing
         returning id`, [uid, aviso.tipo, aviso.subtipo, c.id, aviso.titulo, aviso.corpo, ctx.usuario.id, aviso.prioridade]);
            if (n.rows[0])
                await tx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: n.rows[0].id, usuario_id: uid, tipo: aviso.tipo, prioridade: aviso.prioridade }, n.rows[0].id);
        }
        await tx.publicar(EVENTO_TAREFA_CRIADA, { tarefa_id: c.id, autor_id: ctx.usuario.id, tipo: c.tipo, cliente_id: c.cliente_id, prazo: c.prazo, usuario_ids: r.usuario_ids, criada_em: iso(agora) }, c.id);
        await auditar(db, ctx, { acao: 'tarefa.criar', entidade: 'tarefa', entidadeId: c.id, antes: null, depois: { tipo: c.tipo, alvo: c.destino.alvo, prazo: c.prazo, destinatarios: r.usuario_ids.length } });
        ctx.log.info({ tarefa_id: c.id, destinatarios: r.usuario_ids.length }, 'tarefa criada');
        return CriarTarefaRespostaSchema.parse({ tarefa_id: c.id, destinatarios: r.usuario_ids.length, ja_existia: false });
    });
}
// ---------------------------------------------------------------------------------------------------------------------
// Rotas do BKO
// ---------------------------------------------------------------------------------------------------------------------
async function tarefasVisiveis(db, visiveis, usuarioId, q) {
    const lista = visiveis === 'tenant' ? null : [...visiveis];
    const r = await db.query(`select ${COLUNAS_TAREFA}
       from core.tarefa t
      where t.deleted_at is null
        and ($2::date is null or t.prazo >= $2::date) and ($3::date is null or t.prazo <= $3::date)
        and ($1::uuid[] is null or t.autor_id = $4 or exists (select 1 from core.tarefa_destinatario d where d.tarefa_id = t.id and d.deleted_at is null and d.usuario_id = any($1::uuid[])))
        and ($5::uuid is null or exists (select 1 from core.tarefa_destinatario d where d.tarefa_id = t.id and d.deleted_at is null and d.usuario_id = $5))
        and ($6::uuid is null or exists (select 1 from core.tarefa_destinatario d join core.usuario u on u.id = d.usuario_id where d.tarefa_id = t.id and d.deleted_at is null and u.equipe_id = $6))
      order by t.prazo desc, t.created_at desc, t.id
      limit 2000`, [lista, q.de ?? null, q.ate ?? null, usuarioId, q.usuario_id ?? null, q.equipe_id ?? null]);
    return r.rows;
}
export const rotasDeTarefas = [
    {
        metodo: 'POST',
        caminho: 'tarefas',
        acao: 'tarefa.criar',
        superficie: 'bko',
        status: 201,
        carteira: (e) => e.corpo?.cliente_id ?? null,
        corpo: CriarTarefaSchema,
        executar: async (ctx) => criarTarefa(ctx, await ctx.usuariosVisiveis(), ctx.corpo),
    },
    {
        metodo: 'GET',
        caminho: 'tarefas',
        acao: 'tarefa.acompanhar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        query: TarefaListaQuerySchema,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const q = ctx.query;
            const hoje = dataLocal(ctx.agora(), ctx.fuso());
            return ctx.comTenant(async (db) => {
                const tarefas = await tarefasVisiveis(db, visiveis, ctx.usuario.id, q);
                const linhas = await destinatariosDe(db, tarefas.map((t) => t.id), visiveis);
                const pesquisaAtiva = await pesquisaAtivaNoTenant(db);
                const itens = [];
                for (const t of tarefas) {
                    const doT = linhas.filter((l) => l.tarefa_id === t.id).map((l) => ({ ...l, situacao: situacaoDaLinha(t, l, hoje, ctx.fuso(), pesquisaAtiva) }));
                    if (q.situacao && !situacaoGeral(t.cancelada_em !== null, doT.map((l) => l.situacao)).includes(q.situacao))
                        continue;
                    itens.push(resumoDaTarefa(t, doT));
                    if (itens.length >= q.limite)
                        break;
                }
                return { itens };
            });
        },
    },
    {
        // resumo por consultor (RN-CORE-TAR-10): abertas, atrasadas, feitas no prazo e com atraso; % no prazo em pontos-base
        metodo: 'GET',
        caminho: 'tarefas/por-consultor',
        acao: 'tarefa.acompanhar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        query: TarefaListaQuerySchema,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const q = ctx.query;
            const hoje = dataLocal(ctx.agora(), ctx.fuso());
            return ctx.comTenant(async (db) => {
                const tarefas = (await tarefasVisiveis(db, visiveis, ctx.usuario.id, { ...q, situacao: undefined })).filter((t) => t.cancelada_em === null);
                const linhas = await destinatariosDe(db, tarefas.map((t) => t.id), visiveis);
                const pesquisaAtiva = await pesquisaAtivaNoTenant(db);
                const porTarefa = new Map(tarefas.map((t) => [t.id, t]));
                const soma = new Map();
                for (const l of linhas) {
                    if (q.usuario_id && l.usuario_id !== q.usuario_id)
                        continue;
                    const t = porTarefa.get(l.tarefa_id);
                    if (!t)
                        continue;
                    const s = situacaoDaLinha(t, l, hoje, ctx.fuso(), pesquisaAtiva);
                    const a = soma.get(l.usuario_id) ?? { nome: l.nome, abertas: 0, atrasadas: 0, no_prazo: 0, com_atraso: 0 };
                    if (s === 'aberta')
                        a.abertas += 1;
                    else if (s === 'atrasada')
                        a.atrasadas += 1;
                    else if (s === 'feita_no_prazo')
                        a.no_prazo += 1;
                    else if (s === 'feita_com_atraso')
                        a.com_atraso += 1;
                    soma.set(l.usuario_id, a);
                }
                const itens = [...soma.entries()]
                    .filter(([, a]) => a.abertas + a.atrasadas + a.no_prazo + a.com_atraso > 0)
                    .map(([usuario_id, a]) => {
                    const base = a.no_prazo + a.com_atraso + a.atrasadas;
                    return { usuario_id, nome: a.nome, abertas: a.abertas, atrasadas: a.atrasadas, feitas_no_prazo: a.no_prazo, feitas_com_atraso: a.com_atraso, pct_no_prazo_pb: base > 0 ? Math.round((10_000 * a.no_prazo) / base) : null };
                })
                    .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR') || (x.usuario_id < y.usuario_id ? -1 : 1));
                return { itens };
            });
        },
    },
    {
        // questionários publicados da Pesquisa (consulta opcional, ADR 0019); sem o módulo = lista vazia (o tipo some do cadastro)
        metodo: 'GET',
        caminho: 'tarefas/questionarios',
        acao: 'tarefa.criar',
        superficie: 'bko',
        carteira: 'nao_se_aplica',
        executar: (ctx) => ctx.comTenant(async (_db, tx) => {
            const q = await questionariosDaPesquisa(tx, [ctx.usuario.id]);
            return { itens: (q ?? []).map((x) => ({ questionario_id: x.questionario_id, titulo: x.titulo })) };
        }),
    },
    {
        metodo: 'GET',
        caminho: 'tarefas/:id',
        acao: 'tarefa.acompanhar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        params: IdParam,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const { id } = ctx.params;
            const hoje = dataLocal(ctx.agora(), ctx.fuso());
            return ctx.comTenant(async (db) => {
                const t = (await db.query(`select ${COLUNAS_TAREFA} from core.tarefa t where t.id = $1 and t.deleted_at is null`, [id])).rows[0];
                if (!t)
                    throw naoEncontrada();
                const linhas = await destinatariosDe(db, [id], visiveis);
                if (linhas.length === 0 && t.autor_id !== ctx.usuario.id)
                    throw naoEncontrada();
                const pesquisaAtiva = await pesquisaAtivaNoTenant(db);
                const destinatarios = linhas.map((l) => ({
                    id: l.id,
                    usuario_id: l.usuario_id,
                    nome: l.nome,
                    situacao: situacaoDaLinha(t, l, hoje, ctx.fuso(), pesquisaAtiva),
                    concluida_em: l.concluida_em,
                    observacao: l.observacao,
                    fotos: l.fotos,
                    suspeita: l.suspeita,
                }));
                return { ...resumoDaTarefa(t, destinatarios), descricao: t.descricao, motivo_cancelamento: t.motivo_cancelamento, destinatarios };
            });
        },
    },
    {
        // RN-CORE-TAR-09: só prazo e descrição mudam; o resto exige cancelar e criar de novo
        metodo: 'PATCH',
        caminho: 'tarefas/:id',
        acao: 'tarefa.editar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        params: IdParam,
        corpo: EditarTarefaSchema,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const { id } = ctx.params;
            const c = ctx.corpo;
            const hoje = dataLocal(ctx.agora(), ctx.fuso());
            if (c.prazo !== undefined && !prazoAceito(c.prazo, hoje))
                throw new ErroRegraNegocio(ERROS_TAREFA.prazo, 'O prazo não pode ser anterior a hoje. Escolha hoje ou uma data depois.');
            return ctx.comTenant(async (db) => {
                const t = await tarefaDoEscopoParaEditar(db, id, ctx.usuario.id, visiveis);
                if (t.cancelada_em)
                    throw new ErroRegraNegocio('RN-CORE-TAR-08', 'Esta tarefa foi cancelada e não pode mais ser editada. Crie uma tarefa nova.');
                const prazo = c.prazo ?? t.prazo;
                const descricao = c.descricao === undefined ? t.descricao : c.descricao;
                if (prazo !== t.prazo || descricao !== t.descricao) {
                    await db.query('update core.tarefa set prazo = $2::date, descricao = $3 where id = $1', [id, prazo, descricao]);
                    await auditar(db, ctx, { acao: 'tarefa.editar', entidade: 'tarefa', entidadeId: id, antes: { prazo: t.prazo, descricao_alterada: descricao !== t.descricao }, depois: { prazo, descricao_alterada: descricao !== t.descricao } });
                }
                return { id, prazo, descricao };
            });
        },
    },
    {
        // RN-CORE-TAR-08: cancelar é idempotente (a 2ª chamada responde o mesmo, sem novo evento)
        metodo: 'POST',
        caminho: 'tarefas/:id/cancelar',
        acao: 'tarefa.cancelar',
        superficie: 'bko',
        carteira: 'filtrar_no_dominio',
        params: IdParam,
        corpo: CancelarTarefaSchema,
        executar: async (ctx) => {
            const visiveis = await ctx.usuariosVisiveis();
            const { id } = ctx.params;
            const c = ctx.corpo;
            const agora = ctx.agora();
            return ctx.comTenant(async (db, tx) => {
                await db.query('select pg_advisory_xact_lock(hashtext($1))', [`tarefa:${id}`]);
                const t = await tarefaDoEscopoParaEditar(db, id, ctx.usuario.id, visiveis);
                if (t.cancelada_em)
                    return { id, cancelada_em: t.cancelada_em, abertas_no_cancelamento: 0, ja_cancelada: true };
                const abertas = Number((await db.query('select count(*)::int as n from core.tarefa_destinatario where tarefa_id = $1 and deleted_at is null and concluida_em is null', [id])).rows[0]?.n ?? 0);
                await db.query('update core.tarefa set cancelada_em = $2::timestamptz, cancelada_por = $3, motivo_cancelamento = $4 where id = $1 and cancelada_em is null', [id, agora.toISOString(), ctx.usuario.id, c.motivo]);
                await tx.publicar(EVENTO_TAREFA_CANCELADA, { tarefa_id: id, cancelada_por: ctx.usuario.id, cancelada_em: iso(agora), abertas_no_cancelamento: abertas }, id);
                await auditar(db, ctx, { acao: 'tarefa.cancelar', entidade: 'tarefa', entidadeId: id, antes: null, depois: { abertas_no_cancelamento: abertas } });
                ctx.log.info({ tarefa_id: id, abertas }, 'tarefa cancelada');
                return { id, cancelada_em: iso(agora), abertas_no_cancelamento: abertas, ja_cancelada: false };
            });
        },
    },
];
// ---------------------------------------------------------------------------------------------------------------------
// Push `tarefa_conclusao` (aparelho)
// ---------------------------------------------------------------------------------------------------------------------
const aceito = (id) => ({ id, status: 'aceito' });
const rejeitado = (id, codigo, mensagem) => ({ id, status: 'rejeitado', codigo, mensagem });
const MENSAGEM_CONCLUSAO = {
    [ERROS_TAREFA.naoEncontrada]: 'Tarefa não encontrada. Atualize a lista de tarefas.',
    [ERROS_TAREFA.pesquisa]: 'Esta tarefa se conclui sozinha ao responder a pesquisa. Responda o questionário.',
    [ERROS_TAREFA.foto]: 'Tarefa de foto precisa de 1 a 5 fotos; as outras não levam foto. Confira as fotos e conclua de novo.',
};
/**
 * Push `tarefa_conclusao` (§5): item a item, cada um na própria transação. Idempotente: o mesmo comando, ou outro para uma linha
 * já concluída, responde `aceito` sem gravar (vale a primeira). Tarefa cancelada antes de a conclusão chegar também é `aceito`
 * (não trava a fila), mas não gera evento nem entra nos números. Linha de outro usuário = a mesma resposta de uma que não existe.
 */
export async function receberConclusoesTarefa(ctx, itens) {
    const saida = [];
    for (const item of itens) {
        if (item.operacao === 'remover') {
            saida.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'A conclusão de tarefa não pode ser removida pelo aparelho.'));
            continue;
        }
        if (!idDoPayloadConfere(item.id, item.payload)) {
            saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.'));
            continue;
        }
        // a API sempre revalida o comando (a plataforma já parseia; aqui vale também para quem chama o provedor direto)
        const valido = ConclusaoTarefaSchema.safeParse(item.payload);
        if (!valido.success) {
            saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'Os dados da conclusão estão incompletos. Atualize o app e tente de novo.'));
            continue;
        }
        const cmd = valido.data;
        try {
            saida.push(await ctx.comTenant(async (db, tx) => {
                await db.query('select pg_advisory_xact_lock(hashtext($1))', [`tarefa_conclusao:${cmd.tarefa_destinatario_id}`]);
                const linha = (await db.query(`select d.id, d.usuario_id, t.tipo, to_char(d.concluida_em at time zone 'UTC', ${UTC}) as concluida_em,
                        to_char(t.cancelada_em at time zone 'UTC', ${UTC}) as cancelada_em, t.id as tarefa_id, t.cliente_id, to_char(t.prazo, 'YYYY-MM-DD') as prazo
                   from core.tarefa_destinatario d join core.tarefa t on t.tenant_id = d.tenant_id and t.id = d.tarefa_id
                  where d.id = $1 and d.deleted_at is null and t.deleted_at is null`, [cmd.tarefa_destinatario_id])).rows[0] ?? null;
                const agora = ctx.agora();
                const d = decidirConclusao(linha, cmd, { usuario_id: ctx.usuario.id, agora });
                if (d.acao === 'recusar')
                    return rejeitado(item.id, d.codigo, MENSAGEM_CONCLUSAO[d.codigo] ?? 'Não foi possível concluir a tarefa.');
                if (d.acao === 'nada' || !linha)
                    return aceito(item.id);
                if (linha.tipo === 'foto') {
                    for (const fotoId of cmd.foto_ids) {
                        await tx.registrarArquivo({ id: fotoId, finalidade: 'tarefa', entidade: 'tarefa_destinatario', entidade_id: linha.id, cliente_id: linha.cliente_id, tipo: 'image/jpeg' });
                    }
                }
                const u = await db.query('update core.tarefa_destinatario set concluida_em = $2::timestamptz, recebida_em = $3::timestamptz, conclusao_id = $4, observacao = $5, suspeita = $6 where id = $1 and concluida_em is null', [linha.id, cmd.concluida_em, agora.toISOString(), cmd.id, cmd.observacao, d.suspeita]);
                if ((u.rowCount ?? 0) > 0 && d.conta) {
                    await tx.publicar(EVENTO_TAREFA_CONCLUIDA, {
                        tarefa_id: linha.tarefa_id,
                        tarefa_destinatario_id: linha.id,
                        usuario_id: linha.usuario_id,
                        cliente_id: linha.cliente_id,
                        tipo: linha.tipo,
                        concluida_em: iso(cmd.concluida_em),
                        recebida_em: iso(agora),
                        no_prazo: dataLocal(cmd.concluida_em, ctx.fuso()) <= linha.prazo,
                        fotos_total: cmd.foto_ids.length,
                        resposta_id: null,
                        suspeita: d.suspeita,
                    }, linha.id);
                }
                return aceito(item.id);
            }));
        }
        catch (e) {
            if (!(e instanceof ErroHttpModulo) || e.status >= 500)
                throw e;
            saida.push(rejeitado(item.id, e.codigo, e.message));
        }
    }
    return saida;
}
// ---------------------------------------------------------------------------------------------------------------------
// Tarefa do tipo pesquisa: a resposta conclui a linha (§4.3)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * `pesquisa.resposta.registrada@1`: conclui a linha ABERTA MAIS ANTIGA do mesmo usuário, tarefa `pesquisa` com o mesmo
 * questionário (e o mesmo cliente, se a tarefa tiver cliente), criada antes de `recebida_em` e não cancelada. Grava
 * `concluida_em = respondida_em`, `recebida_em`, `resposta_id` e `suspeita`; o `conclusao_id` fica nulo. Idempotente: a resposta já
 * gravada numa linha não muda nada. Reexecutável (o despachante pode repetir o evento).
 *
 * É UM PASSO do consumidor que o Core já tem desse evento (`consumidorBaixaPorResposta`), NÃO um consumidor novo: o despachante
 * guarda a idempotência por (módulo, evento) e um 2º consumidor do Core no mesmo evento nunca rodaria. A costura chama este passo
 * no início de `consumidorBaixaPorResposta`, antes do `return` de quem não tem `visita_id` (desenho §4.3: "o consumidor ganha mais um passo").
 */
export async function concluirTarefaPorResposta(p, ctx) {
    const ja = await ctx.db.query('select 1 from core.tarefa_destinatario where resposta_id = $1 and deleted_at is null limit 1', [p.resposta_id]);
    if (ja.rows.length > 0)
        return;
    const r = await ctx.db.query(`select d.id, d.tarefa_id, t.cliente_id, to_char(t.prazo, 'YYYY-MM-DD') as prazo
       from core.tarefa_destinatario d join core.tarefa t on t.tenant_id = d.tenant_id and t.id = d.tarefa_id
      where d.usuario_id = $1 and d.deleted_at is null and d.concluida_em is null and d.created_at < $4::timestamptz
        and t.deleted_at is null and t.cancelada_em is null and t.tipo = 'pesquisa' and t.questionario_id = $2
        and (t.cliente_id is null or t.cliente_id = $3)
      order by d.created_at, d.id limit 1`, [p.usuario_id, p.questionario_id, p.cliente_id, p.recebida_em]);
    const linha = r.rows[0];
    if (!linha)
        return;
    const u = await ctx.db.query('update core.tarefa_destinatario set concluida_em = $2::timestamptz, recebida_em = $3::timestamptz, resposta_id = $4, suspeita = $5 where id = $1 and concluida_em is null', [linha.id, p.respondida_em, p.recebida_em, p.resposta_id, p.suspeita]);
    if ((u.rowCount ?? 0) === 0)
        return;
    await ctx.publicar(EVENTO_TAREFA_CONCLUIDA, {
        tarefa_id: linha.tarefa_id,
        tarefa_destinatario_id: linha.id,
        usuario_id: p.usuario_id,
        cliente_id: linha.cliente_id,
        tipo: 'pesquisa',
        concluida_em: iso(p.respondida_em),
        recebida_em: iso(p.recebida_em),
        no_prazo: dataLocal(p.respondida_em, ctx.fuso()) <= linha.prazo,
        fotos_total: 0,
        resposta_id: p.resposta_id,
        suspeita: p.suspeita,
    }, linha.id);
    ctx.log.info({ tarefa_destinatario_id: linha.id }, 'tarefa de pesquisa concluída pela resposta');
}
