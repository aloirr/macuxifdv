/**
 * Limite diário de consultas inteligentes por usuário (RN-CAT-03) e cache de consultas frequentes (RF-CAT-01).
 * Regras puras: quem guarda o contador e o cache (Postgres/Redis) é a API.
 * RN-CAT-03: só consulta RESPONDIDA pelo provedor consome a cota. Falha do provedor (erro ou tempo esgotado),
 * resposta do cache, busca offline e busca simples não consomem.
 * Ordem na API: cache → `verificarConsultaIa` (barra sem consumir) → `interpretarBusca` (ou a pergunte) →
 * `registrarDesfechoIa(…, desfecho)` (consome só se `respondida`, com incremento atômico no banco).
 */
import { localDate } from '@macuxi/comum';
import type { ParametrosCatalogo } from './parametros';
import { chaveDeTermo } from './texto';

export interface UsoIa {
  /** Dia civil no fuso do tenant (AAAA-MM-DD). */
  dia: string;
  consultas: number;
}

export interface ResultadoLimite {
  permitido: boolean;
  /** Estado a gravar. Igual ao de entrada (ou zerado no dia novo) quando barrado. */
  uso: UsoIa;
  restantes: number;
  motivo: 'limite_atingido' | 'ia_desligada' | null;
  mensagem: string | null;
}

export const MENSAGEM_LIMITE_ATINGIDO = 'Você atingiu o limite de buscas inteligentes de hoje. A busca simples continua disponível; o limite volta amanhã.';
export const MENSAGEM_IA_DESLIGADA = 'A busca inteligente não está habilitada para a sua empresa. Use a busca simples.';

/** Dia civil (AAAA-MM-DD) de um instante no fuso do tenant. */
export function diaDoTenant(agora: string | Date, fuso: string): string {
  const d = typeof agora === 'string' ? new Date(agora) : agora;
  if (Number.isNaN(d.getTime())) throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
  return localDate(d, fuso);
}

function usoDeHoje(uso: UsoIa | null, agora: string, p: Pick<ParametrosCatalogo, 'fuso'>): UsoIa {
  const dia = diaDoTenant(agora, p.fuso);
  return uso && uso.dia === dia ? uso : { dia, consultas: 0 };
}

/** Quantas consultas de IA ainda restam hoje (não consome). */
export function consultasRestantes(uso: UsoIa | null, agora: string, p: Pick<ParametrosCatalogo, 'fuso' | 'limite_consultas_ia_dia'>): number {
  return Math.max(0, p.limite_consultas_ia_dia - usoDeHoje(uso, agora, p).consultas);
}

/**
 * Desfecho de uma tentativa de IA (RN-CAT-03): `respondida` = o provedor devolveu uma resposta (mesmo fora do
 * formato, que cai na contingência: houve custo); `erro` / `tempo_esgotado` = falha do provedor;
 * `nao_chamada` = cache, offline, limite, IA desligada, sem provedor ou busca simples.
 */
export type DesfechoIa = 'respondida' | 'erro' | 'tempo_esgotado' | 'nao_chamada';

/** RN-CAT-03: só a consulta respondida consome a cota. */
export function consomeCotaIa(desfecho: DesfechoIa): boolean {
  return desfecho === 'respondida';
}

/** RN-CAT-03: confere se ainda pode chamar o provedor, sem consumir. Use antes da chamada. */
export function verificarConsultaIa(uso: UsoIa | null, agora: string, p: Pick<ParametrosCatalogo, 'fuso' | 'limite_consultas_ia_dia'>): ResultadoLimite {
  const hoje = usoDeHoje(uso, agora, p);
  if (p.limite_consultas_ia_dia === 0) return { permitido: false, uso: hoje, restantes: 0, motivo: 'ia_desligada', mensagem: MENSAGEM_IA_DESLIGADA };
  if (hoje.consultas >= p.limite_consultas_ia_dia) return { permitido: false, uso: hoje, restantes: 0, motivo: 'limite_atingido', mensagem: MENSAGEM_LIMITE_ATINGIDO };
  return { permitido: true, uso: hoje, restantes: p.limite_consultas_ia_dia - hoje.consultas, motivo: null, mensagem: null };
}

export interface ResultadoDesfecho {
  /** Estado a gravar. */
  uso: UsoIa;
  restantes: number;
  consumiu: boolean;
}

