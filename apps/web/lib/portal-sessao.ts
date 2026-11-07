/**
 * Sessão do super-admin no portal `config.` (T-0087; ADR 0029 §4; desenho docs/desenho/T-0087.md §2).
 * - Token só no `sessionStorage` da origem `config.` (nunca `localStorage`, nunca cookie): fechar a aba encerra; o BKO, em outra
 *   origem, nunca o lê.
 * - Token de 15 min renovado (`POST /v1/plataforma/auth/renovar`) quando faltam menos de `RENOVAR_ANTES_MS` e há uso; depois do
 *   teto (`sessao_expira_em`, 8 h) só com login de novo.
 * - Nada daqui vai ao `console` (token, e-mail ou código).
 * As regras de tempo são puras (`estadoDaSessao`), para teste; o armazenamento recebe o `Storage` por parâmetro.
 */
import { SessaoPlataformaSchema } from '@macuxi/platform-sdk';

/** O apps/web não depende do zod direto: o tipo sai do schema do SDK. */
export type SessaoPortal = ReturnType<typeof SessaoPlataformaSchema.parse>;

export const CHAVE_SESSAO_PORTAL = 'macuxi.portal.sessao';
/** Renova quando faltam menos de 3 min para o fim do token (15 min). */
export const RENOVAR_ANTES_MS = 3 * 60_000;
/** "Há uso": houve interação nos últimos 10 min (sem uso, o token vence e o portal pede login). */
export const USO_RECENTE_MS = 10 * 60_000;

export type EstadoSessao = 'ausente' | 'valida' | 'renovar' | 'expirada';

/** Estado da sessão no instante `agora` (ms). `renovar` = ainda vale, mas está perto do fim e o teto permite. */
export function estadoDaSessao(s: SessaoPortal | null, agora: number): EstadoSessao {
  if (!s) return 'ausente';
  const fimToken = Date.parse(s.expira_em);
  const teto = Date.parse(s.sessao_expira_em);
  if (!Number.isFinite(fimToken) || !Number.isFinite(teto)) return 'expirada';
  if (agora >= teto || agora >= fimToken) return 'expirada';
  if (fimToken - agora <= RENOVAR_ANTES_MS && teto - agora > 0) return 'renovar';
  return 'valida';
}

/** Minutos que faltam para o teto da sessão (para o aviso "a sessão termina em N min"). */
export function minutosAteOTeto(s: SessaoPortal, agora: number): number {
  return Math.max(0, Math.floor((Date.parse(s.sessao_expira_em) - agora) / 60_000));
}

function armazenamento(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function lerSessaoPortal(st: Storage | null = armazenamento()): SessaoPortal | null {
  if (!st) return null;
  try {
    const bruto = st.getItem(CHAVE_SESSAO_PORTAL);
    if (!bruto) return null;
    const p = SessaoPlataformaSchema.safeParse(JSON.parse(bruto));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const ouvintes = new Set<() => void>();
let versao = 0;
/** "Sair" pedido pelo usuário (ver `marcarSaidaPedida`); declarado aqui porque o `salvarSessaoPortal` o zera. */
let saidaPedida = false;

function avisar() {
  versao++;
  for (const o of ouvintes) o();
}

export function salvarSessaoPortal(s: SessaoPortal, st: Storage | null = armazenamento()) {
  // sessão nova: um "Sair" antigo que a guarda não consumiu (ex.: clicado com a sessão já nula, no Dialog de links por baixar)
  // não pode esconder o aviso nem a volta da próxima expiração real (R-20261107-093612 🟢 5; R-20261107-094706 🟢 4)
  saidaPedida = false;
  try {
    st?.setItem(CHAVE_SESSAO_PORTAL, JSON.stringify(SessaoPlataformaSchema.parse(s)));
  } catch {
    // navegador sem storage: a sessão some no F5
  }
  avisar();
}

export function limparSessaoPortal(st: Storage | null = armazenamento()) {
  try {
    st?.removeItem(CHAVE_SESSAO_PORTAL);
  } catch {
    // sem storage
  }
  avisar();
}

/** Para `useSyncExternalStore`: muda a cada salvar/limpar. */
export function assinarSessaoPortal(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function versaoDaSessaoPortal(): number {
  return versao;
}

// ---------------------------------------------------------------------------------------------------------------- retorno

/**
 * Volta depois do login (revisão de UX R-20261106-023316 🟡 10): quando a guarda manda para `/entrar`, guarda a página de origem
 * (com o `#aba`) e se a sessão terminou (para o aviso "Sua sessão terminou"). Só caminhos do próprio portal (`/empresas...`):
 * nada de outro host, `//` ou query, para o retorno não virar redirecionamento aberto.
 */
export const CHAVE_RETORNO_PORTAL = 'macuxi.portal.retorno';

export type RetornoPortal = { caminho: string | null; sessaoTerminou: boolean };

/** Caminho interno aceito para voltar depois do login, ou `null`. */
export function caminhoDeRetornoSeguro(c: unknown): string | null {
  if (typeof c !== 'string' || c.length > 120) return null;
  return /^\/empresas(\/[A-Za-z0-9-]{1,64})?(#[a-z]{1,20})?$/.test(c) ? c : null;
}

export function guardarRetornoPortal(r: RetornoPortal, st: Storage | null = armazenamento()) {
  try {
    st?.setItem(CHAVE_RETORNO_PORTAL, JSON.stringify({ caminho: caminhoDeRetornoSeguro(r.caminho), sessaoTerminou: r.sessaoTerminou === true }));
  } catch {
    // sem storage: o login volta para a lista de empresas
  }
}

/**
 * Lê sem apagar: a entrada lê ao montar e só apaga depois do login (`apagarRetornoPortal`), para um F5 na entrada não perder a
 * página de origem nem o aviso (R-20261107-093612 🟢 4). O caminho é revalidado na leitura.
 */
export function lerRetornoPortal(st: Storage | null = armazenamento()): RetornoPortal | null {
  if (!st) return null;
  try {
    const bruto = st.getItem(CHAVE_RETORNO_PORTAL);
    if (!bruto) return null;
    const x = JSON.parse(bruto) as { caminho?: unknown; sessaoTerminou?: unknown };
    return { caminho: caminhoDeRetornoSeguro(x.caminho), sessaoTerminou: x.sessaoTerminou === true };
  } catch {
    return null;
  }
}

export function apagarRetornoPortal(st: Storage | null = armazenamento()) {
  try {
    st?.removeItem(CHAVE_RETORNO_PORTAL);
  } catch {
    // sem storage
  }
}

/** Lê e apaga (vale uma vez). */
export function consumirRetornoPortal(st: Storage | null = armazenamento()): RetornoPortal | null {
  const r = lerRetornoPortal(st);
  apagarRetornoPortal(st);
  return r;
}

/** "Sair" pedido pelo usuário: a guarda não mostra "Sua sessão terminou" nem guarda a página de origem. Zera ao salvar sessão. */
export function marcarSaidaPedida() {
  saidaPedida = true;
}
/** Lê e zera a marca de "Sair". */
export function retirarSaidaPedida(): boolean {
  const s = saidaPedida;
  saidaPedida = false;
  return s;
}
