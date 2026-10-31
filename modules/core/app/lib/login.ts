/**
 * Login real do app (RF-CORE-01): código da empresa + e-mail + senha. Regras puras (validação e mensagens em
 * português com a ação seguinte) + a chamada de `POST /v1/auth/login`, que o shell liga ao transporte HTTP.
 * O código da empresa fica salvo no aparelho depois do primeiro login (doc 03, esclarecimentos).
 * Senha e token nunca vão para log, nem para o armazenamento do módulo (o shell guarda o token em área segura).
 */
import { ehSemConexao } from '@macuxi/platform-sdk';
import { CODIGOS_AUTH, LoginSenhaRequestSchema, SessaoRespostaSchema, type LoginSenhaRequest, type SessaoResposta } from '../../contracts';

export interface CamposLogin {
  codigo_empresa: string;
  email: string;
  senha: string;
}

export type ErrosLogin = Partial<Record<keyof CamposLogin, string>>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODIGO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/;

/** Validação antes de enviar (campo a campo, com a ação seguinte). Vazio = pode enviar. */
export function validarLogin(c: CamposLogin): ErrosLogin {
  const erros: ErrosLogin = {};
  if (!c.codigo_empresa.trim()) erros.codigo_empresa = 'Informe o código da empresa (quem administra o sistema na sua empresa sabe qual é).';
  else if (!CODIGO_RE.test(c.codigo_empresa.trim())) erros.codigo_empresa = 'O código da empresa tem só letras, números e hífen. Confira e digite de novo.';
  if (!c.email.trim()) erros.email = 'Informe o seu e-mail.';
  else if (!EMAIL_RE.test(c.email.trim())) erros.email = 'Esse e-mail não parece certo. Confira e digite de novo.';
  if (!c.senha) erros.senha = 'Informe a sua senha.';
  return erros;
}

/** Mensagem para o usuário a partir do erro da API (códigos de `CODIGOS_AUTH`) ou de rede. */
export function mensagemDeErroDeLogin(e: unknown): string {
  if (ehSemConexao(e)) return 'Sem conexão com o servidor. O primeiro login precisa de internet: conecte-se e tente de novo.';
  const x = e as { codigo?: unknown } | null;
  switch (x?.codigo) {
    case CODIGOS_AUTH.credenciais:
      return 'Código da empresa, e-mail ou senha incorretos. Confira os dados e tente de novo.';
    case CODIGOS_AUTH.bloqueado:
      return 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou tente de novo mais tarde.';
    case CODIGOS_AUTH.muitasTentativas:
      return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    case CODIGOS_AUTH.sessao:
      return 'Sua sessão expirou. Entre de novo com o código da empresa, o e-mail e a senha.';
    case 'AUTENTICACAO_INDISPONIVEL':
      return 'O login está indisponível no momento. Tente de novo em alguns minutos; se continuar, avise o suporte.';
    default:
      return 'Não foi possível entrar agora. Tente de novo; se continuar, avise o suporte.';
  }
}

/** Transporte sem token (o shell entrega): POST do corpo no caminho `/auth/login` da API v1. */
export type PostSemSessao = (caminho: string, corpo: unknown) => Promise<unknown>;

/** Entra com a senha. Valida a resposta (contrato) antes de devolver; o shell guarda tokens e abre o app. */
export async function entrarComSenha(post: PostSemSessao, campos: CamposLogin, aparelho: { id?: string; nome?: string } = {}): Promise<SessaoResposta> {
  const corpo: LoginSenhaRequest = LoginSenhaRequestSchema.parse({
    codigo_empresa: campos.codigo_empresa.trim(),
    email: campos.email.trim(),
    senha: campos.senha,
    ...(aparelho.id ? { dispositivo_id: aparelho.id } : {}),
    ...(aparelho.nome ? { dispositivo_nome: aparelho.nome } : {}),
  });
  return SessaoRespostaSchema.parse(await post('/auth/login', corpo));
}
