/**
 * Visor de foto comum do shell (RD-0088, v1.0.4): um só visor em tela cheia para os módulos (foto do PDV do Core, foto do
 * produto do Vendedor, e o que vier), com zoom (pinça e toque duplo), fechar e o estado sem sinal "Sem internet".
 * Puro, para teste: o pedido do módulo, os parâmetros da rota e a matemática do zoom.
 *
 * O módulo chama `ambiente.abrirFoto(pedido)` (porta que o shell põe no ambiente; tipo no platform-sdk, pedido ao
 * engenheiro-software) com UMA das fontes:
 * - `arquivo_id`: arquivo da plataforma (`fotos/<id>.jpg` deste aparelho, também sem sinal; senão `GET /v1/arquivos/<id>`
 *   em memória, com sinal) — a regra da foto do PDV (`lib/foto-pdv.ts`, T-0147);
 * - `uri`: endereço que o módulo já resolveu (ex.: `catalogo.foto_produto@1` devolve o `file://` do cache do shell).
 *   Local (`file://`, `content://`) abre sem sinal; `http(s)://` precisa de sinal.
 * Título e subtítulo chegam já formatados pelo módulo (datas no fuso do tenant).
 */
import { nomeArquivoFoto } from './foto';
import { pedidoDaRota, TEXTO_SEM_SINAL_FOTO } from './foto-pdv';

/** O que o módulo passa ao shell. Exatamente uma fonte: `arquivo_id` ou `uri`. */
export type PedidoAbrirFoto = (
  | { arquivo_id: string; uri?: undefined }
  | { uri: string; arquivo_id?: undefined }
) & {
  /** Ex.: nome do cliente ou descrição do produto. */
  titulo?: string;
  /** Ex.: "Fachada · 08/11/2026". */
  subtitulo?: string;
};

export const ROTA_VISOR_FOTO = '/foto';
/** Rótulo acessível da imagem: o título e o subtítulo já são lidos no topo, a imagem não os repete. */
export const ROTULO_IMAGEM_FOTO = 'Foto';
/** Teto do endereço vindo do módulo (um `data:` gigante ou lixo não vira parâmetro de rota). */
export const MAX_TAMANHO_URI = 2048;

const URI_LOCAL = /^(file|content):\/\//i;
const URI_REDE = /^https?:\/\//i;

/** Endereço que o visor aceita: local (`file://`, `content://`) ou de rede (`http(s)://`), sem espaços, até o teto. */
export function uriAceita(uri: string): boolean {
  return (
    uri.length > 0 &&
    uri.length <= MAX_TAMANHO_URI &&
    !/\s/.test(uri) &&
    (URI_LOCAL.test(uri) || URI_REDE.test(uri))
  );
}

function extras(p: { titulo?: string | undefined; subtitulo?: string | undefined }): {
  titulo?: string;
  subtitulo?: string;
} {
  return { ...(p.titulo ? { titulo: p.titulo } : {}), ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) };
}

/** Rota do visor para o pedido do módulo; lança se a fonte for inválida (arquivo que não é UUID, endereço recusado). */
export function rotaDoVisor(p: PedidoAbrirFoto): {
  pathname: typeof ROTA_VISOR_FOTO;
  params: Record<string, string>;
} {
  if (p.arquivo_id !== undefined) {
    nomeArquivoFoto(p.arquivo_id); // lança se não for UUID
    return { pathname: ROTA_VISOR_FOTO, params: { arquivo: p.arquivo_id.toLowerCase(), ...extras(p) } };
  }
  if (p.uri === undefined || !uriAceita(p.uri)) throw new Error('Endereço de foto recusado pelo visor');
  return { pathname: ROTA_VISOR_FOTO, params: { uri: p.uri, ...extras(p) } };
}

function um(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lê os parâmetros da rota; `null` = sem fonte ou fonte inválida (a tela volta). */
export function pedidoDoVisor(params: Record<string, string | string[] | undefined>): PedidoAbrirFoto | null {
  if (um(params.arquivo) !== undefined) return pedidoDaRota(params);
  const uri = um(params.uri);
  if (!uri || !uriAceita(uri)) return null;
  return { uri, ...extras({ titulo: um(params.titulo), subtitulo: um(params.subtitulo) }) };
}

export type EstadoVisor =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; uri: string }
  | { tipo: 'erro'; mensagem: string };

/** Resultado da carga do visor (foto e PDF): o estado sem o `carregando`. */
export type VisorCarregado = Exclude<EstadoVisor, { tipo: 'carregando' }>;

/** Endereço já resolvido: local abre sempre; de rede só com sinal. */
export function estadoDoEndereco(uri: string, online: boolean): EstadoVisor {
  if (URI_LOCAL.test(uri) || online) return { tipo: 'ok', uri };
  return { tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO };
}

// ---- zoom ----

export const ESCALA_MIN = 1;
export const ESCALA_MAX = 4;
/** Toque duplo na foto inteira aproxima para esta escala; na foto aproximada, volta à inteira. */
export const ESCALA_TOQUE_DUPLO = 2.5;
/** Dois toques até este intervalo e esta distância contam como toque duplo. */
export const TOQUE_DUPLO_MS = 300;
export const TOQUE_DUPLO_PX = 24;
/** Abaixo disto o dedo "não andou" (toque, não arraste). */
export const ARRASTE_MIN_PX = 8;

export interface Ponto {
  x: number;
  y: number;
}

export interface Area {
  largura: number;
  altura: number;
}

export function limitarEscala(s: number): number {
  if (!Number.isFinite(s)) return ESCALA_MIN;
  return Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, s));
}

export function distancia(a: Ponto, b: Ponto): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Escala durante a pinça: a de antes vezes a razão entre a distância atual e a inicial dos dedos, nos limites. */
export function escalaDaPinca(
  escalaInicial: number,
  distanciaInicial: number,
  distanciaAtual: number,
): number {
  return limitarEscala((escalaInicial * distanciaAtual) / Math.max(distanciaInicial, 1));
}

/**
 * Deslocamento permitido para a escala (a escala é no centro da área): a borda da foto não passa da borda da área. Na
 * foto inteira não há deslocamento.
 */
export function limitarDeslocamento(d: Ponto, escala: number, area: Area): Ponto {
  if (escala <= ESCALA_MIN) return { x: 0, y: 0 };
  const mx = ((escala - 1) * Math.max(area.largura, 0)) / 2;
  const my = ((escala - 1) * Math.max(area.altura, 0)) / 2;
  const x = Math.min(mx, Math.max(-mx, d.x));
  const y = Math.min(my, Math.max(-my, d.y));
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** Escala depois do toque duplo: aproxima a foto inteira; volta a aproximada à inteira. */
export function escalaDoToqueDuplo(atual: number): number {
  return atual > ESCALA_MIN + 0.05 ? ESCALA_MIN : ESCALA_TOQUE_DUPLO;
}

export interface Toque extends Ponto {
  t: number;
}

/** O segundo toque, perto no tempo e no lugar do primeiro, é toque duplo. */
export function ehToqueDuplo(anterior: Toque | null, agora: Toque): boolean {
  if (!anterior) return false;
  const dt = agora.t - anterior.t;
  return dt >= 0 && dt <= TOQUE_DUPLO_MS && distancia(anterior, agora) <= TOQUE_DUPLO_PX;
}
