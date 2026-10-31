/**
 * Permissão por ação (ADR 0004; doc 03 §2 "Matriz de permissões").
 *
 * Cada módulo declara em `manifest.acoes` as ações que expõe (`pedido.criar`, `pedido.cancelar`…) e
 * os perfis que podem executá-las. A mesma declaração serve:
 *  - ao SHELL, que esconde botões, abas, menus e itens de extensão de quem não pode (`pode`);
 *  - à API, que revalida a rota com `verificarAcao` (401 / 403 MODULO_INATIVO / 403 PERFIL_SEM_ACESSO).
 * Ação desconhecida = negada (falha fechada). RN-PRO-01 é aplicada de novo aqui, pelo perfil, mesmo que
 * um manifesto escape da validação: promotor nunca executa ação de pedido.
 * O escopo do dado (próprio / equipe / tenant) não mora aqui: fica no domain do módulo + `verificarCarteira`.
 */
import { verificarAcesso, type RegraRota, type ResultadoAcesso, type UsuarioAcesso } from './acesso';
import type { Manifesto } from './manifesto';
import { ehAcaoDePedido, type ModuloId, type Perfil } from './nomes';

export interface ContextoPermissao {
  perfil: Perfil | null | undefined;
  /** Módulos efetivos do usuário (RN-CORE-01/03). */
  modulosAtivos: Iterable<ModuloId>;
}

interface DefAcao {
  modulo: ModuloId;
  perfis: readonly Perfil[];
}

/** RN-PRO-01: vale pelo perfil, independentemente do módulo que declarou a ação. */
function vetadaPeloPerfil(acao: string, perfil: Perfil): boolean {
  return perfil === 'promotor' && ehAcaoDePedido(acao);
}

export function criarPermissoes(manifestos: readonly Manifesto[]) {
  const porAcao = new Map<string, DefAcao>();
  for (const m of manifestos) {
    for (const [acao, def] of Object.entries(m.acoes)) {
      const atual = porAcao.get(acao);
      if (atual && atual.modulo !== m.id) throw new Error(`Ação ${acao} declarada por ${atual.modulo} e por ${m.id}`);
      porAcao.set(acao, { modulo: m.id, perfis: def.perfis });
    }
  }

  const pode = (acao: string, ctx: ContextoPermissao): boolean => {
    const def = porAcao.get(acao);
    if (!def || !ctx.perfil) return false;
    if (vetadaPeloPerfil(acao, ctx.perfil)) return false;
    if (![...ctx.modulosAtivos].includes(def.modulo)) return false;
    return def.perfis.includes(ctx.perfil);
  };

  return {
    /** O usuário pode executar a ação? (módulo dono efetivo + perfil autorizado; desconhecida = não). */
    pode,
    /** Todas as ações permitidas no contexto, em ordem alfabética (útil para `GET /v1/me` e testes). */
    acoesPermitidas(ctx: ContextoPermissao): string[] {
      return [...porAcao.keys()].filter((a) => pode(a, ctx)).sort();
    },
    conhece(acao: string): boolean {
      return porAcao.has(acao);
    },
    /** Regra da rota da API correspondente à ação (para `verificarAcesso`). Erro se a ação não existe. */
    regraDaAcao(acao: string): RegraRota {
      const def = porAcao.get(acao);
      if (!def) throw new Error(`Ação ${acao} não declarada em nenhum manifesto`);
      const perfis = ehAcaoDePedido(acao) ? def.perfis.filter((p) => p !== 'promotor') : def.perfis;
      return { modulo: def.modulo, perfis };
    },
  };
}

export type Permissoes = ReturnType<typeof criarPermissoes>;

/** Verificação da API para uma ação: autenticação → licença do módulo → perfil (mesma ordem de `verificarAcesso`). */
export function verificarAcao(usuario: UsuarioAcesso | null | undefined, permissoes: Permissoes, acao: string): ResultadoAcesso {
  if (!permissoes.conhece(acao)) {
    if (!usuario) return verificarAcesso(usuario, { modulo: 'core', perfis: [] });
    return { ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Ação desconhecida.' };
  }
  return verificarAcesso(usuario, permissoes.regraDaAcao(acao));
}
