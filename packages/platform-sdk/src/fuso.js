/**
 * Fuso do tenant no contexto das rotas (`ctx.fuso()`, T-0035; RN-CORE-11: datas gravadas em UTC, exibidas e viradas
 * no fuso da empresa). A API lê `plataforma.tenant.fuso` junto com as licenças, a cada requisição; o módulo não toca
 * `plataforma.*` (regra 1, S0-014). Mesmo padrão de `@macuxi/comum/fuso` (`DEFAULT_TZ`).
 */
/** Fuso usado quando o tenant não tem fuso válido (ou a rota não tem tenant). */
export const FUSO_PADRAO_TENANT = 'America/Manaus';
/** `true` se `fuso` é um nome IANA que o `Intl` deste processo reconhece (ex.: `America/Manaus`). */
export function ehFusoValido(fuso) {
    if (typeof fuso !== 'string' || fuso.trim() === '' || fuso !== fuso.trim())
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: fuso });
        return true;
    }
    catch {
        return false;
    }
}
/** Fuso do tenant normalizado: o próprio, se válido; senão `America/Manaus` (falha segura, nunca lança). */
export function fusoDoTenantOuPadrao(fuso) {
    return ehFusoValido(fuso) ? fuso : FUSO_PADRAO_TENANT;
}
