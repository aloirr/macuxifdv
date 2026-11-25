/**
 * RN-CORE-58 (T-0175): vínculo automático do vendedor do ERP ao usuário do Macuxi pelo NOME COMPLETO (além do vínculo manual).
 * Só vincula quando há um único usuário vendedor/promotor, ativo e sem código ERP com o mesmo nome normalizado. Homônimo, quem já
 * tem outro código e inativo não vinculam e geram aviso. Funções puras, sem banco. Proposta: docs/modulos/core/vinculo-erp-por-nome.md.
 */
import { ehUsuarioProvisorio } from './vinculo-erp';
/** Caixa, acentos, pontuação e espaços repetidos não contam; nome de uma palavra só não serve (nulo). */
export function normalizarNomeParaVinculo(nome) {
    const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return n.split(' ').filter(Boolean).length >= 2 ? n : null;
}
const PERFIS_COMPATIVEIS = new Set(['vendedor', 'promotor']);
export function decidirVinculoPorNome(nomeErp, usuarios) {
    const alvo = normalizarNomeParaVinculo(nomeErp);
    if (alvo === null)
        return { acao: 'seguir' };
    const iguais = usuarios.filter((u) => PERFIS_COMPATIVEIS.has(u.perfil) && !ehUsuarioProvisorio(u.email) && normalizarNomeParaVinculo(u.nome) === alvo);
    if (iguais.length === 0)
        return { acao: 'seguir' };
    if (iguais.length > 1)
        return { acao: 'avisar', motivo: 'homonimo', candidatos: iguais.length };
    const u = iguais[0];
    if (u.external_id)
        return { acao: 'avisar', motivo: 'outro_codigo', candidatos: 1 };
    if (!u.ativo)
        return { acao: 'avisar', motivo: 'inativo', candidatos: 1 };
    return { acao: 'vincular', usuario_id: u.id };
}
