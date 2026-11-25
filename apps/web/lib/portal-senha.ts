/**
 * "Trocar a senha" do admin do cliente no menu do usuário do portal (v1.0.34; R-20261124-083356). Rota pública do Core
 * (`POST /v1/auth/senha/trocar`, RN-CORE-32 e RN-CORE-34) com o código da empresa da sessão e o e-mail digitado (a sessão do
 * portal não traz o e-mail). Vai no modo cookie (`CABECALHOS_SESSAO_WEB`): a resposta não traz o token de renovação, e o
 * transporte do portal não guarda cookie (`credentials: 'omit'`), então a sessão do tenant que a troca abre não fica com ninguém.
 * A troca revoga as sessões do usuário, e a do portal leva a versão da sessão dele: se a renovação for recusada, a pessoa volta à
 * entrada com "Senha trocada. Entre de novo." (sem o "Sua sessão terminou").
 * O time Macuxi (super-admin) não tem esta opção nesta versão: não há rota de troca para ele.
 */
import { CABECALHOS_SESSAO_WEB } from '@macuxi/platform-sdk/web';

import { chamarPortal, renovarSessaoPortal } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';
import {
  consumirAvisoPortal,
  guardarAvisoPortal,
  limparSessaoPortal,
  marcarSaidaPedida,
  MENSAGEM_SENHA_TROCADA_ENTRE,
  retirarSaidaPedida,
  type SessaoPortal,
} from './portal-sessao';

/** O admin do cliente com uma empresa escolhida pode trocar a senha (o código da empresa vai no pedido). */
export function podeTrocarSenhaNoPortal(s: SessaoPortal | null | undefined): s is SessaoPortal & { empresa: NonNullable<SessaoPortal['empresa']> } {
  return !!s && s.tipo === 'admin_cliente' && !!s.empresa;
}

/** Corpo do pedido: o código da empresa da sessão, o e-mail digitado (sem espaços nas pontas) e as senhas como vieram. */
export function corpoDaTrocaNoPortal(s: SessaoPortal & { empresa: { codigo: string } }, c: { email: string; senha_atual: string; senha_nova: string }) {
  return { codigo_empresa: s.empresa.codigo, email: c.email.trim(), senha_atual: c.senha_atual, senha_nova: c.senha_nova, app: 'web' as const };
}

/** Troca a senha; `continua` = a sessão do portal segue; `entrar_de_novo` = a sessão saiu e a entrada mostra o aviso. */
export async function trocarSenhaNoPortal(s: SessaoPortal, c: { email: string; senha_atual: string; senha_nova: string }): Promise<'continua' | 'entrar_de_novo'> {
  if (!podeTrocarSenhaNoPortal(s)) throw new Error('sem empresa na sessão');
  await chamarPortal(ROTAS_PORTAL.trocarSenha, { metodo: 'POST', corpo: corpoDaTrocaNoPortal(s, c), cabecalhos: CABECALHOS_SESSAO_WEB });
  // se a renovação for recusada (sessão revogada), a guarda leva à entrada já com o aviso e sem o "Sua sessão terminou"
  marcarSaidaPedida();
  guardarAvisoPortal(MENSAGEM_SENHA_TROCADA_ENTRE);
  const nova = await renovarSessaoPortal();
  if (nova) {
    retirarSaidaPedida();
    consumirAvisoPortal();
    return 'continua';
  }
  limparSessaoPortal();
  return 'entrar_de_novo';
}
