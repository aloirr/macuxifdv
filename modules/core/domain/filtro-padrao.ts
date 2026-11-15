/**
 * Filtro padrão do app Campo nas telas do Core (Rota, Clientes e Performance), aprovado pelo dono do produto
 * (R-20261115-072200, R-20261115-074500 e R-20261115-082500; spec `docs/design/filtro-padrao-campo/spec.md`).
 * Puro, sem relógio: "hoje" (data civil no fuso do tenant) chega por parâmetro. A tela só desenha o resultado.
 * - Rota: cliente (nome ou código), cidade, bairro (segue a cidade) e data (padrão: hoje). O padrão não conta nem vira etiqueta.
 * - Clientes: as situações marcadas viram etiquetas; a etiqueta da situação já filtrada não se repete na linha (RD-0500).
 */
import type { SituacaoDoCliente } from './lista-clientes';

/** Minúsculas, sem acento e sem espaço nas pontas (busca tolerante). */
function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const ordenar = (xs: Iterable<string>): string[] => [...xs].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ---------------- Rota ----------------

/** O que o filtro da Rota precisa de cada parada (o `RouteStop` serve). */
export interface ParadaFiltravel {
  status: string;
  customer: { trade_name: string; legal_name?: string; erp_code?: string; city: string; district: string };
}

export interface FiltroRota {
  /** Busca por nome ou código do cliente ("" = sem filtro). */
  cliente: string;
  cidade: string | null;
  bairro: string | null;
  /** Data civil (AAAA-MM-DD) da rota; null = hoje (o padrão). */
  data: string | null;
}

export const FILTRO_ROTA_PADRAO: FiltroRota = { cliente: '', cidade: null, bairro: null, data: null };

/** A data em vigor (o padrão é hoje). */
export const dataDaRota = (f: FiltroRota, hoje: string): string => f.data ?? hoje;

/** Data igual a hoje volta ao padrão (não conta nem vira etiqueta). */
export const comData = (f: FiltroRota, data: string, hoje: string): FiltroRota => ({ ...f, data: data === hoje ? null : data });

/** Cidades das paradas da rota, sem repetição, em ordem alfabética. */
export function cidadesDaRota(paradas: readonly ParadaFiltravel[]): string[] {
  return ordenar(new Set(paradas.map((p) => p.customer.city.trim()).filter(Boolean)));
}

/** Bairros das paradas; com cidade escolhida, só os dela (o bairro segue a cidade). */
export function bairrosDaRota(paradas: readonly ParadaFiltravel[], cidade: string | null): string[] {
  const daCidade = cidade ? paradas.filter((p) => p.customer.city.trim() === cidade) : paradas;
  return ordenar(new Set(daCidade.map((p) => p.customer.district.trim()).filter(Boolean)));
}

/** Trocar a cidade: o bairro que não é dela sai. */
export function comCidade(f: FiltroRota, cidade: string | null, paradas: readonly ParadaFiltravel[]): FiltroRota {
  const bairro = f.bairro && bairrosDaRota(paradas, cidade).includes(f.bairro) ? f.bairro : null;
  return { ...f, cidade, bairro };
}

/** Paradas que passam no filtro (a numeração continua a da rota: a parada não é renumerada). */
export function filtrarParadas<T extends ParadaFiltravel>(paradas: readonly T[], f: FiltroRota): T[] {
  const termo = normalizar(f.cliente);
  return paradas.filter((p) => {
    const c = p.customer;
    if (f.cidade && c.city.trim() !== f.cidade) return false;
    if (f.bairro && c.district.trim() !== f.bairro) return false;
    if (!termo) return true;
    return [c.trade_name, c.legal_name ?? '', c.erp_code ?? ''].some((x) => normalizar(x).includes(termo));
  });
}

/** Selo do botão: cliente, cidade, bairro e data fora de hoje contam um cada. */
export function contarFiltrosRota(f: FiltroRota): number {
  return filtrosDeParada(f).filter(Boolean).length + (f.data !== null ? 1 : 0);
}

/** Cliente, cidade e bairro: os filtros que tiram paradas da lista (a data troca o dia, não filtra). */
const filtrosDeParada = (f: FiltroRota): boolean[] => [f.cliente.trim() !== '', f.cidade !== null, f.bairro !== null];

export type CampoFiltroRota = 'cliente' | 'cidade' | 'bairro' | 'data';

