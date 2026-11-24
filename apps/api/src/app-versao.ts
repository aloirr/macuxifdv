/**
 * "Verificar atualização" do app (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md`
 * §2). Contrato no SDK (`app-versao.ts`), as duas públicas (sem sessão, sem dado de tenant), `public, max-age=300`:
 *   GET /v1/app/versao?variante=campo|gestao&contrato=2   AppVersaoPublicadaV2, sem `apk_url` (apps a partir da v1.0.19)
 *   GET /v1/app/versao?variante=campo|gestao              AppVersaoPublicada (apps v1.0.17 e v1.0.18, que não mudam)
 *   GET /v1/app/atualizar?variante=campo|gestao           página HTML que só orienta a pedir o link do APK
 * Desde a T-0190 (ADR 0065, RN-CORE-67) o APK só se baixa pelo link temporário que o administrador gera no portal
 * (`POST /v1/core/apps/download`). O app antigo exige `apk_url` https e o abre no navegador ("Atualizar para X.Y.Z"): o
 * endereço passa a ser a página `/v1/app/atualizar` desta API, que não lista nem serve o arquivo.
 * T-0195 (ADR 0070, RN-CORE-80): a versão e a hora da publicação vêm do manifesto `<produto>/ultimo.json` que o `publicar-pacote`
 * grava (porta `ServicoPacotes.manifestoDoUltimo`, cache de 5 min, `criarFonteVersoesApp`); sem S3 ou sem manifesto, do ambiente.
 * A mesma fonte alimenta o bloqueio do app antigo (`registrarBloqueioVersaoApp`: 426 `APP_DESATUALIZADO` depois das 24 h, com as
 * rotas que salvam o que foi digitado liberadas) e a porta `ctx.versaoApp` dos módulos.
 * Fonte de reserva: a configuração do servidor, lida uma vez na subida (`versoesAppDoAmbiente`, `urlApiPublicaDoAmbiente`):
 *   APP_CAMPO_VERSAO, APP_CAMPO_PUBLICADA_EM (opcional, ISO)
 *   APP_GESTAO_VERSAO, APP_GESTAO_PUBLICADA_EM (opcional, ISO)
 *   MACUXI_API_URL_PUBLICA (opcional, https; padrão `https://api.macuxifdv.com.br`)
 * `APP_*_APK_URL` não é mais lida. Variante sem versão ou com valor fora do contrato = 404 `SEM_VERSAO`.
 */
