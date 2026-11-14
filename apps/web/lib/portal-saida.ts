/**
 * "Segurar a saída" do portal `config.` (T-0087 fatia E; revisão de UX R-20261106-050553 R1, Y2): o que aparece uma vez só
 * (ex.: links renovados) fica registrado aqui enquanto não for baixado. O cabeçalho do portal
 * ("← Empresas", a marca, "Sair") consulta antes de navegar e abre o Dialog; a guarda da sessão avisa antes do fim e, se a sessão
 * vencer com pendência, oferece baixar antes de mandar ao login; o `beforeunload` cobre fechar a aba e o F5.
 * Só memória da aba (LGPD, T-0087 §7): nada vai ao storage nem ao `console`. As regras de tempo são puras, para teste.
 */
import { RENOVAR_ANTES_MS, type SessaoPortal } from './portal-sessao';

export interface SaidaPendente {
  /** Quem segura (ex.: `renovados:<tenant>`); registrar de novo com o mesmo id substitui. */
  id: string;
  /** Rótulo do botão "Baixar …" no Dialog. */
  rotulo: string;
  /** Baixa o arquivo (local, sem rede: funciona com a sessão vencida). Quem registrou libera a pendência ao baixar. */
  baixar: () => void;
}

const pendentes = new Map<string, SaidaPendente>();
const ouvintes = new Set<() => void>();
let versao = 0;

function avisar() {
  versao++;
  for (const o of ouvintes) o();
}

/** Registra (ou troca) uma pendência; devolve a função que libera. */
export function segurarSaida(p: SaidaPendente): () => void {
  pendentes.set(p.id, p);
  avisar();
  return () => liberarSaida(p.id);
}

export function liberarSaida(id: string) {
  if (pendentes.delete(id)) avisar();
}

export function pendenciasDeSaida(): SaidaPendente[] {
  return [...pendentes.values()];
}

export function haSaidaSegurada(): boolean {
  return pendentes.size > 0;
}

/** Baixa tudo o que está pendente (o Dialog "Baixar convites e sair"). */
export function baixarPendencias() {
  for (const p of pendenciasDeSaida()) p.baixar();
}

export function assinarSaida(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function versaoDaSaida(): number {
  return versao;
}

/** "Sair sem baixar": a pessoa decidiu perder os links (e no teste). */
export function descartarPendenciasDeSaida() {
  if (pendentes.size === 0) return;
  pendentes.clear();
  avisar();
}

// ---------------------------------------------------------------------------------------------------------------- fim da sessão

/** Avisa o fim do teto da sessão (8 h, sem renovação) com esta antecedência. */
export const AVISO_TETO_MS = 10 * 60_000;

export type AvisoDeFim = { tipo: 'nenhum' } | { tipo: 'teto'; minutos: number } | { tipo: 'parado'; minutos: number };

/**
 * Com pendência de saída, a sessão vai acabar logo? `teto` = faltam até 10 min para o teto (não há renovação: só baixar);
 * `parado` = o token está perto do fim e sem uso recente, então não será renovado (continuar = uso, que renova).
 * Sem pendência, nada a avisar (o portal segue a regra normal da sessão).
 */
export function avisoDeFimDaSessao(s: SessaoPortal | null, agora: number, o: { pendente: boolean; usoRecente: boolean }): AvisoDeFim {
  if (!s || !o.pendente) return { tipo: 'nenhum' };
  const teto = Date.parse(s.sessao_expira_em);
  const fimToken = Date.parse(s.expira_em);
  if (!Number.isFinite(teto) || !Number.isFinite(fimToken) || agora >= teto || agora >= fimToken) return { tipo: 'nenhum' };
  const minutos = (ate: number) => Math.max(1, Math.ceil((ate - agora) / 60_000));
  if (teto - agora <= AVISO_TETO_MS) return { tipo: 'teto', minutos: minutos(teto) };
  if (fimToken - agora <= RENOVAR_ANTES_MS && !o.usoRecente) return { tipo: 'parado', minutos: minutos(fimToken) };
  return { tipo: 'nenhum' };
}
