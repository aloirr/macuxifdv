/**
 * Atualização obrigatória do APK (T-0195, ADR 0070 §D6 e §D7, RN-CORE-80). Duas rotas do Core para o usuário logado no app:
 * - `POST /v1/core/app/apk` (`ROTA_CORE_APP_APK`, sem corpo): link temporário do último APK da PRÓPRIA variante
 *   (`varianteDoPerfil`). A `url` é segredo de minutos: nunca em log, auditoria, notificação nem armazenamento do aparelho.
 * - `POST /v1/core/app/aviso-versao` (`ROTA_CORE_APP_AVISO_VERSAO`, sem corpo, cabeçalho `x-macuxi-app`): devolve a situação
 *   do app (`situacaoDaVersao`) para o app guardar e usar offline e, só em `aviso`, cria UMA notificação do sininho por
 *   (usuário, variante, versão publicada).
 * A notificação do aviso NÃO tem `link`: o app a reconhece pelo `subtipo` (`SUBTIPO_NOTIFICACAO_APP_VERSAO`) e, ao tocar, abre
 * a própria tela de atualização (portão do ADR 0070 §D8 a), que pede o link por `ROTA_CORE_APP_APK`.
 */
import { LinkPacoteSchema, SITUACOES_VERSAO_APP, VARIANTES_APP } from '@macuxi/platform-sdk';
import { z } from 'zod';
/** As duas rotas não têm corpo (`{}` estrito): a variante vem do perfil (D6) e a versão do cabeçalho (D7). */
export const AppAtualizacaoCorpoSchema = z.object({}).strict();
/** Resposta de `POST /v1/core/app/apk`: o `LinkPacote` do SDK com a variante. */
export const LinkApkProprioSchema = LinkPacoteSchema.extend({ variante: z.enum(VARIANTES_APP) }).strip();
/** 403 quando o perfil não usa app Android (admin, analista, assistente). */
export const CODIGO_APP_PERFIL_SEM_APP = 'APP_PERFIL_SEM_APP';
/** 403 quando o cabeçalho `x-macuxi-app` traz a variante que não é a do perfil. */
export const CODIGO_APP_VARIANTE_DIFERENTE = 'APP_VARIANTE_DIFERENTE';
/**
 * Resposta de `POST /v1/core/app/aviso-versao`. Sem cabeçalho (ou sem versão publicada) a situação é `atual` com
 * `versao_publicada`/`prazo_ate` nulos. O app guarda a resposta e, offline, trata `agora >= prazo_ate` como `bloqueada`.
 */
export const AvisoVersaoAppRespostaSchema = z
    .object({
    variante: z.enum(VARIANTES_APP),
    situacao: z.enum(SITUACOES_VERSAO_APP),
    versao_publicada: z.string().nullable(),
    /** ISO UTC do fim das 24 h; `null` = situação `atual` ou hora da publicação desconhecida (nunca bloqueia). */
    prazo_ate: z.string().datetime().nullable(),
})
    .strict();
/**
 * `subtipo` da notificação do aviso (`tipo = 'sistema'`). Tocar nela abre a tela de atualização do app, não um link: a
 * notificação nunca guarda a URL do APK.
 */
export const SUBTIPO_NOTIFICACAO_APP_VERSAO = 'app_versao_nova';
/** Textos do aviso (designer-ux, docs/design/t0195-atualizacao-obrigatoria.md). */
export const tituloAvisoVersaoApp = (versao) => `Versão ${versao} disponível`;
export const CORPO_AVISO_VERSAO_APP = 'Instale por cima da versão atual, sem desinstalar o app.';
/** `true` = a notificação é o aviso de versão nova (o app abre a tela de atualização ao tocar). */
export function ehAvisoDeVersaoApp(n) {
    return n.tipo === 'sistema' && n.subtipo === SUBTIPO_NOTIFICACAO_APP_VERSAO;
}
/**
 * Rota da tela de atualização do shell (portão do ADR 0070 §D8 a). Tocar no aviso de versão, na notificação ou no balão, abre
 * esta rota; ela fica no shell (`apps/mobile`), não é página de módulo (`/m/...`).
 */
export const ROTA_TELA_ATUALIZAR_APP = '/atualizar-app';
