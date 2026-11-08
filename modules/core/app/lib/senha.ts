/**
 * "Crie sua senha" e "Esqueci a senha" no app (T-0094; RN-CORE-32/34; docs/design/ciclo-de-senha.md §2 e §3). Regras puras
 * (validação, textos em português com a ação seguinte) + as chamadas públicas `POST /v1/auth/senha/trocar` e `.../esqueci`,
 * que o shell liga ao transporte HTTP. Exigem internet (o 1º login já é online). A senha atual (a temporária) só existe na
 * memória do shell durante a tela: nunca em storage, URL ou log. Nada aqui registra senha ou e-mail.
 */
import { ehSemConexao, type AppComLogin } from '@macuxi/platform-sdk';
import { DetalhesSenhaATrocarSchema, MENSAGEM_ESQUECI_SENHA, SessaoRespostaSchema, TrocarSenhaRequestSchema, EsqueciSenhaRequestSchema, faltasNaSenha, mensagemDaSenha, type DetalhesSenhaATrocar, type SessaoResposta } from '../../contracts';
import { ehServidorInvalido, mensagemDeErroDeLogin, type PostSemSessao } from './login';
import { tolerante } from './leitor-tolerante';

export const TITULO_CRIE_SUA_SENHA = 'Crie sua senha';
export const TEXTO_SEM_INTERNET_TROCA = 'Conecte-se à internet para criar a sua senha.';
export const TEXTO_SEM_INTERNET_ESQUECI = 'Conecte-se à internet para pedir uma senha temporária.';
export const TEXTO_ESQUECI_CONFIRMACAO = MENSAGEM_ESQUECI_SENHA;
export const TEXTO_ESQUECI_NAO_CHEGOU = 'Não chegou? Confira o spam ou fale com o administrador da sua empresa.';
export const TEXTO_ESQUECI_INSTRUCAO = 'Informe o código da empresa e o seu e-mail. Vamos mandar uma senha temporária para o seu e-mail.';
export const AVISO_SENHA_CRIADA = 'Senha criada.';

/** `SENHA_A_TROCAR` do login: o shell vai direto à "Crie sua senha" (sem mostrar texto). `null` = é outro erro. */
export function detalhesDaTroca(e: unknown): DetalhesSenhaATrocar | null {
  const x = e as { codigo?: unknown; code?: unknown; detalhes?: unknown; details?: unknown } | null;
  if ((x?.codigo ?? x?.code) !== 'SENHA_A_TROCAR') return null;
  const d = DetalhesSenhaATrocarSchema.safeParse(x?.detalhes ?? x?.details);
  // sem detalhes legíveis, trata como troca de senha temporária (a tela é a mesma)
  return d.success ? d.data : { motivo: 'senha_temporaria', expira_em: null };
}
export const ehSenhaATrocar = (e: unknown): boolean => detalhesDaTroca(e) !== null;

export function subtituloDaTroca(motivo: DetalhesSenhaATrocar['motivo']): string {
  return motivo === 'primeiro_acesso' ? 'É o seu primeiro acesso. Crie uma senha só sua para continuar.' : 'Você entrou com uma senha temporária. Crie uma senha nova para continuar.';
}

export type RepeticaoDaSenha = 'vazia' | 'igual' | 'diferente';

/** A tela compara; o kit `RegrasDaSenha` não recebe senha nenhuma. */
export const repeticaoDaSenha = (nova: string, repetida: string): RepeticaoDaSenha => (repetida === '' ? 'vazia' : repetida === nova ? 'igual' : 'diferente');

export interface ResultadoDaValidacaoDaTroca {
  ok: boolean;
  faltas: string[];
  repeticao: RepeticaoDaSenha;
}

/** Antes de enviar: a regra da senha (RN-CORE-32) e as duas digitações iguais. A API revalida tudo. */
export function validarTroca(nova: string, repetida: string): ResultadoDaValidacaoDaTroca {
  const faltas = faltasNaSenha(nova);
  const repeticao = repeticaoDaSenha(nova, repetida);
  return { ok: faltas.length === 0 && repeticao === 'igual', faltas, repeticao };
}

/** O que a tela faz depois do erro da troca. */
export type AcaoAposErroDaTroca = 'ficar' | 'destacar' | 'limpar' | 'voltar_ao_login';
export interface ErroDaTroca {
  texto: string;
  acao: AcaoAposErroDaTroca;
}

const codigoDe = (e: unknown): unknown => {
  const x = e as { codigo?: unknown; code?: unknown } | null;
  return x?.codigo ?? x?.code;
};

