/**
 * RN-CORE-15 no shell: aparelho bloqueado vale para o tenant inteiro. Quando o login, o refresh ou qualquer chamada
 * recebe 423 `DISPOSITIVO_BLOQUEADO`, o shell entrega ao Core (`tratarAparelhoBloqueado`, `@macuxi/core/app`) as ações
 * deste aparelho: apagar os dados locais (motor + chaves de usuário + fotos), encerrar a sessão, avisar e ir ao login.
 *
 * Puro (sem React Native): as fontes de disco, sessão e navegação são injetadas por `state/plataforma.tsx`.
 * O que NÃO é apagado: o id do aparelho (`fv:dispositivo` — com um id novo o bloqueio seria contornado), o endereço do
 * servidor, o modo sem sinal e o código da empresa (não são dados do tenant nem pessoais).
 */
import type { AcoesAparelhoBloqueado } from '@macuxi/core/app';

/** Prefixos do AsyncStorage com dados de usuário: motor por usuário (`armazenamento.ts`) e legado da Fase M. */
export const PREFIXOS_DADOS_DE_USUARIO = ['macuxi:u:', 'fv:u:'] as const;
/** Sessão guardada sem token (`keys.session`). Os tokens saem pelo `apagarTokens` (armazenamento seguro). */
export const CHAVE_SESSAO_GUARDADA = 'fv:session';

/** Chaves do AsyncStorage que saem do aparelho bloqueado (de TODOS os usuários que entraram nele). */
export function chavesDoAparelhoBloqueado(todas: readonly string[]): string[] {
  return todas.filter((k) => k === CHAVE_SESSAO_GUARDADA || PREFIXOS_DADOS_DE_USUARIO.some((p) => k.startsWith(p)));
}

export interface FontesAparelhoBloqueado {
  /** Motor aberto da sessão atual (ou `null`, ex.: no login). */
  motor(): { limparAparelho(): Promise<void> } | null;
  chavesLocais(): Promise<readonly string[]>;
  removerChaves(chaves: readonly string[]): Promise<void>;
  /** Apaga a pasta das fotos tiradas no aparelho (inclusive as ainda não enfileiradas). */
  apagarFotos(): Promise<void>;
  apagarTokens(): Promise<void>;
  /** Fecha a sessão em memória (motor, usuário, módulos), sem chamar o servidor: a família já foi revogada. */
  fecharSessao(): void;
  avisar(mensagem: string): void;
  irParaLogin(): void;
}

/** Ações que o Core recebe em `tratarAparelhoBloqueado` (ordem garantida pelo Core: apagar → sessão → aviso → login). */
export function acoesDoAparelhoBloqueado(f: FontesAparelhoBloqueado): AcoesAparelhoBloqueado {
  return {
    async apagarDadosLocais() {
      // 1º o motor (fila, linhas, cursores e o estado em memória numa transação quando o adaptador sabe); depois a varredura
      await f.motor()?.limparAparelho();
      await f.removerChaves(chavesDoAparelhoBloqueado(await f.chavesLocais()));
      await f.apagarFotos();
    },
    async encerrarSessao() {
      await f.apagarTokens();
      f.fecharSessao();
    },
    avisar: (m) => f.avisar(m),
    irParaLogin: () => f.irParaLogin(),
  };
}

type Tratar = (erro: unknown, acoes: AcoesAparelhoBloqueado) => Promise<boolean>;

/**
 * Tratador único do shell: várias chamadas recebendo 423 ao mesmo tempo (fila, pull, refresh) limpam o aparelho UMA
 * vez. Erro que não é de aparelho bloqueado devolve `false` sem tocar em nada.
 */
export function criarTratadorAparelhoBloqueado(
  fontes: FontesAparelhoBloqueado,
  tratar: Tratar,
  ehAparelhoBloqueado: (e: unknown) => boolean,
): (erro: unknown) => Promise<boolean> {
  let emCurso: Promise<boolean> | null = null;
  return (erro) => {
    if (!ehAparelhoBloqueado(erro)) return Promise.resolve(false);
    emCurso ??= tratar(erro, acoesDoAparelhoBloqueado(fontes)).finally(() => {
      emCurso = null;
    });
    return emCurso;
  };
}
