/**
 * "Crie sua senha" e "Esqueci a senha" no app (T-0094; RN-CORE-32/34; docs/design/ciclo-de-senha.md §2 e §3). Regras puras
 * (validação, textos em português com a ação seguinte) + as chamadas públicas `POST /v1/auth/senha/trocar` e `.../esqueci`,
 * que o shell liga ao transporte HTTP. Exigem internet (o 1º login já é online). A senha atual (a temporária) só existe na
 * memória do shell durante a tela: nunca em storage, URL ou log. Nada aqui registra senha ou e-mail.
 */
import { ehSemConexao, type AppComLogin } from '@macuxi/platform-sdk';
import {
  acaoDoErroDaTroca,
  SessaoRespostaSchema,
  TrocarSenhaRequestSchema,
  EsqueciSenhaRequestSchema,
  TEXTOS_CRIE_SENHA,
  TEXTOS_ESQUECI,
  TEXTOS_TROCAR_SENHA,
  codigoDoErro,
  faltasNaSenha,
  textoDoErroDaSenha,
  repeticaoDaSenha,
  textoDeMuitosPedidos,
  type FaltaNaSenha,
  type CamposEsqueci,
  type RepeticaoDaSenha,
  type AcaoAposErroDaTroca,
  type SessaoResposta,
} from '../../contracts';
import { ehServidorInvalido, mensagemDeErroDeLogin, type PostSemSessao } from './login';
import { tolerante } from './leitor-tolerante';

export const TITULO_CRIE_SUA_SENHA = TEXTOS_CRIE_SENHA.titulo;
export const TEXTO_SEM_INTERNET_TROCA = TEXTOS_CRIE_SENHA.semInternet;
export const TEXTO_SEM_INTERNET_ESQUECI = TEXTOS_ESQUECI.semInternet;
export const TEXTO_ESQUECI_CONFIRMACAO = TEXTOS_ESQUECI.confirmacao;
export const TEXTO_ESQUECI_NAO_CHEGOU = TEXTOS_ESQUECI.naoChegou;
export const TEXTO_ESQUECI_INSTRUCAO = TEXTOS_ESQUECI.instrucao;
export const AVISO_SENHA_TROCADA = TEXTOS_TROCAR_SENHA.trocada;
export const AVISO_SENHA_CRIADA = TEXTOS_CRIE_SENHA.criada;

// Funções puras do ciclo (detalhes da troca, subtítulo, repetição, espera, validação do Esqueci) vêm de `contracts/ciclo-senha.ts` (RD-0019).
export {
  detalhesDaTroca,
  ehSenhaATrocar,
  repeticaoDaSenha,
  subtituloDaTroca,
  textoDeEspera,
  validarEsqueci,
  type CamposEsqueci,
  type ErrosEsqueci,
  type RepeticaoDaSenha,
} from '../../contracts';

export interface ResultadoDaValidacaoDaTroca {
  ok: boolean;
  faltas: FaltaNaSenha[];
  repeticao: RepeticaoDaSenha;
}

/** Antes de enviar: a regra da senha (RN-CORE-32) e as duas digitações iguais. A API revalida tudo. */
export function validarTroca(nova: string, repetida: string): ResultadoDaValidacaoDaTroca {
  const faltas = faltasNaSenha(nova);
  const repeticao = repeticaoDaSenha(nova, repetida);
  return { ok: faltas.length === 0 && repeticao === 'igual', faltas, repeticao };
}

export type { AcaoAposErroDaTroca };
export interface ErroDaTroca {
  texto: string;
  acao: AcaoAposErroDaTroca;
}

