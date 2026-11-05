/**
 * Funções puras do teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075; dono: banco-dados).
 * Usadas por db/dbaas/teste-compatibilidade.ts (roda num contêiner da imagem da API, na VM da demo) e testadas em
 * db/testes/dbaas.test.ts. Nada aqui conecta em banco nem lê ambiente.
 *
 * Regra do relatório: só ✅/❌ por item, versões e tempos. Nenhuma senha (mascarar) e nenhum dado pessoal.
 */

export type Situacao = 'ok' | 'falha';

/**
 * Grupos do relatório. `pre` e `c1`..`c4` (critérios 1–4 da T-0075) decidem o código de saída; `comp` (complementares)
 * só informa; `limpeza` falhando dá o código LIMPEZA (a base ficou no DBaaS).
 */
export type Grupo = 'pre' | 'c1' | 'c2' | 'c3' | 'c4' | 'comp' | 'limpeza';

export const TITULOS_GRUPO: Record<Grupo, string> = {
  pre: 'Pré-requisitos (alcance, conexão, versão)',
  c1: 'Critério 1 — extensão vector com o admin do DBaaS',
  c2: 'Critério 2 — migrações, papéis sem SUPERUSER/BYPASSRLS, RLS forçado, SECURITY DEFINER e seed demo',
  c3: 'Critério 3 — RLS na prática e suíte de banco (@macuxi/db, com o vazamento entre tenants)',
  c4: 'Critério 4 — índice HNSW criado e usado na busca (EXPLAIN)',
  comp: 'Complementares (não mudam o código de saída; entram no ADR)',
  limpeza: 'Limpeza (bases de teste apagadas; a instância quem apaga é o dono do produto)',
};

export interface Item {
  grupo: Grupo;
  /** Código curto e estável (ex.: "C2.3"), para o ADR citar o item. */
  codigo: string;
  titulo: string;
  situacao: Situacao;
  /** Detalhe curto, já mascarado (versões, contagens, motivo da falha). */
  detalhe?: string;
  /** Duração em milissegundos (omitida quando não se aplica). */
  ms?: number;
  /** Linhas extras (ex.: arquivos da suíte que falharam), já mascaradas. */
  subitens?: string[];
}

/** Códigos de saída do script (o workflow dbaas-teste.yml usa para o vermelho/verde). */
export const SAIDA = {
  /** Pré-requisitos e critérios 1–4 ✅ e limpeza ✅. */
  OK: 0,
  /** Pelo menos um item ❌ nos pré-requisitos ou nos critérios 1–4 (o relatório diz qual). */
  FALHA: 1,
  /** Uso/configuração errados (senha ausente, host local, Docker ausente). Nada foi tocado no DBaaS. */
  CONFIGURACAO: 2,
  /** O DBaaS não respondeu em host:porta (rede, VPC, grupo de segurança). Nada foi tocado no DBaaS. */
  SEM_ALCANCE: 3,
  /** Critérios 1–4 ✅, mas sobrou base de teste no DBaaS (apague à mão ou apague a instância). */
  LIMPEZA: 4,
} as const;

/** Troca cada segredo (e a forma URL-encoded dele) por *** e esconde credencial de URL postgres://. */
export function mascarar(texto: string, segredos: readonly string[]): string {
  let saida = texto;
  const formas = new Set<string>();
  for (const s of segredos) {
    if (!s || s.length < 4) continue;
    formas.add(s);
    formas.add(encodeURIComponent(s));
  }
  // as mais longas primeiro: uma forma pode conter outra
  for (const f of [...formas].sort((a, b) => b.length - a.length)) saida = saida.split(f).join('***');
  return saida.replace(/(postgres(?:ql)?:\/\/)[^@\s/]*@/gi, '$1***@');
}

/** Nome da base de teste com data e hora UTC: macuxi_dbaas_AAAAMMDD_HHMMSS (cabe em validarNomeBanco). */
export function nomeBaseTeste(agora: Date): string {
  const iso = agora.toISOString(); // 2026-11-05T15:30:12.345Z
  return `macuxi_dbaas_${iso.slice(0, 10).replace(/-/g, '')}_${iso.slice(11, 19).replace(/:/g, '')}`;
}

/** Percentil p (0..100) pelo método do vizinho mais próximo; lista vazia = NaN. */
export function percentil(valores: readonly number[], p: number): number {
  if (valores.length === 0) return Number.NaN;
  const ordenados = [...valores].sort((a, b) => a - b);
  const pos = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[pos]!;
}