/** Respostas da API na "Crie sua senha" (ciclo-de-senha.md §2). */
export function erroDaTroca(e: unknown): ErroDaTroca {
  if (ehSemConexao(e)) return { texto: TEXTO_SEM_INTERNET_TROCA, acao: 'ficar' };
  const x = e as { message?: unknown; detalhes?: { faltas?: unknown } } | null;
  switch (codigoDe(e)) {
    case 'RN-CORE-32': {
      const faltas = Array.isArray(x?.detalhes?.faltas) ? (x.detalhes.faltas as string[]) : [];
      const texto = faltas.length > 0 ? (mensagemDaSenha(faltas as never) ?? String(x?.message ?? '')) : typeof x?.message === 'string' && x.message ? x.message : 'A senha não serve. Confira a lista e tente de novo.';
      return { texto, acao: 'destacar' };
    }
    case 'RN-CORE-34':
      return { texto: 'A senha nova precisa ser diferente da senha que você recebeu.', acao: 'limpar' };
    case 'CREDENCIAIS_INVALIDAS':
      return { texto: 'Esta senha não vale mais. Entre de novo.', acao: 'voltar_ao_login' };
    case 'SENHA_TEMPORARIA_VENCIDA':
    case 'PERFIL_FORA_DO_APP':
    case 'USUARIO_BLOQUEADO':
    case 'MUITAS_TENTATIVAS':
    case 'DISPOSITIVO_BLOQUEADO':
      return { texto: mensagemDeErroDeLogin(e), acao: 'voltar_ao_login' };
    default:
      return { texto: mensagemDeErroDeLogin(e), acao: 'ficar' };
  }
}

export interface DadosDaTroca {
  codigo_empresa: string;
  email: string;
  /** A senha com que a pessoa entrou (temporária); só na memória. */
  senha_atual: string;
  senha_nova: string;
}

/** Troca a senha e já devolve a sessão (a pessoa entra direto). Valida a resposta antes de entregar ao shell. */
export async function trocarSenhaPeloApp(post: PostSemSessao, d: DadosDaTroca, app: AppComLogin, aparelho: { id?: string; nome?: string } = {}): Promise<SessaoResposta> {
  const corpo = TrocarSenhaRequestSchema.parse({
    codigo_empresa: d.codigo_empresa.trim(),
    email: d.email.trim(),
    senha_atual: d.senha_atual,
    senha_nova: d.senha_nova,
    app,
    ...(aparelho.id ? { dispositivo_id: aparelho.id } : {}),
    ...(aparelho.nome ? { dispositivo_nome: aparelho.nome } : {}),
  });
  return tolerante(SessaoRespostaSchema).parse(await post('/auth/senha/trocar', corpo));
}

// ---------- Esqueci a senha ----------
export interface CamposEsqueci {
  codigo_empresa: string;
  email: string;
}
export type ErrosEsqueci = Partial<Record<keyof CamposEsqueci, string>>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Campo vazio e e-mail sem formato, com a frase do desenho. Vazio = pode enviar. */
export function validarEsqueci(c: CamposEsqueci): ErrosEsqueci {
  const erros: ErrosEsqueci = {};
  if (!c.codigo_empresa.trim() || !c.email.trim()) {
    if (!c.codigo_empresa.trim()) erros.codigo_empresa = 'Informe o código da empresa e o e-mail.';
    if (!c.email.trim()) erros.email = 'Informe o código da empresa e o e-mail.';
    return erros;
  }
  if (!EMAIL_RE.test(c.email.trim())) erros.email = 'Informe um e-mail válido, como nome@empresa.com.br.';
  return erros;
}

/** `retry_after_s` → "em 1 minuto" / "em 3 minutos" (mínimo 1). */
export function textoDeEspera(retryAfterS: unknown): string {
  const n = typeof retryAfterS === 'number' && Number.isFinite(retryAfterS) ? Math.max(1, Math.ceil(retryAfterS / 60)) : 1;
  return n === 1 ? 'em 1 minuto' : `em ${n} minutos`;
}

export function erroDoEsqueci(e: unknown): string {
  if (ehSemConexao(e)) return TEXTO_SEM_INTERNET_ESQUECI;
  if (ehServidorInvalido(e)) return 'Este endereço não é um servidor Macuxi. Confira o endereço em Servidor, teste de novo e só então peça a senha.';
  if (codigoDe(e) === 'MUITAS_TENTATIVAS') {
    const d = (e as { detalhes?: { retry_after_s?: unknown } } | null)?.detalhes;
    return `Muitos pedidos seguidos. Tente de novo ${textoDeEspera(d?.retry_after_s)}.`;
  }
  return 'Não foi possível pedir agora. Tente de novo em alguns minutos.';
}

/** Pede a senha temporária. A resposta é sempre a mesma (202): a tela mostra `TEXTO_ESQUECI_CONFIRMACAO` em qualquer sucesso. */
export async function pedirSenhaTemporaria(post: PostSemSessao, c: CamposEsqueci): Promise<void> {
  const corpo = EsqueciSenhaRequestSchema.parse({ codigo_empresa: c.codigo_empresa.trim(), email: c.email.trim() });
  await post('/auth/senha/esqueci', corpo);
}