/** Remove um filtro (o ✕ da etiqueta). */
export function semFiltroRota(f: FiltroRota, campo: CampoFiltroRota): FiltroRota {
  if (campo === 'cliente') return { ...f, cliente: '' };
  if (campo === 'cidade') return { ...f, cidade: null };
  if (campo === 'bairro') return { ...f, bairro: null };
  return { ...f, data: null };
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "ter, 18/11" (dia da semana curto e dd/mm); `maiusculo` → "Ter, 18/11". */
export function textoDaDataDaRota(data: string, maiusculo = false): string {
  const dia = DIAS_CURTOS[new Date(`${data}T12:00:00Z`).getUTCDay()] ?? '';
  const t = `${dia}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
  return maiusculo ? maiuscula(t) : t;
}

/** Título da tela: "Rota de hoje" ou, com outra data, "Rota de ter, 17/11". */
export const tituloDaRota = (f: FiltroRota): string => (f.data ? `Rota de ${textoDaDataDaRota(f.data)}` : 'Rota de hoje');

/** Etiquetas removíveis, na ordem da folha. */
export function etiquetasDaRota(f: FiltroRota): Array<{ campo: CampoFiltroRota; texto: string }> {
  const e: Array<{ campo: CampoFiltroRota; texto: string }> = [];
  if (f.cliente.trim()) e.push({ campo: 'cliente', texto: f.cliente.trim() });
  if (f.cidade) e.push({ campo: 'cidade', texto: f.cidade });
  if (f.bairro) e.push({ campo: 'bairro', texto: f.bairro });
  if (f.data) e.push({ campo: 'data', texto: textoDaDataDaRota(f.data, true) });
  return e;
}

const visitas = (n: number): string => (n === 1 ? '1 visita' : `${n} visitas`);
const km = (n: number): string => `${Math.round(n).toLocaleString('pt-BR')} km`;

/**
 * Subtítulo da faixa: "12 visitas · 38 km · Centro-Sul" sem filtro; "4 de 12 visitas · 38 km" com filtro. A região sai com
 * filtro (RD-0499: o que já está numa etiqueta não se repete no subtítulo).
 */
export function subtituloDaRota(o: { filtradas: number; total: number; totalKm: number; regiao: string; comFiltro: boolean }): string {
  if (!o.comFiltro) return [visitas(o.total), km(o.totalKm), o.regiao.trim()].filter(Boolean).join(' · ');
  return `${o.filtradas} de ${visitas(o.total)} · ${km(o.totalKm)}`;
}

/** A tag da linha de cima conta as feitas entre as filtradas: "2 feitas", "1 feita". */
export const textoDasFeitas = (paradas: readonly ParadaFiltravel[]): string => {
  const n = paradas.filter((p) => p.status === 'done').length;
  return n === 1 ? '1 feita' : `${n} feitas`;
};

/** Botão principal da folha: "Ver 4 visitas", "Ver 1 visita". */
export const textoVerVisitas = (n: number): string => `Ver ${visitas(n)}`;

// ---------------- Clientes ----------------

/** Botão principal da folha de Clientes: "Ver 5 clientes", "Ver 1 cliente". */
export const textoVerClientes = (n: number): string => (n === 1 ? 'Ver 1 cliente' : `Ver ${n} clientes`);

/** Subtítulo da faixa de Clientes; com a carteira vazia não há subtítulo (RD-0501: o estado vazio já diz). */
export function subtituloDaCarteira(filtrados: number, total: number): string | undefined {
  if (total === 0) return undefined;
  return filtrados === total ? `${total} na carteira` : `${filtrados} de ${total} na carteira`;
}

/**
 * RD-0500: a tag da situação que um filtro marcado já garante não se repete na linha. `garantidas` = as situações que os filtros
 * marcados garantem (ex.: "Devendo" garante `devendo`). Retorna null quando a linha fica sem tag.
 */
export function situacaoNaLinha(situacao: SituacaoDoCliente, garantidas: readonly SituacaoDoCliente[]): SituacaoDoCliente | null {
  return garantidas.includes(situacao) ? null : situacao;
}

/** Na virada do dia, a data escolhida que virou hoje volta ao padrão (a rota de hoje tem check-in de novo). */
export const filtroNoDia = (f: FiltroRota, hoje: string): FiltroRota => (f.data === hoje ? { ...f, data: null } : f);

/** Filtro que tira paradas da lista (cliente, cidade ou bairro); só a data não filtra paradas. */
export const filtraParadas = (f: FiltroRota): boolean => filtrosDeParada(f).some(Boolean);

/** Trocar a data: a cidade e o bairro que não existem nas paradas do novo dia saem. */
export function ajustarAoDia(f: FiltroRota, paradas: readonly ParadaFiltravel[]): FiltroRota {
  const cidade = f.cidade && cidadesDaRota(paradas).includes(f.cidade) ? f.cidade : null;
  const bairro = f.bairro && bairrosDaRota(paradas, cidade).includes(f.bairro) ? f.bairro : null;
  return cidade === f.cidade && bairro === f.bairro ? f : { ...f, cidade, bairro };
}

/** Rota de outro dia é só para ver: não há "próxima" parada (ela é desenhada como pendente). */
export function paradasParaVer<T extends ParadaFiltravel>(paradas: readonly T[], ehHoje: boolean): T[] {
  return ehHoje ? [...paradas] : paradas.map((p) => (p.status === 'next' ? { ...p, status: 'pending' } : p));
}
