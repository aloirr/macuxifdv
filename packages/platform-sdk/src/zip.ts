/**
 * Regras puras do ZIP enviado pelo BKO (ADR 0054 §3; RN-CAT-14). O leitor (`apps/api/src/leitor-zip.ts`) lê o diretório
 * central e chama `classificarEntradaZip` para cada entrada; o módulo só recebe o resultado. Nada é escrito a partir do
 * nome da entrada: vale só o nome-base.
 */

/** Tetos de um lote. Os parâmetros do tenant só BAIXAM os da plataforma (`LIMITES_ZIP_TETO`). */
export interface LimitesZip {
  /** Tamanho do ZIP inteiro. */
  bytesZipMax: number;
  /** Arquivos considerados (sem os ignorados). */
  arquivosMax: number;
  /** Bytes descompactados de uma entrada (declarado e real). */
  bytesEntradaMax: number;
  /** Razão descompactado / compactado de uma entrada (zip bomb). */
  razaoMax: number;
  /** Soma declarada dos descompactados das entradas consideradas. */
  bytesDescompactadosMax: number;
}

const MIB = 1024 * 1024;

export const LIMITES_ZIP_TETO: Readonly<LimitesZip> = Object.freeze({
  bytesZipMax: 500 * MIB,
  arquivosMax: 10_000,
  bytesEntradaMax: 8 * MIB,
  razaoMax: 20,
  bytesDescompactadosMax: 1024 * MIB,
});

/**
 * Folga do compactado sobre o teto por foto (A-T0174-1): o deflate de dado incompressível cresce ~5 bytes a cada 64 KiB
 * (≈ 640 bytes em 8 MiB). Compactado declarado acima de `bytesEntradaMax + FOLGA_COMPACTADO_BYTES` → `foto_grande`, e o
 * leitor nunca aloca mais que isso por entrada.
 */
export const FOLGA_COMPACTADO_BYTES = 64 * 1024;

/** Diretório central com mais entradas que isto (contando pastas e ignorados) recusa o lote antes de qualquer leitura. */
export const ENTRADAS_BRUTAS_MAX = 20_000;

/** Por que o ZIP inteiro foi recusado. */
export const MOTIVOS_RECUSA_ZIP = ['zip_grande', 'muitos_arquivos', 'descompactado_grande', 'zip_invalido', 'zip64_nao_suportado', 'zip_incompleto'] as const;
export type MotivoRecusaZip = (typeof MOTIVOS_RECUSA_ZIP)[number];

/** Por que uma entrada foi recusada (o resto do lote segue). */
export const MOTIVOS_RECUSA_ENTRADA = [
  'caminho_invalido',
  'criptografado',
  'compressao_nao_suportada',
  'arquivo_vazio',
  'foto_grande',
  'compressao_suspeita',
  'entrada_corrompida',
  'tipo_nao_aceito',
  'foto_ilegivel',
] as const;
export type MotivoRecusaEntrada = (typeof MOTIVOS_RECUSA_ENTRADA)[number];

/** Uma entrada do diretório central. */
export interface EntradaZip {
  /** Posição no diretório central (estável entre leituras do mesmo ZIP: é a chave do checkpoint do item). */
  indice: number;
  /** Caminho decodificado (UTF-8 com o bit 11, senão CP437), normalizado NFC. */
  caminho: string;
  pasta: boolean;
  /** 0 = stored, 8 = deflate; o resto é recusado. */
  metodo: number;
  criptografada: boolean;
  compactado: number;
  descompactado: number;
  crc32: number;
}

export type ClassificacaoEntradaZip =
  | { acao: 'ignorar' }
  | { acao: 'recusar'; motivo: MotivoRecusaEntrada }
  | { acao: 'aceitar'; nomeBase: string };

const IGNORADOS = new Set(['thumbs.db', 'desktop.ini']);
// eslint-disable-next-line no-control-regex
const CONTROLE_RE = /[\u0000-\u001f\u007f]/;

/**
 * O que fazer com a entrada, nesta ordem: caminho perigoso → recusa; pasta, `__MACOSX`, oculto, `Thumbs.db`,
 * `desktop.ini` → ignora; controle no nome → recusa; criptografia e método; vazio, teto por foto (descompactado e
 * compactado + folga) e razão de compressão;
 * senão aceita com o nome-base.
 */
export function classificarEntradaZip(e: EntradaZip, limites: LimitesZip): ClassificacaoEntradaZip {
  const caminho = e.caminho.replace(/\\/g, '/');
  const segmentos = caminho.split('/');
  if (caminho.startsWith('/') || /^[A-Za-z]:/.test(caminho) || segmentos.includes('..')) return { acao: 'recusar', motivo: 'caminho_invalido' };
  const nomeBase = segmentos[segmentos.length - 1] ?? '';
  if (e.pasta || nomeBase === '') return { acao: 'ignorar' };
  if (segmentos.some((s) => s.toLowerCase() === '__macosx' || s.startsWith('.'))) return { acao: 'ignorar' };
  if (IGNORADOS.has(nomeBase.toLowerCase())) return { acao: 'ignorar' };
  if (CONTROLE_RE.test(caminho)) return { acao: 'recusar', motivo: 'caminho_invalido' };
  if (e.criptografada) return { acao: 'recusar', motivo: 'criptografado' };
  if (e.metodo !== 0 && e.metodo !== 8) return { acao: 'recusar', motivo: 'compressao_nao_suportada' };
  if (e.descompactado === 0) return { acao: 'recusar', motivo: 'arquivo_vazio' };
  if (e.descompactado > limites.bytesEntradaMax) return { acao: 'recusar', motivo: 'foto_grande' };
  if (e.compactado > limites.bytesEntradaMax + FOLGA_COMPACTADO_BYTES) return { acao: 'recusar', motivo: 'foto_grande' };
  if (e.descompactado / Math.max(e.compactado, 1) > limites.razaoMax) return { acao: 'recusar', motivo: 'compressao_suspeita' };
  return { acao: 'aceitar', nomeBase };
}
