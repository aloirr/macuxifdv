/**
 * Consulta `catalogo.foto_produto@1` no aparelho (T-0148): "tem foto?" sem rede e "abrir a foto" sob demanda, com o arquivo
 * guardado no cache de disco do shell (resolvedor injetado por `definirResolvedorMiniatura`). Offline-first: o que já foi
 * aberto abre sem sinal; o que nunca foi aberto e está sem sinal devolve `uri` nulo.
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_FOTO_PRODUTO } from '../contracts';
import { miniaturasLocais } from './lib/miniatura-local';
import { urlBaixavel } from './lib/miniatura-resolvedor';

export const consultaFotoProdutoAparelho = implementarConsultaAparelho(CONSULTA_FOTO_PRODUTO, async (entrada, ctx) => {
  const minis = await miniaturasLocais(ctx, entrada.produto_ids);
  const itens = await Promise.all(
    entrada.produto_ids.map(async (id) => {
      const m = minis.get(id);
      if (!m) return { produto_id: id, tem_foto: false, uri: null };
      if (!entrada.abrir) return { produto_id: id, tem_foto: true, uri: null };
      try {
        return { produto_id: id, tem_foto: true, uri: (await urlBaixavel(m)) ?? null };
      } catch {
        return { produto_id: id, tem_foto: true, uri: null };
      }
    }),
  );
  return { itens };
});
