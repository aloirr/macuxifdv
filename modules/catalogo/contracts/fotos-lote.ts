/**
 * Fotos dos produtos em lote por ZIP (RN-CAT-14, RF-CAT-07, T-0174, ADR 0054): constantes, estados, rotas e eventos.
 * As listas de situação e motivo são as dos CHECKs da migração 0080 (`SITUACOES_FOTO_LOTE_BANCO` & cia. em `db/nuvem.ts`;
 * o teste `fotos-lote.test.ts` confere que são iguais). Saídas `.strict()`, sem dado pessoal.
 * Rótulos pt-BR: os da spec do designer-ux (`docs/design/telas/fotos-em-lote.md` §5).
 */
import { z } from 'zod';
import { definirEvento, MOTIVOS_RECUSA_ENTRADA, MOTIVOS_RECUSA_ZIP, PARTE_ENVIO_BYTES, PARTES_ENVIO_MAX, TIPOS_IMAGEM } from '@macuxi/platform-sdk';

const Uuid = z.string().uuid();
const InstanteUtc = z.string().datetime();
const Int = z.number().int().nonnegative();

// ---------- limites (RN-CAT-14; os tetos são os do SDK, `LIMITES_ZIP_TETO`; os parâmetros do tenant só os baixam) ----------
/** Formatos aceitos, conferidos pela assinatura do arquivo (RN-CAT-14). */
export const TIPOS_FOTO_LOTE = TIPOS_IMAGEM;
/** Chaves de `plataforma.parametro` que baixam os tetos. */
export const PARAMETROS_FOTO_LOTE = { zip: 'foto_lote_zip_max', foto: 'foto_lote_foto_max', arquivos: 'foto_lote_arquivos_max' } as const;
/** Lotes `enfileirado | conferindo | processando` ao mesmo tempo por tenant (409 `LOTE_EM_ANDAMENTO`). */
export const FOTO_LOTE_ATIVOS_MAX = 2;
/** Maior número de ordem aceito no sufixo `_N` do nome (a coluna aceita 1..99). */
export const FOTO_LOTE_ORDEM_MAX = 99;
export const FOTO_LOTE_CODIGO_MAX = 100;

// ---------- situações e motivos ----------
export const SituacaoLote = z.enum(['aguardando_envio', 'enfileirado', 'conferindo', 'processando', 'concluido', 'recusado', 'falhou', 'duplicado']);
export type SituacaoLote = z.infer<typeof SituacaoLote>;
export const SITUACOES_LOTE_EM_ANDAMENTO = ['enfileirado', 'conferindo', 'processando'] as const satisfies readonly SituacaoLote[];
export const MotivoLote = z.enum(MOTIVOS_RECUSA_ZIP);
export type MotivoLote = z.infer<typeof MotivoLote>;
export const SituacaoItem = z.enum(['pendente', 'ligado', 'sem_produto', 'ambiguo', 'recusado', 'repetido']);
export type SituacaoItem = z.infer<typeof SituacaoItem>;
export const MotivoItem = z.enum([...MOTIVOS_RECUSA_ENTRADA, 'nome_invalido', 'ordem_repetida_no_lote']);
export type MotivoItem = z.infer<typeof MotivoItem>;

export const ROTULO_SITUACAO_ITEM: Readonly<Record<SituacaoItem, string>> = {
  pendente: 'Na fila',
  ligado: 'Ligada',
  sem_produto: 'Sem produto',
  ambiguo: 'Ambígua',
  recusado: 'Recusada',
  repetido: 'Repetida',
};
/** Texto da coluna Motivo (tela e CSV; spec `docs/design/telas/fotos-em-lote.md` §5.3). `ambiguo` e `foto_grande` (número do teto do tenant) saem de `textoMotivoItem` do domain. */
export const ROTULO_MOTIVO_ITEM: Readonly<Record<Exclude<MotivoItem, 'foto_grande'>, string>> = {
  caminho_invalido: 'Caminho inválido no ZIP',
  criptografado: 'Arquivo com senha',
  compressao_nao_suportada: 'Compactação não aceita',
  arquivo_vazio: 'Arquivo vazio',
  compressao_suspeita: 'Compactação suspeita',
  entrada_corrompida: 'Arquivo corrompido',
  tipo_nao_aceito: 'Não é JPEG, PNG nem WEBP',
  foto_ilegivel: 'Foto não abre',
  nome_invalido: 'Nome não é código nem EAN',
  ordem_repetida_no_lote: 'Outra foto do ZIP tem a mesma ordem',
};
/** Aviso do lote recusado sem número; os que citam limite saem de `mensagemMotivoLote` do domain (teto do tenant). */
export const ROTULO_MOTIVO_LOTE: Readonly<Record<Exclude<MotivoLote, 'zip_grande' | 'muitos_arquivos' | 'descompactado_grande'>, string>> = {
  zip_invalido: 'O arquivo não abre como ZIP. Compacte as fotos de novo.',
  zip64_nao_suportado: 'Formato de ZIP não aceito. Compacte de novo sem a opção ZIP64.',
  zip_incompleto: 'O ZIP chegou incompleto. Envie de novo.',
};

