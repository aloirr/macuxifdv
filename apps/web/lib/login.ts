/**
 * Regras puras do login do BKO (T-0003 F2): validação campo a campo e mensagem a partir do erro da API, em português
 * e com a ação seguinte. Mesmos textos da tela do app (`modules/core/app/lib/login.ts`); quando o Core exportar essas
 * funções num caminho sem React Native, o BKO passa a usá-las (recado ao modulo-core).
 */
import { CODIGOS_AUTH } from '@macuxi/core/contracts';
import { CODIGO_PERFIL_FORA_DO_APP } from '@macuxi/platform-sdk';

export interface CamposLogin {
  codigo_empresa: string;
  email: string;
  senha: string;
}

/** Código da empresa lembrado no navegador depois do primeiro login (doc 03, esclarecimentos). */
export const CHAVE_CODIGO_EMPRESA = 'macuxi.web.codigo_empresa';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODIGO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/;

export function validarCampos(c: CamposLogin): Partial<Record<keyof CamposLogin, string>> {
  const erros: Partial<Record<keyof CamposLogin, string>> = {};
  if (!c.codigo_empresa.trim()) erros.codigo_empresa = 'Informe o código da empresa (quem administra o sistema na sua empresa sabe qual é).';
  else if (!CODIGO_RE.test(c.codigo_empresa.trim())) erros.codigo_empresa = 'O código da empresa tem só letras, números e hífen. Confira e digite de novo.';
  if (!c.email.trim()) erros.email = 'Informe o seu e-mail.';
  else if (!EMAIL_RE.test(c.email.trim())) erros.email = 'Esse e-mail não parece certo. Confira e digite de novo.';
  if (!c.senha) erros.senha = 'Informe a sua senha.';
  return erros;
}

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
      return 'Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.';
    // RN-CORE-33: a API diz onde entrar (`mensagemPerfilForaDoApp` do SDK)
    case CODIGO_PERFIL_FORA_DO_APP:
      return fraseDaApi(x.message) ?? 'Seu perfil não tem acesso ao backoffice.';
    case 'AUTENTICACAO_INDISPONIVEL':
      return 'O login está indisponível no momento. Tente de novo em alguns minutos; se continuar, avise o suporte.';
    default:
      return 'Não foi possível entrar agora. Tente de novo; se continuar, avise o suporte.';
  }
}
