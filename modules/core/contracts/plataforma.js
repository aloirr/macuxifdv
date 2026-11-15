import { EmpresaDoAcessoSchema, EscolherEmpresaPortalSchema, LoginPortalSchema, SessaoPortalSchema } from '@macuxi/platform-sdk';
export { EmpresaDoAcessoSchema, EscolherEmpresaPortalSchema, LoginPortalSchema, SessaoPortalSchema };
/** Códigos de erro das rotas `plataforma/auth/*` (a tela decide a mensagem e a volta pelo código). */
export const CODIGOS_PORTAL = {
    /** 401: e-mail ou senha errados (mesma resposta e mesmo tempo para e-mail inexistente). */
    credenciais: 'CREDENCIAIS_INVALIDAS',
    /** 423: 5 falhas seguidas, 15 min (também para e-mail que não existe). */
    bloqueado: 'BLOQUEADO',
    /** 401: token de plataforma ausente, vencido ou de sessão encerrada. */
    sessao: 'SESSAO_PLATAFORMA_INVALIDA',
    /** 503: falta o segredo do portal no ambiente (falha fechada). */
    indisponivel: 'PORTAL_INDISPONIVEL',
    /** 403: empresa fora da lista da sessão, ou `x-macuxi-tenant` diferente da empresa escolhida. */
    empresaNaoPermitida: 'EMPRESA_NAO_PERMITIDA',
    /** 409: admin do cliente com 2+ empresas que ainda não escolheu uma. */
    empresaNaoEscolhida: 'EMPRESA_NAO_ESCOLHIDA',
    /** 403 (T-0094, RN-CORE-34): a senha conferiu, mas o admin ainda tem senha temporária; a troca é no backoffice (BKO). */
    senhaATrocar: 'SENHA_A_TROCAR',
};
export const MENSAGEM_PORTAL_SENHA_A_TROCAR = 'Antes de entrar no portal, crie a sua senha no backoffice com o código da empresa.';
