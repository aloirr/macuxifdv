/**
 * Pacote pronto da primeira carga (ADR 0054; desenho `docs/desenho/T-catalogo-pacote.md` §1, §1.5, §1.6 e §3).
 *
 * - Unidade: (tenant, módulo, partição); partição `tenant` ou `filial:<uuid>`. Arquivo SQLite com o layout do aparelho
 *   (`ent_<entidade>(id, updated_at, dados)` + `_pacote(chave, valor)`), só linhas vivas, compactado em gzip.
 * - `GET /v1/sync/pacotes` devolve `PacotesSyncResposta`; lista vazia (ou 404 de servidor antigo) = o aparelho segue no pull
 *   paginado. Por entidade, `cursor` = `(horizonte, UUID nulo)` e a `versao_escopo` do usuário: o pull continua dali.
 * - Tudo aditivo e opcional: sem as peças (`TransporteSync.pacotes`, `ArquivosLocais.baixarPacote`, `LinhasSync.importarPacote`,
 *   `ProvedorSync.pacote`), o motor faz o pull de hoje.
 *
 * Puro TypeScript (sem `node:*`): roda na API, no worker e no aparelho. O `url` é um segredo de curta duração: nunca vai a
 * log nem ao Diagnóstico.
 */
import { z } from 'zod';
import { ENTIDADE_SYNC_RE, MODULOS } from './nomes';
import { decodificarCursor } from './sync';

/** Versão do layout do arquivo (`_pacote.formato`). Outro valor = o aparelho não importa (cai no pull paginado). */
export const FORMATO_PACOTE_SYNC = 1;

/** Mais filiais que isto para o mesmo usuário (admin/gerente com "todas"): o módulo segue no pull paginado. */
export const MAX_PARTICOES_PACOTE = 8;

/** Manifesto dos pacotes do usuário. Arquivo no driver `disco` (dev/CI): `${ROTA_SYNC_PACOTES}/:id/arquivo`. */
export const ROTA_SYNC_PACOTES = '/v1/sync/pacotes';

/** Tipo de partição declarado pelo provedor (`ProvedorSync.pacote.particao`). */
export const TIPOS_PARTICAO_PACOTE = ['tenant', 'filial'] as const;
export type TipoParticaoPacote = (typeof TIPOS_PARTICAO_PACOTE)[number];

/** Partição concreta de um pacote: `tenant` ou `filial:<uuid>`. */
export type ParticaoPacote = 'tenant' | `filial:${string}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTICAO_RE = /^(tenant|filial:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MD5_RE = /^[0-9a-f]{32}$/i;
const PREFIXO_FILIAL = 'filial:';

/** `filial:<uuid>` da filial (uuid inválido = erro de programação). */
export function particaoDeFilial(filialId: string): ParticaoPacote {
  if (!UUID_RE.test(filialId)) throw new Error(`Filial inválida para partição de pacote: ${filialId}`);
  return `${PREFIXO_FILIAL}${filialId}`;
}

/** Uuid da filial da partição; `null` para `tenant` (ou texto que não é partição de filial). */
export function filialDaParticao(particao: string): string | null {
  return PARTICAO_RE.test(particao) && particao.startsWith(PREFIXO_FILIAL) ? particao.slice(PREFIXO_FILIAL.length) : null;
}

const ParticaoSchema = z
  .string()
  .regex(PARTICAO_RE, 'partição inválida')
  .transform((p) => p as ParticaoPacote);
const DataIsoSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'data ISO inválida');

/** Entidade coberta por um pacote, com o cursor e a versão de escopo a gravar na importação (§1.5). */
export const EntidadePacoteSyncSchema = z
  .object({
    nome: z.string().regex(ENTIDADE_SYNC_RE),
    /** Linhas da entidade no arquivo (conferida com `_pacote.entidades` e com o que a importação gravou). */
    linhas: z.number().int().min(0),
    /** Cursor do pull para continuar depois do pacote: `codificarCursor({ updated_at: horizonte, id: UUID_NIL })`. */
    cursor: z.string().min(1).max(200).refine((c) => decodificarCursor(c) !== null, 'cursor inválido'),
    /** `versao_escopo` do usuário (mesma do pull); ausente em escopo sem variação. */
    versao_escopo: z.string().min(1).max(200).optional(),
  })
  .passthrough();
export type EntidadePacoteSync = z.output<typeof EntidadePacoteSyncSchema>;

export const PacoteSyncSchema = z
  .object({
    id: z.string().uuid(),
    modulo: z.enum(MODULOS),
    particao: ParticaoSchema,
    /** Watermark (relógio do banco, ADR 0006): toda linha visível com `updated_at` abaixo dele está no arquivo. */
    horizonte: DataIsoSchema,
    /** Tamanho do `.sqlite.gz` (conferido depois do download). */
    bytes: z.number().int().positive(),
    md5: z.string().regex(MD5_RE),
    /** GET pré-assinado (aceita `Range`) ou caminho relativo da rota de disco. Segredo: nunca em log. */
    url: z.string().min(1).max(4096),
    expira_em: DataIsoSchema,
    entidades: z
      .array(EntidadePacoteSyncSchema)
      .min(1)
      .refine((es) => new Set(es.map((e) => e.nome)).size === es.length, 'entidade repetida no pacote'),
  })
  .passthrough();
export type PacoteSync = z.output<typeof PacoteSyncSchema>;

export const PacotesSyncRespostaSchema = z
  .object({
    /** Geração da base (ADR 0021): o motor confere com `conferirGeracao` antes de importar. */
    geracao_base: z.string().min(1).max(100).optional(),
    pacotes: z
      .array(PacoteSyncSchema)
      .max(100)
      .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, 'pacote repetido'),
  })
  .passthrough();
export type PacotesSyncResposta = z.output<typeof PacotesSyncRespostaSchema>;

const ContagensSchema = z.record(z.string().regex(ENTIDADE_SYNC_RE), z.number().int().min(0));

/**
 * Tabela `_pacote(chave, valor)` do arquivo, já como objeto `{ chave: valor }` (valores em texto). `formato` tem de ser
 * `FORMATO_PACOTE_SYNC`; `entidades` é o JSON `{ nome: linhas }`.
 */
export const MetaPacoteSchema = z.object({
  formato: z.coerce.number().pipe(z.literal(FORMATO_PACOTE_SYNC)),
  tenant_id: z.string().uuid(),
  modulo: z.enum(MODULOS),
  particao: ParticaoSchema,
  horizonte: DataIsoSchema,
  geracao_base: z.string().min(1).max(100),
  entidades: z.string().transform((s, ctx) => {
    try {
      return ContagensSchema.parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entidades inválidas no _pacote' });
      return z.NEVER;
    }
  }),
});
export type MetaPacote = z.output<typeof MetaPacoteSchema>;

/**
 * Por que o pacote não foi usado (aviso `pacote_falhou` no Diagnóstico, sem dado pessoal). Todos caem no pull paginado;
 * só erro de rede (que não vira `ErroPacoteSync`) para a passada para retomar o download depois.
 */
export const CODIGOS_FALHA_PACOTE = [
  'tamanho',
  'md5',
  'formato',
  'quick_check',
  'contagem',
  'sem_espaco',
  'geracao',
  'indisponivel',
] as const;
export type CodigoFalhaPacote = (typeof CODIGOS_FALHA_PACOTE)[number];

export class ErroPacoteSync extends Error {
  constructor(readonly codigo: CodigoFalhaPacote) {
    super(`Pacote da primeira carga recusado: ${codigo}`);
    this.name = 'ErroPacoteSync';
  }
}
