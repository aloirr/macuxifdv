/**
 * Arquivos enviados pelo aparelho (ADR 0010; desenho T-0016 §1 E4): fotos (fachada do cliente fechado RN-CORE-14,
 * gôndola RN-PRO-02, pesquisa RN-PES-06). Puro TypeScript: constantes, códigos e funções que o app (fila do motor) e a
 * API (`PUT/GET /v1/arquivos/:id`) compartilham.
 *
 * Fluxo: o módulo grava a foto no aparelho (`<documentos>/fotos/<uuid>.jpg`, ADR 0008 §5), manda o comando que a
 * referencia pela fila de itens (ex.: checkout com `foto_fachada_id`) e enfileira o arquivo
 * (`motor.enfileirarArquivo`). No servidor, o comando cria a linha `aguardando` (`tx.registrarArquivo`) e o upload só a
 * completa. Upload que chega antes do comando → 409 `ARQUIVO_SEM_REFERENCIA` (retentável: fica na fila).
 */

/** Rota de plataforma (fora de `/v1/<modulo>`): `PUT` grava os bytes, `GET` devolve. */
export const ROTA_ARQUIVOS = '/v1/arquivos';

/** Tamanho máximo aceito pela API (o app já reduz para 1600 px / JPEG 80, que dá 100–600 KB). */
export const LIMITE_ARQUIVO_BYTES = 2 * 1024 * 1024;

/** Tipos aceitos (a migração 0005 restringe `plataforma.arquivo.tipo` aos mesmos). */
export const TIPOS_ARQUIVO = ['image/jpeg'] as const;
export type TipoArquivo = (typeof TIPOS_ARQUIVO)[number];

/** Códigos de erro do upload/download (corpo `ErroApiSchema`). */
export const CODIGOS_ARQUIVO = {
  /** 409: nenhum comando referenciou o arquivo ainda (o push não chegou) — retentável. */
  semReferencia: 'ARQUIVO_SEM_REFERENCIA',
  /** 409: o arquivo já foi recebido com outro conteúdo (sha256 diferente) — não retentável. */
  divergente: 'ARQUIVO_DIVERGENTE',
  /** 400: o corpo não é um JPEG (assinatura `FF D8 FF`) ou está vazio. */
  invalido: 'ARQUIVO_INVALIDO',
  /** 413: maior que `LIMITE_ARQUIVO_BYTES`. */
  grandeDemais: 'ARQUIVO_GRANDE_DEMAIS',
  /** 404: inexistente, ainda não recebido ou fora do escopo (não revela qual). */
  naoEncontrado: 'ARQUIVO_NAO_ENCONTRADO',
  /** 409 (no comando do módulo): o mesmo id já referencia outra entidade. */
  jaReferenciado: 'ARQUIVO_JA_REFERENCIADO',
  /** Só no aparelho: o arquivo local sumiu antes do envio. */
  ausenteNoAparelho: 'ARQUIVO_AUSENTE_NO_APARELHO',
} as const;

/** Rejeições do upload que não são culpa do arquivo: o motor o mantém `pendente` e tenta no próximo envio. */
export const CODIGOS_ARQUIVO_RETENTAVEIS: readonly string[] = [CODIGOS_ARQUIVO.semReferencia];

/** Dias que o arquivo local fica no aparelho depois de aceito (a tela ainda mostra a foto offline; ADR 0010 §4). */
export const DIAS_RETENCAO_ARQUIVO_LOCAL = 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Caminho local padrão da foto, relativo à pasta de documentos do app (o mesmo de `apps/mobile/src/lib/foto.ts`):
 * o módulo só conhece o UUID; o shell resolve o caminho absoluto ao ler.
 */
export function caminhoFoto(id: string): string {
  if (!UUID_RE.test(id)) throw new Error('id de foto inválido (UUID gerado no aparelho)');
  return `fotos/${id.toLowerCase()}.jpg`;
}

/** O que o módulo informa ao referenciar um arquivo no comando (`tx.registrarArquivo`). */
export interface NovoArquivo {
  /** UUID gerado no aparelho (o mesmo da coluna que referencia, ex.: `core.visita.foto_fachada_id`). */
  id: string;
  /** Finalidade em snake_case (ex.: `fachada`, `gondola`). */
  finalidade: string;
  /** Dono lógico (ex.: `visita` / `<visita_id>`). */
  entidade: string;
  entidade_id: string;
  /** Cliente da foto: o `GET` checa a carteira dele (RN-CORE-04). `null` = vale o escopo de usuários. */
  cliente_id?: string | null;
  tipo?: TipoArquivo;
}

/** Problemas do `NovoArquivo` (lista vazia = válido). A API chama antes de gravar; o módulo pode chamar no domínio. */
export function validarNovoArquivo(a: NovoArquivo): string[] {
  const p: string[] = [];
  if (!UUID_RE.test(a.id)) p.push('id precisa ser UUID');
  if (!UUID_RE.test(a.entidade_id)) p.push('entidade_id precisa ser UUID');
  if (a.cliente_id != null && !UUID_RE.test(a.cliente_id)) p.push('cliente_id precisa ser UUID');
  if (!NOME_RE.test(a.finalidade)) p.push('finalidade em snake_case');
  if (!NOME_RE.test(a.entidade)) p.push('entidade em snake_case');
  if (a.tipo !== undefined && !(TIPOS_ARQUIVO as readonly string[]).includes(a.tipo)) p.push(`tipo ${a.tipo} não aceito`);
  return p;
}

/** JPEG: começa com SOI + marcador (`FF D8 FF`). */
export function ehJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Largura e altura lidas do primeiro marcador SOF do JPEG (sem decodificar a imagem). `null` = não achou
 * (o servidor aceita assim mesmo: as colunas são opcionais).
 */
export function dimensoesJpeg(bytes: Uint8Array): { largura: number; altura: number } | null {
  if (!ehJpeg(bytes)) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marcador = bytes[i + 1]!;
    if (marcador === 0xff) {
      i++; // preenchimento
      continue;
    }
    // marcadores sem tamanho (TEM, RSTn)
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) return null; // fim ou início do scan antes do SOF
    const tamanho = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (tamanho < 2) return null;
    const ehSof = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (ehSof) {
      if (i + 9 > bytes.length) return null;
      const altura = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const largura = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return largura > 0 && altura > 0 ? { largura, altura } : null;
    }
    i += 2 + tamanho;
  }
  return null;
}

/** Resposta do upload, vista pelo motor (o transporte traduz o HTTP). Exceção = falha de transporte (tenta depois). */
export type ResultadoEnvioArquivo =
  | { status: 'aceito' }
  | { status: 'rejeitado'; codigo: string; mensagem: string };

/** Arquivo pronto para o upload (o motor lê os bytes pelo leitor injetado pelo shell). */
export interface EnvioArquivo {
  id: string;
  tipo: TipoArquivo;
  bytes: Uint8Array;
}
