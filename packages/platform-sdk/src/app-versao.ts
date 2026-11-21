/**
 * "Verificar atualização" do app (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md`
 * §2). A API diz qual é a última versão publicada de cada variante (pública, sem sessão e sem dado de tenant):
 *   GET /v1/app/versao?variante=campo|gestao&contrato=2   AppVersaoPublicadaV2 (apps a partir da v1.0.19), sem `apk_url`
 *   GET /v1/app/versao?variante=campo|gestao              AppVersaoPublicada (apps v1.0.17 e v1.0.18, que não mudam)
 * Desde a T-0190 (ADR 0065, RN-CORE-67) o APK só se baixa pelo link temporário que o administrador gera no portal
 * (`POST /v1/core/apps/download`, porta `ServicoPacotes`, produtos `campo` e `gestao`). No contrato antigo o `apk_url` não
 * aponta mais para o APK: aponta para a página `GET /v1/app/atualizar?variante=` da API, que só orienta a pedir o link ao
 * gestor ou ao administrador (não lista nem serve o arquivo).
 * Puro TypeScript: o app compara a própria versão com `haVersaoNova`.
 */
import { z } from 'zod';

export const VARIANTES_APP = ['campo', 'gestao'] as const;
export type VarianteApp = (typeof VARIANTES_APP)[number];
/** Nome do app por variante, para textos a pessoas (página de orientação da API, portal). */
export const NOME_APP_VARIANTE: Readonly<Record<VarianteApp, string>> = { campo: 'Macuxi Campo', gestao: 'Macuxi Gestão' };

export const ROTA_APP_VERSAO = '/v1/app/versao';
/** Versão do contrato que o app novo pede na query (`contrato=2`): sem ela a API responde o contrato antigo. */
export const CONTRATO_APP_VERSAO_V2 = '2';
/** Rota do app a partir da v1.0.19 (contrato V2, T-0190). */
export const rotaAppVersao = (variante: VarianteApp): string =>
  `${ROTA_APP_VERSAO}?variante=${variante}&contrato=${CONTRATO_APP_VERSAO_V2}`;

/** Página pública que o `apk_url` do contrato antigo abre: só orienta a pedir o link do APK (T-0190, RN-CORE-67). */
export const ROTA_APP_ATUALIZAR = '/v1/app/atualizar';

/** 404 da rota: o servidor não tem versão publicada para a variante. */
export const CODIGO_SEM_VERSAO = 'SEM_VERSAO';

/** Versão `X.Y.Z` numérica, sem zero à esquerda, sem prefixo nem sufixo. */
const SEMVER_APP_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const VersaoAppSchema = z.string().regex(SEMVER_APP_RE);

const ApkUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'Use um endereço https.');

/**
 * @deprecated Contrato dos apps v1.0.17 e v1.0.18 (`apk_url` obrigatório; o botão "Atualizar para X.Y.Z" abre o endereço).
 * A API ainda responde nele quando a query vem sem `contrato`, com `apk_url` na página de orientação (`ROTA_APP_ATUALIZAR`).
 * App novo usa `AppVersaoPublicadaV2Schema`. Sai quando nenhum app instalado for anterior à v1.0.19 (ADR 0065).
 */
export const AppVersaoPublicadaSchema = z
  .object({
    variante: z.enum(VARIANTES_APP),
    versao: VersaoAppSchema,
    apk_url: ApkUrlSchema,
    publicada_em: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
/** @deprecated Use `AppVersaoPublicadaV2`. */
export type AppVersaoPublicada = z.output<typeof AppVersaoPublicadaSchema>;

/**
 * Resposta de `GET /v1/app/versao?contrato=2` (T-0190, ADR 0065). A API não manda `apk_url`; o campo fica opcional só para o
 * app ler, sem quebrar, um servidor que ainda o mande (https). O app que acha versão nova pede o link ao administrador.
 */
export const AppVersaoPublicadaV2Schema = AppVersaoPublicadaSchema.extend({ apk_url: ApkUrlSchema.optional() }).strict();
export type AppVersaoPublicadaV2 = z.output<typeof AppVersaoPublicadaV2Schema>;

/** Query da rota: sem `contrato` = contrato antigo (apps v1.0.17 e v1.0.18); `contrato=2` = V2. */
export const ConsultaAppVersaoSchema = z
  .object({ variante: z.enum(VARIANTES_APP), contrato: z.literal(CONTRATO_APP_VERSAO_V2).optional() })
  .strict();

/** Query da página de orientação. */
export const ConsultaAppAtualizarSchema = z.object({ variante: z.enum(VARIANTES_APP) }).strict();

const partes = (v: string): [number, number, number] | null => {
  const m = SEMVER_APP_RE.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** `true` só se `publicada` for maior que `atual` (comparação numérica X, Y, Z). Qualquer uma inválida = `false`. */
export function haVersaoNova(atual: string, publicada: string): boolean {
  const a = partes(atual);
  const p = partes(publicada);
  if (!a || !p) return false;
  for (let i = 0; i < 3; i++) if (p[i] !== a[i]) return p[i]! > a[i]!;
  return false;
}
