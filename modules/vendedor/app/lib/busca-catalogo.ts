/**
 * T-0084-A3 (RN-CAT-12): resultado da busca do seletor pela consulta `catalogo.busca_produtos@1`.
 * Só `ConsultaIndisponivel` leva à busca local de reserva; qualquer outro erro é falha da busca (aparece na tela e vai ao log).
 */
import type { TrechoServeEm } from '../../domain/busca-seletor';

/** `veiculo` só vem quando a busca levou veículo (RN-CAT-22). */
export type ItemBuscaCatalogo = { produto_id: string; serve_em: TrechoServeEm | null; veiculo?: { compatibilidade: 'compativel' | 'conferir'; serve_em: TrechoServeEm | null } };
export type ResultadoBuscaCatalogo = { tipo: 'ok'; itens: ItemBuscaCatalogo[]; total: number; sugestao: string | null } | { tipo: 'reserva' } | { tipo: 'erro' };

export const MENSAGEM_ERRO_BUSCA = 'Não deu para buscar agora. Toque em buscar de novo ou veja o catálogo.';

export async function buscarNoCatalogoComReserva(
  consultar: () => Promise<{ itens: ItemBuscaCatalogo[]; total?: number; sugestao?: string | null }>,
  ehIndisponivel: (e: unknown) => boolean,
  registrar: (mensagem: string, extra: { nome: string }) => void,
): Promise<ResultadoBuscaCatalogo> {
  try {
    const r = await consultar();
    return { tipo: 'ok', itens: r.itens.map((i) => ({ produto_id: i.produto_id, serve_em: i.serve_em, ...(i.veiculo ? { veiculo: i.veiculo } : {}) })), total: r.total ?? r.itens.length, sugestao: r.sugestao ?? null };
  } catch (e) {
    if (ehIndisponivel(e)) return { tipo: 'reserva' };
    // sem dado pessoal: só o nome do erro, nunca a mensagem nem a consulta digitada
    registrar('[busca-seletor] falha da catalogo.busca_produtos@1', { nome: e instanceof Error ? e.name : 'desconhecido' });
    return { tipo: 'erro' };
  }
}
