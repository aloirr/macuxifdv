/**
 * `GET /v1/auditoria` — leitura da trilha (RN-AUD-01; T-0030 D-B29). Contrato, perfis, filtro de licença/escopo e
 * cursor: `@macuxi/platform-sdk` (`auditoria.ts`). Quem grava é o módulo (`tx.auditar`, `outbox.ts`).
 *
 * Ordem das checagens: 401 → perfil (403 PERFIL_SEM_ACESSO) → Zod (400) → licença do `modulo` pedido (403
 * MODULO_INATIVO) → SQL só em `plataforma.auditoria` (RLS do tenant, papel macuxi_app) com os módulos efetivos e os
 * autores visíveis. Nome do autor pela consulta `core.cadastro_resumo@1` do Core (ADR 0012), na mesma transação.
 * Log sem dado pessoal: nada de antes/depois nem nomes.
 */
import { CONSULTA_CADASTRO_RESUMO, erroModuloInativo } from '@macuxi/core/contracts';
import {
  AuditoriaQuerySchema,
  AuditoriaRespostaSchema,
  cursorAuditoria,
  executarConsulta,
  filtroAuditoria,
  lerCursorAuditoria,
  PERFIS_AUDITORIA,
  ROTA_AUDITORIA,
  verificarAcesso,
  type AuditoriaResposta,
  type ClienteBanco,
  type ContextoBase,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { ErroHttp } from './erros';
import type { Plataforma } from './tipos';

interface LinhaBanco {
  id: string;
  modulo: string;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  usuario_id: string | null;
  antes: unknown;
  depois: unknown;
  ocorrido_em: Date | string;
}

/** Nomes dos autores pelo Core (ADR 0012). Sem a consulta instalada (fixture), os nomes ficam `null`. */
async function nomesDosAutores(p: Plataforma, db: ClienteBanco, ctx: ContextoBase, ids: string[]): Promise<Map<string, string>> {
  const impl = p.modulos.flatMap((m) => m.consultas ?? []).find((c) => c.consulta.nome === CONSULTA_CADASTRO_RESUMO.nome);
  if (!impl || ids.length === 0 || !ctx.usuario.modulos.includes('core')) return new Map();
  const r = await executarConsulta(CONSULTA_CADASTRO_RESUMO, { usuario_ids: ids }, (e) =>
    impl.executar(e, { db, usuario: ctx.usuario, requestId: ctx.requestId, agora: ctx.agora, parametros: () => ctx.parametros(), log: ctx.log }),
  );
  return new Map(r.usuarios.map((u) => [u.id.toLowerCase(), u.nome]));
}

export function registrarAuditoria(app: FastifyInstance, p: Plataforma): void {
  app.get(ROTA_AUDITORIA, async (req) => {
    const { ctx } = await p.preparar(req, 'core');
    const u = ctx.usuario;
    const perfil = verificarAcesso(u, { modulo: 'core', perfis: PERFIS_AUDITORIA });
    if (!perfil.ok) throw new ErroHttp(perfil.status, perfil.codigo, perfil.mensagem);

    const q = AuditoriaQuerySchema.safeParse(req.query ?? {});
    if (!q.success) throw new ErroHttp(400, 'VALIDACAO', 'Filtro da auditoria inválido.');
    const cursor = q.data.cursor ? lerCursorAuditoria(q.data.cursor) : null;
    if (q.data.cursor && !cursor) throw new ErroHttp(400, 'VALIDACAO', 'Cursor da auditoria inválido.');

    const f = filtroAuditoria({ efetivos: u.modulos, visiveis: await ctx.usuariosVisiveis(), modulo: q.data.modulo });
    if (f.negado) {
      const e = erroModuloInativo(q.data.modulo!);
      throw new ErroHttp(403, e.codigo, e.mensagem, e.detalhes);
    }

    const valores: unknown[] = [f.modulos];
    const onde = ['modulo = any($1::text[])', 'deleted_at is null'];
    if (f.usuarios !== 'todos') {
      valores.push(f.usuarios);
      onde.push(`usuario_id = any($${valores.length}::uuid[])`);
    }
    if (q.data.entidade) {
      valores.push(q.data.entidade);
      onde.push(`entidade = $${valores.length}`);
    }
    if (cursor) {
      valores.push(cursor.ocorrido_em, cursor.id);
      onde.push(`(date_trunc('milliseconds', ocorrido_em), id) < ($${valores.length - 1}::timestamptz, $${valores.length}::uuid)`);
    }
    valores.push(q.data.limite + 1);

    const resposta = await ctx.comTenant(async (db): Promise<AuditoriaResposta> => {
      const linhas = (
        await db.query<LinhaBanco>(
          `select id::text, modulo, acao, entidade, entidade_id::text, usuario_id::text, antes, depois,
                  date_trunc('milliseconds', ocorrido_em) as ocorrido_em
             from plataforma.auditoria
            where ${onde.join(' and ')}
            order by date_trunc('milliseconds', ocorrido_em) desc, id desc
            limit $${valores.length}`,
          valores,
        )
      ).rows;
      const pagina = linhas.slice(0, q.data.limite);
      const autores = [...new Set(pagina.map((l) => l.usuario_id?.toLowerCase()).filter((x): x is string => !!x))];
      const nomes = await nomesDosAutores(p, db, ctx, autores);
      const itens = pagina.map((l) => ({
        ...l,
        entidade_id: l.entidade_id?.toLowerCase() ?? null,
        usuario_id: l.usuario_id?.toLowerCase() ?? null,
        usuario_nome: l.usuario_id ? (nomes.get(l.usuario_id.toLowerCase()) ?? null) : null,
        antes: l.antes ?? null,
        depois: l.depois ?? null,
        ocorrido_em: new Date(l.ocorrido_em).toISOString(),
      }));
      const ultima = itens.at(-1);
      return { itens: itens as AuditoriaResposta['itens'], proximo_cursor: linhas.length > q.data.limite && ultima ? cursorAuditoria(ultima) : null };
    });
    ctx.log.info({ itens: resposta.itens.length, entidade: q.data.entidade ?? null, modulo: q.data.modulo ?? null }, 'auditoria lida');
    return AuditoriaRespostaSchema.parse(resposta);
  });
}
