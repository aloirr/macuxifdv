/**
 * Cadastro de marcas concorrentes do Catálogo (RN-CAT-13, ADR 0034): regras puras da escrita. A marca é do Catálogo e
 * serve a referência cruzada (RN-CAT-09) com ou sem o Promotor. Nome de 1 a 120, único no tenant sem caixa nem acento;
 * não se apaga, só inativa e reativa.
 */
import { chaveSemAcento } from './texto';
export const LIMITE_NOME_MARCA = 120;
/** Chave do nome da marca: sem acento, sem caixa, sem espaço nas pontas (RN-CAT-13). Única definição: o ERP e a lista usam esta. */
export const chaveDoNomeMarca = chaveSemAcento;
/** RN-CAT-13: nome com trim, de 1 a 120 caracteres. */
export function validarNomeMarca(nome) {
    const n = nome.trim();
    if (n.length === 0)
        return { ok: false, erro: { regra: 'RN-CAT-13', campo: 'nome', mensagem: 'Informe o nome da marca e salve de novo.' } };
    if (n.length > LIMITE_NOME_MARCA)
        return { ok: false, erro: { regra: 'RN-CAT-13', campo: 'nome', mensagem: `O nome da marca tem no máximo ${LIMITE_NOME_MARCA} caracteres. Abrevie e salve de novo.` } };
    return { ok: true, nome: n };
}
/** RN-CAT-13: dois nomes são o mesmo sem diferenciar maiúsculas, acentos e espaços nas pontas. */
export const nomeMarcaIgual = (a, b) => chaveDoNomeMarca(a) === chaveDoNomeMarca(b);
/** Fato do evento `catalogo.marca_concorrente.alterada@1`; `null` = nada mudou (não publica). */
export function fatoDaEscritaMarca(antes, depois) {
    if (!antes)
        return 'criada';
    if (antes.ativo && !depois.ativo)
        return 'inativada';
    if (!antes.ativo && depois.ativo)
        return 'reativada';
    if (antes.nome !== depois.nome || (antes.external_id ?? null) !== (depois.external_id ?? null))
        return 'alterada';
    return null;
}
/** RN-CAT-13: texto da confirmação ao inativar; `null` quando nenhuma referência é afetada. */
export function mensagemInativarMarca(referencias) {
    if (referencias <= 0)
        return null;
    return referencias === 1 ? '1 referência sai da busca.' : `${referencias} referências saem da busca.`;
}
/** RN-CAT-13: filtro da lista de Marcas concorrentes (situação e busca pelo nome, sem caixa nem acento). */
export function filtrarMarcas(todas, filtro) {
    const busca = filtro.busca ? chaveDoNomeMarca(filtro.busca) : '';
    return todas.filter((m) => (filtro.situacao === 'todas' || (filtro.situacao === 'ativas' ? m.ativo : !m.ativo)) && (busca === '' || chaveDoNomeMarca(m.nome).includes(busca)));
}
