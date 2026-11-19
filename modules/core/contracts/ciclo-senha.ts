/**
 * Ciclo de senha, fonte única (T-0094; RD-0019/RD-0020; RN-CORE-32/33/34; docs/design/ciclo-de-senha.md §1 a §3). Funções puras,
 * textos em português e validação de login que o app (`modules/core/app/lib`) e o BKO (`apps/web/lib/ciclo-senha.ts`) importam, em
 * vez de cada um ter a sua cópia. Sem React e sem rede. Nada aqui registra senha ou e-mail.
 */
import { ehEmail } from '@macuxi/comum/email';
import { ehSemConexao, VALIDADE_SENHA_PROVISORIA_HORAS } from '@macuxi/platform-sdk';
import { CodigoEmpresaFormatoSchema, CodigoEmpresaSchema, DetalhesSenhaATrocarSchema, MENSAGEM_CODIGO_EMPRESA, textoEmMinutos, type DetalhesSenhaATrocar } from './auth';
import { faltasNaSenha, mensagemDaSenha, MENSAGEM_SENHA_ESPACO_NAS_PONTAS, temEspacoNasPontas, type FaltaNaSenha } from './senha';

/** Formato do e-mail: `ehEmail` de `@macuxi/comum` (RD-0020), já sem os espaços das pontas. */
export const ehEmailValido = (email: string): boolean => ehEmail(email.trim());

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

/** "Trocar senha" no Perfil (docs/design/trocar-senha/spec.md §8). Os outros textos vêm do kit e de `TEXTOS_CRIE_SENHA`/`TEXTOS_ESQUECI`. */
export const TEXTOS_TROCAR_SENHA = Object.freeze({
  titulo: 'Trocar senha',
  voltarAoPerfil: 'Perfil',
  senhaAtual: 'Senha atual',
  salvar: 'Salvar senha',
  salvando: 'Salvando…',
  atualErrada: 'A senha atual está errada. Digite de novo.',
  igualAAtual: 'A senha nova precisa ser diferente da atual.',
  semInternet: 'Conecte-se à internet para trocar a senha.',
  outro: 'Não foi possível trocar agora. Tente de novo em alguns minutos.',
  trocada: 'Senha trocada.',
});

/** "Esqueci a senha" (spec §3). A confirmação é sempre a mesma, exista ou não o cadastro; a validade vem do SDK. */
export const TEXTOS_ESQUECI = Object.freeze({
  titulo: 'Esqueci a senha',
  codigoEmpresa: 'Código da empresa',
  email: 'E-mail',
  instrucao: 'Informe o código da empresa e o seu e-mail. Vamos mandar uma senha temporária para o seu e-mail.',
  enviar: 'Enviar senha temporária',
  enviando: 'Enviando…',
  voltar: 'Voltar ao login',
  confirmacao: `Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por ${VALIDADE_SENHA_PROVISORIA_HORAS} horas.`,
  confirmacaoNoApp: `Você vai receber uma senha temporária em alguns minutos. Ela vale por ${VALIDADE_SENHA_PROVISORIA_HORAS} horas.`,
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
/**
 * RD-0019: FONTE ÚNICA do que a tela faz depois do erro da troca de senha (spec §2), pelo código da API. App e BKO só trocam o
 * texto (cada um tem o seu `mensagemDeErroDeLogin`). Sem rede (`status` 0 ou erro do SDK) = ficar na tela.
 */
export function acaoDoErroDaTroca(e: unknown): AcaoAposErroDaTroca {
  if (ehSemConexao(e) || (e as { status?: unknown } | null)?.status === 0) return 'ficar';
  switch (codigoDoErro(e)) {
    case 'RN-CORE-32':
      return 'destacar';
    case 'RN-CORE-34':
      return 'limpar';
    case 'CREDENCIAIS_INVALIDAS':
    case 'SENHA_TEMPORARIA_VENCIDA':
    case 'PERFIL_FORA_DO_APP':
    case 'USUARIO_BLOQUEADO':
    case 'MUITAS_TENTATIVAS':
    case 'DISPOSITIVO_BLOQUEADO':
      return 'voltar_ao_login';
    default:
      return 'ficar';
  }
}
const FALTAS_VALIDAS: readonly string[] = ['caracteres', 'letra', 'numero', 'especial', 'espaco'];
/**
 * RN-CORE-32 (T-0140): FONTE ÚNICA do texto do 422 da senha, para app, BKO e portal (spec §2): a frase das faltas válidas
 * (`mensagemDaSenha(faltas, senhaNova)`) ou, sem faltas, "A senha não pode ser igual ao e-mail.". Nunca repassa a mensagem
 * da API nem código técnico. `senhaNova` só serve para distinguir "curta" de "longa demais".
 */
export function textoDoErroDaSenha(e: unknown, senhaNova?: string): string {
  const d = detalhesDoErro(e);
  const brutas = d && typeof d === 'object' ? (d as { faltas?: unknown }).faltas : undefined;
  const faltas = (Array.isArray(brutas) ? brutas : []).filter((f): f is FaltaNaSenha => typeof f === 'string' && FALTAS_VALIDAS.includes(f));
  return mensagemDaSenha(faltas, senhaNova) ?? TEXTOS_CRIE_SENHA.igualAoEmail;
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
export const textoDeEspera = (retryAfterS: unknown): string => textoEmMinutos(retryAfterS, 1, 60);
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

/** RF-CORE-01: regra NOVA do campo (UF + 4 dígitos): mensagem única do código inválido (com a ação seguinte); `null` se vale. O BKO segue com `validarLogin` (regra antiga) até o PR do engenheiro-apps. */
export function validarCodigoEmpresaNovo(valor: string): string | null {
  return CodigoEmpresaFormatoSchema.safeParse(valor).success ? null : MENSAGEM_CODIGO_EMPRESA;
}

export interface CamposLogin {
  codigo_empresa: string;
  email: string;
  senha: string;
}
export type ErrosLogin = Partial<Record<keyof CamposLogin, string>>;

/** Validação do login antes de enviar (campo a campo, com a ação seguinte); o app e o BKO usam esta. Vazio = pode enviar. */
/** Validação do login com a regra ANTIGA do código (BKO, até migrar). Senha: espaço nas pontas é recusado (RN-CORE-32). */
export function validarLogin(c: CamposLogin): ErrosLogin {
  const erros: ErrosLogin = {};
  if (!c.codigo_empresa.trim()) erros.codigo_empresa = 'Informe o código da empresa (quem administra o sistema na sua empresa sabe qual é).';
  else if (!CodigoEmpresaSchema.safeParse(c.codigo_empresa).success) erros.codigo_empresa = 'O código da empresa tem só letras, números e hífen. Confira e digite de novo.';
  if (!c.email.trim()) erros.email = 'Informe o seu e-mail.';
  else if (!ehEmailValido(c.email)) erros.email = 'Esse e-mail não parece certo. Confira e digite de novo.';
  if (!c.senha) erros.senha = 'Informe a sua senha.';
  else if (temEspacoNasPontas(c.senha)) erros.senha = MENSAGEM_SENHA_ESPACO_NAS_PONTAS;
  return erros;
}

/** Login do app (Campo e Gestão): igual ao `validarLogin`, com o código na regra NOVA (UF + 4 dígitos). */
export function validarLoginNovo(c: CamposLogin): ErrosLogin {
  const erros = validarLogin(c);
  if (c.codigo_empresa.trim()) {
    const e = validarCodigoEmpresaNovo(c.codigo_empresa);
    if (e) erros.codigo_empresa = e;
    else delete erros.codigo_empresa;
  }
  return erros;
}
