const texto = (v) => (v ?? '').trim();
export function produtoDoCadastroCore(p) {
    const ean = texto(p.ean);
    return {
        id: p.id,
        sku: p.sku,
        ean: ean === '' ? null : ean,
        nome: p.nome,
        marca: texto(p.marca),
        categoria: texto(p.categoria),
        unidade: p.unidade,
        ativo: p.ativo,
        atributos: [],
        thumbnail_url: null,
        campanha: false,
        vendas: 0,
    };
}
