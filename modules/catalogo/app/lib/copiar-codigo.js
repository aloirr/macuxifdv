export const ROTULO_COPIAR_CODIGO = 'Copiar código';
export const AVISO_CODIGO_COPIADO = 'Código copiado';
export const AVISO_CODIGO_NAO_COPIADO = 'Não foi possível copiar o código. Tente de novo.';
let copiadorDoShell = null;
export function definirCopiadorTexto(c) {
    copiadorDoShell = c;
}
export const rotuloAcessivelCopiar = (codigo) => `${ROTULO_COPIAR_CODIGO} ${codigo}`;
/** `padrao` é o copiador da plataforma (a tela passa o `Clipboard`); o do shell, se houver, tem prioridade. */
export async function copiarCodigo(codigo, padrao) {
    const texto = codigo.trim();
    const copiar = copiadorDoShell ?? padrao;
    if (!texto || !copiar)
        return { ok: false, aviso: AVISO_CODIGO_NAO_COPIADO };
    try {
        await copiar(texto);
        return { ok: true, aviso: AVISO_CODIGO_COPIADO };
    }
    catch {
        return { ok: false, aviso: AVISO_CODIGO_NAO_COPIADO };
    }
}
