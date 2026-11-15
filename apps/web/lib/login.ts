/**
 * Regras puras do login do BKO (T-0003 F2): mensagem a partir do erro da API, em português e com a ação seguinte. A
 * validação campo a campo é a `validarLoginNovo` da fonte única do Core (`@macuxi/core/contracts`, RD-0020), a mesma do app.
 */
import { CODIGOS_AUTH, TEXTOS_LOGIN_SENHA } from '@macuxi/core/contracts';
import { CODIGO_PERFIL_FORA_DO_APP } from '@macuxi/platform-sdk';

/** Código da empresa lembrado no navegador depois do primeiro login (doc 03, esclarecimentos). */
export const CHAVE_CODIGO_EMPRESA = 'macuxi.web.codigo_empresa';

/** Frase da API que serve para a tela (nem JSON nem pilha). */
function fraseDaApi(m: unknown): string | null {
  const t = typeof m === 'string' ? m.trim() : '';
  return t && !t.startsWith('{') && !t.startsWith('[') && !/\n\s+at\s/.test(t) ? t : null;
}

/** Erro da API (`ApiRequestError`: `status`, `code`) ou de rede (status 0) → mensagem para o usuário. */
export function mensagemDoLogin(e: unknown): string {
  const x = (e ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  if (x.status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  switch (x.code) {
    case CODIGOS_AUTH.credenciais:
      return 'Código da empresa, e-mail ou senha incorretos. Confira os dados e tente de novo.';
    case CODIGOS_AUTH.bloqueado:
      return 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou tente de novo mais tarde.';
    case CODIGOS_AUTH.muitasTentativas:
      return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    // T-0094 (spec ciclo-de-senha §1): a temporária passou de 72 h; o link "Esqueci a senha" fica logo abaixo
    case CODIGOS_AUTH.senhaVencida:
      return TEXTOS_LOGIN_SENHA.senhaVencida;
    // RN-CORE-33: a API diz onde entrar (`mensagemPerfilForaDoApp` do SDK)
    case CODIGO_PERFIL_FORA_DO_APP:
      return fraseDaApi(x.message) ?? TEXTOS_LOGIN_SENHA.semBko;
    case 'AUTENTICACAO_INDISPONIVEL':
      return 'O login está indisponível no momento. Tente de novo em alguns minutos; se continuar, avise o suporte.';
    default:
      return 'Não foi possível entrar agora. Tente de novo; se continuar, avise o suporte.';
  }
}