/** Versão "a.b.c" >= mínima "x.y.z" (partes ausentes valem 0; sufixos não numéricos são ignorados). */
export function versaoAtende(versao: string, minima: string): boolean {
  const partes = (v: string) => v.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const a = partes(versao);
  const b = partes(minima);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type ModoTls = 'prefer' | 'require' | 'verify-full' | 'disable';

/**
 * Tentativas de PGSSLMODE do node-pg para o DBAAS_SSLMODE pedido (semântica do libpq): prefer = TLS sem conferir
 * certificado e, se o servidor não tiver TLS, sem TLS; require = TLS sem conferir certificado; verify-full = TLS com
 * cadeia e nome conferidos; disable = sem TLS. (No node-pg, PGSSLMODE=prefer/require CONFERE o certificado: por isso
 * o "no-verify".)
 */
export function tentativasTls(modo: string): Array<'no-verify' | 'verify-full' | 'disable'> | null {
  switch (modo) {
    case 'prefer':
      return ['no-verify', 'disable'];
    case 'require':
      return ['no-verify'];
    case 'verify-full':
      return ['verify-full'];
    case 'disable':
      return ['disable'];
    default:
      return null;
  }
}

export type TipoErroConexao = 'tls' | 'recusada' | 'tempo' | 'autenticacao' | 'pg_hba' | 'outro';

/** Classifica o erro de conexão do `pg` para dar uma mensagem clara (e decidir a próxima tentativa de TLS). */
export function classificarErroConexao(e: unknown): { tipo: TipoErroConexao; mensagem: string } {
  const lista = e instanceof AggregateError ? e.errors : [e];
  const textos = lista.map((x) => {
    const err = x as { code?: string; message?: string };
    return `${err.code ?? ''} ${err.message ?? String(x)}`.trim();
  });
  const t = textos.join('; ');
  const tls = { tipo: 'tls' as const, mensagem: 'TLS: o servidor exige TLS, não tem TLS ou o certificado não confere' };
  // "no pg_hba.conf entry ..., no encryption" = o servidor só aceita com TLS (antes da regra geral do pg_hba)
  if (/no encryption/i.test(t)) return tls;
  if (/pg_hba\.conf/i.test(t)) return { tipo: 'pg_hba', mensagem: 'o pg_hba.conf do DBaaS recusou este IP/usuário/banco' };
  if (/server does not support SSL|self[- ]signed|certificate|SSL/i.test(t)) return tls;
  if (/28P01|password authentication failed/i.test(t)) return { tipo: 'autenticacao', mensagem: 'usuário ou senha do admin recusados' };
  if (/ECONNREFUSED/i.test(t)) return { tipo: 'recusada', mensagem: 'conexão recusada (porta fechada ou instância parada)' };
  if (/ETIMEDOUT|timeout|EHOSTUNREACH|ENETUNREACH/i.test(t)) return { tipo: 'tempo', mensagem: 'sem resposta (rede, VPC ou grupo de segurança)' };
  return { tipo: 'outro', mensagem: t.slice(0, 200) || 'erro desconhecido' };
}

/**
 * Problemas de um search_path de função SECURITY DEFINER (regra da migração 0012): fixo, sem `public`/`$user` e com
 * `pg_temp` por último. `null` = função sem search_path fixo. Lista vazia = seguro.
 */
export function problemasSearchPath(searchPath: string | null): string[] {
  if (searchPath === null) return ['sem search_path fixo'];
  const partes = searchPath
    .split(',')
    .map((p) => p.trim().replace(/^"(.*)"$/, '$1'))
    .filter((p) => p !== '');
  if (partes.length === 0) return []; // search_path vazio: só pg_catalog implícito; seguro
  const problemas: string[] = [];
  if (partes.some((p) => p === 'public' || p === '$user')) problemas.push('search_path com public ou $user');
  if (partes[partes.length - 1] !== 'pg_temp') problemas.push('pg_temp não é o último do search_path');
  return problemas;
}

/** search_path de um proconfig (`{search_path=pg_catalog, plataforma, pg_temp}`); null se não houver. */
export function searchPathDoProconfig(proconfig: readonly string[] | null): string | null {
  const achado = (proconfig ?? []).find((c) => c.startsWith('search_path='));
  return achado === undefined ? null : achado.slice('search_path='.length);
}

export function formatarMs(ms: number): string {
  if (!Number.isFinite(ms)) return '?';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 120_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`;
}

/** Uma linha do relatório: "✅ C2.3 Título (1.2 s) — detalhe". */
export function formatarItem(item: Item): string {
  const marca = item.situacao === 'ok' ? '✅' : '❌';
  const tempo = item.ms === undefined ? '' : ` (${formatarMs(item.ms)})`;
  const detalhe = item.detalhe ? ` — ${item.detalhe}` : '';
  return `${marca} ${item.codigo} ${item.titulo}${tempo}${detalhe}`;
}

const DECIDEM: readonly Grupo[] = ['pre', 'c1', 'c2', 'c3', 'c4'];

export function resumir(itens: readonly Item[]): { total: number; falhas: number; codigo: number; linha: string } {
  const falhos = itens.filter((i) => i.situacao === 'falha');
  const decisivos = falhos.filter((i) => DECIDEM.includes(i.grupo));
  const limpeza = falhos.filter((i) => i.grupo === 'limpeza');
  const codigo = decisivos.length > 0 ? SAIDA.FALHA : limpeza.length > 0 ? SAIDA.LIMPEZA : SAIDA.OK;
  const lista = (xs: Item[]) => xs.map((i) => i.codigo).join(', ');
  let linha: string;
  if (codigo === SAIDA.OK) {
    const extra = falhos.length > 0 ? ` (complementares com ❌: ${lista(falhos)})` : '';
    linha = `✅ RESULTADO: critérios 1–4 ✅ — ${itens.length - falhos.length}/${itens.length} itens ✅${extra}`;
  } else if (codigo === SAIDA.LIMPEZA) {
    linha = `❌ RESULTADO: critérios 1–4 ✅, mas a limpeza falhou (${lista(limpeza)}): sobrou base de teste no DBaaS`;
  } else {
    linha = `❌ RESULTADO: ${decisivos.length} item(ns) dos critérios com ❌ (${lista(decisivos)}); ${falhos.length} de ${itens.length} itens ❌ no total`;
  }
  return { total: itens.length, falhas: falhos.length, codigo, linha };
}

export interface CabecalhoRelatorio {
  quando: string;
  alvo: string;
  versoes: string[];
  duracaoMs: number;
}

/** Relatório em Markdown (vai inteiro para o resumo do job do workflow dbaas-teste.yml). */
export function montarMarkdown(cab: CabecalhoRelatorio, itens: readonly Item[], explainHnsw: string | null): string {
  const r = resumir(itens);
  const linhas: string[] = [
    '# Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075)',
    '',
    `- Quando (UTC): ${cab.quando}`,
    `- Alvo: ${cab.alvo}`,
    ...cab.versoes.map((v) => `- ${v}`),
    `- Duração total: ${formatarMs(cab.duracaoMs)}`,
    '',
    `**${r.linha}**`,
  ];
  for (const g of Object.keys(TITULOS_GRUPO) as Grupo[]) {
    const doGrupo = itens.filter((i) => i.grupo === g);
    if (doGrupo.length === 0) continue;
    linhas.push('', `## ${TITULOS_GRUPO[g]}`, '');
    for (const i of doGrupo) {
      linhas.push(`- ${formatarItem(i)}`);
      for (const s of i.subitens ?? []) linhas.push(`  - ${s}`);
    }
    if (g === 'c4' && explainHnsw) linhas.push('', 'EXPLAIN (ANALYZE) da busca por vizinhos:', '', '```', explainHnsw, '```');
  }
  linhas.push('', `Código de saída: ${r.codigo} (0 = ok · 1 = critério ❌ · 2 = configuração · 3 = sem alcance · 4 = limpeza ❌)`, '');
  return linhas.join('\n');
}

