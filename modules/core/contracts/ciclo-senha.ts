/**
 * Ciclo de senha, fonte única (T-0094; RD-0019/RD-0020; RN-CORE-32/33/34; docs/design/ciclo-de-senha.md §1 a §3). Funções puras,
 * textos em português e validação de login que o app (`modules/core/app/lib`) e o BKO (`apps/web/lib/ciclo-senha.ts`) importam, em
 * vez de cada um ter a sua cópia. Sem React e sem rede. Nada aqui registra senha ou e-mail.
 */
import { VALIDADE_SENHA_PROVISORIA_HORAS } from '@macuxi/platform-sdk';
import { CodigoEmpresaSchema, DetalhesSenhaATrocarSchema, type DetalhesSenhaATrocar } from './auth';
import { faltasNaSenha } from './senha';

/** Formato do e-mail (o mesmo da constraint `usuario_email_formato`). Troca por `ehEmail` de `@macuxi/comum` quando ele existir. */
export const EMAIL_FORMATO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const ehEmailValido = (email: string): boolean => EMAIL_FORMATO.test(email.trim());

/** Textos do login que o ciclo de senha usa. */
export const TEXTOS_LOGIN_SENHA = Object.freeze({
  esqueci: 'Esqueci a senha',
  senhaVencida: 'Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.',
  semBko: 'Seu perfil não tem acesso ao backoffice.',
});

/** "Crie sua senha" (spec §2), sem variação. */
export const TEXTOS_CRIE_SENHA = Object.freeze({
  titulo: 'Crie sua senha',
  primeiroAcesso: 'É o seu primeiro acesso. Crie uma senha só sua para continuar.',
  senhaTemporaria: 'Você entrou com uma senha temporária. Crie uma senha nova para continuar.',
  salvar: 'Salvar e entrar',
  salvando: 'Salvando…',
  voltar: 'Voltar ao login',
  igualAoEmail: 'A senha não pode ser igual ao e-mail.',
  repetiuATemporaria: 'A senha nova precisa ser diferente da senha que você recebeu.',
  naoValeMais: 'Esta senha não vale mais. Entre de novo.',
  semInternet: 'Conecte-se à internet para criar a sua senha.',
  criada: 'Senha criada.',
});

/** "Esqueci a senha" (spec §3). A confirmação é sempre a mesma, exista ou não o cadastro; a validade vem do SDK. */
export const TEXTOS_ESQUECI = Object.freeze({
  titulo: 'Esqueci a senha',
  instrucao: 'Informe o código da empresa e o seu e-mail. Vamos mandar uma senha temporária para o seu e-mail.',
  enviar: 'Enviar senha temporária',
  enviando: 'Enviando…',
  voltar: 'Voltar ao login',
  confirmacao: `Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por ${VALIDADE_SENHA_PROVISORIA_HORAS} horas.`,
  naoChegou: 'Não chegou? Confira o spam ou fale com o administrador da sua empresa.',
  vazio: 'Informe o código da empresa e o e-mail.',
  emailInvalido: 'Informe um e-mail válido, como nome@empresa.com.br.',
  semInternet: 'Conecte-se à internet para pedir uma senha temporária.',
  outro: 'Não foi possível pedir agora. Tente de novo em alguns minutos.',
});

/** O que a tela faz depois do erro da troca (spec §2). */
export type AcaoAposErroDaTroca = 'ficar' | 'destacar' | 'limpar' | 'voltar_ao_login';

interface ErroSolto {
  codigo?: unknown;
  code?: unknown;
  detalhes?: unknown;
  details?: unknown;
}
const comoErro = (e: unknown): ErroSolto => (e && typeof e === 'object' ? (e as ErroSolto) : {});
/** Código do erro da API, venha do SDK mobile (`codigo`) ou web (`code`). */
export const codigoDoErro = (e: unknown): unknown => comoErro(e).codigo ?? comoErro(e).code;
/** Detalhes do erro da API, venham do SDK mobile (`detalhes`) ou web (`details`). */
export const detalhesDoErro = (e: unknown): unknown => comoErro(e).detalhes ?? comoErro(e).details;

