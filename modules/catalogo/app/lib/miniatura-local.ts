/**
 * Leitura das miniaturas dos itens EXIBIDOS (T-0097). Offline-first: vem do `produto_conteudo` já sincronizado, lendo só
 * as linhas dos ids pedidos (`linhasPorCampo`, índice por `produto_id`), nunca a tabela inteira. Linha sem miniatura ou
 * com miniatura fora do contrato/teto é ignorada.
 */
import type { MiniaturaProduto, ProdutoConteudoSync } from '../../contracts';
import { miniaturaNoTeto } from './miniatura';
import type { LeitorLocal } from './local';

export async function miniaturasLocais(leitor: Pick<LeitorLocal, 'linhasPorCampo'>, ids: readonly string[]): Promise<Map<string, MiniaturaProduto>> {
  const saida = new Map<string, MiniaturaProduto>();
  if (ids.length === 0 || !leitor.linhasPorCampo) return saida;
  const linhas = await leitor.linhasPorCampo<ProdutoConteudoSync>('produto_conteudo', 'produto_id', [...new Set(ids)]);
  for (const l of linhas) {
    if (l.deleted_at) continue;
    const m = l.miniatura;
    if (miniaturaNoTeto(m)) saida.set(l.produto_id, m);
  }
  return saida;
}
