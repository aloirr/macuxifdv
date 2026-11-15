import { codigoCompacto } from './ranking';
export const LIMITES_CADASTRO_CATALOGO = { referencias: 3, codigo: 30, ofereceJunto: 5, etiquetas: 4, etiqueta: 20 };
/** Devolve os erros do cadastro (`[]` = ok). A API revalida com esta mesma função (422 com a regra e o campo). */
export function validarCadastroCatalogo(produtoId, c, opcoes) {
    const L = LIMITES_CADASTRO_CATALOGO;
    const erros = [];
    const erro = (regra, campo, mensagem) => erros.push({ regra, campo, mensagem });
    if (c.aplicacao !== null && c.aplicacao.trim().length > opcoes.aplicacaoMax) {
        erro('RN-CAT-11', 'aplicacao', `Aplicação: use até ${opcoes.aplicacaoMax.toLocaleString('pt-BR')} caracteres (agora: ${c.aplicacao.trim().length.toLocaleString('pt-BR')}).`);
    }
    const referencias = c.referencias ?? [];
    if (referencias.length > L.referencias)
        erro('RN-CAT-09', 'referencias', `Use até ${L.referencias} referências de concorrente.`);
    const vistas = new Set();
    for (const [i, r] of referencias.entries()) {
        const codigo = r.codigo.trim();
        if (codigo.length > L.codigo)
            erro('RN-CAT-09', 'referencias', `Código ${i + 1}: use até ${L.codigo} caracteres.`);
        const compacto = codigoCompacto(codigo);
        if (compacto === '') {
            erro('RN-CAT-09', 'referencias', 'Informe o código do concorrente com letras ou números.');
            continue;
        }
        const chave = `${r.marca_id}:${compacto}`;
        if (vistas.has(chave))
            erro('RN-CAT-09', 'referencias', `A referência "${codigo}" está repetida para a mesma marca. Deixe só uma.`);
        vistas.add(chave);
    }
    if (c.oferece_junto.length + (c.oferece_junto_codigos?.length ?? 0) > L.ofereceJunto)
        erro('RN-CAT-09', 'oferece_junto', `Oferece junto: use até ${L.ofereceJunto} produtos.`);
    if (c.oferece_junto.includes(produtoId))
        erro('RN-CAT-09', 'oferece_junto', 'O produto não pode oferecer ele mesmo. Escolha outro.');
    if (new Set(c.oferece_junto).size !== c.oferece_junto.length)
        erro('RN-CAT-09', 'oferece_junto', 'Há produto repetido em "Oferece junto". Deixe só um de cada.');
    if (c.etiquetas.length > L.etiquetas)
        erro('RN-CAT-09', 'etiquetas', `Use até ${L.etiquetas} etiquetas, com até ${L.etiqueta} caracteres cada.`);
    if (c.etiquetas.some((e) => e.trim().length > L.etiqueta || e.trim() === ''))
        erro('RN-CAT-09', 'etiquetas', `Use até ${L.etiquetas} etiquetas, com até ${L.etiqueta} caracteres cada.`);
    return erros;
}
