/**
 * "Trocar senha" no Perfil (T-0178; RF-CORE-01; RN-CORE-32 e RN-CORE-34; docs/design/trocar-senha/spec.md §4, §5 e §10).
 * Funções puras (conferência antes de enviar e leitura do erro da API) + `trocarMinhaSenha`, a chamada de
 * `POST /v1/auth/senha/trocar` com a senha atual. Só online. A senha nunca vai a fila, storage, URL ou log.
 */
import { ehSemConexao, type AppComLogin } from '@macuxi/platform-sdk';
import {
  codigoDoErro,
  faltasNaSenha,
  repeticaoDaSenha,
  TEXTOS_CRIE_SENHA,
  TEXTOS_TROCAR_SENHA,
  textoDoErroDaSenha,
  type SessaoResposta,
} from '../../contracts';
import { mensagemDeErroDeLogin, type PostSemSessao } from './login';
import { trocarSenhaPeloApp } from './senha';

export interface ResultadoDoPrecheck {
  ok: boolean;
  atualVazia: boolean;
  /** Para onde vai o foco quando não envia. */
  foco: 'atual' | 'nova' | 'repita' | null;
}

/** Spec §4: o que a tela confere antes de chamar a API (RN-CORE-32 e as duas digitações iguais; senha atual não vazia). A API revalida tudo. */
export function precheckDaTrocaVoluntaria(
  atual: string,
  nova: string,
  repetida: string,
): ResultadoDoPrecheck {
  const atualVazia = atual === '';
  const faltas = faltasNaSenha(nova).length > 0;
  const diferentes = repeticaoDaSenha(nova, repetida) !== 'igual';
  const foco = atualVazia ? 'atual' : faltas ? 'nova' : diferentes ? 'repita' : null;
  return {
    ok: !atualVazia && !faltas && !diferentes,
    atualVazia,
    foco,
  };
}

export type AcaoAposErroDaTrocaVoluntaria = 'limpar_atual' | 'limpar_novas' | 'destacar' | 'ficar';
export interface ErroDaTrocaVoluntaria {
  /** Texto do `Banner` do topo; `null` = nenhum aviso (a lista de regras já diz). */
  texto: string | null;
  tom: 'danger' | 'warning';
  acao: AcaoAposErroDaTrocaVoluntaria;
}

/** Spec §5: respostas da API na troca pelo Perfil. Um aviso só; texto sempre em português com a ação seguinte. */
export function erroDaTrocaVoluntaria(e: unknown, senhaNova?: string): ErroDaTrocaVoluntaria {
  if (ehSemConexao(e) || (e as { status?: unknown } | null)?.status === 0)
    return { texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning', acao: 'ficar' };
  switch (codigoDoErro(e)) {
    case 'CREDENCIAIS_INVALIDAS':
      return { texto: TEXTOS_TROCAR_SENHA.atualErrada, tom: 'danger', acao: 'limpar_atual' };
    case 'RN-CORE-34':
      return { texto: TEXTOS_TROCAR_SENHA.igualAAtual, tom: 'danger', acao: 'limpar_novas' };
    case 'RN-CORE-32': {
      // com faltas, a lista de regras mostra (sem aviso); sem faltas só sobra "igual ao e-mail"
      const igualAoEmail = textoDoErroDaSenha(e, senhaNova) === TEXTOS_CRIE_SENHA.igualAoEmail;
      return { texto: igualAoEmail ? TEXTOS_CRIE_SENHA.igualAoEmail : null, tom: 'danger', acao: 'destacar' };
    }
    case 'MUITAS_TENTATIVAS':
    case 'USUARIO_BLOQUEADO':
    case 'DISPOSITIVO_BLOQUEADO':
    case 'SENHA_TEMPORARIA_VENCIDA':
      return { texto: mensagemDeErroDeLogin(e), tom: 'danger', acao: 'ficar' };
    default:
      return { texto: TEXTOS_TROCAR_SENHA.outro, tom: 'danger', acao: 'ficar' };
  }
}

/**
 * Troca a senha de quem está logado e devolve a `SessaoResposta` nova (o aparelho passa a usar os tokens novos; os outros
 * aparelhos perdem a sessão). `sessao` é o código da empresa e o e-mail da sessão atual; a confirmação ("Repita a senha") fica
 * na tela e não vai à API. `post` é o POST sem sessão do shell (o mesmo de `pedirSenhaTemporaria`); o erro HTTP lançado traz
 * `codigo` (ex.: `CREDENCIAIS_INVALIDAS`, `RN-CORE-32`, `RN-CORE-34`, `MUITAS_TENTATIVAS`) e `detalhes`.
 */
export function trocarMinhaSenha(
  post: PostSemSessao,
  sessao: { codigoEmpresa: string; email: string },
  corpo: { senha_atual: string; senha_nova: string },
  app: AppComLogin,
  aparelho: { id?: string; nome?: string } = {},
): Promise<SessaoResposta> {
  return trocarSenhaPeloApp(
    post,
    {
      codigo_empresa: sessao.codigoEmpresa,
      email: sessao.email,
      senha_atual: corpo.senha_atual,
      senha_nova: corpo.senha_nova,
    },
    app,
    aparelho,
  );
}