import {
  AppVersaoPublicadaSchema,
  CABECALHO_APP,
  CODIGO_APP_DESATUALIZADO,
  lerCabecalhoApp,
  MENSAGEM_APP_DESATUALIZADO,
  ROTA_CORE_APP_APK,
  situacaoDaVersao,
  STATUS_APP_DESATUALIZADO,
  type AppDoCabecalho,
  type LogRota,
  type PortaVersaoApp,
  type ServicoPacotes,
  type VersaoPublicadaApp,
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

/** Cache da fonte de versões no processo (D1 da ADR 0070: até 5 min, o mesmo do `cache-control` da rota). */
export const CACHE_FONTE_VERSOES_MS = 300_000;

/** Fonte única da última versão publicada de cada variante (rota, 426 e `ctx.versaoApp`). `publicada` nunca lança. */
export interface FonteVersoesApp {
  publicada(variante: VarianteApp): Promise<VersaoPublicadaApp | null>;
}

const SEMVER_APP_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * ADR 0070 §D1: manifesto `ultimo.json` do APK (porta de pacotes, sem assinar link) e, sem S3, sem manifesto ou com versão fora de
 * X.Y.Z, a versão do ambiente. Cache por variante de `cacheMs`; falha do armazenamento = o último valor bom, senão o do ambiente
 * (nunca derruba a requisição: sem hora conhecida não há bloqueio). Log só com variante e código, nunca o conteúdo.
 */
export function criarFonteVersoesApp(dep: {
  pacotes: ServicoPacotes;
  doAmbiente: VersoesApp;
  relogio: () => Date;
  cacheMs?: number;
  log?: Pick<LogRota, 'warn'>;
}): FonteVersoesApp {
  const cacheMs = dep.cacheMs ?? CACHE_FONTE_VERSOES_MS;
  const doAmbiente = (variante: VarianteApp): VersaoPublicadaApp | null => {
    const v = dep.doAmbiente[variante];
    return v ? { versao: v.versao, publicada_em: v.publicada_em } : null;
  };
  const cache = new Map<VarianteApp, { em: number; valor: Promise<VersaoPublicadaApp | null> }>();
  const bons = new Map<VarianteApp, VersaoPublicadaApp>();
  const ler = async (variante: VarianteApp): Promise<VersaoPublicadaApp | null> => {
    if (!dep.pacotes.disponivel() || !dep.pacotes.manifestoDoUltimo) return doAmbiente(variante);
    try {
      const m = await dep.pacotes.manifestoDoUltimo(variante);
      if (!m || !SEMVER_APP_RE.test(m.versao)) return doAmbiente(variante);
      const v = { versao: m.versao, publicada_em: m.publicado_em ?? null };
      bons.set(variante, v);
      return v;
    } catch (e) {
      dep.log?.warn({ variante, codigo: (e as { codigo?: string }).codigo ?? 'desconhecido', operacao: 'versao_app' }, 'versão publicada do app indisponível');
      return bons.get(variante) ?? doAmbiente(variante);
    }
  };
  return {
    publicada(variante) {
      const agora = dep.relogio().getTime();
      const c = cache.get(variante);
      if (c && agora - c.em < cacheMs && agora >= c.em) return c.valor;
      const valor = ler(variante);
      cache.set(variante, { em: agora, valor });
      return valor;
    },
  };
}

/** `ctx.versaoApp` da requisição (ADR 0070 §D7). */
export function portaVersaoApp(fonte: FonteVersoesApp, cabecalhos: Record<string, unknown>): PortaVersaoApp {
  return { doCliente: lerCabecalhoApp(cabecalhos[CABECALHO_APP]), publicada: (v) => fonte.publicada(v) };
}

/**
 * ADR 0070 §D4: o que o app bloqueado ainda pode chamar, para nada digitado se perder e para chegar ao APK novo. Método + padrão
 * da rota do Fastify (`req.routeOptions.url`); `*` = qualquer método; padrão terminado em `/*` = prefixo.
 */
export const ROTAS_LIBERADAS_APP_DESATUALIZADO: readonly { metodo: string; url: string }[] = Object.freeze([
  // autenticação: entrar, renovar, sair, trocar e recuperar a senha (sem sessão não há envio da fila)
  { metodo: '*', url: '/v1/auth/*' },
  // envio da fila do motor (pedidos, orçamentos, pré-cadastros, visitas, leituras...) e dos arquivos dela (fotos, assinaturas)
  { metodo: 'POST', url: '/v1/sync/push' },
  { metodo: 'PUT', url: '/v1/arquivos/:id' },
  { metodo: 'PUT', url: '/v1/arquivos/:id/partes/:n' },
  { metodo: 'GET', url: '/v1/arquivos/:id/partes/:n/url-envio' },
  { metodo: 'POST', url: '/v1/arquivos/:id/concluir' },
  // a versão publicada, a identificação do servidor e o link do APK do próprio app (Core, D6)
  { metodo: 'GET', url: ROTA_APP_VERSAO },
  { metodo: 'GET', url: ROTA_APP_ATUALIZAR },
  { metodo: 'GET', url: '/v1/saude' },
  { metodo: 'POST', url: ROTA_CORE_APP_APK },
]);

/** A rota (método + padrão do Fastify) fica aberta ao app bloqueado? Sem padrão (404) = sim: o 404 segue o caminho normal. */
export function rotaLiberadaAoAppDesatualizado(metodo: string, url: string | undefined): boolean {
  if (url === undefined) return true;
  const m = metodo.toUpperCase();
  return ROTAS_LIBERADAS_APP_DESATUALIZADO.some(
    (r) => (r.metodo === '*' || r.metodo === m || (m === 'HEAD' && r.metodo === 'GET')) && (r.url.endsWith('/*') ? url.startsWith(r.url.slice(0, -1)) : url === r.url),
  );
}

/** Situação do app que chamou (`null` = sem cabeçalho ou sem versão publicada: nada muda). */
export async function situacaoDoCliente(
  fonte: FonteVersoesApp,
  cliente: AppDoCabecalho | null,
  agora: Date,
): Promise<{ publicada: VersaoPublicadaApp; situacao: ReturnType<typeof situacaoDaVersao> } | null> {
  if (!cliente) return null;
  const publicada = await fonte.publicada(cliente.variante);
  if (!publicada) return null;
  return { publicada, situacao: situacaoDaVersao({ atual: cliente.versao, publicada: publicada.versao, publicadaEm: publicada.publicada_em, agora }) };
}

/**
 * ADR 0070 §D4 (RN-CORE-80, a API sempre revalida): `onRequest` global. App (cabeçalho `x-macuxi-app`) com a situação `bloqueada`
 * recebe 426 `APP_DESATUALIZADO` em toda rota fora de `ROTAS_LIBERADAS_APP_DESATUALIZADO`. Sem cabeçalho (BKO, portal, apps até a
 * v1.0.32), sem versão publicada ou sem hora da publicação: nada muda.
 */
export function registrarBloqueioVersaoApp(app: FastifyInstance, dep: { fonte: FonteVersoesApp; relogio: () => Date }): void {
  app.addHook('onRequest', async (req) => {
    const cliente = lerCabecalhoApp(req.headers[CABECALHO_APP]);
    if (!cliente || rotaLiberadaAoAppDesatualizado(req.method, req.routeOptions.url)) return;
    const r = await situacaoDoCliente(dep.fonte, cliente, dep.relogio());
    if (r?.situacao.situacao !== 'bloqueada' || r.publicada.publicada_em === null || r.situacao.prazoAte === null) return;
    req.log.info({ codigo: CODIGO_APP_DESATUALIZADO, variante: cliente.variante, versao: cliente.versao, request_id: req.id }, 'app desatualizado recusado');
    throw new ErroHttp(STATUS_APP_DESATUALIZADO, CODIGO_APP_DESATUALIZADO, MENSAGEM_APP_DESATUALIZADO, {
      variante: cliente.variante,
      versao_publicada: r.publicada.versao,
      publicada_em: r.publicada.publicada_em,
      prazo_ate: r.situacao.prazoAte,
    });
  });
}

export function registrarRotaAppVersao(
  app: FastifyInstance,
  dep: { fonte: FonteVersoesApp; urlApiPublica: string; validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown },
): void {
  app.get(ROTA_APP_VERSAO, async (req, reply) => {
    const { variante, contrato } = dep.validar(ConsultaAppVersaoSchema, req.query, 'query') as z.output<typeof ConsultaAppVersaoSchema>;
    const v = await dep.fonte.publicada(variante);
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
      .send(paginaAtualizar(variante, (await dep.fonte.publicada(variante))?.versao ?? null));
  });
}
