/**
 * `POST conector/download` (T-0098, ADR 0037): devolve o link temporário do último instalador do Conector. Só o admin do cliente
 * (`conector.gerenciar`) e o super-admin (ADR 0029/0031); a plataforma confere a licença do módulo. Cada pedido fica auditado
 * com versão e arquivo; a URL assinada nunca vai a auditoria, log nem detalhes. Sem S3, o SDK responde 503 `ARMAZENAMENTO_INDISPONIVEL`.
 */
import { ErroHttpModulo, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { CODIGO_CONECTOR_SEM_PACOTE, LinkDownloadConectorSchema, type LinkDownloadConector } from '../contracts';

export const rotaDownloadConector: RotaModulo = {
  metodo: 'POST',
  caminho: 'conector/download',
  acao: 'conector.gerenciar',
  superAdmin: 'aceita',
  carteira: 'nao_se_aplica',
  status: 200,
  executar: async (ctx: ContextoRota): Promise<LinkDownloadConector> => {
    if (!ctx.pacotes) throw new ErroHttpModulo(503, 'ARMAZENAMENTO_INDISPONIVEL', 'O download não está disponível neste servidor agora. Tente de novo em instantes ou avise o suporte.');
    const link = await ctx.pacotes.linkDoUltimo('conector');
    if (!link) throw new ErroHttpModulo(404, CODIGO_CONECTOR_SEM_PACOTE, 'O instalador do Conector ainda não foi publicado.');
    await ctx.comTenant(async (_db, tx) => {
      await tx.auditar({ acao: 'conector.download_link', entidade: 'conector_pacote', entidade_id: null, depois: { versao: link.versao, arquivo: link.arquivo } });
    });
    return LinkDownloadConectorSchema.parse(link);
  },
};
