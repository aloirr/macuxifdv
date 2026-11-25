/**
 * "Trocar a senha" no menu do usuário do portal (v1.0.34 e v1.0.35; R-20261124-083356 e R-20261124-191902, ADR 0075). O time Macuxi
 * e o admin do cliente com a empresa escolhida usam a mesma rota, com o token do portal: `POST /v1/plataforma/auth/senha`
 * (`TrocarSenhaPortalSchema` `{ senha_atual, senha_nova }`); a sessão diz quem é. 204 derruba todas as sessões da pessoa, inclusive
 * esta, e a entrada mostra "Senha trocada. Entre de novo." (sem o "Sua sessão terminou"). Erros da rota fora da tabela do Core:
 * 423 `BLOQUEADO` (minutos restantes) e 409 `SENHA_MUDOU`.
 */
import { CODIGOS_PORTAL, erroDaTrocaVoluntaria, mensagemBloqueioPorTentativas, type ErroDaTrocaVoluntaria } from '@macuxi/core/contracts';
import { TrocarSenhaPortalSchema } from '@macuxi/platform-sdk';

import { chamarPortal, ErroPortal } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';
import { guardarAvisoPortal, limparSessaoPortal, marcarSaidaPedida, MENSAGEM_SENHA_TROCADA_ENTRE, type SessaoPortal } from './portal-sessao';

/** Texto da recusa que só a rota do portal tem (a tabela do Core cobre o resto). */
export const TEXTOS_TROCA_PORTAL = Object.freeze({
  senhaMudou: 'A senha mudou enquanto você a trocava. Saia, entre de novo e repita a troca.',
});

/** Time Macuxi sempre; admin do cliente só com a empresa escolhida (sem ela, a API responde 403 `EMPRESA_NAO_PERMITIDA`). */
export function podeTrocarSenhaNoPortal(s: SessaoPortal | null | undefined): s is SessaoPortal {
  return !!s && (s.tipo === 'super_admin' || !!s.empresa);
}

/** Troca a senha; a sessão do portal sai e a entrada mostra o aviso. Erro da API: lança o `ErroPortal`. */
export async function trocarSenhaNoPortal(c: { senha_atual: string; senha_nova: string }): Promise<void> {
  const corpo = TrocarSenhaPortalSchema.parse({ senha_atual: c.senha_atual, senha_nova: c.senha_nova });
  await chamarPortal(ROTAS_PORTAL.trocarSenha, { metodo: 'POST', corpo });
  // a API já revogou a sessão: a guarda leva à entrada com o aviso, sem o "Sua sessão terminou"
  marcarSaidaPedida();
  guardarAvisoPortal(MENSAGEM_SENHA_TROCADA_ENTRE);
  limparSessaoPortal();
}

/** Resposta de erro da troca no portal → o aviso da gaveta (mesmo formato da tabela do Core). */
export function erroDaTrocaNoPortal(e: unknown, senhaNova?: string): ErroDaTrocaVoluntaria {
  if (e instanceof ErroPortal) {
    if (e.status === 423 && e.codigo === CODIGOS_PORTAL.bloqueado) return { texto: mensagemBloqueioPorTentativas(e.detalhes?.minutos_restantes), tom: 'danger', acao: 'ficar' };
    if (e.codigo === CODIGOS_PORTAL.senhaMudou) return { texto: TEXTOS_TROCA_PORTAL.senhaMudou, tom: 'danger', acao: 'ficar' };
  }
  return erroDaTrocaVoluntaria(e, senhaNova);
}
