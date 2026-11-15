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
import { z } from 'zod';
import { PERFIS, type Perfil } from './nomes';

/** Rota de plataforma (fora de `/v1/<modulo>`): `PUT` grava os bytes, `GET` devolve. */
export const ROTA_ARQUIVOS = '/v1/arquivos';

/** Tamanho máximo aceito pela API (o app já reduz para 1600 px / JPEG 80, que dá 100–600 KB). */
export const LIMITE_ARQUIVO_BYTES = 2 * 1024 * 1024;

/**
 * T-0097 b: versão reduzida da foto (miniatura de lista e busca), gerada pela API na primeira leitura e guardada ao lado do
 * original. `GET /v1/arquivos/:id/miniatura` (`caminhoMiniaturaArquivo`): mesma regra de acesso do original, maior lado
 * até `LADO_MINIATURA_ARQUIVO_PX` e no máximo `BYTES_MAX_MINIATURA_ARQUIVO` (os tetos do contrato do Catálogo, T-0097).
 */
export const LADO_MINIATURA_ARQUIVO_PX = 320;
export const BYTES_MAX_MINIATURA_ARQUIVO = 30 * 1024;

/** `/v1/arquivos/<id>/miniatura` (relativo, autenticado). */
export function caminhoMiniaturaArquivo(id: string): string {
  if (!UUID_RE.test(id)) throw new Error('id de arquivo inválido (UUID)');
  return `${ROTA_ARQUIVOS}/${id.toLowerCase()}/miniatura`;
}

/**
 * Tipos aceitos em `plataforma.arquivo` (o CHECK `arquivo_tipo_valido` do banco acompanha). PNG e WEBP só entram pela foto
 * do lote (ADR 0058, gravada pelo trabalho); o ZIP do lote nunca é servido. O aparelho só envia `TIPOS_ENVIO_APARELHO`.
 */
export const TIPOS_ARQUIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/zip'] as const;
export type TipoArquivo = (typeof TIPOS_ARQUIVO)[number];

/** O que `PUT /v1/arquivos/:id` aceita (corpo inteiro, até `LIMITE_ARQUIVO_BYTES`): a foto do aparelho e do BKO. */
export const TIPOS_ENVIO_APARELHO = ['image/jpeg'] as const;

/**
 * ADR 0058 §1: arquivo grande (o ZIP do lote de fotos) vai em partes de 8 MiB (`PUT /v1/arquivos/:id/partes/:n`), cada uma
 * um objeto no armazenamento; `POST /v1/arquivos/:id/concluir` confere as partes e marca o arquivo `recebido`.
 */
export const PARTE_ENVIO_BYTES = 8 * 1024 * 1024;
/** 63 × 8 MiB ≥ 500 MB (RN-CAT-14). */
export const PARTES_ENVIO_MAX = 63;

/** Quantas partes um arquivo de `tamanhoBytes` ocupa. */
export function partesDoEnvio(tamanhoBytes: number): number {
  return Math.ceil(tamanhoBytes / PARTE_ENVIO_BYTES);
}

export const ConcluirEnvioSchema = z
  .object({ partes: z.number().int().min(1).max(PARTES_ENVIO_MAX), tamanho_bytes: z.number().int().positive() })
  .strict();
export type ConcluirEnvio = z.infer<typeof ConcluirEnvioSchema>;

/** `GET /v1/arquivos/:id/partes/:n/url-envio` (só com S3 e `MACUXI_ENVIO_URL_ASSINADA=1`). */
export const UrlEnvioSchema = z.object({ url: z.string().url(), metodo: z.literal('PUT'), expira_em: z.string().datetime() }).strict();
export type UrlEnvio = z.infer<typeof UrlEnvioSchema>;

/**
 * Confere os tamanhos das partes guardadas (`null` = não existe): da 1ª à penúltima com exatamente `PARTE_ENVIO_BYTES`, a
 * última de 1 byte a `PARTE_ENVIO_BYTES`, e a soma igual a `total`. `partes_faltando` lista as partes a reenviar (1-based);
 * vazia com `ok: false` = as partes estão certas, mas a soma não bate com o total informado.
 */
