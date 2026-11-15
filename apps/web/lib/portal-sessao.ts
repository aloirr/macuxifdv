/**
 * Sessão do portal `config.` (T-0087; T-0093, ADR 0031; desenho docs/desenho/T-0093.md §2 e §4).
 * - Quem entra: o time da Macuxi (`super_admin`, vê todas as empresas) ou o admin do cliente (`admin_cliente`, só nas empresas
 *   em que a senha conferiu; com 2+ escolhe uma). O formato é o `SessaoPortalSchema` do SDK: token, prazos, tipo e empresas.
 * - Token só no `sessionStorage` da origem `config.` (nunca `localStorage`, nunca cookie): fechar a aba encerra; o BKO, em outra
 *   origem, nunca o lê. Nada de senha nem de e-mail aqui: a sessão guardada é só a resposta da API.
 * - Token de 15 min renovado (`POST /v1/plataforma/auth/renovar`) quando faltam menos de `RENOVAR_ANTES_MS` e há uso; depois do
 *   teto (`sessao_expira_em`, 8 h) só com login de novo.
 * - Nada daqui vai ao `console` (token, e-mail ou senha).
 * As regras de tempo e de destino são puras (`estadoDaSessao`, `destinoDaSessao`...), para teste; o armazenamento recebe o
 * `Storage` por parâmetro.
 */
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import { SessaoPortalSchema } from '@macuxi/platform-sdk';

/** O apps/web não depende do zod direto: o tipo sai do schema do SDK. */
export type SessaoPortal = ReturnType<typeof SessaoPortalSchema.parse>;
export type EmpresaDaSessaoPortal = SessaoPortal['empresas'][number];

export const CHAVE_SESSAO_PORTAL = 'macuxi.portal.sessao';

/** O admin do cliente numa área só do time Macuxi (Diagnósticos, Frases da carga): um texto só para todas. */
export const SEM_ACESSO_TIME_MACUXI = 'Esta área é só do time Macuxi.';
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
    const p = SessaoPortalSchema.safeParse(JSON.parse(bruto));
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
    st?.setItem(CHAVE_SESSAO_PORTAL, JSON.stringify(SessaoPortalSchema.parse(s)));
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

// ---------------------------------------------------------------------------------------------------------------- empresa

/**
 * Escolha de empresa (T-0093; docs/design/portal-entrar.md §2 e §3). Caminhos sem o prefixo `/config` (o `proxy.ts` reescreve).
 * - time da Macuxi: a lista de todas as empresas (`/empresas`), como antes;
 * - admin do cliente com a empresa escolhida (1 empresa entra direto): a página dela;
 * - admin do cliente com 2+ e sem escolha: "Escolha a empresa".
 */
export const CAMINHO_ESCOLHER_EMPRESA = '/escolher-empresa';
export const CAMINHO_EMPRESAS = '/empresas';

export const caminhoDaEmpresa = (id: string): string => `${CAMINHO_EMPRESAS}/${encodeURIComponent(id)}`;

/** Página inicial de quem tem a sessão `s` (marca do cabeçalho, raiz do portal, entrada com sessão viva). */
export function destinoDaSessao(s: SessaoPortal): string {
  if (s.tipo === 'super_admin') return CAMINHO_EMPRESAS;
  return s.empresa ? caminhoDaEmpresa(s.empresa.id) : CAMINHO_ESCOLHER_EMPRESA;
}

/**
 * Para onde ir depois do login ou da escolha, com a página de origem guardada pela guarda (`caminhoDeRetornoSeguro`):
 * - time da Macuxi: a página de origem, se houver; senão a lista;
 * - admin do cliente: a página de origem só se for da empresa da sessão (`/empresas/<id>` ou `/empresas/<id>#aba`); outra empresa
 *   nunca abre sem escolher de novo (critério 3 da T-0093). Sem empresa escolhida: "Escolha a empresa".
 */
export function destinoDepoisDoLogin(s: SessaoPortal, retorno: string | null): string {
  const seguro = caminhoDeRetornoSeguro(retorno);
  if (s.tipo === 'super_admin') return seguro ?? CAMINHO_EMPRESAS;
  if (!s.empresa) return CAMINHO_ESCOLHER_EMPRESA;
  const daEmpresa = caminhoDaEmpresa(s.empresa.id);
  return seguro && (seguro === daEmpresa || seguro.startsWith(`${daEmpresa}#`)) ? seguro : daEmpresa;
}

/** "Trocar de empresa" no cabeçalho: só o admin do cliente com 2 ou mais empresas. */
export function podeTrocarDeEmpresa(s: SessaoPortal | null | undefined): boolean {
  return !!s && s.tipo === 'admin_cliente' && s.empresas.length >= 2;
}

/** Lista nova, criar empresa e "Nova empresa": só o time da Macuxi (RN-CORE-33). */
export function ehTimeMacuxi(s: SessaoPortal | null | undefined): boolean {
  return !!s && s.tipo === 'super_admin';
}

