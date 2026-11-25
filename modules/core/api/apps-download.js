/**
 * `POST apps/download` (T-0190, RN-CORE-67, ADR 0065): link temporário do último APK do Campo ou do Gestão. Só o admin do cliente
 * (`app.baixar`) e o super-admin; a licença do módulo que usa o app é conferida no domain. A URL assinada nunca vai a auditoria
 * nem a log. Sem S3, o SDK responde 503 `ARMAZENAMENTO_INDISPONIVEL`.
 */
import { ErroHttpModulo, erroArmazenamentoIndisponivel } from '@macuxi/platform-sdk';
import { CODIGO_APP_SEM_LICENCA, CODIGO_APP_SEM_PACOTE, LinkDownloadAppRequestSchema, LinkDownloadAppSchema } from '../contracts';
import { podeBaixarApp } from '../domain';
export const rotaDownloadApp = {
    metodo: 'POST',
    caminho: 'apps/download',
    superficie: 'bko',
    acao: 'app.baixar',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    semCache: true,
    status: 200,
    corpo: LinkDownloadAppRequestSchema,
    executar: async (ctx) => {
        const { variante } = ctx.corpo;
        return LinkDownloadAppSchema.parse(await linkDoApp(ctx, variante, 'core.app_download_link'));
    },
};
/** RN-CORE-67: a licença é da EMPRESA (tenant_modulo, que o Core licencia), não dos módulos do perfil do usuário. */
export async function empresaPodeBaixarApp(ctx, variante) {
    const ativos = await ctx.comTenant(async (db) => (await db.query('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null')).rows.map((r) => r.modulo));
    return podeBaixarApp(variante, ativos);
}
/**
 * Link temporário do último APK da variante, com a licença da empresa (RN-CORE-67) e a auditoria SEM a URL. Serve ao portal
 * (`apps/download`) e ao próprio app (`app/apk`, T-0195). Sem S3 = 503; sem pacote = 404.
 */
export async function linkDoApp(ctx, variante, acaoAuditoria) {
    if (!(await empresaPodeBaixarApp(ctx, variante))) {
        throw new ErroHttpModulo(403, CODIGO_APP_SEM_LICENCA, 'Este app não está licenciado para a empresa. Peça ao suporte para ativar o módulo.');
    }
    if (!ctx.pacotes)
        throw erroArmazenamentoIndisponivel();
    const link = await ctx.pacotes.linkDoUltimo(variante);
    if (!link)
        throw new ErroHttpModulo(404, CODIGO_APP_SEM_PACOTE, 'O app ainda não foi publicado. Avise o suporte.');
    await ctx.comTenant(async (_db, tx) => {
        await tx.auditar({ acao: acaoAuditoria, entidade: 'app_pacote', entidade_id: null, depois: { variante, versao: link.versao, arquivo: link.arquivo } });
    });
    return { ...link, variante };
}
export const rotasDeAppsDownload = [rotaDownloadApp];
