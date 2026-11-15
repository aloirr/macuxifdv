/**
 * Ações do BKO sobre o lote e apoio da tela "Integração ERP" (T-0173; RN-INT-15, RN-INT-16):
 *  - `POST /v1/integracao/lotes/:id/cancelar` (`lote.cancelar`): só lote em andamento; outro estado = 409 `lote_nao_esta_em_andamento`.
 *  - `POST /v1/integracao/lotes/:id/reprocessar`: só Com falha ou Concluído com avisos (409 nos demais). Quem tem `lote.reprocessar`
 *    reprocessa direto; quem não tem envia `autorizador_id` + `senha`: a senha é conferida pelo Core (porta `VerificadorSenha`),
 *    o autorizador precisa ter `lote.reprocessar`, as tentativas erradas são limitadas e a auditoria grava quem autorizou.
 *    A senha nunca vai para log, auditoria nem resposta.
 *  - `GET /v1/integracao/lotes/autorizadores` (`monitor.ver`): quem pode autorizar, sem e-mail.
 *  - `GET /v1/integracao/mapeamentos/codigos-macuxi?tipo=` (`monitor.ver`): códigos do Macuxi para o De-para.
 * Regras no `domain` (`status-lote.ts`); aqui só SQL no schema `integracao`, consultas declaradas no manifesto e auditoria.
 */
import { ConsultaIndisponivel, ErroHttpModulo, ErroNaoEncontrado, pode, type ClienteBanco, type ContextoRota, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_USUARIOS_RESUMO } from '@macuxi/core/contracts';
import { z } from 'zod';
import { CONSULTA_FORMAS_PAGAMENTO } from '../../vendedor/contracts';
import { CodigosMacuxiQuery, ReprocessarLoteEntrada, type AutorizadoresResposta, type CancelarLoteResposta, type CodigosMacuxiResposta, type EstadoLote, type ReprocessarLoteResposta } from '../contracts';
import {
  JANELA_TENTATIVAS_AUTORIZACAO_MS,
  autorizacaoReprocessar,
  limiteTentativasAutorizacao,
  podeCancelarLote,
  podeReprocessarLote,
  transicionarLote,
} from '../domain';
import { EVENTO_LOTE_RECEBIDO } from './eventos';

const Params = z.object({ id: z.string().uuid('UUID inválido') });
const PERFIS_AUTORIZADORES = ['admin', 'analista'] as const;

/** Resultado da conferência da senha pelo Core. `indisponivel` = o Core ainda não oferece a conferência (pendência com o modulo-core). */
export type ResultadoSenha = 'ok' | 'incorreta' | 'indisponivel';

/**
 * Porta da conferência de senha do autorizador (RN-INT-16). O Core não oferece hoje uma consulta de credencial (pedido ao
 * modulo-core: `core.credencial_conferir@1`); enquanto isso o padrão devolve `indisponivel` (503 com a ação seguinte) e nunca
 * aceita uma senha sem conferir. A implementação real entra no `criarModuloApiIntegracao({ verificarSenha })`.
 */
export type VerificadorSenha = (entrada: { tenant_id: string; usuario_id: string; senha: string }, tx: TransacaoTenant) => Promise<ResultadoSenha>;
export const verificadorSenhaIndisponivel: VerificadorSenha = async () => 'indisponivel';

/** Falhas de senha por autorizador na janela (RN-INT-16), em memória do processo; a cota durável fica como pendência do banco-dados. */
export interface LimiteTentativas {
  falhas(chave: string, agora: number): number;
  registrarFalha(chave: string, agora: number): void;
  limpar(chave: string): void;
}

export function criarLimiteTentativas(janelaMs = JANELA_TENTATIVAS_AUTORIZACAO_MS): LimiteTentativas {
  const falhas = new Map<string, number[]>();
  const recentes = (chave: string, agora: number): number[] => {
    const l = (falhas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    if (l.length === 0) falhas.delete(chave);
    else falhas.set(chave, l);
    return l;
  };
  return {
    falhas: (chave, agora) => recentes(chave, agora).length,
    registrarFalha: (chave, agora) => falhas.set(chave, [...recentes(chave, agora), agora]),
    limpar: (chave) => void falhas.delete(chave),
  };
}

interface LinhaLoteAcao {
  id: string;
  entidade: string;
  status: EstadoLote;
  com_erro: number;
  recebidas: number;
}

async function lerLoteTravado(db: ClienteBanco, tenantId: string, id: string): Promise<LinhaLoteAcao> {
  const { rows } = await db.query<LinhaLoteAcao>(
    'select id, entidade, status, com_erro, recebidas from integracao.lote where tenant_id = $1 and id = $2 and deleted_at is null for update',
    [tenantId, id],
  );
  const l = rows[0];
  if (!l) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'O lote não existe mais. Atualize a lista em Integração ERP.');
  return l;
}

