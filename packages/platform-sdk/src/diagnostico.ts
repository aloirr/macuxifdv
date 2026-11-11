/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §2): diagnóstico do aparelho enviado à plataforma. Rota da plataforma
 * `POST /v1/diagnosticos` (sessão do app, sem licença de módulo), idempotente pelo `id` gerado no aparelho; leitura só do
 * super-admin no portal (`GET /v1/plataforma/diagnosticos[/:id]`). Só dado técnico: tenant e usuário vêm do TOKEN, nunca do
 * corpo (`.strict()` recusa `tenant_id`, `usuario_id`, e-mail, nome...). Datas ISO em UTC.
 */
import { z } from 'zod';

export const ROTA_DIAGNOSTICOS = '/v1/diagnosticos';
export const ROTA_PORTAL_DIAGNOSTICOS = '/v1/plataforma/diagnosticos';
/** Limite do corpo do `POST` (bytes). O print vai à parte, pela fila de arquivos (ADR 0010). */
export const LIMITE_CORPO_DIAGNOSTICO_BYTES = 32 * 1024;
/** Envios por usuário por hora (acima = 429 `DIAGNOSTICO_LIMITE`). */
export const DIAGNOSTICOS_POR_HORA = 20;
/** Retenção (LGPD): o worker apaga de fato linha, arquivo e bytes depois disto. */
export const RETENCAO_DIAGNOSTICO_DIAS = 90;
/** `plataforma.arquivo.finalidade` do print (com `modulo = 'plataforma'`). */
export const FINALIDADE_PRINT_DIAGNOSTICO = 'print_diagnostico';

export const CODIGOS_DIAGNOSTICO = {
  jaExiste: 'DIAGNOSTICO_JA_EXISTE',
  limite: 'DIAGNOSTICO_LIMITE',
} as const;

const Id = z.string().uuid();
const Data = z.string().datetime();
const texto = (max: number) => z.string().max(max);

export const ORIGENS_DIAGNOSTICO = ['botao', 'queda', 'erro_tela'] as const;
export type OrigemDiagnostico = (typeof ORIGENS_DIAGNOSTICO)[number];
export const APPS_DIAGNOSTICO = ['campo', 'gestao'] as const;

export const DiagnosticoErroSchema = z
  .object({ mensagem: texto(300), pilha: texto(2000).nullable(), origem: texto(40) })
  .strict();

export const DiagnosticoSaidaAndroidSchema = z
  .object({
    motivo: z.number().int(),
    status: z.number().int(),
    importancia: z.number().int(),
    pss_kb: z.number().int().nonnegative(),
    rss_kb: z.number().int().nonnegative(),
    descricao: texto(300),
    pilha: texto(4000).nullable(),
  })
  .strict();

/**
 * Uma das últimas saídas do processo (`ultimasSaidas` do `macuxi-saida`, T-0144), com o horário (`quando`, UTC) e a pilha
 * curta (o ponto da falha). Decisão do dono do produto (R-20261110-192152): o envio leva as 5 últimas, para uma queda
 * seguida de reaberturas aparecer inteira no portal.
 */
export const DiagnosticoSaidaDaListaSchema = DiagnosticoSaidaAndroidSchema.extend({ quando: Data, pilha: texto(1000).nullable() }).strict();
export type DiagnosticoSaidaDaLista = z.infer<typeof DiagnosticoSaidaDaListaSchema>;
/** Quantas saídas do Android vão no envio (as mais novas primeiro). */
export const MAX_SAIDAS_DIAGNOSTICO = 5;

