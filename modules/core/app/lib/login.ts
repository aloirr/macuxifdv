/**
 * Login real do app (RF-CORE-01): código da empresa + e-mail + senha. Regras puras (validação e mensagens em
 * português com a ação seguinte) + a chamada de `POST /v1/auth/login`, que o shell liga ao transporte HTTP.
 * O código da empresa fica salvo no aparelho depois do primeiro login (doc 03, esclarecimentos).
 * Senha e token nunca vão para log, nem para o armazenamento do módulo (o shell guarda o token em área segura).
 */
import { ehSemConexao, type AppComLogin } from '@macuxi/platform-sdk';
import { AVISO_APARELHO_LIMPO, CODIGO_DISPOSITIVO_BLOQUEADO, CODIGOS_AUTH, LoginSenhaRequestSchema, validarLogin, type CamposLogin, type ErrosLogin, MENSAGEM_SENHA_A_TROCAR, MENSAGEM_SENHA_VENCIDA, SessaoRespostaSchema, type LoginSenhaRequest, type SessaoResposta } from '../../contracts';
import { ESCONDER_SENHA, MOSTRAR_SENHA } from '@macuxi/ui/mobile/puro';
import { tolerante } from './leitor-tolerante';

export { validarLogin, type CamposLogin, type ErrosLogin };

/** Campos com que a TelaLogin abre: código lembrado do aparelho e e-mail devolvido pelo shell (volta de "Crie sua senha"/"Esqueci a senha"). A senha nunca volta. */
export function camposIniciaisDoLogin(codigoSalvo?: string | null, emailInicial?: string | null): CamposLogin {
  return { codigo_empresa: codigoSalvo ?? '', email: emailInicial ?? '', senha: '' };
}

/** Códigos que o shell/SDK usam quando o endereço respondeu, mas não é um servidor Macuxi (ou a resposta não bate com o contrato). */
export const CODIGOS_SERVIDOR_INVALIDO = ['SERVIDOR_INVALIDO', 'RESPOSTA_INVALIDA'] as const;

/** Resposta que não é de um servidor Macuxi: código dedicado, falha de contrato (Zod) ou 404/405 sem código da API. */
export function ehServidorInvalido(e: unknown): boolean {
  const x = e as { codigo?: unknown; name?: unknown; status?: unknown } | null;
  if (typeof x?.codigo === 'string' && (CODIGOS_SERVIDOR_INVALIDO as readonly string[]).includes(x.codigo)) return true;
  if (x?.name === 'ZodError') return true;
  return (x?.status === 404 || x?.status === 405) && typeof x?.codigo !== 'string';
}

/** Mensagem para o usuário a partir do erro da API (códigos de `CODIGOS_AUTH`) ou de rede. Três casos distintos de conexão/servidor/credencial. */
export function mensagemDeErroDeLogin(e: unknown): string {
  if (ehSemConexao(e)) return 'Sem conexão ou o servidor não respondeu. Confira a internet e o endereço do servidor e tente de novo.';
  if (ehServidorInvalido(e)) return 'Este endereço não é um servidor Macuxi. Confira o endereço em Servidor, teste de novo e só então entre.';
  const x = e as { codigo?: unknown; message?: unknown } | null;
  switch (x?.codigo) {
    case CODIGOS_AUTH.credenciais:
      return 'Código da empresa, e-mail ou senha incorretos. Confira os dados e tente de novo.';
    case CODIGOS_AUTH.bloqueado:
      return 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou tente de novo mais tarde.';
    case CODIGO_DISPOSITIVO_BLOQUEADO:
      return AVISO_APARELHO_LIMPO;
    case CODIGOS_AUTH.muitasTentativas:
      return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    case CODIGOS_AUTH.sessao:
      return 'Sua sessão expirou. Entre de novo com o código da empresa, o e-mail e a senha.';
    case CODIGOS_AUTH.senhaVencida:
      return MENSAGEM_SENHA_VENCIDA;
    case CODIGOS_AUTH.senhaATrocar:
      // o app novo navega para "Crie sua senha" pelo código (senha.ts); este texto é só a rede de segurança
      return MENSAGEM_SENHA_A_TROCAR;
    case 'PERFIL_FORA_DO_APP':
      return typeof x?.message === 'string' && x.message ? x.message : 'Este perfil não usa este aplicativo. Use o aplicativo ou o painel indicado pela sua empresa.';
    case 'AUTENTICACAO_INDISPONIVEL':
      return 'O login está indisponível no momento. Tente de novo em alguns minutos; se continuar, avise o suporte.';
    default:
      return 'Não foi possível entrar agora. Tente de novo; se continuar, avise o suporte.';
  }
}

/**
 * Propriedades do campo Senha do login: o teclado não pode pôr maiúscula, corrigir nem sugerir (a senha temporária mistura
 * maiúsculas e minúsculas; um primeiro caractere trocado vira "senha incorreta" com os dados certos). Igual ao "Crie sua senha".
 */
export const propsDoCampoSenhaDoLogin = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'current-password',
  textContentType: 'password',
} as const;

/** Rótulo acessível do botão de olho da senha. */
export function rotuloOlhoSenha(visivel: boolean): string {
  return visivel ? ESCONDER_SENHA : MOSTRAR_SENHA;
}

/** Transporte sem token (o shell entrega): POST do corpo no caminho `/auth/login` da API v1. */
export type PostSemSessao = (caminho: string, corpo: unknown) => Promise<unknown>;

/**
 * Entra com a senha. Valida a resposta (contrato) antes de devolver; o shell guarda tokens e abre o app. `app` (RN-CORE-33): a
 * variante do shell (`campo` ou `gestao`); a API recusa o perfil de outro app (403 `PERFIL_FORA_DO_APP`) sem abrir sessão.
 * `SENHA_A_TROCAR` (403) sobe como erro: o shell navega para a "Crie sua senha" (`detalhesDaTroca`, senha.ts).
 */
export async function entrarComSenha(post: PostSemSessao, campos: CamposLogin, aparelho: { id?: string; nome?: string } = {}, app?: AppComLogin): Promise<SessaoResposta> {
  const corpo: LoginSenhaRequest = LoginSenhaRequestSchema.parse({
    codigo_empresa: campos.codigo_empresa.trim(),
    email: campos.email.trim(),
    senha: campos.senha,
    ...(aparelho.id ? { dispositivo_id: aparelho.id } : {}),
    ...(aparelho.nome ? { dispositivo_nome: aparelho.nome } : {}),
    ...(app ? { app } : {}),
  });
  return tolerante(SessaoRespostaSchema).parse(await post('/auth/login', corpo));
}
