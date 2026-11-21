/**
 * `POST apps/download` (T-0190, RN-CORE-67, ADR 0065): link temporário do último APK do Campo ou do Gestão. Só o admin do cliente
 * (`app.baixar`) e o super-admin; a licença do módulo que usa o app é conferida no domain. A URL assinada nunca vai a auditoria
 * nem a log. Sem S3, o SDK responde 503 `ARMAZENAMENTO_INDISPONIVEL`.
 */
import { ErroHttpModulo, erroArmazenamentoIndisponivel, type ContextoRota, type ModuloId, type RotaModulo } from '@macuxi/platform-sdk';
import { CODIGO_APP_SEM_LICENCA, CODIGO_APP_SEM_PACOTE, LinkDownloadAppRequestSchema, LinkDownloadAppSchema, type LinkDownloadApp, type LinkDownloadAppRequest } from '../contracts';
import { podeBaixarApp } from '../domain';

export const rotaDownloadApp: RotaModulo = {
  metodo: 'POST',
  caminho: 'apps/download',
  superficie: 'bko',
  acao: 'app.baixar',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  semCache: true,
  status: 200,
  corpo: LinkDownloadAppRequestSchema,
  executar: async (ctx: ContextoRota): Promise<LinkDownloadApp> => {
    const { variante } = ctx.corpo as LinkDownloadAppRequest;
    // RN-CORE-67: a licença é da EMPRESA (tenant_modulo, que o Core licencia), não dos módulos do perfil do usuário.
    const ativos = await ctx.comTenant(async (db) => (await db.query<{ modulo: ModuloId }>('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null')).rows.map((r) => r.modulo));
    if (!podeBaixarApp(variante, ativos)) {
      throw new ErroHttpModulo(403, CODIGO_APP_SEM_LICENCA, 'Este app não está licenciado para a empresa. Peça ao suporte para ativar o módulo.');
    }
    if (!ctx.pacotes) throw erroArmazenamentoIndisponivel();
    const link = await ctx.pacotes.linkDoUltimo(variante);
    if (!link) throw new ErroHttpModulo(404, CODIGO_APP_SEM_PACOTE, 'O app ainda não foi publicado. Avise o suporte.');
    await ctx.comTenant(async (_db, tx) => {
      await tx.auditar({ acao: 'core.app_download_link', entidade: 'app_pacote', entidade_id: null, depois: { variante, versao: link.versao, arquivo: link.arquivo } });
    });
    return LinkDownloadAppSchema.parse({ ...link, variante });
  },
};

export const rotasDeAppsDownload: RotaModulo[] = [rotaDownloadApp];