/** Textos dos 409 do envio (a API responde com eles e a tela mostra os mesmos). */
export const TEXTO_LOTES_ATIVOS = 'Espere um dos lotes em processamento terminar para enviar outro.';
export const TEXTO_LOTE_DIVERGENTE = 'O arquivo mudou desde o início do envio. Escolha o ZIP de novo.';
export const TEXTO_ENVIO_PAROU = 'O envio parou. Confira a internet e tente de novo.';

// ---------- rotas ----------
export const FotoLoteCriarSchema = z
  .object({
    /** Gerado no BKO: o POST é idempotente. */
    id: Uuid,
    /** Id do ZIP em `plataforma.arquivo`, gerado no BKO. */
    arquivo_id: Uuid,
    nome_arquivo: z.string().trim().min(1).max(255),
    tamanho_bytes: z.number().int().positive(),
  })
  .strict();
export type FotoLoteCriar = z.infer<typeof FotoLoteCriarSchema>;

export const TotaisLoteSchema = z.object({ pendente: Int, ligado: Int, sem_produto: Int, ambiguo: Int, recusado: Int, repetido: Int }).strict();
export type TotaisLote = z.infer<typeof TotaisLoteSchema>;

export const FotoLoteSchema = z
  .object({
    id: Uuid,
    situacao: SituacaoLote,
    motivo: MotivoLote.nullable(),
    nome_arquivo: z.string(),
    tamanho_bytes: z.number().int(),
    /** Arquivos considerados; nulo antes da conferência. */
    total: Int.nullable(),
    totais: TotaisLoteSchema,
    duplicado_de: Uuid.nullable(),
    criado_em: InstanteUtc,
    concluido_em: InstanteUtc.nullable(),
  })
  .strict();
export type FotoLote = z.infer<typeof FotoLoteSchema>;

export const EnvioLoteSchema = z.object({ arquivo_id: Uuid, parte_bytes: z.literal(PARTE_ENVIO_BYTES), partes: z.number().int().min(1).max(PARTES_ENVIO_MAX) }).strict();
export type EnvioLote = z.infer<typeof EnvioLoteSchema>;
/** `envio` nulo = o lote já foi enfileirado (nada mais a enviar). */
export const FotoLoteCriadoSchema = z.object({ lote: FotoLoteSchema, envio: EnvioLoteSchema.nullable() }).strict();
export type FotoLoteCriado = z.infer<typeof FotoLoteCriadoSchema>;
/** Limites efetivos do tenant (`limitesFotoLote` do domain): o BKO confere o ZIP e monta o texto da tela com eles. */
export const FotoLoteLimitesSchema = z.object({ bytes_zip_max: z.number().int().positive(), arquivos_max: z.number().int().positive(), bytes_foto_max: z.number().int().positive() }).strict();
export type FotoLoteLimites = z.infer<typeof FotoLoteLimitesSchema>;
export const FotoLoteListaSchema = z.object({ lotes: z.array(FotoLoteSchema) }).strict();
export type FotoLoteLista = z.infer<typeof FotoLoteListaSchema>;

