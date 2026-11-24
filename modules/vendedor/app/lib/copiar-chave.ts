/**
 * Copiar a chave de acesso da NF (RF-VEN-05): vão os 44 dígitos, sem espaços. Puro: a porta de cópia é injetada
 * (a tela passa o `Clipboard` do react-native). Mesmo desenho do `copiarCodigo` do Catálogo, sem importar dele
 * (módulo só importa packages e contracts); se um terceiro módulo precisar, o helper sobe para packages/ui.
 */
import { AVISO_CHAVE_COPIADA, chaveAcessoSoDigitos } from '../../domain/retorno-erp';

export type CopiadorTexto = (texto: string) => void | Promise<void>;

export const AVISO_CHAVE_NAO_COPIADA = 'Não foi possível copiar a chave. Tente de novo.';

export async function copiarChaveNf(chave: string | null | undefined, copiar: CopiadorTexto): Promise<{ ok: boolean; aviso: string }> {
  const texto = chaveAcessoSoDigitos(chave);
  if (!texto) return { ok: false, aviso: AVISO_CHAVE_NAO_COPIADA };
  try {
    await copiar(texto);
    return { ok: true, aviso: AVISO_CHAVE_COPIADA };
  } catch {
    return { ok: false, aviso: AVISO_CHAVE_NAO_COPIADA };
  }
}
