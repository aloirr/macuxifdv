/**
 * Filtro padrão do app Campo nas telas do Core (Rota, Clientes e Performance), aprovado pelo dono do produto
 * (R-20261115-072200, R-20261115-074500 e R-20261115-082500).
 * Puro, sem relógio: "hoje" (data civil no fuso do tenant) chega por parâmetro. A tela só desenha o resultado.
 * - Rota: cliente (nome ou código), cidade, bairro (segue a cidade) e data (padrão: hoje). O padrão não conta nem vira etiqueta.
 * - Clientes: as situações marcadas viram etiquetas; a etiqueta da situação já filtrada não se repete na linha (RD-0500).
 */
import { normalizarBusca } from './clientes';
const ordenar = (xs) => [...xs].sort((a, b) => a.localeCompare(b, 'pt-BR'));
export const FILTRO_ROTA_PADRAO = { cliente: '', cidade: null, bairro: null, data: null };
/** A data em vigor (o padrão é hoje). */
export const dataDaRota = (f, hoje) => f.data ?? hoje;
/** Data igual a hoje volta ao padrão (não conta nem vira etiqueta). */
export const comData = (f, data, hoje) => ({ ...f, data: data === hoje ? null : data });
/** Cidades das paradas da rota, sem repetição, em ordem alfabética. */
export function cidadesDaRota(paradas) {
    return ordenar(new Set(paradas.map((p) => p.customer.city.trim()).filter(Boolean)));
}
/** Bairros das paradas; com cidade escolhida, só os dela (o bairro segue a cidade). */
export function bairrosDaRota(paradas, cidade) {
    const daCidade = cidade ? paradas.filter((p) => p.customer.city.trim() === cidade) : paradas;
    return ordenar(new Set(daCidade.map((p) => p.customer.district.trim()).filter(Boolean)));
}
/** Trocar a cidade: o bairro que não é dela sai. */
export function comCidade(f, cidade, paradas) {
    const bairro = f.bairro && bairrosDaRota(paradas, cidade).includes(f.bairro) ? f.bairro : null;
    return { ...f, cidade, bairro };
}
/** Paradas que passam no filtro (a numeração continua a da rota: a parada não é renumerada). */
export function filtrarParadas(paradas, f) {
    const termo = normalizarBusca(f.cliente);
    return paradas.filter((p) => {
        const c = p.customer;
        if (f.cidade && c.city.trim() !== f.cidade)
            return false;
        if (f.bairro && c.district.trim() !== f.bairro)
            return false;
        if (!termo)
            return true;
        return [c.trade_name, c.legal_name ?? '', c.erp_code ?? ''].some((x) => normalizarBusca(x).includes(termo));
    });
}
/** Selo do botão: cliente, cidade, bairro e data fora de hoje contam um cada. */
export function contarFiltrosRota(f) {
    return filtrosDeParada(f).filter(Boolean).length + (f.data !== null ? 1 : 0);
}
/** Cliente, cidade e bairro: os filtros que tiram paradas da lista (a data troca o dia, não filtra). */
const filtrosDeParada = (f) => [f.cliente.trim() !== '', f.cidade !== null, f.bairro !== null];
/** Remove um filtro (o ✕ da etiqueta). */
export function semFiltroRota(f, campo) {
    if (campo === 'cliente')
        return { ...f, cliente: '' };
    if (campo === 'cidade')
        return { ...f, cidade: null };
    if (campo === 'bairro')
        return { ...f, bairro: null };
    return { ...f, data: null };
}
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "ter, 18/11" (dia da semana curto e dd/mm); `maiusculo` → "Ter, 18/11". */
export function textoDaDataDaRota(data, maiusculo = false) {
    const dia = DIAS_CURTOS[new Date(`${data}T12:00:00Z`).getUTCDay()] ?? '';
    const t = `${dia}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
    return maiusculo ? maiuscula(t) : t;
}
/** Título da tela: "Rota de hoje" ou, com outra data, "Rota" (a data fica só na etiqueta removível; RD-1235). */
export const tituloDaRota = (f) => (f.data ? 'Rota' : 'Rota de hoje');
/** Etiquetas removíveis, na ordem da folha. */
export function etiquetasDaRota(f) {
    const e = [];
    if (f.cliente.trim())
        e.push({ campo: 'cliente', texto: f.cliente.trim() });
    if (f.cidade)
        e.push({ campo: 'cidade', texto: f.cidade });
    if (f.bairro)
        e.push({ campo: 'bairro', texto: f.bairro });
    if (f.data)
        e.push({ campo: 'data', texto: textoDaDataDaRota(f.data, true) });
    return e;
}
const visitas = (n) => (n === 1 ? '1 visita' : `${n} visitas`);
const km = (n) => `${Math.round(n).toLocaleString('pt-BR')} km`;
/**
 * Subtítulo da faixa: "12 visitas · 38 km · Centro-Sul" sem filtro; "4 de 12 visitas · 38 km" com filtro. A região sai com
 * filtro (RD-0499: o que já está numa etiqueta não se repete no subtítulo).
 */
export function subtituloDaRota(o) {
    if (!o.comFiltro)
        return [visitas(o.total), km(o.totalKm), o.regiao.trim()].filter(Boolean).join(' · ');
    return `${o.filtradas} de ${visitas(o.total)} · ${km(o.totalKm)}`;
}
/** A tag da linha de cima conta as feitas entre as filtradas: "2 feitas", "1 feita". */
export const textoDasFeitas = (paradas) => {
    const n = paradas.filter((p) => p.status === 'done').length;
    return n === 1 ? '1 feita' : `${n} feitas`;
};
/** Botão principal da folha: "Ver 4 visitas", "Ver 1 visita". */
export const textoVerVisitas = (n) => `Ver ${visitas(n)}`;
// ---------------- Clientes ----------------
/** Botão principal da folha de Clientes: "Ver 5 clientes", "Ver 1 cliente". */
export const textoVerClientes = (n) => (n === 1 ? 'Ver 1 cliente' : `Ver ${n} clientes`);
/** Subtítulo da faixa de Clientes; com a carteira vazia não há subtítulo (RD-0501: o estado vazio já diz). */
export function subtituloDaCarteira(filtrados, total) {
    if (total === 0)
        return undefined;
    return filtrados === total ? `${total} na carteira` : `${filtrados} de ${total} na carteira`;
}
/**
 * RD-0500: a tag da situação que um filtro marcado já garante não se repete na linha. `garantidas` = as situações que os filtros
 * marcados garantem (ex.: "Devendo" garante `devendo`). Retorna null quando a linha fica sem tag.
 */
export function situacaoNaLinha(situacao, garantidas) {
    return garantidas.includes(situacao) ? null : situacao;
}
/** Na virada do dia, a data escolhida que virou hoje volta ao padrão (a rota de hoje tem check-in de novo). */
export const filtroNoDia = (f, hoje) => (f.data ? comData(f, f.data, hoje) : f);
/** Filtro que tira paradas da lista (cliente, cidade ou bairro); só a data não filtra paradas. */
export const filtraParadas = (f) => filtrosDeParada(f).some(Boolean);
/** Trocar a data: a cidade e o bairro que não existem nas paradas do novo dia saem. */
export function ajustarAoDia(f, paradas) {
    const cidade = f.cidade && cidadesDaRota(paradas).includes(f.cidade) ? f.cidade : null;
    const bairro = f.bairro && bairrosDaRota(paradas, cidade).includes(f.bairro) ? f.bairro : null;
    return cidade === f.cidade && bairro === f.bairro ? f : { ...f, cidade, bairro };
}
/** Rota de outro dia é só para ver: não há "próxima" parada (ela é desenhada como pendente). */
export function paradasParaVer(paradas, ehHoje) {
    return ehHoje ? [...paradas] : paradas.map((p) => (p.status === 'next' ? { ...p, status: 'pending' } : p));
}
