/**
 * Copiar o código do produto (`erp_code`): o Catálogo é só consulta (decisão do dono do produto, R-20261114-151000-alexandre).
 * Puro (sem react-native): a porta de cópia é injetada. O shell pode trocar o padrão (`Clipboard` do react-native) por
 * `expo-clipboard` com `definirCopiadorTexto`.
 */
export type CopiadorTexto = (texto: string) => void | Promise<void>;

export const ROTULO_COPIAR_CODIGO = 'Copiar código';
export const AVISO_CODIGO_COPIADO = 'Código copiado';
export const AVISO_CODIGO_NAO_COPIADO = 'Não foi possível copiar o código. Tente de novo.';

let copiadorDoShell: CopiadorTexto | null = null;
export function definirCopiadorTexto(c: CopiadorTexto | null): void {
  copiadorDoShell = c;
}

export const rotuloAcessivelCopiar = (codigo: string): string => `${ROTULO_COPIAR_CODIGO} ${codigo}`;

/** `padrao` é o copiador da plataforma (a tela passa o `Clipboard`); o do shell, se houver, tem prioridade. */
export async function copiarCodigo(codigo: string, padrao?: CopiadorTexto): Promise<{ ok: boolean; aviso: string }> {
  const texto = codigo.trim();
  const copiar = copiadorDoShell ?? padrao;
  if (!texto || !copiar) return { ok: false, aviso: AVISO_CODIGO_NAO_COPIADO };
  try {
    await copiar(texto);
    return { ok: true, aviso: AVISO_CODIGO_COPIADO };
  } catch {
    return { ok: false, aviso: AVISO_CODIGO_NAO_COPIADO };
  }
}