/**
 * A página `/empresas/<id>` pode abrir com esta sessão? Time da Macuxi: qualquer empresa. Admin do cliente: só a empresa escolhida
 * (o `x-macuxi-tenant` das chamadas é sempre ela). Senão, o caminho para onde ir: outra empresa da lista = escolher de novo;
 * empresa fora da lista = a página inicial dele.
 */
export function desvioDaPaginaDaEmpresa(s: SessaoPortal, id: string): string | null {
  if (s.tipo === 'super_admin') return null;
  if (s.empresa?.id === id) return null;
  if (s.empresas.length >= 2 && s.empresas.some((e) => e.id === id)) return CAMINHO_ESCOLHER_EMPRESA;
  return destinoDaSessao(s);
}

/** Item da lista "Escolha a empresa": nome, código, selo "Atual" e o rótulo falado (spec §2). */
export interface ItemEscolhaEmpresa {
  id: string;
  nome: string;
  codigo: string;
  atual: boolean;
  rotuloAcessivel: string;
}

/**
 * A lista vem da sessão, na ordem da API (nome da empresa); nunca de outra fonte. `fora`: empresas que deram 403
 * `EMPRESA_NAO_PERMITIDA` nesta aba e saem da lista, nem como "Atual" (spec §4; R-20261107-174216 🟡 2).
 */
export function itensDaEscolha(s: SessaoPortal, fora: readonly string[] = []): ItemEscolhaEmpresa[] {
  if (s.tipo !== 'admin_cliente') return [];
  return s.empresas.filter((e) => !fora.includes(e.id)).map((e) => {
    const atual = s.empresa?.id === e.id;
    return { id: e.id, nome: e.nome, codigo: e.codigo, atual, rotuloAcessivel: atual ? `Entrar em ${e.nome}, empresa atual` : `Entrar em ${e.nome}` };
  });
}

// ---------------------------------------------------------------------------------------------------------------- desvio

/** 403 `EMPRESA_NAO_PERMITIDA` (spec §4): aviso na entrada (1 empresa) ou na Escolha quando não se sabe qual empresa foi. */
export const MENSAGEM_EMPRESA_INDISPONIVEL = 'Esta empresa não está mais disponível para você.';
/** 403 `EMPRESA_NAO_PERMITIDA` na Escolha a empresa (2+): o aviso diz o nome, e ela sai da lista (spec §4). */
export const mensagemDaEmpresaIndisponivel = (nome: string): string => `A empresa ${nome} não está mais disponível para você.`;

/** Empresa que deu 403 `EMPRESA_NAO_PERMITIDA`: sai da lista da Escolha e dá nome ao aviso. */
export type EmpresaIndisponivel = { id: string; nome: string };

/**
 * Sessão sem a empresa `id` (403 `EMPRESA_NAO_PERMITIDA`), quando o resultado ainda é uma sessão válida pelo `SessaoPortalSchema`:
 * 2+ empresas restantes (a atual vira `null` se for ela) ou 1 restante que já é a atual. Senão `null` (nenhuma restante, ou 1
 * restante ainda não escolhida: a Escolha entra nela pela API, porque o token é da empresa escolhida).
 */
export function sessaoSemEmpresa(s: SessaoPortal, id: string): SessaoPortal | null {
  if (s.tipo !== 'admin_cliente' || !s.empresas.some((e) => e.id === id)) return null;
  const empresas = s.empresas.filter((e) => e.id !== id);
  const empresa = s.empresa && s.empresa.id !== id ? s.empresa : null;
  if (empresas.length === 0 || (empresas.length === 1 && !empresa)) return null;
  return { ...s, empresa, empresas };
}

/**
 * O que a "Escolha a empresa" faz com a lista que sobrou depois de tirar as empresas do 403 (puro; spec §2 e §4):
 * - `lista`: 2+ para escolher;
 * - `pagina`: sobrou só a atual → a página dela, sem pedido;
 * - `entrar_em`: sobrou 1 ainda não escolhida → entra direto nela (`POST auth/empresa`), como no login com 1 empresa;
 * - `entrada`: não sobrou nenhuma → a sessão acaba e a entrada mostra "Esta empresa não está mais disponível para você.".
 */
export type PassoDaEscolha = { tipo: 'lista' } | { tipo: 'pagina'; id: string } | { tipo: 'entrar_em'; id: string } | { tipo: 'entrada' };

export function passoDaEscolha(s: SessaoPortal, fora: readonly string[]): PassoDaEscolha {
  const itens = itensDaEscolha(s, fora);
  const unica = itens.length === 1 ? itens[0] : undefined;
  if (itens.length === 0) return { tipo: 'entrada' };
  if (!unica) return { tipo: 'lista' };
  return unica.atual ? { tipo: 'pagina', id: unica.id } : { tipo: 'entrar_em', id: unica.id };
}