export const rotaCancelarLote: RotaModulo = {
  metodo: 'POST',
  caminho: 'lotes/:id/cancelar',
  acao: 'lote.cancelar',
  carteira: 'nao_se_aplica',
  params: Params,
  executar: async (ctx: ContextoRota<unknown, unknown, z.infer<typeof Params>>): Promise<CancelarLoteResposta> => {
    const tenantId = ctx.usuario.tenant_id;
    return ctx.comTenant(async (db, tx) => {
      const l = await lerLoteTravado(db, tenantId, ctx.params.id);
      const t = podeCancelarLote(l.status) ? transicionarLote(l.status, 'cancelado') : null;
      if (!t?.ok) throw new ErroHttpModulo(409, 'lote_nao_esta_em_andamento', 'Este lote já terminou e não pode ser cancelado. Atualize a lista em Integração ERP.');
      await db.query("update integracao.lote set status = 'cancelado', concluido_em = $3::timestamptz where tenant_id = $1 and id = $2", [tenantId, l.id, ctx.agora().toISOString()]);
      await tx.auditar({ acao: 'lote.cancelar', entidade: 'lote', entidade_id: l.id, antes: { status: l.status }, depois: { status: 'cancelado', entidade_lote: l.entidade } });
      return { lote_id: l.id, status: 'cancelado' as const };
    });
  },
};

/** Usuários ativos admin/analista do tenant (sem e-mail), pela consulta do Core. */
async function lerAutorizadores(tx: TransacaoTenant): Promise<AutorizadoresResposta['itens']> {
  const itens: AutorizadoresResposta['itens'] = [];
  let apos: string | undefined;
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = await tx.consultar(CONSULTA_USUARIOS_RESUMO, { limite: 500, ...(apos ? { apos_id: apos } : {}) });
    for (const u of r.usuarios) {
      if (u.ativo && (PERFIS_AUTORIZADORES as readonly string[]).includes(u.perfil)) itens.push({ id: u.id, nome: u.nome, perfil: u.perfil as (typeof PERFIS_AUTORIZADORES)[number] });
    }
    if (!r.proximo_cursor) break;
    apos = r.proximo_cursor;
  }
  return itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export const rotaListarAutorizadores: RotaModulo = {
  metodo: 'GET',
  caminho: 'lotes/autorizadores',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  executar: async (ctx: ContextoRota): Promise<AutorizadoresResposta> => ctx.comTenant(async (_db, tx) => ({ itens: await lerAutorizadores(tx) })),
};

