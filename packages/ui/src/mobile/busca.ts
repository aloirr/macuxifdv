/**
 * T-0167 (RF-CAT-01; pedido-v4.md §5.3 e §6 da busca): parte PURA do fim da lista de resultados — a contagem com
 * "+ Mostrar mais" (20 por vez, sem nova consulta) e o "Você quis dizer…" quando a busca não acha nada.
 * Vale para a busca do Catálogo e da aba Itens do Novo pedido. Sem regra de negócio (o ranking e a sugestão são do módulo).
 * Sem react-native: roda em Node (Vitest).
 */
import { textoDaContagem } from './componentes';

/** Tamanho da página: o módulo mostra 20 e cada toque em "+ Mostrar mais" traz os próximos 20 da lista já ranqueada. */
export const PAGINA_DA_BUSCA = 20;

export const ROTULO_MOSTRAR_MAIS = 'Mostrar mais';

/** "Mostrando 20 de 87" · null quando tudo já está à vista (aí a contagem e o botão somem). */
export function textoDaContagemDaBusca(mostrando: number, total: number): string | null {
  const t = Math.max(0, Math.trunc(total));
  const m = Math.min(Math.max(0, Math.trunc(mostrando)), t);
  if (m >= t) return null;
  return `Mostrando ${textoDaContagem(m)} de ${textoDaContagem(t)}`;
}

/** Quantos mostrar depois de mais um toque (nunca passa do total). */
export function proximaPaginaDaBusca(mostrando: number, total: number, pagina = PAGINA_DA_BUSCA): number {
  return Math.min(Math.max(0, Math.trunc(total)), Math.max(0, Math.trunc(mostrando)) + pagina);
}

/** TalkBack do botão: "Mostrar mais 20 produtos, mostrando 20 de 87". */
export function leituraDoMostrarMais(mostrando: number, total: number, objeto = 'produtos'): string {
  const proximos = proximaPaginaDaBusca(mostrando, total) - Math.min(mostrando, total);
  const contagem = textoDaContagemDaBusca(mostrando, total);
  return `Mostrar mais ${proximos} ${objeto}${contagem ? `, ${contagem.toLowerCase()}` : ''}`;
}

/** "Nenhum produto com “agau”." (o termo como foi digitado, sem espaços nas pontas). */
export function textoNadaEncontrado(termo: string, objeto = 'produto'): string {
  return `Nenhum ${objeto} com “${termo.trim()}”.`;
}

/** "Você quis dizer “água”?" · null sem sugestão (ou sugestão igual ao termo): aí fica só a frase do nada encontrado. */
export function textoVoceQuisDizer(sugestao: string | null | undefined, termo?: string): string | null {
  const s = (sugestao ?? '').trim();
  if (!s) return null;
  if (termo !== undefined && s.toLowerCase() === termo.trim().toLowerCase()) return null;
  return `Você quis dizer “${s}”?`;
}