/**
 * Para onde a guarda leva quando uma chamada do admin do cliente volta com 403 `EMPRESA_NAO_PERMITIDA` ou 409
 * `EMPRESA_NAO_ESCOLHIDA` (desenho T-0093 §4): `escolher` = "Escolha a empresa"; `entrar` = sessão encerrada, entrar de novo.
 */
export type DesvioPortal = { para: 'escolher' | 'entrar'; aviso: string | null; empresa?: EmpresaIndisponivel };

/**
 * Desvio pelo erro de uma rota autenticada (puro). Super-admin e outros erros: `null` (a tela mostra o erro). No 403, `tenant` é
 * a empresa da chamada (`x-macuxi-tenant`; sem ele, a atual): com 2+, ela vai em `empresa` para sair da lista da Escolha.
 */
export function desvioDoErro(s: SessaoPortal | null, status: number, codigo: string, tenant?: string): DesvioPortal | null {
  if (!s || s.tipo !== 'admin_cliente') return null;
  if (status === 409 && codigo === CODIGOS_PORTAL.empresaNaoEscolhida) return s.empresas.length >= 2 ? { para: 'escolher', aviso: null } : { para: 'entrar', aviso: null };
  if (status === 403 && codigo === CODIGOS_PORTAL.empresaNaoPermitida) {
    if (s.empresas.length < 2) return { para: 'entrar', aviso: MENSAGEM_EMPRESA_INDISPONIVEL };
    const id = tenant ?? s.empresa?.id;
    const e = s.empresas.find((x) => x.id === id);
    return e ? { para: 'escolher', aviso: mensagemDaEmpresaIndisponivel(e.nome), empresa: { id: e.id, nome: e.nome } } : { para: 'escolher', aviso: MENSAGEM_EMPRESA_INDISPONIVEL };
  }
  return null;
}

let desvio: DesvioPortal | null = null;

/** Pede à guarda que leve para a escolha ou para a entrada (`useSyncExternalStore` com `lerDesvioPortal`). */
export function pedirDesvioPortal(d: DesvioPortal) {
  desvio = d;
  avisar();
}
/** Desvio pendente (mesma referência até mudar: serve de snapshot do `useSyncExternalStore`). */
export function lerDesvioPortal(): DesvioPortal | null {
  return desvio;
}
/** Lê e zera o desvio (a guarda consome uma vez). */
export function retirarDesvioPortal(): DesvioPortal | null {
  const d = desvio;
  desvio = null;
  return d;
}

/** Aviso para a próxima tela (entrada ou escolha): só o texto fixo da spec, nunca dado pessoal. Vale uma vez. */
export const CHAVE_AVISO_PORTAL = 'macuxi.portal.aviso';
const AVISOS_ACEITOS: readonly string[] = [MENSAGEM_EMPRESA_INDISPONIVEL];

export function guardarAvisoPortal(aviso: string, st: Storage | null = armazenamento()) {
  if (!AVISOS_ACEITOS.includes(aviso)) return;
  try {
    st?.setItem(CHAVE_AVISO_PORTAL, aviso);
  } catch {
    // sem storage: a tela abre sem o aviso
  }
}

export function consumirAvisoPortal(st: Storage | null = armazenamento()): string | null {
  try {
    const a = st?.getItem(CHAVE_AVISO_PORTAL) ?? null;
    st?.removeItem(CHAVE_AVISO_PORTAL);
    return a && AVISOS_ACEITOS.includes(a) ? a : null;
  } catch {
    return null;
  }
}

/**
 * Empresa do 403 para a Escolha a empresa (vale uma vez): id e nome, os mesmos da sessão (sem dado pessoal). A Escolha a tira da
 * lista e monta o aviso com `mensagemDaEmpresaIndisponivel`.
 */
export const CHAVE_EMPRESA_INDISPONIVEL = 'macuxi.portal.empresa-indisponivel';

export function guardarEmpresaIndisponivel(e: EmpresaIndisponivel, st: Storage | null = armazenamento()) {
  try {
    st?.setItem(CHAVE_EMPRESA_INDISPONIVEL, JSON.stringify({ id: e.id, nome: e.nome }));
  } catch {
    // sem storage: a Escolha abre sem o aviso (a sessão já saiu sem a empresa, quando possível)
  }
}

export function consumirEmpresaIndisponivel(st: Storage | null = armazenamento()): EmpresaIndisponivel | null {
  try {
    const bruto = st?.getItem(CHAVE_EMPRESA_INDISPONIVEL) ?? null;
    st?.removeItem(CHAVE_EMPRESA_INDISPONIVEL);
    if (!bruto) return null;
    const x = JSON.parse(bruto) as { id?: unknown; nome?: unknown };
    const ok = typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 64 && typeof x.nome === 'string' && x.nome.length > 0 && x.nome.length <= 200;
    return ok ? { id: x.id as string, nome: x.nome as string } : null;
  } catch {
    return null;
  }
}
