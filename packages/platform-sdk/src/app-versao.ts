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

/** A versão está no formato do contrato (`X.Y.Z`, sem espaço)? Usada pela API para descartar manifesto fora do contrato. */
export const versaoAppValida = (v: string): boolean => SEMVER_APP_RE.test(v);

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

// ---------- T-0195 (ADR 0070, RN-CORE-80): atualização obrigatória do APK ----------
// APK novo publicado: nas primeiras 24 h o app antigo segue e recebe um aviso no sininho; depois delas o app antigo mostra só
// a tela de reinstalar e a API recusa as chamadas dele (426 `APP_DESATUALIZADO`), menos as rotas de
// `ROTAS_LIBERADAS_APP_DESATUALIZADO` (ADR 0070 §D4). A hora de referência é o `publicado_em` do manifesto `ultimo.json`.

/**
 * Cabeçalho que o app manda em toda chamada à API: `<variante>/<X.Y.Z>` (ex.: `campo/1.0.33`). Sem ele (BKO, portal, apps até
 * a v1.0.32) a API não bloqueia nada.
 */
export const CABECALHO_APP = 'x-macuxi-app';

/** O app que chamou, lido do `CABECALHO_APP`. */
export interface AppDoCabecalho {
  variante: VarianteApp;
  versao: string;
}

const CABECALHO_APP_RE = /^(campo|gestao)\/((?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3}))$/;

/** Valor do `CABECALHO_APP`. Versão fora de X.Y.Z = erro de programação (o shell lê a versão do próprio build). */
export function valorCabecalhoApp(variante: VarianteApp, versao: string): string {
  const valor = `${variante}/${versao}`;
  if (!CABECALHO_APP_RE.test(valor)) throw new Error(`versão do app fora de X.Y.Z: ${JSON.stringify(versao)}`);
  return valor;
}

/** Lê o `CABECALHO_APP` (string do Fastify ou do `fetch`). Ausente, repetido ou fora do formato = `null` (não bloqueia). */
export function lerCabecalhoApp(valor: unknown): AppDoCabecalho | null {
  if (typeof valor !== 'string' || valor.length > 32) return null;
  const m = CABECALHO_APP_RE.exec(valor.trim());
  return m ? { variante: m[1] as VarianteApp, versao: m[2]! } : null;
}

/** Prazo de convivência depois da publicação: 24 h exatas. Às 24h00 o app antigo já fica bloqueado. */
export const PRAZO_ATUALIZACAO_APP_MS = 24 * 60 * 60 * 1000;

export const SITUACOES_VERSAO_APP = ['atual', 'aviso', 'bloqueada'] as const;
/** `atual`: nada a fazer · `aviso`: há versão nova, ainda no prazo (sininho) · `bloqueada`: prazo vencido (tela de reinstalar). */
export type SituacaoVersaoApp = (typeof SITUACOES_VERSAO_APP)[number];

export interface EntradaSituacaoVersao {
  /** Versão do app instalado (X.Y.Z). */
  atual: string;
  /** Última publicada da variante (X.Y.Z); `null` = nenhuma conhecida. */
  publicada: string | null;
  /** ISO da publicação (`publicado_em` do manifesto, `publicada_em` da rota); `null` = desconhecida. */
  publicadaEm: string | null;
  agora: Date;
}

export interface SituacaoDaVersao {
  situacao: SituacaoVersaoApp;
  /** ISO UTC do fim do prazo (publicação + 24 h); `null` quando a situação é `atual` ou a hora da publicação é desconhecida. */
  prazoAte: string | null;
}

const ISO_DATA_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * RN-CORE-80 (T-0195, ADR 0070): situação do app instalado diante da última versão publicada. Função pura, a MESMA no app (tela
 * de entrada, inclusive offline com a última resposta guardada de `GET /v1/app/versao`), na API (o 426) e no Core (o sininho).
 * - versão inválida (qualquer uma), nenhuma publicada ou a instalada não é menor que a publicada → `atual`;
 * - menor que a publicada, com a hora da publicação desconhecida ou inválida → `aviso` sem prazo (nunca bloqueia sem a hora);
 * - menor, antes de publicação + 24 h → `aviso`; a partir de publicação + 24 h (inclusive) → `bloqueada`.
 * Publicação "no futuro" (relógio do aparelho atrasado) conta como `aviso`.
 */
export function situacaoDaVersao(e: EntradaSituacaoVersao): SituacaoDaVersao {
  if (e.publicada === null || !haVersaoNova(e.atual, e.publicada)) return { situacao: 'atual', prazoAte: null };
  const publicadaMs = e.publicadaEm !== null && ISO_DATA_RE.test(e.publicadaEm) ? Date.parse(e.publicadaEm) : Number.NaN;
  const agoraMs = e.agora.getTime();
  if (!Number.isFinite(publicadaMs) || !Number.isFinite(agoraMs)) return { situacao: 'aviso', prazoAte: null };
  const prazoMs = publicadaMs + PRAZO_ATUALIZACAO_APP_MS;
  return { situacao: agoraMs >= prazoMs ? 'bloqueada' : 'aviso', prazoAte: new Date(prazoMs).toISOString() };
}