export function conferirPartes(tamanhos: readonly (number | null)[], total: number): { ok: true } | { ok: false; partes_faltando: number[] } {
  const faltando: number[] = [];
  tamanhos.forEach((t, i) => {
    const ultima = i === tamanhos.length - 1;
    const certo = t !== null && (ultima ? t >= 1 && t <= PARTE_ENVIO_BYTES : t === PARTE_ENVIO_BYTES);
    if (!certo) faltando.push(i + 1);
  });
  if (faltando.length > 0) return { ok: false, partes_faltando: faltando };
  const soma = tamanhos.reduce<number>((a, t) => a + (t ?? 0), 0);
  return soma === total ? { ok: true } : { ok: false, partes_faltando: [] };
}

/** O que a plataforma conta ao módulo sobre um arquivo dele (`tx.infoArquivo`). */
export interface InfoArquivo {
  id: string;
  tipo: TipoArquivo;
  situacao: 'aguardando' | 'recebido';
  tamanho_bytes: number | null;
  entidade: string;
  entidade_id: string;
  enviado_por: string;
}

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
  /** 400: número da parte fora de 1..`PARTES_ENVIO_MAX` ou parte vazia (ADR 0058). */
  parteInvalida: 'PARTE_INVALIDA',
  /** 409: `concluir` com parte faltando ou de tamanho errado (`detalhes.partes_faltando`). */
  envioIncompleto: 'ENVIO_INCOMPLETO',
  /** 404: URL assinada desligada (só com S3 e `MACUXI_ENVIO_URL_ASSINADA=1`). */
  urlAssinadaDesligada: 'URL_ASSINADA_DESLIGADA',
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
  /**
   * ADR 0041 (T-0147): perfis que podem LER o arquivo, além da carteira. `null`/ausente = regra de sempre (licença + perfil
   * do módulo + carteira). A lista vem do domain do módulo dono (o Core: `perfisDeLeitura(tipo)`, RN-CORE-38).
   */
  perfis_leitura?: readonly Perfil[] | null;
}

/** Problemas da lista de perfis de leitura (ADR 0041; mesmo CHECK da 0057): 1 a 7 perfis da plataforma, sem repetição. */
export function problemasPerfisLeitura(perfis: readonly string[] | null | undefined): string[] {
  if (perfis == null) return [];
  const p: string[] = [];
  if (perfis.length === 0) p.push('perfis_leitura vazio (use null para a regra de sempre)');
  for (const x of perfis) if (!(PERFIS as readonly string[]).includes(x)) p.push(`perfil de leitura ${String(x)} não existe`);
  if (new Set(perfis).size !== perfis.length) p.push('perfis_leitura com perfil repetido');
  return p;
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
  p.push(...problemasPerfisLeitura(a.perfis_leitura));
  return p;
}

/**
 * ADR 0041: o usuário passa na lista de perfis de leitura do arquivo? `null` = sem restrição (vale a regra de sempre).
 * Conta a BASE de cada perfil resolvido na requisição (perfil personalizado herda a base, ADR 0033); sem perfis resolvidos,
 * o perfil do token (como `perfisDaSessao`). Falha fechada: lista presente e usuário sem nenhum desses perfis = não lê.
 * A carteira continua valendo à parte.
 */
export function perfilLeArquivo(
  perfisLeitura: readonly string[] | null | undefined,
  usuario: { perfil?: Perfil | null; perfis?: readonly { base: Perfil }[] },
): boolean {
  if (perfisLeitura == null) return true;
  const meus: readonly string[] =
    usuario.perfis && usuario.perfis.length > 0 ? usuario.perfis.map((p) => p.base) : usuario.perfil ? [usuario.perfil] : [];
  return perfisLeitura.some((p) => meus.includes(p));
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