export function criarRotaReprocessarLote(o: { verificarSenha: VerificadorSenha; limite: LimiteTentativas }): RotaModulo {
  return {
    metodo: 'POST',
    caminho: 'lotes/:id/reprocessar',
    // quem não tem `lote.reprocessar` chega aqui com a senha de quem tem: a rota exige só o monitor e o domain decide o resto
    acao: 'monitor.ver',
    carteira: 'nao_se_aplica',
    params: Params,
    corpo: ReprocessarLoteEntrada,
    executar: async (ctx: ContextoRota<ReprocessarLoteEntrada, unknown, z.infer<typeof Params>>): Promise<ReprocessarLoteResposta> => {
      const tenantId = ctx.usuario.tenant_id;
            const solicitantePode = pode(ctx.usuario.perfis, 'lote.reprocessar');
      const { autorizador_id, senha } = ctx.corpo;
      return ctx.comTenant(async (db, tx) => {
        const l = await lerLoteTravado(db, tenantId, ctx.params.id);
        if (!podeReprocessarLote(l.status)) {
          throw new ErroHttpModulo(409, 'lote_nao_pode_reprocessar', 'Só lote Com falha ou Concluído com avisos pode ser reprocessado. Atualize a lista em Integração ERP.');
        }

        let autorizadoPor: string | null = null;
        if (!solicitantePode) {
          if (!autorizador_id || !senha) {
            throw new ErroHttpModulo(403, 'autorizador_necessario', 'Escolha quem autoriza o reprocessamento e digite a senha dessa pessoa.');
          }
          const agora = ctx.agora().getTime();
          // RN-INT-16: o limite é por autorizador (tenant + autorizador_id), não por quem pede
          const chaveLimite = `${tenantId}:${autorizador_id}`;
          const bloqueio = limiteTentativasAutorizacao(o.limite.falhas(chaveLimite, agora));
          if (bloqueio.bloqueado) throw new ErroHttpModulo(429, 'muitas_tentativas', bloqueio.mensagem);
          const alvo = (await lerAutorizadores(tx)).find((a) => a.id === autorizador_id);
          // fora da lista (outro perfil, inativo ou de outro tenant) = sem permissão para autorizar
          const decisao = autorizacaoReprocessar({ solicitantePode: false, autorizador: alvo ? { perfil: alvo.perfil } : { perfil: 'vendedor' } });
          if (!decisao.ok) throw new ErroHttpModulo(403, decisao.codigo, decisao.mensagem);
          const r = await o.verificarSenha({ tenant_id: tenantId, usuario_id: autorizador_id, senha }, tx);
          if (r === 'indisponivel') throw new ErroHttpModulo(503, 'autorizacao_indisponivel', 'Não deu para autorizar agora. Peça a um administrador ou analista para reprocessar.');
          if (r === 'incorreta') {
            o.limite.registrarFalha(chaveLimite, agora);
            throw new ErroHttpModulo(422, 'senha_incorreta', 'Senha incorreta.');
          }
          o.limite.limpar(chaveLimite);
          autorizadoPor = autorizador_id;
        }

        const { rows: st } = await db.query<{ tem: boolean }>('select corpo is not null as tem from integracao.lote_staging where tenant_id = $1 and lote_id = $2', [tenantId, l.id]);
        if (!st[0]?.tem) {
          throw new ErroHttpModulo(409, 'conteudo_expirado', 'O conteúdo deste lote já foi apagado. Peça ao Conector para reenviar a carga.');
        }
        const t = transicionarLote(l.status, 'recebido');
        if (!t.ok) throw new ErroHttpModulo(409, 'lote_nao_pode_reprocessar', t.mensagem);
        const agoraIso = ctx.agora().toISOString();
        await db.query("update integracao.lote set status = 'recebido', concluido_em = null, iniciado_em = null, ultimo_erro = null where tenant_id = $1 and id = $2", [tenantId, l.id]);
        // volta à fila: o consumidor de integracao.lote.recebido@1 reaplica do staging (linhas iguais viram "inalteradas")
        const c = await db.query<{ conector: string; entidade: string; modo: string }>(
          `select c.identificador as conector, l.entidade, l.modo from integracao.lote l join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id where l.tenant_id = $1 and l.id = $2`,
          [tenantId, l.id],
        );
        const x = c.rows[0];
        await tx.publicar(EVENTO_LOTE_RECEBIDO, { lote_id: l.id, conector_id: x?.conector ?? 'bko', entidade: l.entidade as never, modo: (x?.modo ?? 'delta') as never, recebidas: l.recebidas, recebido_em: agoraIso }, l.id);
        await tx.auditar({
          acao: 'lote.reprocessar',
          entidade: 'lote',
          entidade_id: l.id,
          antes: { status: l.status },
          depois: { status: 'recebido', via: autorizadoPor ? 'autorizado' : 'direto', autorizado_por: autorizadoPor },
        });
        return { lote_id: l.id, reenfileiradas: l.com_erro, status: 'recebido' as const };
      });
    },
  };
}

/** Códigos de condição de pagamento do Macuxi (formas ativas do Vendedor); tipos sem fonte ainda voltam `disponivel: false`. */
export const rotaCodigosMacuxi: RotaModulo = {
  metodo: 'GET',
  caminho: 'mapeamentos/codigos-macuxi',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  query: CodigosMacuxiQuery,
  executar: async (ctx: ContextoRota<unknown, CodigosMacuxiQuery>): Promise<CodigosMacuxiResposta> => {
    const { tipo } = ctx.query;
    if (tipo !== 'condicao_pagamento') return { tipo, disponivel: false, itens: [] };
    return ctx.comTenant(async (_db, tx) => {
      try {
        const r = await tx.consultar(CONSULTA_FORMAS_PAGAMENTO, {}, { licenca: 'tenant' });
        return { tipo, disponivel: true, itens: r.formas.map((f) => ({ codigo: f.codigo, nome: f.nome, ativo: f.ativo })).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR')) };
      } catch (e) {
        if (e instanceof ConsultaIndisponivel) return { tipo, disponivel: false, itens: [] };
        throw e;
      }
    });
  },
};
