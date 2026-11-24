/**
 * Atualização obrigatória do APK (T-0195, ADR 0070 §D6 e §D7, RN-CORE-80). Rotas do usuário logado no app (ação `app.atualizar`):
 * - `POST app/apk`: link temporário do APK da PRÓPRIA variante (`varianteDoPerfil`, nunca o que o cliente manda), com a mesma
 *   licença e auditoria sem URL do portal (`linkDoApp`). A API a libera mesmo com o app bloqueado (426).
 * - `POST app/aviso-versao`: situação do app (`avisoDeVersaoApp`, domain) e, só em `aviso`, UMA notificação do sininho por
 *   (usuário, variante, versão publicada): `envio_id` determinístico + `on conflict do nothing` no único `notificacao_envio_uk`
 *   (repetição e corrida não duplicam). A notificação não leva link: o app a reconhece pelo `subtipo` e abre a tela de atualização.
 */
import { ErroHttpModulo, NOME_APP_VARIANTE, varianteDoPerfil, type ContextoRota, type RotaModulo, type VarianteApp } from '@macuxi/platform-sdk';
import {
  AppAtualizacaoCorpoSchema,
  AvisoVersaoAppRespostaSchema,
  CODIGO_APP_PERFIL_SEM_APP,
  CODIGO_APP_VARIANTE_DIFERENTE,
  EVENTO_NOTIFICACAO_CRIADA,
  LinkApkProprioSchema,
  SUBTIPO_NOTIFICACAO_APP_VERSAO,
  type AvisoVersaoAppResposta,
  type LinkApkProprio,
} from '../contracts';
import { avisoDeVersaoApp } from '../domain';
import { linkDoApp } from './apps-download';
import { uuidDoTexto } from './consumidores-sistema';

const perfilSemApp = () => new ErroHttpModulo(403, CODIGO_APP_PERFIL_SEM_APP, 'Seu perfil não usa o app no celular. Entre pelo navegador.');
const varianteDiferente = (v: VarianteApp) =>
  new ErroHttpModulo(403, CODIGO_APP_VARIANTE_DIFERENTE, `Seu perfil usa o ${NOME_APP_VARIANTE[v]}. Instale esse app para continuar.`);

export const rotaApkProprio: RotaModulo = {
  metodo: 'POST',
  caminho: 'app/apk',
  acao: 'app.atualizar',
  carteira: 'nao_se_aplica',
  semCache: true,
  corpo: AppAtualizacaoCorpoSchema,
  executar: async (ctx: ContextoRota): Promise<LinkApkProprio> => {
    const variante = varianteDoPerfil(ctx.usuario.perfil);
    if (!variante) throw perfilSemApp();
    return LinkApkProprioSchema.parse(await linkDoApp(ctx, variante, 'core.app_apk_link'));
  },
};

export const rotaAvisoVersaoApp: RotaModulo = {
  metodo: 'POST',
  caminho: 'app/aviso-versao',
  acao: 'app.atualizar',
  carteira: 'nao_se_aplica',
  semCache: true,
  corpo: AppAtualizacaoCorpoSchema,
  executar: async (ctx: ContextoRota): Promise<AvisoVersaoAppResposta> => {
    const doCliente = ctx.versaoApp?.doCliente ?? null;
    // sem cabeçalho não há o que comparar: não lê a fonte; variante do cabeçalho diferente da do perfil o domain recusa
    const publicada = doCliente && ctx.versaoApp ? await ctx.versaoApp.publicada(doCliente.variante) : null;
    const r = avisoDeVersaoApp({ perfil: ctx.usuario.perfil, doCliente, publicada, agora: ctx.agora() });
    if (r.tipo === 'perfil_sem_app') throw perfilSemApp();
    if (r.tipo === 'variante_diferente') throw varianteDiferente(r.variante);
    const aviso = r.aviso;
    if (aviso) {
      const usuarioId = ctx.usuario.id;
      await ctx.comTenant(async (db, tx) => {
        const ins = await db.query<{ id: string }>(
          `insert into core.notificacao (tenant_id, usuario_id, tipo, subtipo, titulo, corpo, link, origem_modulo, envio_id, prioridade, expira_em)
           values (plataforma.tenant_atual(), $1, 'sistema', $2, $3, $4, null, 'core', $5, 'normal', $6::timestamptz)
           on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
           returning id`,
          [usuarioId, SUBTIPO_NOTIFICACAO_APP_VERSAO, aviso.titulo, aviso.corpo, uuidDoTexto(`macuxi.notificacao.app_versao|${usuarioId}|${aviso.chave}`), aviso.expira_em],
        );
        const nova = ins.rows[0];
        if (nova) await tx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: nova.id, usuario_id: usuarioId, tipo: 'sistema', prioridade: 'normal' }, nova.id);
      });
    }
    return AvisoVersaoAppRespostaSchema.parse(r.resposta);
  },
};

export const rotasDeAppAtualizacao: RotaModulo[] = [rotaApkProprio, rotaAvisoVersaoApp];
