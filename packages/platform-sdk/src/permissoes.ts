/**
 * Permissão por ação (ADR 0004; doc 03 §2 "Matriz de permissões").
 *
 * Cada módulo declara em `manifest.acoes` as ações que expõe (`pedido.criar`, `pedido.cancelar`…) e
 * os perfis que podem executá-las. A mesma declaração serve:
 *  - ao SHELL, que esconde botões, abas, menus e itens de extensão de quem não pode (`pode`);
 *  - à API, que revalida a rota com `verificarAcao` (401 / 403 MODULO_INATIVO / 403 PERFIL_SEM_ACESSO).
 * Ação desconhecida = negada (falha fechada). RN-PRO-01 é aplicada de novo aqui, pelo perfil, mesmo que
 * um manifesto escape da validação: promotor nunca executa ação de ESCRITA de pedido; a leitura (`pedido.ver`)
 * segue o `perfis` do manifesto (doc 03 §2 "Ver pedidos", esclarecimento O-3).
 * O escopo do dado (próprio / equipe / tenant) não mora aqui: fica no domain do módulo + `verificarCarteira`.
 *
 * ADR 0033 (T-0111): o `perfis` do manifesto passa a ser o PADRÃO DE FÁBRICA. Com os perfis de acesso do usuário no contexto
 * (`perfis`, que a API resolve a cada requisição), quem decide é o motor (`pode` de `permissoes-perfil`), já com o que o tenant
 * mudou e os limites travados; sem eles (shell antigo, testes), vale o manifesto como antes. As chaves da plataforma
 * (`CHAVES_PLATAFORMA`: onde entra, escopo, usuários, senhas e perfis) entram aqui como ações do `core`.
 */
import { verificarAcesso, type RegraRota, type ResultadoAcesso, type UsuarioAcesso } from './acesso';
import type { Manifesto } from './manifesto';
import { ehAcaoDeEscritaDePedido, PERFIS, type ModuloId, type Perfil } from './nomes';
import { CHAVES_PLATAFORMA, matrizDeFabrica, pode as podePelosPerfis, type PerfilDaRequisicao } from './permissoes-perfil';

export interface ContextoPermissao {
  perfil: Perfil | null | undefined;
  /** Módulos efetivos do usuário (RN-CORE-01/03). */
  modulosAtivos: Iterable<ModuloId>;
  /** ADR 0033: perfis de acesso resolvidos; presentes, o motor decide (o `perfil` acima fica só como legado). */
  perfis?: readonly PerfilDaRequisicao[];
}

interface DefAcao {
  modulo: ModuloId;
  perfis: readonly Perfil[];
}

/** RN-PRO-01: vale pelo perfil, independentemente do módulo que declarou a ação (só escrita; leitura = manifesto). */
function vetadaPeloPerfil(acao: string, perfil: Perfil): boolean {
  return perfil === 'promotor' && ehAcaoDeEscritaDePedido(acao);
}

export function criarPermissoes(manifestos: readonly Manifesto[]) {
  const porAcao = new Map<string, DefAcao>();
  // chaves da plataforma (ADR 0033): do core, com os perfis da fábrica. Valem em `pode`, `conhece` e `regraDaAcao` (a rota pode
  // declarar `acao: 'usuario.criar'`), mas ficam fora de `acoesPermitidas`, que continua listando só as ações dos manifestos
  const fabrica = matrizDeFabrica([]);
  const daPlataforma = new Map<string, DefAcao>(
    Object.keys(CHAVES_PLATAFORMA).map((chave) => [chave, { modulo: 'core', perfis: PERFIS.filter((p) => !!fabrica[p][chave]) }] as const),
  );
  const definicao = (acao: string): DefAcao | undefined => porAcao.get(acao) ?? daPlataforma.get(acao);
  for (const m of manifestos) {
    for (const [acao, def] of Object.entries(m.acoes)) {
      const atual = porAcao.get(acao);
      if (Object.hasOwn(CHAVES_PLATAFORMA, acao)) throw new Error(`Ação ${acao} do módulo ${m.id} é chave da plataforma (ADR 0033)`);
      if (atual && atual.modulo !== m.id) throw new Error(`Ação ${acao} declarada por ${atual.modulo} e por ${m.id}`);
      porAcao.set(acao, { modulo: m.id, perfis: def.perfis });
    }
  }

  const pode = (acao: string, ctx: ContextoPermissao): boolean => {
    const def = definicao(acao);
    if (!def) return false;
    if (ctx.perfis) return [...ctx.modulosAtivos].includes(def.modulo) && podePelosPerfis(ctx.perfis, acao);
    if (!ctx.perfil) return false;
    if (vetadaPeloPerfil(acao, ctx.perfil)) return false;
    if (![...ctx.modulosAtivos].includes(def.modulo)) return false;
    return def.perfis.includes(ctx.perfil);
  };

  return {
    /** O usuário pode executar a ação? (módulo dono efetivo + perfil autorizado; desconhecida = não). */
    pode,
    /** Ações dos manifestos permitidas no contexto, em ordem alfabética (sem as chaves da plataforma; ver `chavesPermitidas`). */
    acoesPermitidas(ctx: ContextoPermissao): string[] {
      return [...porAcao.keys()].filter((a) => pode(a, ctx)).sort();
    },
    conhece(acao: string): boolean {
      return definicao(acao) !== undefined;
    },
    /** Regra da rota da API correspondente à ação (para `verificarAcesso`). Erro se a ação não existe. */
    regraDaAcao(acao: string): RegraRota {
      const def = definicao(acao);
      if (!def) throw new Error(`Ação ${acao} não declarada em nenhum manifesto`);
      const perfis = ehAcaoDeEscritaDePedido(acao) ? def.perfis.filter((p) => p !== 'promotor') : def.perfis;
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
  const regra = permissoes.regraDaAcao(acao);
  if (!usuario?.perfis) return verificarAcesso(usuario, regra);
  // ADR 0033: licença do módulo dono (mesma ordem e códigos), depois o motor de permissões dos perfis do usuário
  const lic = verificarAcesso(usuario, { modulo: regra.modulo, perfis: [usuario.perfil] });
  if (!lic.ok) return lic;
  if (!podePelosPerfis(usuario.perfis, acao)) return { ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Seu perfil não tem acesso a esta ação.' };
  return { ok: true };
}
