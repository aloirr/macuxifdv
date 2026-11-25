import { clienteCasaBusca, normalizarBusca } from '../contracts/busca-cliente';
import { clienteNoEscopo, clientesVisiveis, escopoDeCarteira } from './escopo';
// Reexporta a regra da busca (`contracts/busca-cliente.ts`).
export { clienteCasaBusca, digitosDeBuscaDoDocumento, MINIMO_BUSCA_CLIENTE_BKO, normalizarBusca, palavrasDaBusca, ROTULO_BUSCA_CLIENTE, ROTULO_BUSCA_CLIENTE_BKO, sqlBuscaNormalizada, } from '../contracts/busca-cliente';
const rotulo = (c) => c.nome_fantasia?.trim() || c.razao_social;
/** Clientes do escopo do perfil (RN-CORE-04) + busca e filtros. O filtro nunca amplia o escopo. */
export function listarClientes(clientes, perfil, conjuntos, filtro = {}, fin = {}) {
    const visiveis = clientesVisiveis(perfil, conjuntos);
    return clientes
        .filter((c) => clienteNoEscopo(c.id, visiveis))
        .filter((c) => !filtro.cidade || normalizarBusca(c.cidade) === normalizarBusca(filtro.cidade))
        .filter((c) => !filtro.segmento || normalizarBusca(c.segmento) === normalizarBusca(filtro.segmento))
        .filter((c) => !filtro.bloqueado || (fin.bloqueados?.has(c.id) ?? false))
        .filter((c) => !filtro.comVencidos || (fin.comVencidos?.has(c.id) ?? false))
        .filter((c) => clienteCasaBusca(filtro.q, c))
        .sort((a, b) => rotulo(a).localeCompare(rotulo(b), 'pt-BR', { sensitivity: 'base' }));
}
/** De quem o usuário vê dados (visitas, rotas, metas, pedidos): gêmeo de `clientesVisiveis`. `'tenant'` = sem filtro (RLS isola o tenant). */
export function escopoDeUsuarios(perfil, u) {
    switch (escopoDeCarteira(perfil)) {
        case 'carteira':
            return new Set([u.proprio]);
        case 'equipe':
            return new Set([u.proprio, ...u.equipe]);
        case 'equipes_abaixo':
            return new Set([u.proprio, ...u.equipe, ...u.equipesAbaixo]);
        case 'tenant':
            return 'tenant';
    }
}
/**
 * RN-CORE-04 / RF-CORE-02: o papel do vínculo da carteira combina com o perfil do usuário — papel `vendedor` é de
 * usuário vendedor e `promotor` de usuário promotor (o promotor nunca cria pedido, RN-PRO-01; carteira de vendedor
 * dada a promotor liberaria o que o promotor não pode).
 */
export function papelCompativel(perfil, papel) {
    return perfil === papel;
}