/**
 * RN-CAT-03: grava o desfecho da tentativa. `respondida` consome uma (sem passar do limite, caso duas consultas
 * tenham passado juntas pela verificação); qualquer outro desfecho devolve o uso como estava.
 */
export function registrarDesfechoIa(uso: UsoIa | null, agora: string, p: Pick<ParametrosCatalogo, 'fuso' | 'limite_consultas_ia_dia'>, desfecho: DesfechoIa): ResultadoDesfecho {
  if (consomeCotaIa(desfecho)) {
    const r = registrarConsultaIa(uso, agora, p);
    return { uso: r.uso, restantes: r.restantes, consumiu: r.permitido };
  }
  const hoje = usoDeHoje(uso, agora, p);
  return { uso: hoje, restantes: Math.max(0, p.limite_consultas_ia_dia - hoje.consultas), consumiu: false };
}

/** Consome uma consulta de IA (use `registrarDesfechoIa`, que só chama esta quando o provedor respondeu). Barrado ⇒ o app/API cai para a busca simples e mostra `mensagem`. */
export function registrarConsultaIa(uso: UsoIa | null, agora: string, p: Pick<ParametrosCatalogo, 'fuso' | 'limite_consultas_ia_dia'>): ResultadoLimite {
  const hoje = usoDeHoje(uso, agora, p);
  if (p.limite_consultas_ia_dia === 0) {
    return { permitido: false, uso: hoje, restantes: 0, motivo: 'ia_desligada', mensagem: MENSAGEM_IA_DESLIGADA };
  }
  if (hoje.consultas >= p.limite_consultas_ia_dia) {
    return { permitido: false, uso: hoje, restantes: 0, motivo: 'limite_atingido', mensagem: MENSAGEM_LIMITE_ATINGIDO };
  }
  const novo = { dia: hoje.dia, consultas: hoje.consultas + 1 };
  return { permitido: true, uso: novo, restantes: p.limite_consultas_ia_dia - novo.consultas, motivo: null, mensagem: null };
}

// ---------- cache ----------
export interface EntradaChaveCache {
  tenant_id: string;
  /** `interpretacao`: frase → filtros (o que custa LLM). `pergunta`: resposta do "Pergunte ao catálogo". */
  tipo: 'interpretacao' | 'pergunta';
  consulta: string;
  /** Quando a resposta depende de contexto (produto, tabela de preço, filiais), ele entra na chave. */
  escopo?: { produto_id?: string | null; tabela_id?: string | null; filiais?: readonly string[] };
}

const enc = (s: string) => encodeURIComponent(s);

/**
 * Chave do cache: `catalogo:cache:v1:<tipo>:<tenant>:<escopo>:<consulta normalizada>`. A consulta é normalizada
 * (caixa, acento, medida, plural) mas mantém a ordem e as palavras de negação — "com" e "sem" não se misturam.
 */
export function chaveCache(e: EntradaChaveCache): string {
  const tenant = e.tenant_id.trim();
  if (tenant === '') throw new RangeError('O cache de busca exige o tenant.');
  const filiais = [...(e.escopo?.filiais ?? [])].sort().map(enc).join(',');
  const escopo = [enc(e.escopo?.produto_id ?? ''), enc(e.escopo?.tabela_id ?? ''), filiais].join('|');
  return ['catalogo', 'cache', 'v1', e.tipo, enc(tenant), escopo, enc(chaveDeTermo(e.consulta))].join(':');
}

/** A entrada vale se é do mesmo tenant e ainda não passou do tempo de vida (`cache_ttl_s`). */
export function cacheValido(entrada: { tenant_id: string; gravado_em: string }, tenantId: string, agora: string, p: Pick<ParametrosCatalogo, 'cache_ttl_s'>): boolean {
  if (p.cache_ttl_s <= 0 || entrada.tenant_id !== tenantId) return false;
  const idade = Date.parse(agora) - Date.parse(entrada.gravado_em);
  return Number.isFinite(idade) && idade >= 0 && idade < p.cache_ttl_s * 1000;
}

/** Só vale guardar a consulta que já apareceu `cache_min_ocorrencias` vezes (frequente). */
export function deveGuardarNoCache(ocorrencias: number, p: Pick<ParametrosCatalogo, 'cache_ttl_s' | 'cache_min_ocorrencias'>): boolean {
  return p.cache_ttl_s > 0 && ocorrencias >= p.cache_min_ocorrencias;
}
