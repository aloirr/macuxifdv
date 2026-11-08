/**
 * Onde o usuário entra, decidido só pelo motor de permissões do SDK (ADR 0033; T-0111; RN-CORE-33). O shell não compara o
 * perfil com listas próprias: pergunta ao motor (`podeEntrar`) pelos perfis de acesso da sessão.
 * - Com os perfis já resolvidos pela API (fábrica + o que o tenant mudou + limites travados), vale o que veio.
 * - Sem eles (API que ainda não os entrega, demonstração), vale o padrão de fábrica do perfil base, resolvido pelo próprio motor
 *   (`resolverPerfil(perfilDeFabrica(base))`). As chaves de acesso são da plataforma e não dependem dos manifestos, e os limites
 *   travados (vendedor, promotor e supervisor nunca entram no BKO; o portal é só do admin) valem nos dois casos.
 */
import {
  matrizDeFabrica,
  perfilDeFabrica,
  PERFIS,
  podeEntrar,
  resolverPerfil,
  type LugarDeAcesso,
  type Perfil,
  type PerfilDaRequisicao,
} from '@macuxi/platform-sdk';

/** Padrão de fábrica das chaves da plataforma (`acesso.*`, escopo, usuários e senhas): não depende dos manifestos. */
const FABRICA_DA_PLATAFORMA = matrizDeFabrica([]);

/** Perfis de acesso da sessão: os resolvidos pela API, se vieram; senão o de fábrica do perfil base. Sem perfil = nenhum. */
export function perfisDaSessao(perfil: Perfil | null | undefined, resolvidos?: readonly PerfilDaRequisicao[] | null): readonly PerfilDaRequisicao[] {
  if (resolvidos && resolvidos.length > 0) return resolvidos;
  return perfil ? [resolverPerfil(perfilDeFabrica(perfil), FABRICA_DA_PLATAFORMA)] : [];
}

/** O usuário entra em `lugar` (`bko`, `campo`, `gestao`, `portal`)? Falha fechada: sem perfil, não. */
export function entraEm(lugar: LugarDeAcesso, perfil: Perfil | null | undefined, resolvidos?: readonly PerfilDaRequisicao[] | null): boolean {
  return podeEntrar(perfisDaSessao(perfil, resolvidos), lugar);
}

/** Perfis base que, de fábrica, entram em `lugar`, na ordem do doc 03 (ex.: a lista de usuários da demonstração do BKO). */
export function perfisDeFabricaQueEntram(lugar: LugarDeAcesso): Perfil[] {
  return PERFIS.filter((p) => entraEm(lugar, p));
}

const NOME_DO_LUGAR: Readonly<Record<Exclude<LugarDeAcesso, 'portal'>, string>> = { campo: 'o Macuxi Campo', gestao: 'o Macuxi Gestão', bko: 'a web do BKO' };

/** "o Macuxi Gestão ou a web do BKO": onde o perfil entra de fábrica (lista da demonstração). Nenhum lugar = `null`. */
export function ondeOPerfilEntra(perfil: Perfil | null | undefined): string | null {
  const lugares = (Object.keys(NOME_DO_LUGAR) as (keyof typeof NOME_DO_LUGAR)[]).filter((l) => entraEm(l, perfil));
  return lugares.length > 0 ? lugares.map((l) => NOME_DO_LUGAR[l]).join(' ou ') : null;
}