export const DiagnosticoEnvioSchema = z
  .object({
    id: Id,
    origem: z.enum(ORIGENS_DIAGNOSTICO),
    ocorrido_em: Data,
    app: z.enum(APPS_DIAGNOSTICO),
    versao_app: z.string().min(1).max(20),
    build: texto(60).nullable(),
    aparelho: z
      .object({ fabricante: texto(60), modelo: texto(80), android: texto(20), api: z.number().int().min(0).max(1000) })
      .strict(),
    tela: texto(200).nullable(),
    motivo: texto(60).nullable(),
    /** "O que aconteceu?" (texto livre; a API passa pela máscara de dado pessoal). */
    descricao: texto(1000).nullable(),
    erro: DiagnosticoErroSchema.nullable(),
    saida_android: DiagnosticoSaidaAndroidSchema.nullable(),
    /** As últimas saídas do Android, a mais nova primeiro (até 5). Aditivo: o app anterior não manda (= nenhuma). */
    ultimas_saidas: z.array(DiagnosticoSaidaDaListaSchema).max(MAX_SAIDAS_DIAGNOSTICO).nullable().optional(),
    sync: z.object({ pendentes: z.number().int().nonnegative(), ultimo_sync_em: Data.nullable() }).strict().nullable(),
    print_id: Id.nullable(),
  })
  .strict();
export type DiagnosticoEnvio = z.infer<typeof DiagnosticoEnvioSchema>;

/** 201 na 1ª vez (`criado: true`), 200 na repetição do mesmo `id` (mesmo protocolo). */
export const DiagnosticoRespostaSchema = z.object({ id: Id, protocolo: z.number().int().positive(), criado: z.boolean() }).strict();
export type DiagnosticoResposta = z.infer<typeof DiagnosticoRespostaSchema>;

/** Protocolo para exibição: `42` → `'0042'` (mínimo 4 dígitos, nunca corta). Fonte única do app e do portal. */
export function formatarProtocolo(protocolo: number): string {
  if (!Number.isSafeInteger(protocolo) || protocolo < 1) throw new Error(`formatarProtocolo: protocolo inválido (${protocolo})`);
  return String(protocolo).padStart(4, '0');
}

export const SITUACOES_ALERTA_DIAGNOSTICO = ['pendente', 'enviado', 'agrupado', 'falhou', 'desligado'] as const;

// ---------- portal (super-admin) ----------

export const DiagnosticoFiltroSchema = z
  .object({
    versao: texto(20).optional(),
    modelo: texto(80).optional(),
    tenant_id: Id.optional(),
    motivo: texto(60).optional(),
    origem: z.enum(ORIGENS_DIAGNOSTICO).optional(),
    de: Data.optional(),
    ate: Data.optional(),
    cursor: texto(200).optional(),
  })
  .strict();
export type DiagnosticoFiltro = z.infer<typeof DiagnosticoFiltroSchema>;

export const DiagnosticoItemSchema = z.object({
  id: Id,
  protocolo: z.number().int().positive(),
  recebido_em: Data,
  ocorrido_em: Data,
  origem: z.enum(ORIGENS_DIAGNOSTICO),
  app: z.enum(APPS_DIAGNOSTICO),
  versao_app: z.string(),
  aparelho_modelo: z.string().nullable(),
  android: z.string().nullable(),
  motivo: z.string().nullable(),
  tenant_id: Id,
  tenant_nome: z.string().nullable(),
  tem_print: z.boolean(),
});
export const DiagnosticoListaSchema = z.object({ itens: z.array(DiagnosticoItemSchema), cursor: z.string().nullable() });
export type DiagnosticoLista = z.infer<typeof DiagnosticoListaSchema>;

export const DiagnosticoDetalheSchema = DiagnosticoItemSchema.extend({
  build: z.string().nullable(),
  aparelho_fabricante: z.string().nullable(),
  android_api: z.number().int().nullable(),
  tela: z.string().nullable(),
  descricao: z.string().nullable(),
  erro: DiagnosticoErroSchema.nullable(),
  saida_android: DiagnosticoSaidaAndroidSchema.nullable(),
  /** As últimas saídas do Android (bloco "Saída do Android" do portal); diagnóstico sem a lista = `[]`. */
  ultimas_saidas: z
    .array(DiagnosticoSaidaDaListaSchema)
    .nullish()
    .transform((v) => v ?? []),
  sync: z.object({ pendentes: z.number().int(), ultimo_sync_em: z.string().nullable() }).nullable(),
  usuario_id: Id,
  perfil: z.string(),
  alerta: z.object({ situacao: z.enum(SITUACOES_ALERTA_DIAGNOSTICO), recado_id: z.string().nullable(), em: Data.nullable() }),
});
export type DiagnosticoDetalhe = z.infer<typeof DiagnosticoDetalheSchema>;