export const FotoLoteItemSchema = z
  .object({
    indice: Int,
    /** Caminho dentro do ZIP. */
    arquivo: z.string(),
    situacao: SituacaoItem,
    motivo: MotivoItem.nullable(),
    tipo_detectado: z.string().nullable(),
    codigo: z.string().nullable(),
    ordem: z.number().int().min(1).nullable(),
    produto_id: Uuid.nullable(),
    produto_codigo: z.string().nullable(),
    /** Só em `ambiguo`. */
    codigos_candidatos: z.array(z.string()).max(5).nullable(),
  })
  .strict();
export type FotoLoteItem = z.infer<typeof FotoLoteItemSchema>;
export const FotoLoteItensQuery = z
  .object({
    /** Uma situação ou várias separadas por vírgula (`sem_produto,ambiguo`: cartão "Sem produto ou ambíguas"). */
    situacao: z
      .string()
      .transform((v) => v.split(',').map((x) => x.trim()).filter((x) => x !== ''))
      .pipe(z.array(SituacaoItem).min(1).max(SituacaoItem.options.length))
      .optional(),
    apos: z.coerce.number().int().min(-1).default(-1),
    limite: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type FotoLoteItensQuery = z.infer<typeof FotoLoteItensQuery>;
export const FotoLoteItensSaida = z.object({ itens: z.array(FotoLoteItemSchema), proximo: z.number().int().nullable() }).strict();
export type FotoLoteItensSaida = z.infer<typeof FotoLoteItensSaida>;
export const ParamsFotoLote = z.object({ id: Uuid }).strict();
export type ParamsFotoLote = z.infer<typeof ParamsFotoLote>;

// ---------- eventos ----------
/** `catalogo.foto_lote.enfileirado@1`: o ZIP está inteiro no armazenamento; dispara o trabalho `processar_foto_lote` (também em `consome`). */
export const FotoLoteEnfileiradoSchema = z.object({ lote_id: Uuid, arquivo_id: Uuid, enviado_por: Uuid, ocorrido_em: InstanteUtc }).strict();
export type FotoLoteEnfileirado = z.infer<typeof FotoLoteEnfileiradoSchema>;
export const EVENTO_FOTO_LOTE_ENFILEIRADO = definirEvento('catalogo.foto_lote.enfileirado@1', FotoLoteEnfileiradoSchema);

/** `catalogo.foto_lote.concluido@1`: fim do lote em qualquer desfecho. */
export const FotoLoteConcluidoSchema = z
  .object({
    lote_id: Uuid,
    enviado_por: Uuid,
    situacao: z.enum(['concluido', 'recusado', 'falhou', 'duplicado']),
    motivo: MotivoLote.nullable(),
    duplicado_de: Uuid.nullable(),
    totais: z.object({ ligado: Int, sem_produto: Int, ambiguo: Int, recusado: Int, repetido: Int }).strict(),
    ocorrido_em: InstanteUtc,
  })
  .strict();
export type FotoLoteConcluido = z.infer<typeof FotoLoteConcluidoSchema>;
export const EVENTO_FOTO_LOTE_CONCLUIDO = definirEvento('catalogo.foto_lote.concluido@1', FotoLoteConcluidoSchema);

/** `catalogo.foto.definida@1`: uma por foto gravada (lote ou ficha). */
export const FotoDefinidaSchema = z
  .object({
    midia_id: Uuid,
    produto_id: Uuid,
    arquivo_id: Uuid.nullable(),
    ordem: z.number().int().min(1),
    principal: z.boolean(),
    origem: z.enum(['lote', 'ficha']),
    lote_id: Uuid.nullable(),
    substituiu_midia_id: Uuid.nullable(),
    ocorrido_em: InstanteUtc,
  })
  .strict();
export type FotoDefinida = z.infer<typeof FotoDefinidaSchema>;
export const EVENTO_FOTO_DEFINIDA = definirEvento('catalogo.foto.definida@1', FotoDefinidaSchema);

/** `catalogo.foto.removida@1`: foto aposentada (substituída por outra da mesma ordem ou removida na ficha). */
export const FotoRemovidaSchema = z
  .object({ midia_id: Uuid, produto_id: Uuid, ordem: z.number().int().min(1), motivo: z.enum(['substituida', 'removida']), ocorrido_em: InstanteUtc })
  .strict();
export type FotoRemovida = z.infer<typeof FotoRemovidaSchema>;
export const EVENTO_FOTO_REMOVIDA = definirEvento('catalogo.foto.removida@1', FotoRemovidaSchema);
