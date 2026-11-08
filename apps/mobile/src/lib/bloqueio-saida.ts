/**
 * Saída de formulário alterado (RN-VEN-38; T-0128; spec docs/design/formulario-pendencias.md §2.1 e §2.5). Puro: roda em
 * Node (Vitest); o React Native e o roteador entram por `DependenciasDoBloqueio` (state/bloqueio-do-shell.ts).
 *
 * Ponto de extensão reutilizável: a tela do módulo chama `useBloquearSaida(alterado, aoTentarSair)` do
 * `@macuxi/platform-sdk/react`, que registra o formulário montado neste registro (`registrar`). O shell intercepta as
 * saídas que são dele:
 * - toque em qualquer aba da barra inferior (Início, Rota, Clientes, Pedidos, Mais), inclusive tocar de novo na aba em uso
 *   (`tentarSair`, chamado pela `TabBar`);
 * - gesto e botão Voltar do Android, em qualquer tela do formulário (`ouvirVoltarDoAndroid`, o `BackHandler`).
 * Com o formulário alterado e as telas de módulo em foco, a navegação NÃO segue: o shell chama `aoTentarSair(prosseguir)`
 * e só vai ao destino quando a tela chamar `prosseguir()` (salvar sem pendência ou descartar confirmado). "Continuar
 * editando" ou salvar com pendência: a tela não chama, e a saída é cancelada. Sem alteração, sai direto, sem chamar a tela.
 * Desmontar a tela retira o bloqueio.
 *
 * Ordem do Voltar do Android: o `BackHandler` chama primeiro o ouvinte mais novo. O registro assina quando o formulário
 * monta (depois do ouvinte do roteador, que é da raiz), então o shell pergunta antes de o roteador voltar; um ouvinte da
 * própria tela registrado depois (ex.: voltar uma aba interna do formulário) continua valendo antes do shell.
 */

import type { BloqueioDeSaida, FormularioAlterado } from '@macuxi/platform-sdk/react';

export type { AoTentarSair, BloqueioDeSaida, FormularioAlterado } from '@macuxi/platform-sdk/react';

export interface DependenciasDoBloqueio {
  /** As telas de módulo estão em foco (não o Início, o Mais ou o Perfil, que deixam o formulário montado por baixo). */
  emFoco(): boolean;
  /** Assina o Voltar do Android (`BackHandler`); o ouvinte devolve `true` quando trata. Devolve a função que cancela. */
  ouvirVoltarDoAndroid(ouvinte: () => boolean): () => void;
  /** O voltar que o Android faria sem o bloqueio (voltar no roteador; na raiz, sair do app). */
  voltar(): void;
}

export interface BloqueioDoShell extends BloqueioDeSaida {
  /**
   * Saída pedida pelo shell (toque na barra inferior). Com formulário alterado em foco, pergunta à tela e devolve `true`
   * (`seguir` só roda no `prosseguir`); senão chama `seguir` na hora e devolve `false`.
   */
  tentarSair(seguir: () => void): boolean;
  /** Há formulário alterado em foco segurando a saída agora? */
  bloqueando(): boolean;
}

export function criarBloqueioDeSaida(dep: DependenciasDoBloqueio): BloqueioDoShell {
  const formularios: FormularioAlterado[] = [];

  /** O formulário que segura a saída: o último montado, se as telas de módulo estão em foco e ele está alterado. */
  const quemBloqueia = (): FormularioAlterado | null => {
    const f = formularios[formularios.length - 1];
    return f && dep.emFoco() && f.alterado() ? f : null;
  };

  /** Pergunta à tela; o `prosseguir` vale uma vez (dois toques em "Descartar" não navegam duas vezes). */
  const perguntar = (f: FormularioAlterado, seguir: () => void): void => {
    let seguiu = false;
    f.aoTentarSair(() => {
      if (seguiu) return;
      seguiu = true;
      seguir();
    });
  };

  return {
    registrar(formulario) {
      formularios.push(formulario);
      const cancelarVoltar = dep.ouvirVoltarDoAndroid(() => {
        if (quemBloqueia() !== formulario) return false;
        perguntar(formulario, dep.voltar);
        return true;
      });
      let registrado = true;
      return () => {
        if (!registrado) return;
        registrado = false;
        const i = formularios.lastIndexOf(formulario);
        if (i >= 0) formularios.splice(i, 1);
        cancelarVoltar();
      };
    },
    tentarSair(seguir) {
      const f = quemBloqueia();
      if (!f) {
        seguir();
        return false;
      }
      perguntar(f, seguir);
      return true;
    },
    bloqueando: () => quemBloqueia() !== null,
  };
}