/** Resumo do JSON do reporter "json" do Vitest: por arquivo, verde ou vermelho, com os casos que falharam. */
export interface ResumoSuite {
  arquivos: number;
  arquivosVerdes: number;
  casos: number;
  casosVerdes: number;
  casosFalhos: number;
  casosPulados: number;
  falhas: Array<{ arquivo: string; casos: string[]; mensagem: string }>;
}

interface JsonVitest {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: Array<{
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string; failureMessages?: string[] }>;
  }>;
}

export function resumirVitest(json: unknown): ResumoSuite {
  const j = (json ?? {}) as JsonVitest;
  const arquivos = j.testResults ?? [];
  const falhas: ResumoSuite['falhas'] = [];
  for (const a of arquivos) {
    const casos = (a.assertionResults ?? []).filter((c) => c.status === 'failed');
    if (a.status !== 'failed' && casos.length === 0) continue;
    const nome = (a.name ?? '?').replace(/\\/g, '/').replace(/^.*\/db\//, 'db/');
    const primeira = casos.find((c) => c.failureMessages?.length)?.failureMessages?.[0] ?? a.message ?? '';
    falhas.push({ arquivo: nome, casos: casos.map((c) => c.fullName ?? c.title ?? '?'), mensagem: primeiraLinhaUtil(primeira) });
  }
  return {
    arquivos: arquivos.length,
    arquivosVerdes: arquivos.length - falhas.length,
    casos: j.numTotalTests ?? 0,
    casosVerdes: j.numPassedTests ?? 0,
    casosFalhos: j.numFailedTests ?? 0,
    casosPulados: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0),
    falhas,
  };
}

/** Primeira linha que não é pilha (at ...) nem vazia, cortada em 240 caracteres. */
export function primeiraLinhaUtil(texto: string): string {
  const linha = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !/^at\s/.test(l));
  return (linha ?? '').slice(0, 240);
}

/** Nomes de índices citados num plano EXPLAIN (FORMAT JSON), em profundidade. */
export function indicesDoPlano(plano: unknown): string[] {
  const achados = new Set<string>();
  const visitar = (no: unknown): void => {
    if (!no || typeof no !== 'object') return;
    if (Array.isArray(no)) {
      for (const x of no) visitar(x);
      return;
    }
    const o = no as Record<string, unknown>;
    if (typeof o['Index Name'] === 'string') achados.add(o['Index Name']);
    for (const v of Object.values(o)) visitar(v);
  };
  visitar(plano);
  return [...achados];
}

/** Versão exata do Vitest no pnpm-lock.yaml (a mesma do CI); null se não achar. */
export function versaoVitestDoLock(lock: string): string | null {
  const m = /^ {2}vitest@(\d+\.\d+\.\d+):/m.exec(lock);
  return m ? m[1]! : null;
}
