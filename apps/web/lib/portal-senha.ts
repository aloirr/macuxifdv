/**
 * "Trocar a senha" no menu do usuário do portal (v1.0.34; R-20261124-083356 e R-20261124-191902, ADR 0075). Dois caminhos:
 * - Time Macuxi (super-admin): `POST /v1/plataforma/auth/senha` (`TrocarSenhaPortalSchema` `{ senha_atual, senha_nova }`) com o
 *   token do portal; a sessão diz quem é. 204 derruba a sessão do portal. Erros da rota: 423 `BLOQUEADO` (minutos restantes), 409
 *   `SENHA_MUDOU` e 403 `TROCA_SO_SUPER_ADMIN` (a rota recusa o admin do cliente; não deve ocorrer, a tela não manda o admin por ela).
 * - Admin do cliente (como no 01a): rota pública do Core (`POST /v1/auth/senha/trocar`, RN-CORE-32 e RN-CORE-34) com o código da
 *   empresa escolhida e o e-mail digitado (a sessão do portal não traz o e-mail). Vai no modo cookie (`CABECALHOS_SESSAO_WEB`): a
 *   resposta não traz o token de renovação, e o transporte do portal não guarda cookie (`credentials: 'omit'`), então a sessão do
 *   tenant que a troca abre não fica com ninguém. A troca revoga as sessões do usuário, e a do portal leva a versão da sessão dele:
 *   se a renovação for recusada, a pessoa volta à entrada com o aviso.
 * Nos dois, a entrada mostra "Senha trocada. Entre de novo." (sem o "Sua sessão terminou").
 */
import { CODIGOS_PORTAL, erroDaTrocaVoluntaria, mensagemBloqueioPorTentativas, type ErroDaTrocaVoluntaria } from '@macuxi/core/contracts';
import { TrocarSenhaPortalSchema } from '@macuxi/platform-sdk';
import { CABECALHOS_SESSAO_WEB } from '@macuxi/platform-sdk/web';

import { chamarPortal, ErroPortal, renovarSessaoPortal } from './portal-api';
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

/** Texto da recusa que só a rota do portal tem (a tabela do Core cobre o resto). */
export const TEXTOS_TROCA_PORTAL = Object.freeze({
  senhaMudou: 'A senha mudou enquanto você a trocava. Saia, entre de novo e repita a troca.',
});

/** Time Macuxi sempre; admin do cliente só com a empresa escolhida (o código dela vai no pedido). */
export function podeTrocarSenhaNoPortal(s: SessaoPortal | null | undefined): s is SessaoPortal {
  return !!s && (s.tipo === 'super_admin' || !!s.empresa);
}

/** Corpo da rota pública do admin: o código da empresa da sessão, o e-mail digitado (sem espaços nas pontas) e as senhas como vieram. */
export function corpoDaTrocaNoPortal(s: SessaoPortal & { empresa: { codigo: string } }, c: { email: string; senha_atual: string; senha_nova: string }) {
  return { codigo_empresa: s.empresa.codigo, email: c.email.trim(), senha_atual: c.senha_atual, senha_nova: c.senha_nova, app: 'web' as const };
}

/**
 * Troca a senha; `continua` = a sessão do portal segue; `entrar_de_novo` = a sessão saiu e a entrada mostra o aviso. Erro da API:
 * lança o `ErroPortal`. O admin do cliente manda o e-mail (`c.email`); o super-admin, não.
 */
export async function trocarSenhaNoPortal(s: SessaoPortal, c: { email?: string; senha_atual: string; senha_nova: string }): Promise<'continua' | 'entrar_de_novo'> {
  if (s.tipo === 'super_admin') {
    const corpo = TrocarSenhaPortalSchema.parse({ senha_atual: c.senha_atual, senha_nova: c.senha_nova });
    await chamarPortal(ROTAS_PORTAL.trocarSenhaSuperAdmin, { metodo: 'POST', corpo });
    // a API já revogou a sessão: a guarda leva à entrada com o aviso, sem o "Sua sessão terminou"
    marcarSaidaPedida();
    guardarAvisoPortal(MENSAGEM_SENHA_TROCADA_ENTRE);
    limparSessaoPortal();
    return 'entrar_de_novo';
  }
  if (!s.empresa) throw new Error('sem empresa na sessão');
  const corpo = corpoDaTrocaNoPortal({ ...s, empresa: s.empresa }, { email: c.email ?? '', senha_atual: c.senha_atual, senha_nova: c.senha_nova });
  await chamarPortal(ROTAS_PORTAL.trocarSenha, { metodo: 'POST', corpo, cabecalhos: CABECALHOS_SESSAO_WEB });
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

/** Resposta de erro da troca no portal → o aviso da gaveta (mesmo formato da tabela do Core). */
export function erroDaTrocaNoPortal(e: unknown, senhaNova?: string): ErroDaTrocaVoluntaria {
  if (e instanceof ErroPortal) {
    if (e.status === 423 && e.codigo === CODIGOS_PORTAL.bloqueado) return { texto: mensagemBloqueioPorTentativas(e.detalhes?.minutos_restantes), tom: 'danger', acao: 'ficar' };
    if (e.codigo === CODIGOS_PORTAL.senhaMudou) return { texto: TEXTOS_TROCA_PORTAL.senhaMudou, tom: 'danger', acao: 'ficar' };
    // a mensagem que a API (Core) mandou; sem ela, o texto padrão do portal (`lerErroDaApi`)
    if (e.status === 403 && e.codigo === CODIGOS_PORTAL.trocaSoSuperAdmin) return { texto: e.message, tom: 'danger', acao: 'ficar' };
  }
  return erroDaTrocaVoluntaria(e, senhaNova);
}
