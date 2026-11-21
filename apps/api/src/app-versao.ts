/**
 * "Verificar atualização" do app (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md`
 * §2). Contrato no SDK (`app-versao.ts`), as duas públicas (sem sessão, sem dado de tenant), `public, max-age=300`:
 *   GET /v1/app/versao?variante=campo|gestao&contrato=2   AppVersaoPublicadaV2, sem `apk_url` (apps a partir da v1.0.19)
 *   GET /v1/app/versao?variante=campo|gestao              AppVersaoPublicada (apps v1.0.17 e v1.0.18, que não mudam)
 *   GET /v1/app/atualizar?variante=campo|gestao           página HTML que só orienta a pedir o link do APK
 * Desde a T-0190 (ADR 0065, RN-CORE-67) o APK só se baixa pelo link temporário que o administrador gera no portal
 * (`POST /v1/core/apps/download`). O app antigo exige `apk_url` https e o abre no navegador ("Atualizar para X.Y.Z"): o
 * endereço passa a ser a página `/v1/app/atualizar` desta API, que não lista nem serve o arquivo.
 * Fonte: a configuração do servidor, lida uma vez na subida (`versoesAppDoAmbiente`, `urlApiPublicaDoAmbiente`):
 *   APP_CAMPO_VERSAO, APP_CAMPO_PUBLICADA_EM (opcional, ISO)
 *   APP_GESTAO_VERSAO, APP_GESTAO_PUBLICADA_EM (opcional, ISO)
 *   MACUXI_API_URL_PUBLICA (opcional, https; padrão `https://api.macuxifdv.com.br`)
 * `APP_*_APK_URL` não é mais lida. Variante sem versão ou com valor fora do contrato = 404 `SEM_VERSAO`.
 */
import {
  AppVersaoPublicadaSchema,
  AppVersaoPublicadaV2Schema,
  CODIGO_SEM_VERSAO,
  ConsultaAppAtualizarSchema,
  ConsultaAppVersaoSchema,
  NOME_APP_VARIANTE,
  ROTA_APP_ATUALIZAR,
  ROTA_APP_VERSAO,
  VARIANTES_APP,
  type AppVersaoPublicadaV2,
  type VarianteApp,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { ErroHttp } from './erros';

export type VersoesApp = Partial<Record<VarianteApp, AppVersaoPublicadaV2>>;

/** Cache curto: o app pergunta ao abrir e no botão; 5 min basta para um APK novo aparecer. */
export const CACHE_APP_VERSAO = 'public, max-age=300';

/** Endereço público desta API (produção), base do `apk_url` do contrato antigo. */
export const URL_API_PUBLICA_PADRAO = 'https://api.macuxifdv.com.br';

/** `MACUXI_API_URL_PUBLICA` (https, sem barra no fim); ausente ou fora de https = padrão. */
export function urlApiPublicaDoAmbiente(env: NodeJS.ProcessEnv): string {
  const v = env.MACUXI_API_URL_PUBLICA?.trim().replace(/\/+$/, '');
  return v && /^https:\/\/[^\s/?#]+$/.test(v) ? v : URL_API_PUBLICA_PADRAO;
}

/** Página de orientação (texto curto, sem dado de tenant, sem link do APK). Versão e variante já validadas (X.Y.Z, enum). */
export function paginaAtualizar(variante: VarianteApp, versao: string | null): string {
  const titulo = versao ? `${NOME_APP_VARIANTE[variante]} ${versao}` : NOME_APP_VARIANTE[variante];
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${titulo}</title></head><body style="font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;margin:24px;line-height:1.5;background:#F8F6F1;color:#16202A">` +
    `<h1>${titulo}</h1><p>Peça o link de download ao gestor ou ao administrador da empresa.</p></body></html>`
  );
}

/** Versões publicadas pela configuração do servidor. Valor fora do contrato = variante ausente. */
export function versoesAppDoAmbiente(env: NodeJS.ProcessEnv): VersoesApp {
  const saida: VersoesApp = {};
  for (const variante of VARIANTES_APP) {
    const p = `APP_${variante.toUpperCase()}_`;
    const versao = env[`${p}VERSAO`]?.trim();
    if (!versao) continue;
    const r = AppVersaoPublicadaV2Schema.safeParse({ variante, versao, publicada_em: env[`${p}PUBLICADA_EM`]?.trim() || null });
    if (r.success) saida[variante] = r.data;
  }
  return saida;
}

export function registrarRotaAppVersao(
  app: FastifyInstance,
  dep: { versoes: VersoesApp; urlApiPublica: string; validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown },
): void {
  app.get(ROTA_APP_VERSAO, async (req, reply) => {
    const { variante, contrato } = dep.validar(ConsultaAppVersaoSchema, req.query, 'query') as z.output<typeof ConsultaAppVersaoSchema>;
    const v = dep.versoes[variante];
    if (!v) throw new ErroHttp(404, CODIGO_SEM_VERSAO, 'Nenhuma versão publicada para este app.');
    const { versao, publicada_em } = v;
    const corpo = contrato
      ? AppVersaoPublicadaV2Schema.parse({ variante, versao, publicada_em })
      : AppVersaoPublicadaSchema.parse({ variante, versao, publicada_em, apk_url: `${dep.urlApiPublica}${ROTA_APP_ATUALIZAR}?variante=${variante}` });
    return reply.header('cache-control', CACHE_APP_VERSAO).send(corpo);
  });

  // RN-CORE-67: o que o "Atualizar para X.Y.Z" dos apps v1.0.17 e v1.0.18 abre no navegador
  app.get(ROTA_APP_ATUALIZAR, async (req, reply) => {
    const { variante } = dep.validar(ConsultaAppAtualizarSchema, req.query, 'query') as z.output<typeof ConsultaAppAtualizarSchema>;
    return reply
      .header('cache-control', CACHE_APP_VERSAO)
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .type('text/html; charset=utf-8')
      .send(paginaAtualizar(variante, dep.versoes[variante]?.versao ?? null));
  });
}
