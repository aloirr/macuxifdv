/**
 * Módulos no portal `config.` (RD-2617): o nome vem do mapa único do kit (`nomeDoModulo`, `modulosContrataveis`). Só Core e
 * Integração entram sempre e somem das listas do portal; o Catálogo é opcional: aparece para escolher (Nova empresa sem planos e
 * "Acrescentar módulos") e no cartão "Módulos licenciados", e só vai no corpo quando marcado.
 */
import { infoDoModulo, MODULOS_NATIVOS, modulosContrataveis, type InfoDoModulo } from '@macuxi/ui/web';

/** Os módulos que entram em toda empresa e não aparecem em lista: o único lugar do filtro. */
export const MODULOS_SEMPRE = ['core', 'integracao'] as const;

export const ehModuloSempre = (id: string): boolean => (MODULOS_SEMPRE as readonly string[]).includes(id);

/** Os módulos que o portal lista: os contratáveis do kit e os nativos opcionais (Catálogo), em ordem alfabética do nome. */
export function modulosDoPortal(ids: readonly string[]): InfoDoModulo[] {
  const nativosOpcionais = MODULOS_NATIVOS.filter((m) => !ehModuloSempre(m) && ids.includes(m)).map(infoDoModulo);
  return [...modulosContrataveis(ids), ...nativosOpcionais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
