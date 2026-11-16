/**
 * RD-0016 (T-0111; ADR 0033; RN-CORE-33): onde o usuário da sessão entra, decidido só pelo motor de permissões. Fonte única
 * dos dois shells (`apps/mobile` e `apps/web` tinham cópias iguais em `lib/acesso.ts`). O shell não compara o perfil com
 * listas próprias: pergunta ao motor (`podeEntrar`) pelos perfis de acesso da sessão.
 * - Com os perfis já resolvidos pela API (fábrica + o que o tenant mudou + limites travados), vale o que veio.
 * - Sem eles (API que ainda não os entrega, demonstração), vale o padrão de fábrica do perfil base, resolvido pelo próprio
 *   motor (`resolverPerfil(perfilDeFabrica(base))`). As chaves de acesso são da plataforma e não dependem dos manifestos, e
 *   os limites travados (vendedor, promotor e supervisor nunca entram no BKO; o portal é só do admin) valem nos dois casos.
 */
import { PERFIS } from './nomes';
import { matrizDeFabrica, perfilDeFabrica, podeEntrar, resolverPerfil } from './permissoes-perfil';
/** Padrão de fábrica das chaves da plataforma (`acesso.*`, escopo, usuários e senhas): não depende dos manifestos. */
const FABRICA_DA_PLATAFORMA = matrizDeFabrica([]);
/** Perfis de acesso da sessão: os resolvidos pela API, se vieram; senão o de fábrica do perfil base. Sem perfil = nenhum. */
export function perfisDaSessao(perfil, resolvidos) {
    if (resolvidos && resolvidos.length > 0)
        return resolvidos;
    return perfil ? [resolverPerfil(perfilDeFabrica(perfil), FABRICA_DA_PLATAFORMA)] : [];
}
/** O usuário entra em `lugar` (`bko`, `campo`, `gestao`, `portal`)? Falha fechada: sem perfil, não. */
export function entraEm(lugar, perfil, resolvidos) {
    return podeEntrar(perfisDaSessao(perfil, resolvidos), lugar);
}
/** Perfis base que, de fábrica, entram em `lugar`, na ordem de `PERFIS` (ex.: a lista de usuários da demonstração do BKO). */
export function perfisDeFabricaQueEntram(lugar) {
    return PERFIS.filter((p) => entraEm(lugar, p));
}
