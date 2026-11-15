/**
 * Usuário sem filial de cadastro no BKO (T-0176; RN-CORE-39, ADR 0056).
 *
 * A API responde 403 `USUARIO_SEM_FILIAL` em toda rota autenticada, salvo `GET|PUT /v1/core/eu/filial-cadastro` (o admin ou o
 * analista informa a própria filial). Por isso o BKO NÃO encerra a sessão: o shell abre só a "Escolha a sua filial" (spec
 * docs/design/filial-cadastro-venda §5, `components/escolher-filial.tsx`); sem a ação, ela mostra o aviso aprovado e o "Sair".
 *
 * Detecção: a consulta dos módulos efetivos (`/v1/me/modulos`) no próprio shell e qualquer consulta ou gravação das páginas
 * (cache do React Query → `avisarSeSemFilial`).
 */

import { ehUsuarioSemFilial } from '@macuxi/platform-sdk';

type Ouvinte = () => void;
let ouvinte: Ouvinte | null = null;

/** O shell (com sessão) registra o que fazer com o 403: abrir a "Escolha a sua filial". Devolve o cancelamento. */
export function aoSemFilial(f: Ouvinte): () => void {
  ouvinte = f;
  return () => {
    if (ouvinte === f) ouvinte = null;
  };
}

/** Chamado pelo cache do React Query a cada erro: só age no 403 `USUARIO_SEM_FILIAL`. */
export function avisarSeSemFilial(e: unknown): boolean {
  if (!ehUsuarioSemFilial(e)) return false;
  ouvinte?.();
  return true;
}
