/** Tabela de preços do cliente no aparelho (RN-VEN-02): vence quando o sync em que foi calculada não é mais o último. */
export function tabelaVencida(tabela: { base_sync?: string | null } | null | undefined, sincronizadoEm: string | null | undefined): boolean {
  if (!tabela) return true;
  if (!sincronizadoEm) return false;
  return tabela.base_sync !== sincronizadoEm;
}
