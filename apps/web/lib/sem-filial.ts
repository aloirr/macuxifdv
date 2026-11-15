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

/** Código do 403 da guarda global (`CODIGO_USUARIO_SEM_FILIAL` do SDK, ADR 0056). */
export const CODIGO_USUARIO_SEM_FILIAL = 'USUARIO_SEM_FILIAL';

/** Texto aprovado (R-20261115-104500), o mesmo do app. */
export const AVISO_SEM_FILIAL = 'Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial.';

/** 403 `USUARIO_SEM_FILIAL` (`ApiRequestError.code` do SDK web; `codigo` no corpo cru). */
export function ehUsuarioSemFilial(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown };
  return x.status === 403 && (x.code === CODIGO_USUARIO_SEM_FILIAL || x.codigo === CODIGO_USUARIO_SEM_FILIAL);
}

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
