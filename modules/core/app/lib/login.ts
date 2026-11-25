/**
 * Login real do app (RF-CORE-01): código da empresa + e-mail + senha. Regras puras (validação e mensagens em
 * português com a ação seguinte) + a chamada de `POST /v1/auth/login`, que o shell liga ao transporte HTTP.
 * O código da empresa fica salvo no aparelho depois do primeiro login (doc 03, esclarecimentos).
 * Senha e token nunca vão para log, nem para o armazenamento do módulo (o shell guarda o token em área segura).
 */
import { type AppComLogin } from '@macuxi/platform-sdk';
import { LoginSenhaRequestSchema, validarLoginNovo as validarLogin, type CamposLogin, type ErrosLogin, CODIGO_EMPRESA_TAMANHO, normalizarCodigoEmpresa, SessaoRespostaSchema, type LoginSenhaRequest, type SessaoResposta } from '../../contracts';
import { tolerante } from './leitor-tolerante';

export { validarLogin, type CamposLogin, type ErrosLogin };
export { ehServidorInvalido, mensagemDeErroDeLogin } from '../../contracts';

/** Campos com que a TelaLogin abre: código lembrado do aparelho e e-mail devolvido pelo shell (volta de "Crie sua senha"/"Esqueci a senha"). A senha nunca volta. */
export function camposIniciaisDoLogin(codigoSalvo?: string | null, emailInicial?: string | null): CamposLogin {
  return { codigo_empresa: codigoSalvo ?? '', email: emailInicial ?? '', senha: '' };
}

/** Propriedades do campo Código da empresa (login e "Esqueci a senha"): cabe só o código da licença, UF + 4 dígitos (ex.: AM4821). */
export const propsDoCampoCodigoEmpresa = { maxLength: CODIGO_EMPRESA_TAMANHO, autoCapitalize: 'characters', autoCorrect: false, spellCheck: false } as const;

/** Transporte sem token (o shell entrega): POST do corpo no caminho `/auth/login` da API v1. */
export type PostSemSessao = (caminho: string, corpo: unknown) => Promise<unknown>;

/**
 * Entra com a senha. Valida a resposta (contrato) antes de devolver; o shell guarda tokens e abre o app. `app` (RN-CORE-33): a
 * variante do shell (`campo` ou `gestao`); a API recusa o perfil de outro app (403 `PERFIL_FORA_DO_APP`) sem abrir sessão.
 * `SENHA_A_TROCAR` (403) sobe como erro: o shell navega para a "Crie sua senha" (`detalhesDaTroca`, senha.ts).
 */
export async function entrarComSenha(post: PostSemSessao, campos: CamposLogin, aparelho: { id?: string; nome?: string } = {}, app?: AppComLogin): Promise<SessaoResposta> {
  const corpo: LoginSenhaRequest = LoginSenhaRequestSchema.parse({
    codigo_empresa: normalizarCodigoEmpresa(campos.codigo_empresa),
    email: campos.email.trim(),
    senha: campos.senha,
    ...(aparelho.id ? { dispositivo_id: aparelho.id } : {}),
    ...(aparelho.nome ? { dispositivo_nome: aparelho.nome } : {}),
    ...(app ? { app } : {}),
  });
  return tolerante(SessaoRespostaSchema).parse(await post('/auth/login', corpo));
}
