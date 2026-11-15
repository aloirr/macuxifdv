/**
 * T-0178 (RF-CORE-01; RN-CORE-32 e RN-CORE-34; spec docs/design/trocar-senha/spec.md §2 e §7): funções puras da "Trocar senha"
 * do Perfil no shell. A troca sobe a `sessao_versao` (os tokens antigos deixam de valer): a sessão da resposta toma o lugar da
 * atual, sem reabrir o motor nem o armazenamento (o usuário e o tenant são os mesmos).
 */

interface SessaoDoShell {
  token: string;
  user: { id: string; name: string; email: string };
  tenant?: { id: string; codigo: string } | null;
  modo?: string;
}

interface RespostaDaTroca {
  access_token: string;
  usuario: { id: string; nome: string };
  tenant: { id: string };
}

/** Código da empresa e e-mail de quem está no app; `null` sem sessão, na demonstração (sem senha) ou sem tenant. */
export function contaDaSessao(s: SessaoDoShell | null): { codigoEmpresa: string; email: string } | null {
  if (!s || s.modo === 'demo' || !s.tenant?.codigo) return null;
  return { codigoEmpresa: s.tenant.codigo, email: s.user.email };
}

/** Sessão com o token novo; `null` se a resposta for de outro usuário ou de outro tenant (o shell não mistura sessões). */
export function sessaoDepoisDaTroca<S extends SessaoDoShell>(atual: S | null, r: RespostaDaTroca): S | null {
  if (!atual || atual.user.id !== r.usuario.id || atual.tenant?.id !== r.tenant.id) return null;
  return { ...atual, token: r.access_token, user: { ...atual.user, name: r.usuario.nome } };
}
