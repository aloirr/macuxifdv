/**
 * Texto e ação do "nada encontrado" da busca do Catálogo no aparelho (T-0052).
 * Especificação: docs/design/catalogo-busca-vazio.md. Função pura: a tela só desenha.
 */
export type CasoVazioBusca = 'filtro' | 'offline' | 'pedido' | 'demais';

export interface EntradaVazioBusca {
  consulta: string;
  /** Algum chip ligado (linha, marca ou "Com estoque"). */
  filtroLigado: boolean;
  /** A busca caiu para o aparelho por falta de internet (AVISO_BUSCA_OFFLINE). */
  semInternet: boolean;
  dentroDoPedido: boolean;
}

export interface VazioBusca {
  caso: CasoVazioBusca;
  titulo: string;
  apoio: string;
  rotuloAcao: 'Limpar filtros' | 'Limpar a busca';
}

const LIMITE_TITULO = 30;
const BASE = 'Confira a grafia, tente o código ou só o começo do nome.';

export function consultaNoTitulo(consulta: string): string {
  const q = consulta.trim();
  return q.length > LIMITE_TITULO ? `${q.slice(0, LIMITE_TITULO - 1)}…` : q;
}

export function vazioDaBusca(e: EntradaVazioBusca): VazioBusca {
  const titulo = `Nada encontrado para "${consultaNoTitulo(e.consulta)}"`;
  if (e.filtroLigado) {
    return { caso: 'filtro', titulo, apoio: 'Há filtro ligado. Tire o filtro para procurar em todo o catálogo.', rotuloAcao: 'Limpar filtros' };
  }
  if (e.semInternet) {
    return { caso: 'offline', titulo, apoio: `${BASE} Com internet, a busca entende mais erros de digitação.`, rotuloAcao: 'Limpar a busca' };
  }
  if (e.dentroDoPedido) {
    return { caso: 'pedido', titulo, apoio: `${BASE} Aqui aparecem só os produtos que este cliente pode comprar.`, rotuloAcao: 'Limpar a busca' };
  }
  return { caso: 'demais', titulo, apoio: BASE, rotuloAcao: 'Limpar a busca' };
}
