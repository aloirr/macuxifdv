/**
 * RN-VEN-38 (T-0128; docs/design/formulario-pendencias.md §2.1 e §2.5) — saída de formulário alterado.
 *
 * O SDK só guarda um registro em contexto: sem RN, sem expo-router e sem hook dinâmico (o app roda com o React Compiler).
 * O shell do app (apps/mobile) cria o `BloqueioDeSaida`, decide foco, barra inferior e Voltar do Android e chama
 * `aoTentarSair(prosseguir)`. A tela do módulo só chama `useBloquearSaida`. Sem provedor (web, testes de módulo), nada acontece.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/** A tela decide (abre a folha) e só chama `prosseguir()` quando liberar a saída. */
export type AoTentarSair = (prosseguir: () => void) => void;

/** Formulário montado que pode bloquear a saída. Lido na hora da tentativa (valores do último render). */
export interface FormularioAlterado {
  alterado(): boolean;
  aoTentarSair: AoTentarSair;
}

/** Registro do shell (apps/mobile: barra inferior e Voltar do Android). */
export interface BloqueioDeSaida {
  /** Registra o formulário montado; devolve a função que o retira (ao desmontar). */
  registrar(formulario: FormularioAlterado): () => void;
}

const CtxBloqueioDeSaida = createContext<BloqueioDeSaida | null>(null);

/** Montado pelo shell do app em volta das telas dos módulos. `value` deve ser estável (um registro por sessão do shell). */
export function ProvedorBloqueioDeSaida({ value, children }: { value: BloqueioDeSaida; children: ReactNode }) {
  return <CtxBloqueioDeSaida.Provider value={value}>{children}</CtxBloqueioDeSaida.Provider>;
}

/**
 * Com `alterado = true`, o shell não segue para o destino (barra inferior, Voltar do Android) e chama `aoTentarSair(prosseguir)`;
 * a navegação só segue quando a tela chamar `prosseguir()`. Sem alteração, sai direto. Desmontar a tela retira o bloqueio.
 * Fora de um `ProvedorBloqueioDeSaida` (web, testes) não faz nada.
 *
 * O registro depende só do `bloqueio` (estável): não re-registra a cada render, para não mudar a ordem dos ouvintes do
 * Voltar do Android. A ref é atualizada em effect (não no render), por causa do React Compiler.
 */
export function useBloquearSaida(alterado: boolean, aoTentarSair: AoTentarSair): void {
  const bloqueio = useContext(CtxBloqueioDeSaida);
  const atual = useRef({ alterado, aoTentarSair });
  useEffect(() => {
    atual.current = { alterado, aoTentarSair };
  });
  useEffect(() => {
    if (!bloqueio) return undefined;
    return bloqueio.registrar({
      alterado: () => atual.current.alterado,
      aoTentarSair: (prosseguir) => atual.current.aoTentarSair(prosseguir),
    });
  }, [bloqueio]);
}