/** 403 `SENHA_A_TROCAR` do login → os detalhes (motivo e validade); `null` para qualquer outro erro. Detalhe estranho = senha temporária. */
export function detalhesDaTroca(e: unknown): DetalhesSenhaATrocar | null {
  if (codigoDoErro(e) !== 'SENHA_A_TROCAR') return null;
  const d = DetalhesSenhaATrocarSchema.safeParse(detalhesDoErro(e));
  return d.success ? d.data : { motivo: 'senha_temporaria', expira_em: null };
}
export const ehSenhaATrocar = (e: unknown): boolean => detalhesDaTroca(e) !== null;

export function subtituloDaTroca(motivo: DetalhesSenhaATrocar['motivo']): string {
  return motivo === 'primeiro_acesso' ? TEXTOS_CRIE_SENHA.primeiroAcesso : TEXTOS_CRIE_SENHA.senhaTemporaria;
}

export type RepeticaoDaSenha = 'vazia' | 'igual' | 'diferente';

/** A tela compara as duas senhas; o kit `RegrasDaSenha` não recebe senha nenhuma. */
export const repeticaoDaSenha = (nova: string, repetida: string): RepeticaoDaSenha => (repetida === '' ? 'vazia' : repetida === nova ? 'igual' : 'diferente');

/** Pode chamar a API? Só com a RN-CORE-32 cumprida e as duas digitações iguais. A API revalida tudo. */
export const trocaProntaParaEnviar = (nova: string, repetida: string): boolean => faltasNaSenha(nova).length === 0 && repeticaoDaSenha(nova, repetida) === 'igual';

/** `retry_after_s` → "em 1 minuto" / "em 3 minutos" (mínimo 1). */
export function textoDeEspera(retryAfterS: unknown): string {
  const n = typeof retryAfterS === 'number' && Number.isFinite(retryAfterS) ? Math.max(1, Math.ceil(retryAfterS / 60)) : 1;
  return n === 1 ? 'em 1 minuto' : `em ${n} minutos`;
}
export const textoDeMuitosPedidos = (retryAfterS: unknown): string => `Muitos pedidos seguidos. Tente de novo ${textoDeEspera(retryAfterS)}.`;

export interface CamposEsqueci {
  codigo_empresa: string;
  email: string;
}
export type ErrosEsqueci = Partial<Record<keyof CamposEsqueci, string>>;

/** Campo vazio e e-mail sem formato, com a frase do desenho. Vazio = pode enviar. */
export function validarEsqueci(c: CamposEsqueci): ErrosEsqueci {
  const erros: ErrosEsqueci = {};
  if (!c.codigo_empresa.trim() || !c.email.trim()) {
    if (!c.codigo_empresa.trim()) erros.codigo_empresa = TEXTOS_ESQUECI.vazio;
    if (!c.email.trim()) erros.email = TEXTOS_ESQUECI.vazio;
    return erros;
  }
  if (!ehEmailValido(c.email)) erros.email = TEXTOS_ESQUECI.emailInvalido;
  return erros;
}

export interface CamposLogin {
  codigo_empresa: string;
  email: string;
  senha: string;
}
export type ErrosLogin = Partial<Record<keyof CamposLogin, string>>;

/** Validação do login antes de enviar (campo a campo, com a ação seguinte); o app e o BKO usam esta. Vazio = pode enviar. */
export function validarLogin(c: CamposLogin): ErrosLogin {
  const erros: ErrosLogin = {};
  if (!c.codigo_empresa.trim()) erros.codigo_empresa = 'Informe o código da empresa (quem administra o sistema na sua empresa sabe qual é).';
  else if (!CodigoEmpresaSchema.safeParse(c.codigo_empresa).success) erros.codigo_empresa = 'O código da empresa tem só letras, números e hífen. Confira e digite de novo.';
  if (!c.email.trim()) erros.email = 'Informe o seu e-mail.';
  else if (!ehEmailValido(c.email)) erros.email = 'Esse e-mail não parece certo. Confira e digite de novo.';
  if (!c.senha) erros.senha = 'Informe a sua senha.';
  return erros;
}