/** Recusa da API ao app bloqueado (RN-CORE-80). O app mostra a mesma tela de reinstalar. */
export const STATUS_APP_DESATUALIZADO = 426;
export const CODIGO_APP_DESATUALIZADO = 'APP_DESATUALIZADO';
/** Texto do dono do produto (T-0195) na `mensagem` do 426. A tela do app usa os textos do designer-ux. */
export const MENSAGEM_APP_DESATUALIZADO = 'Versão desatualizada, reinstale para continuar.';

/** Corpo do 426 (`ErroApiSchema` com `detalhes` fixos). */
export const ErroAppDesatualizadoSchema = z
  .object({
    codigo: z.literal(CODIGO_APP_DESATUALIZADO),
    mensagem: z.string(),
    detalhes: z
      .object({
        variante: z.enum(VARIANTES_APP),
        versao_publicada: VersaoAppSchema,
        publicada_em: z.string().datetime({ offset: true }),
        prazo_ate: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
export type ErroAppDesatualizado = z.output<typeof ErroAppDesatualizadoSchema>;

/**
 * Última versão publicada de uma variante, como a API a conhece (manifesto `ultimo.json` ou ambiente).
 * `publicada_em`: ISO UTC; `null` = hora desconhecida (não bloqueia).
 */
export type VersaoPublicadaApp = Pick<AppVersaoPublicadaV2, 'versao' | 'publicada_em'>;

/**
 * Porta `ctx.versaoApp` das rotas de módulo (ADR 0070 §D7): o app que chamou e a última versão publicada de cada variante, a
 * MESMA fonte do 426 e de `GET /v1/app/versao` (cache de até 5 min). `publicada` nunca lança: falha do armazenamento = `null`.
 * A API sempre preenche; é opcional só para os contextos falsos dos testes dos módulos.
 */
export interface PortaVersaoApp {
  /** `CABECALHO_APP` desta requisição; `null` = sem cabeçalho (BKO, app antigo). */
  doCliente: AppDoCabecalho | null;
  publicada(variante: VarianteApp): Promise<VersaoPublicadaApp | null>;
}

// ---------- ADR 0076 (RN-VEN-02 v3): trava da quantidade fracionária ----------

/** Primeira versão dos apps que lê e grava quantidade e fator com casas decimais. */
export const VERSAO_APP_FRACAO = '1.0.35';

/** A variante já obriga a `VERSAO_APP_FRACAO`: publicada maior, ou igual e com as 24 h de convivência vencidas. */
function varianteObrigaFracao(v: VersaoPublicadaApp | null, agora: Date): boolean {
  if (v === null || !versaoAppValida(v.versao)) return false;
  if (haVersaoNova(VERSAO_APP_FRACAO, v.versao)) return true;
  if (v.versao !== VERSAO_APP_FRACAO) return false;
  const publicadaMs = v.publicada_em !== null && ISO_DATA_RE.test(v.publicada_em) ? Date.parse(v.publicada_em) : Number.NaN;
  const agoraMs = agora.getTime();
  return Number.isFinite(publicadaMs) && Number.isFinite(agoraMs) && agoraMs >= publicadaMs + PRAZO_ATUALIZACAO_APP_MS;
}

/**
 * ADR 0076 D6: a fração está liberada para a plataforma (API e app) só quando o Campo e o Gestão já obrigam a 1.0.35
 * (`varianteObrigaFracao`). Sem versão, sem hora, versão menor ou inválida = fechada. Publicar uma versão maior não fecha de novo.
 */
export function fracaoLiberada({
  campo,
  gestao,
  agora,
}: {
  campo: VersaoPublicadaApp | null;
  gestao: VersaoPublicadaApp | null;
  agora: Date;
}): boolean {
  return varianteObrigaFracao(campo, agora) && varianteObrigaFracao(gestao, agora);
}

/** ADR 0076 D6 (pull filtrado): o app que chamou lê fração? Só com o `CABECALHO_APP` e versão ≥ `VERSAO_APP_FRACAO`. */
export function clienteAceitaFracao(app: AppDoCabecalho | null): boolean {
  return app !== null && versaoAppValida(app.versao) && !haVersaoNova(app.versao, VERSAO_APP_FRACAO);
}

/** Porta fixa para os testes de módulo. */
export function criarPortaVersaoAppMemoria(
  publicadas: Partial<Record<VarianteApp, VersaoPublicadaApp>>,
  doCliente: AppDoCabecalho | null = null,
): PortaVersaoApp {
  return { doCliente, publicada: (v) => Promise.resolve(publicadas[v] ?? null) };
}

/**
 * Rotas do Core da T-0195 (ADR 0070 §D6 e §D7; o `modulo-core` implementa e põe os schemas em `modules/core/contracts`):
 * - `POST /v1/core/app/apk` — link temporário do APK da PRÓPRIA variante do usuário logado no app (`varianteDoPerfil`), pela
 *   porta `ctx.pacotes`; a API a libera mesmo com o app bloqueado.
 * - `POST /v1/core/app/aviso-versao` — o app chama ao abrir e ao voltar ao primeiro plano; o Core cria a notificação do sininho
 *   (uma por usuário, variante e versão) só na situação `aviso`.
 */
export const ROTA_CORE_APP_APK = '/v1/core/app/apk';
export const ROTA_CORE_APP_AVISO_VERSAO = '/v1/core/app/aviso-versao';
