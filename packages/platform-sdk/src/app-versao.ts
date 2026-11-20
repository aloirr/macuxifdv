/**
 * "Verificar atualização" do app (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md`
 * §2). O APK sai do `android-build.yml` (sem loja, sem Expo); a API diz qual é a última versão publicada de cada variante:
 *   GET /v1/app/versao?variante=campo|gestao   AppVersaoPublicada (pública, sem sessão e sem dado de tenant)
 * Puro TypeScript: o app compara a própria versão com `haVersaoNova`.
 */
import { z } from 'zod';

export const VARIANTES_APP = ['campo', 'gestao'] as const;
export type VarianteApp = (typeof VARIANTES_APP)[number];

export const ROTA_APP_VERSAO = '/v1/app/versao';
export const rotaAppVersao = (variante: VarianteApp): string => `${ROTA_APP_VERSAO}?variante=${variante}`;

/** 404 da rota: o servidor não tem versão publicada para a variante. */
export const CODIGO_SEM_VERSAO = 'SEM_VERSAO';

/** Versão `X.Y.Z` numérica, sem zero à esquerda, sem prefixo nem sufixo. */
const SEMVER_APP_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const VersaoAppSchema = z.string().regex(SEMVER_APP_RE);

export const AppVersaoPublicadaSchema = z
  .object({
    variante: z.enum(VARIANTES_APP),
    versao: VersaoAppSchema,
    apk_url: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), 'Use um endereço https.'),
    publicada_em: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AppVersaoPublicada = z.output<typeof AppVersaoPublicadaSchema>;

/** Query da rota. */
export const ConsultaAppVersaoSchema = z.object({ variante: z.enum(VARIANTES_APP) }).strict();

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
