const LIMITE_TITULO = 30;
const BASE = 'Confira a grafia, tente o código ou só o começo do nome.';
export function consultaNoTitulo(consulta) {
    const q = consulta.trim();
    return q.length > LIMITE_TITULO ? `${q.slice(0, LIMITE_TITULO - 1)}…` : q;
}
export function vazioDaBusca(e) {
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
