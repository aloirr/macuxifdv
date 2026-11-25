const texto = (v) => (typeof v === 'string' ? v.trim() : '');
function montar(logradouro, bairro, cidade, uf) {
    const c = texto(cidade);
    const u = texto(uf).toUpperCase();
    if (c === '' || !/^[A-Z]{2}$/.test(u))
        return null;
    return { logradouro: texto(logradouro), bairro: texto(bairro), cidade: c, uf: u };
}
const objeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
/** `https://brasilapi.com.br/api/cep/v1/{cep}`: `{ street, neighborhood, city, state }`. */
export function cepDaBrasilApi(corpo) {
    const o = objeto(corpo);
    return o ? montar(o.street, o.neighborhood, o.city, o.state) : null;
}
/** `https://viacep.com.br/ws/{cep}/json/`: `{ logradouro, bairro, localidade, uf }`; CEP inexistente vem `{ erro: true }`. */
export function cepDoViaCep(corpo) {
    const o = objeto(corpo);
    if (!o || o.erro === true || o.erro === 'true')
        return null;
    return montar(o.logradouro, o.bairro, o.localidade, o.uf);
}
