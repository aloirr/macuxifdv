/**
 * "Verificar atualização" do app (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md`
 * §2). Contrato no SDK (`app-versao.ts`):
 *   GET /v1/app/versao?variante=campo|gestao   AppVersaoPublicada, `public, max-age=300`
 * Pública (sem sessão, sem dado de tenant): só diz a última versão do APK que o `android-build.yml` publicou e onde baixar.
 * Fonte: a configuração do servidor, lida uma vez na subida (`versoesAppDoAmbiente`):
 *   APP_CAMPO_VERSAO, APP_CAMPO_APK_URL, APP_CAMPO_PUBLICADA_EM (opcional, ISO)
 *   APP_GESTAO_VERSAO, APP_GESTAO_APK_URL, APP_GESTAO_PUBLICADA_EM (opcional, ISO)
 * Variante sem versão ou com valor fora do contrato (versão fora de X.Y.Z, endereço sem https) = 404 `SEM_VERSAO`.
 */
import {
  AppVersaoPublicadaSchema,
  CODIGO_SEM_VERSAO,
  ConsultaAppVersaoSchema,
  ROTA_APP_VERSAO,
  VARIANTES_APP,
  type AppVersaoPublicada,
  type VarianteApp,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { ErroHttp } from './erros';

export type VersoesApp = Partial<Record<VarianteApp, AppVersaoPublicada>>;

/** Cache curto: o app pergunta ao abrir e no botão; 5 min basta para um APK novo aparecer. */
export const CACHE_APP_VERSAO = 'public, max-age=300';

/** Versões publicadas pela configuração do servidor. Valor fora do contrato = variante ausente (o app nunca recebe link inválido). */
export function versoesAppDoAmbiente(env: NodeJS.ProcessEnv): VersoesApp {
  const saida: VersoesApp = {};
  for (const variante of VARIANTES_APP) {
    const p = `APP_${variante.toUpperCase()}_`;
    const versao = env[`${p}VERSAO`]?.trim();
    const apk = env[`${p}APK_URL`]?.trim();
    if (!versao || !apk) continue;
    const r = AppVersaoPublicadaSchema.safeParse({ variante, versao, apk_url: apk, publicada_em: env[`${p}PUBLICADA_EM`]?.trim() || null });
    if (r.success) saida[variante] = r.data;
  }
  return saida;
}

export function registrarRotaAppVersao(
  app: FastifyInstance,
  dep: { versoes: VersoesApp; validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown },
): void {
  app.get(ROTA_APP_VERSAO, async (req, reply) => {
    const { variante } = dep.validar(ConsultaAppVersaoSchema, req.query, 'query') as z.output<typeof ConsultaAppVersaoSchema>;
    const v = dep.versoes[variante];
    if (!v) throw new ErroHttp(404, CODIGO_SEM_VERSAO, 'Nenhuma versão publicada para este app.');
    return reply.header('cache-control', CACHE_APP_VERSAO).send(AppVersaoPublicadaSchema.parse(v));
  });
}
