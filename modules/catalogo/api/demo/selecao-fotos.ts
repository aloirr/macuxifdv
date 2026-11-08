/** Escolha dos produtos que ganham foto na demo (T-0097): distribui por categoria para a vitrine ficar variada. Puro. */
export interface ItemParaFoto {
  id: string;
  description: string;
  line: string | null;
}

export function escolherProdutosDeVitrine<T extends ItemParaFoto>(itens: readonly T[], limite: number): T[] {
  const grupos = new Map<string, T[]>();
  for (const i of itens) {
    const chave = (i.line ?? '').trim().toLowerCase();
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  }
  const filas = [...grupos.values()];
  const saida: T[] = [];
  for (let rodada = 0; saida.length < limite; rodada++) {
    let achou = false;
    for (const fila of filas) {
      const i = fila[rodada];
      if (!i) continue;
      achou = true;
      if (saida.length < limite) saida.push(i);
    }
    if (!achou) break;
  }
  return saida;
}
