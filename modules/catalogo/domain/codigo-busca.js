/**
 * RN-CAT-03: a frase que é só um código (SKU/ERP/EAN) não precisa de interpretação por IA: vai direto à busca exata/FTS,
 * sem gastar a cota do dia e sem o aviso de "busca inteligente indisponível".
 * Parece código: um só termo (sem espaço), só letras ASCII, dígitos, ponto, hífen ou barra, com ao menos um dígito.
 */
const CODIGO_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;
export function textoPareceCodigo(texto) {
    const t = String(texto ?? '').trim();
    return t.length > 0 && CODIGO_RE.test(t) && /\d/.test(t);
}
