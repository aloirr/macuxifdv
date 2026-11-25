/**
 * Contratos do acesso ao portal de implantação no Core (T-0093; ADR 0031; RN-CORE-32/33; desenho docs/desenho/T-0093.md §5).
 * Entrada só com e-mail e senha: o super-admin vê todas as empresas e o admin do cliente escolhe a dele.
 * Os schemas Zod das rotas públicas `POST /v1/plataforma/auth/*` moram no `platform-sdk` (a API e o portal compartilham);
 * aqui ficam reexportados com os tipos e os códigos de erro que a tela trata pelo código.
 * Nada disto vai a log: e-mail, senha e token só trafegam no corpo.
 */
import type { z } from 'zod';
import { EmpresaDoAcessoSchema, EscolherEmpresaPortalSchema, LoginPortalSchema, SessaoPortalSchema, TrocarSenhaPortalSchema } from '@macuxi/platform-sdk';

export { EmpresaDoAcessoSchema, EscolherEmpresaPortalSchema, LoginPortalSchema, SessaoPortalSchema, TrocarSenhaPortalSchema };

export type TrocarSenhaPortal = z.output<typeof TrocarSenhaPortalSchema>;
export type LoginPortal = z.output<typeof LoginPortalSchema>;
export type SessaoPortal = z.output<typeof SessaoPortalSchema>;
export type EmpresaDoAcesso = z.output<typeof EmpresaDoAcessoSchema>;
export type EscolherEmpresaPortal = z.output<typeof EscolherEmpresaPortalSchema>;

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
  /** 409 (ADR 0075): a senha do super-admin mudou entre a conferência e a gravação; entre de novo e repita. */
  senhaMudou: 'SENHA_MUDOU',
  /** @deprecated A API não devolve mais este código (v1.0.35: o admin do cliente troca a senha pelo portal, 0107); fica até o `apps/web` (portal-falso, portal-senha) e os testes de `tests/` deixarem de citá-lo. */
  trocaSoSuperAdmin: 'TROCA_SO_SUPER_ADMIN',
} as const;

export const MENSAGEM_PORTAL_SENHA_A_TROCAR = 'Antes de entrar no portal, crie a sua senha no backoffice com o código da empresa.';
