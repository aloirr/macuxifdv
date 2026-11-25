/**
 * Escopo de dados por perfil (RN-CORE-04). A API filtra a consulta por este escopo; o `domain` decide qual é
 * e confere se um cliente está dentro. O Core resolve o conjunto de clientes a partir de carteira/equipe.
 */
import { escopoDoPerfil, verificarCarteira } from '@macuxi/platform-sdk';
/** vendedor/promotor → carteira própria; supervisor → equipe; gerente → equipes abaixo; analista/assistente/admin → tenant. */
export function escopoDeCarteira(perfil) {
    return escopoDoPerfil(perfil);
}
/** Resolve os clientes visíveis; `'tenant'` = sem filtro de carteira (o RLS ainda isola o tenant, RN-CORE-05). */
export function clientesVisiveis(perfil, c) {
    switch (escopoDeCarteira(perfil)) {
        case 'carteira':
            return c.propria;
        case 'equipe':
            return new Set([...c.propria, ...c.equipe]);
        case 'equipes_abaixo':
            return new Set([...c.propria, ...c.equipe, ...c.equipesAbaixo]);
        case 'tenant':
            return 'tenant';
    }
}
export function clienteNoEscopo(clienteId, visiveis) {
    return verificarCarteira(clienteId, visiveis).ok;
}