/** Respostas da API na "Crie sua senha" (ciclo-de-senha.md §2). */
export function erroDaTroca(e: unknown, senhaNova?: string): ErroDaTroca {
  if (ehSemConexao(e)) return { texto: TEXTO_SEM_INTERNET_TROCA, acao: 'ficar' };
  const acao = acaoDoErroDaTroca(e);
  switch (codigoDoErro(e)) {
    case 'RN-CORE-32': {
      const texto = textoDoErroDaSenha(e, senhaNova);
      return { texto, acao };
    }
    case 'RN-CORE-34':
      return { texto: TEXTOS_CRIE_SENHA.repetiuATemporaria, acao };
    case 'CREDENCIAIS_INVALIDAS':
      return { texto: TEXTOS_CRIE_SENHA.naoValeMais, acao };
    default:
      return { texto: mensagemDeErroDeLogin(e), acao };
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
export async function trocarSenhaPeloApp(
  post: PostSemSessao,
  d: DadosDaTroca,
  app: AppComLogin,
  aparelho: { id?: string; nome?: string } = {},
): Promise<SessaoResposta> {
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
export function erroDoEsqueci(e: unknown): string {
  if (ehSemConexao(e)) return TEXTO_SEM_INTERNET_ESQUECI;
  if (ehServidorInvalido(e))
    return 'Este endereço não é um servidor Macuxi. Confira o endereço em Servidor, teste de novo e só então peça a senha.';
  if (codigoDoErro(e) === 'MUITAS_TENTATIVAS') {
    const d = (e as { detalhes?: { retry_after_s?: unknown } } | null)?.detalhes;
    return textoDeMuitosPedidos(d?.retry_after_s);
  }
  return TEXTOS_ESQUECI.outro;
}

/** Pede a senha temporária. A resposta é sempre a mesma (202): a tela mostra `TEXTO_ESQUECI_CONFIRMACAO` em qualquer sucesso. */
export async function pedirSenhaTemporaria(post: PostSemSessao, c: CamposEsqueci): Promise<void> {
  // Formato fora do contrato ou 400 da API: a resposta nunca revela cadastro, então a tela mostra a confirmação de sempre.
  const corpo = EsqueciSenhaRequestSchema.safeParse({
    codigo_empresa: c.codigo_empresa.trim(),
    email: c.email.trim(),
  });
  if (!corpo.success) return;
  try {
    await post('/auth/senha/esqueci', corpo.data);
  } catch (e) {
    if ((e as { status?: unknown } | null)?.status === 400) return;
    throw e;
  }
}

// ---------- Trocar senha no Perfil (T-0178; RN-CORE-32/34; docs/design/trocar-senha/spec.md) ----------
/** O que a tela faz com os campos depois do erro da troca voluntária. */
export type EfeitoNosCampos = 'nenhum' | 'limpar_atual' | 'limpar_novas' | 'destacar';
export interface AvisoDaTrocaVoluntaria {
  /** `null` = sem Banner (a lista de regras já diz o que fazer). */
  texto: string | null;
  tom: 'danger' | 'warning';
  efeito: EfeitoNosCampos;
}

/** Respostas da API na "Trocar senha" (spec §5). Um aviso por vez; nunca repassa a mensagem da API. */
export function erroDaTrocaVoluntaria(e: unknown, senhaNova?: string): AvisoDaTrocaVoluntaria {
  if (ehSemConexao(e) || (e as { status?: unknown } | null)?.status === 0)
    return { texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning', efeito: 'nenhum' };
  switch (codigoDoErro(e)) {
    case 'CREDENCIAIS_INVALIDAS':
      return { texto: TEXTOS_TROCAR_SENHA.atualErrada, tom: 'danger', efeito: 'limpar_atual' };
    case 'RN-CORE-32': {
      const texto = textoDoErroDaSenha(e, senhaNova);
      // com faltas, a lista mostra; só "igual ao e-mail" ganha Banner
      return {
        texto: texto === TEXTOS_CRIE_SENHA.igualAoEmail ? texto : null,
        tom: 'danger',
        efeito: 'destacar',
      };
    }
    case 'RN-CORE-34':
      return { texto: TEXTOS_TROCAR_SENHA.igualAAtual, tom: 'danger', efeito: 'limpar_novas' };
    case 'USUARIO_BLOQUEADO':
    case 'MUITAS_TENTATIVAS':
      return { texto: mensagemDeErroDeLogin(e), tom: 'danger', efeito: 'nenhum' };
    default:
      return { texto: TEXTOS_TROCAR_SENHA.outro, tom: 'danger', efeito: 'nenhum' };
  }
}

export interface DadosDaTrocaVoluntaria {
  codigo_empresa: string;
  email: string;
  senha_atual: string;
  senha_nova: string;
}

/**
 * Troca a senha de quem já está logado: `POST /v1/auth/senha/trocar`, só online (sem fila offline) e devolve a sessão nova, que o shell
 * passa a usar. Os refresh dos outros aparelhos ficam revogados pela API. A senha só existe na memória da tela.
 */
export const trocarSenhaDoPerfil = (
  post: PostSemSessao,
  d: DadosDaTrocaVoluntaria,
  app: AppComLogin,
  aparelho: { id?: string; nome?: string } = {},
): Promise<SessaoResposta> => trocarSenhaPeloApp(post, d, app, aparelho);
