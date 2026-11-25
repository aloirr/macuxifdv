/**
 * "Trocar senha" no Perfil (T-0178; RF-CORE-01; RN-CORE-32 e RN-CORE-34; docs/design/trocar-senha/spec.md §4, §5 e §10).
 * `trocarMinhaSenha`, a chamada de `POST /v1/auth/senha/trocar` com a senha atual (precheck e leitura do erro:
 * contracts/troca-senha-voluntaria.ts). Só online. A senha nunca vai a fila, storage, URL ou log.
 */
import { type AppComLogin } from '@macuxi/platform-sdk';
import { type SessaoResposta } from '../../contracts';
import { type PostSemSessao } from './login';
import { trocarSenhaPeloApp } from './senha';

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
