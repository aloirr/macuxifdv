/** Apoio das rotas e do sync do Treinamento: repositório na transação, parâmetros do tenant, "hoje" e o aluno. */
import { localIsoDate } from '@macuxi/comum/fuso';
import { ErroHttpModulo, ErroRegraNegocio, type ContextoBase, type Perfil, type TransacaoTenant } from '@macuxi/platform-sdk';
import type { UsuarioPublico } from '../domain/trilha';
import { type ParametrosTreinamento } from '../domain/parametros';
import { parametrosEmUso } from '../domain/parametros-em-uso';
import manifest from '../manifest';
import type { FabricaRepositorio, RepositorioTreinamento, UsuarioTreinamento } from './repositorio';

export const MENSAGEM_INDISPONIVEL = 'O Treinamento não está disponível neste servidor. Tente de novo mais tarde; o que você fez no aparelho fica guardado.';

/** Abre a transação do tenant com o repositório. Sem fábrica (montagem sem banco) = 503, falha fechada. */
export function comRepositorio<T>(
  fabrica: FabricaRepositorio | null,
  ctx: ContextoBase,
  fn: (repo: RepositorioTreinamento, tx: TransacaoTenant) => Promise<T>,
): Promise<T> {
  if (!fabrica) throw new ErroHttpModulo(503, 'TREINAMENTO_INDISPONIVEL', MENSAGEM_INDISPONIVEL);
  return ctx.comTenant((db, tx) => fn(fabrica.doTenant(db, ctx.usuario.tenant_id, () => ctx.agora(), tx), tx));
}

/**
 * Parâmetros do tenant (`plataforma.parametro`, módulo treinamento) com o fuso do tenant. Valor inválido no cadastro
 * não derruba a rota: vale o padrão do doc 03 e o aviso vai ao log (sem dado pessoal).
 */
export function parametrosDoTenant(ctx: Pick<ContextoBase, 'parametros' | 'fuso' | 'log'>): ParametrosTreinamento {
  const { parametros, invalidos } = parametrosEmUso(ctx.parametros(), ctx.fuso());
  if (invalidos.length > 0) ctx.log.warn({ campos: invalidos }, 'parâmetros do treinamento inválidos; usando o padrão');
  return parametros;
}

/** Data civil de hoje no fuso do tenant (RN-CORE-11). */
export const hojeNoTenant = (ctx: Pick<ContextoBase, 'agora' | 'fuso'>): string => localIsoDate(ctx.agora(), ctx.fuso());

/** Perfil e equipe do usuário da sessão para o público-alvo (RN-TRE-07); sem cadastro no Core = sem equipe. */
export function alunoDaSessao(ctx: Pick<ContextoBase, 'usuario'>, usuarios: readonly UsuarioTreinamento[]): UsuarioPublico & { regional_id: string | null } {
  const u = usuarios.find((x) => x.id === ctx.usuario.id);
  return { perfil: ctx.usuario.perfil, equipe_id: u?.equipe_id ?? null, regional_id: u?.regional_id ?? null };
}

/** Perfis da ação no manifesto (ADR 0004): usado onde a plataforma não confere a ação (provedores de sync). */
export const perfilPode = (acao: keyof typeof manifest.acoes, perfil: Perfil): boolean => (manifest.acoes[acao]?.perfis ?? []).includes(perfil);

/** Regra do domain recusada → 422 com o código do domain e a regra (RN/RF) em `detalhes`. */
export function erroDeRegra(r: { codigo: string; regra: string; mensagem: string }, detalhes: Record<string, unknown> = {}): ErroRegraNegocio {
  return new ErroRegraNegocio(r.codigo, r.mensagem, { regra: r.regra, ...detalhes });
}

/** Recorte do escopo (RN-CORE-04): usuários visíveis ao gestor, opcionalmente uma equipe dentro dele. */
export function noEscopo(usuarios: readonly UsuarioTreinamento[], visiveis: ReadonlySet<string> | 'tenant', equipeId?: string): UsuarioTreinamento[] {
  return usuarios.filter((u) => (visiveis === 'tenant' || visiveis.has(u.id)) && (!equipeId || u.equipe_id === equipeId));
}
