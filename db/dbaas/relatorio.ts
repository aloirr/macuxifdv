/**
 * Funções puras do teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075; dono: banco-dados).
 * Usadas por db/dbaas/teste-compatibilidade.ts (roda num contêiner da imagem da API, na VM da demo) e testadas em
 * db/testes/dbaas.test.ts. Nada aqui conecta em banco nem lê ambiente.
 *
 * Regra do relatório: ✅ (passou como está), ⚠️ (passou só pelo caminho alternativo do plano B, por falta de privilégio
 * no DBaaS) ou ❌ por item, versões e tempos. Nenhuma senha (mascarar) e nenhum dado pessoal.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

export type Situacao = 'ok' | 'alternativa' | 'falha';

/**
 * Grupos do relatório. `pre` e `c1`..`c4` (critérios 1–4 da T-0075) decidem o código de saída; `comp` (complementares)
 * só informa; `planob` mede os caminhos alternativos (B1, B2) e também só informa; `limpeza` falhando dá o código
 * LIMPEZA (sobrou base ou papel de teste no DBaaS).
 */
export type Grupo = 'pre' | 'c1' | 'c2' | 'c3' | 'c4' | 'comp' | 'planob' | 'limpeza';

export const TITULOS_GRUPO: Record<Grupo, string> = {
  pre: 'Pré-requisitos (alcance, conexão, versão)',
  c1: 'Critério 1 — extensão vector com o admin do DBaaS',
  c2: 'Critério 2 — migrações, papéis sem SUPERUSER/BYPASSRLS, RLS forçado, SECURITY DEFINER e seed demo',
  c3: 'Critério 3 — RLS na prática e suíte de banco (@macuxi/db, com o vazamento entre tenants)',
  c4: 'Critério 4 — índice HNSW criado e usado na busca (EXPLAIN)',
  comp: 'Complementares (não mudam o código de saída; entram no ADR)',
  planob: 'Caminhos alternativos medidos (plano B, sem SUPERUSER nem BYPASSRLS)',
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
  /** Critérios 1–4 sem ❌, mas sobrou base ou papel de teste no DBaaS (apague à mão ou apague a instância). */
  LIMPEZA: 4,
  /** Nenhum ❌ nos pré-requisitos e critérios 1–4, mas algum ⚠️: só passa com o plano B (seção do relatório). */
  PLANO_B: 5,
} as const;

/** Legenda dos códigos de saída (relatório e script da VM). */
export const LEGENDA_SAIDA = '0 = ok · 1 = critério ❌ · 2 = configuração · 3 = sem alcance · 4 = limpeza ❌ · 5 = só com o plano B (⚠️)';

/**
 * Erro causado por falta de privilégio no DBaaS (sem SUPERUSER/BYPASSRLS), e não por incompatibilidade do schema:
 * 42501, RLS que barra o dono das tabelas (FORCE), session_replication_role, atributo de papel que só superusuário muda.
 */
export function ehBloqueioDePrivilegio(mensagem: string): boolean {
  return /42501|permission denied|row-level security|session_replication_role|must be superuser|only roles with the|precisa de superusu[aá]rio|exige superusu[aá]rio/i.test(
    mensagem,
  );
}

/**
 * Verificador SCRAM-SHA-256 no formato do pg_authid (`SCRAM-SHA-256$<iter>:<sal>$<StoredKey>:<ServerKey>`, RFC 5802/7677),
 * calculado no cliente: o CREATE/ALTER ROLE ... PASSWORD leva o verificador e a senha em texto nunca chega ao servidor
 * (nem ao pgaudit/log_statement do DBaaS). Só ASCII imprimível sem espaço (as senhas do teste são hex): dispensa o SASLprep.
 */
export function verificadorScram(senha: string, sal: Buffer = randomBytes(16), iteracoes = 4096): string {
  if (!/^[\x21-\x7e]+$/.test(senha)) throw new Error('verificadorScram: só senha ASCII imprimível, sem espaço');
  const salgada = pbkdf2Sync(senha, sal, iteracoes, 32, 'sha256');
  const chaveCliente = createHmac('sha256', salgada).update('Client Key').digest();
  const chaveGuardada = createHash('sha256').update(chaveCliente).digest();
  const chaveServidor = createHmac('sha256', salgada).update('Server Key').digest();
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString('base64')}$${chaveGuardada.toString('base64')}:${chaveServidor.toString('base64')}`;
}

/** Chave estrangeira entre tabelas com tenant_id (catálogo pg_constraint), para a exclusão de tenant em ordem de FK. */
export interface ChaveEstrangeira {
  nome: string;
  /** Tabela que referencia ("esquema.tabela", já citada com aspas se precisar). */
  filha: string;
  /** Tabela referenciada. */
  mae: string;
  /** Colunas da filha na FK, sem tenant_id (as que o UPDATE ... SET NULL anula para quebrar um ciclo), já citadas. */
  colunas: string[];
  /** Todas as `colunas` aceitam nulo (com MATCH SIMPLE, uma coluna nula desliga a conferência da FK). */
  anulavel: boolean;
}

export type PassoExclusao = { tipo: 'anular'; tabela: string; colunas: string[]; fk: string } | { tipo: 'apagar'; tabela: string };

/**
 * Ordem de exclusão das linhas de um tenant SEM session_replication_role (plano B, B2): filhas antes das mães; ciclo
 * (ex.: core.usuario <-> core.equipe) quebrado antes anulando as colunas de uma FK anulável do ciclo. FK da tabela para
 * ela mesma fica de fora (um DELETE só apaga todas as linhas do tenant; NO ACTION confere no fim do comando).
 * `erro` diz as tabelas de um ciclo sem FK anulável (aí só com gatilho/FK desligados ou FK DEFERRABLE).
 */
export function ordemExclusao(tabelas: readonly string[], fks: readonly ChaveEstrangeira[]): { passos: PassoExclusao[]; erro: string | null } {
  const restantes = new Set(tabelas);
  let arestas = fks.filter((f) => f.filha !== f.mae && restantes.has(f.filha) && restantes.has(f.mae));
  const passos: PassoExclusao[] = [];
  while (restantes.size > 0) {
    const prontas = [...restantes].filter((t) => !arestas.some((a) => a.mae === t)).sort();
    if (prontas.length > 0) {
      for (const t of prontas) {
        passos.push({ tipo: 'apagar', tabela: t });
        restantes.delete(t);
      }
      arestas = arestas.filter((a) => restantes.has(a.filha) && restantes.has(a.mae));
      continue;
    }
    const quebra = arestas.filter((a) => a.anulavel && a.colunas.length > 0).sort((a, b) => a.nome.localeCompare(b.nome))[0];
    if (!quebra) return { passos, erro: `ciclo de FK sem coluna anulável entre: ${[...restantes].sort().join(', ')}` };
    passos.push({ tipo: 'anular', tabela: quebra.filha, colunas: quebra.colunas, fk: quebra.nome });
    arestas = arestas.filter((a) => a !== quebra);
  }
  return { passos, erro: null };
}

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
  const marca = item.situacao === 'ok' ? '✅' : item.situacao === 'alternativa' ? '⚠️' : '❌';
  const tempo = item.ms === undefined ? '' : ` (${formatarMs(item.ms)})`;
  const detalhe = item.detalhe ? ` — ${item.detalhe}` : '';
  return `${marca} ${item.codigo} ${item.titulo}${tempo}${detalhe}`;
}

const DECIDEM: readonly Grupo[] = ['pre', 'c1', 'c2', 'c3', 'c4'];

export function resumir(itens: readonly Item[]): { total: number; falhas: number; alternativas: number; codigo: number; linha: string } {
  const falhos = itens.filter((i) => i.situacao === 'falha');
  const alternativos = itens.filter((i) => i.situacao === 'alternativa');
  const decisivos = falhos.filter((i) => DECIDEM.includes(i.grupo));
  const decisivosAlt = alternativos.filter((i) => DECIDEM.includes(i.grupo));
  const limpeza = falhos.filter((i) => i.grupo === 'limpeza');
  const codigo = decisivos.length > 0 ? SAIDA.FALHA : limpeza.length > 0 ? SAIDA.LIMPEZA : decisivosAlt.length > 0 ? SAIDA.PLANO_B : SAIDA.OK;
  const lista = (xs: Item[]) => xs.map((i) => i.codigo).join(', ');
  const alt = decisivosAlt.length > 0 ? `; ⚠️ só pelo caminho alternativo: ${lista(decisivosAlt)}` : '';
  let linha: string;
  if (codigo === SAIDA.OK) {
    const extra = falhos.length > 0 ? ` (complementares com ❌: ${lista(falhos)})` : '';
    linha = `✅ RESULTADO: critérios 1–4 ✅ — ${itens.length - falhos.length - alternativos.length}/${itens.length} itens ✅${extra}`;
  } else if (codigo === SAIDA.LIMPEZA) {
    linha = `❌ RESULTADO: critérios 1–4 sem ❌, mas a limpeza falhou (${lista(limpeza)}): sobrou base ou papel de teste no DBaaS${alt}`;
  } else if (codigo === SAIDA.PLANO_B) {
    linha = `⚠️ RESULTADO: critérios 1–4 sem ❌, mas ${decisivosAlt.length} item(ns) só passam pelo caminho alternativo (${lista(decisivosAlt)}): aprovado só com o plano B (seção "Plano B")`;
  } else {
    linha = `❌ RESULTADO: ${decisivos.length} item(ns) dos critérios com ❌ (${lista(decisivos)})${alt}; ${falhos.length} de ${itens.length} itens ❌ no total`;
  }
  return { total: itens.length, falhas: falhos.length, alternativas: alternativos.length, codigo, linha };
}

/** Medições que decidem o texto da seção "Plano B" do relatório (null = não medido nesta execução). */
export interface MedicoesPlanoB {
  adminIgnoraRls: boolean | null;
  replicacaoPermitida: boolean | null;
  mgc: { existe: boolean; setRole: boolean | null; superusuario: boolean | null; ignoraRls: boolean | null } | null;
  /** ALTER ROLE <admin> BYPASSRLS ou CREATE ROLE ... BYPASSRLS passou (dentro de transação desfeita). */
  bypassConcedivel: boolean | null;
  vectorDireto: boolean | null;
  vectorViaMgc: boolean | null;
  /** B1 (política de manutenção) aplicado e com o seed/DEFINER funcionando; tabelas com RLS cobertas. */
  b1: { ok: boolean; variante: string; tabelas: number } | null;
  /** B2 (exclusão de tenant em ordem de FK): resultado, passos, ciclos anulados e gatilhos de DELETE vistos. */
  b2: { ok: boolean; passos: number; anuladas: string[]; gatilhos: string[]; erro: string | null } | null;
  /** O servidor registra comandos de papel (log_statement ddl/all ou pgaudit.log com role/ddl/all). */
  logRegistraPapel: boolean | null;
  suiteBloqueada: boolean;
}

const simNao = (v: boolean | null | undefined, sim = 'sim', nao = 'não'): string => (v === null || v === undefined ? 'não medido' : v ? sim : nao);

/**
 * Seção "Plano B" (T-0075): o que fazer no código se o DBaaS não der SUPERUSER nem BYPASSRLS, com o custo de cada
 * mudança. O texto fixo é a proposta do banco-dados; as linhas "Medido" vêm desta execução.
 */
export function secaoPlanoB(med: MedicoesPlanoB): string[] {
  const l: string[] = ['## Plano B — sem SUPERUSER nem BYPASSRLS (proposta do banco-dados, com o custo)', ''];
  if (med.adminIgnoraRls && med.replicacaoPermitida) {
    l.push('O admin ignora RLS e muda session_replication_role: o plano B não é necessário (só o B0 continua recomendado).', '');
  }
  const mgc = med.mgc;
  l.push(
    '**Medido nesta execução**',
    '',
    `- Admin ignora RLS (SUPERUSER/BYPASSRLS): ${simNao(med.adminIgnoraRls)} · session_replication_role: ${simNao(med.replicacaoPermitida, 'permitido', 'negado')}`,
    `- mgc_superuser: ${mgc ? (mgc.existe ? `SET ROLE ${simNao(mgc.setRole, 'funciona', 'negado')} · SUPERUSER ${simNao(mgc.superusuario)} · BYPASSRLS ${simNao(mgc.ignoraRls)}` : 'não existe') : 'não medido'}`,
    `- BYPASSRLS concedível pelo admin (ALTER ROLE ou CREATE ROLE, desfeito): ${simNao(med.bypassConcedivel)}`,
    `- CREATE EXTENSION vector: direto (pgextwlist) ${simNao(med.vectorDireto, 'funciona', 'negado')}${med.vectorViaMgc === null ? '' : ` · via SET ROLE mgc_superuser ${simNao(med.vectorViaMgc, 'funciona', 'negado')}`}`,
    `- B1 política de manutenção: ${med.b1 ? `${med.b1.ok ? '⚠️ funciona' : '❌ não resolveu'} (${med.b1.variante}; ${med.b1.tabelas} tabelas com RLS)` : 'não aplicado'}`,
    `- B2 exclusão em ordem de FK: ${med.b2 ? `${med.b2.ok ? '⚠️ funciona' : '❌ falhou'} (${med.b2.passos} passos${med.b2.anuladas.length ? `; ciclos quebrados em ${med.b2.anuladas.join(', ')}` : ''}${med.b2.gatilhos.length ? `; ${med.b2.gatilhos.length} gatilho(s) de DELETE disparam` : ''}${med.b2.erro ? `; ${med.b2.erro}` : ''})` : 'não medido'}`,
    `- O servidor registra comandos de papel no log: ${simNao(med.logRegistraPapel)}${med.suiteBloqueada ? ' · a suíte ficou bloqueada por privilégio (B0/B1)' : ''}`,
    '',
  );
  if (mgc?.setRole && (mgc.ignoraRls || mgc.superusuario)) {
    l.push(
      '**Atalho medido (sem migração):** `SET ROLE mgc_superuser` dá BYPASSRLS/superusuário. Seed, fixture e exclusão de tenant podem rodar sob esse papel e as funções SECURITY DEFINER podem ter `ALTER FUNCTION ... OWNER TO mgc_superuser` — confirmar com a Magalu que o papel é estável e suportado antes de depender dele; os itens B1 e B2 abaixo continuam sendo o caminho que não depende do provedor.',
      '',
    );
  }
  l.push(
    '**B0 — papéis sem ALTER de atributo (necessário em qualquer DBaaS; sem migração).** No PostgreSQL 16, quem não é superusuário não pode citar SUPERUSER/NOSUPERUSER, REPLICATION nem BYPASSRLS num ALTER ROLE (foi o "permission denied to alter role" da C2.2). `db/src/papeis.ts`: papel novo = CREATE ROLE com os atributos; papel existente = só `ALTER ROLE ... LOGIN PASSWORD <verificador SCRAM>` e conferência dos atributos em pg_roles (erro claro se tiver SUPERUSER/BYPASSRLS). A senha vai como verificador SCRAM calculado no cliente, nunca em texto (o DBaaS carrega pgaudit). Custo: 1 arquivo (~30 linhas) + 1 teste sem banco em db/testes; nenhum chamador muda. Este script já faz assim (C2.1).',
    '',
    '**B1 — papel de manutenção no lugar do BYPASSRLS (X1).** Migração nova `00nn_plataforma_manutencao`: `create role macuxi_manutencao nologin` (sem BYPASSRLS), `grant macuxi_manutencao to current_user with inherit true` (o migrador) e, num laço DO sobre toda tabela com RLS, `create policy manutencao on <t> for all to macuxi_manutencao using (true) with check (true)` — o mesmo padrão das políticas do macuxi_worker (0003). Como o migrador é dono das funções SECURITY DEFINER e herda o papel, as 5 migrações com DEFINER (0001, 0010, 0011, 0024, 0027) e a 0029 (provisionar_tenant) voltam a enxergar todos os tenants sem ALTER FUNCTION. Seed demo e Fase M, as 5 fixtures (dois-tenants, gestor, pesquisa, promotor, treinamento) e os ~25 testes que preparam dados pela conexão admin passam sem mudar código. Custo: 1 migração + down; `db/scripts/conferir-rls.sql` e `tests/integracao/banco/conformidade.test.ts` passam a exigir a política `manutencao` em toda tabela (e toda migração futura com tabela nova a cria junto); `docs/banco/rls.md`. Risco: o mesmo de hoje com superusuário (a conexão admin vê todos os tenants); a API e o worker nunca usam o admin (S0-028). A sugestão de rodar seed e fixture só com `SET app.tenant_id` por tenant NÃO basta: as políticas atuais são `to macuxi_app`, e o admin com o tenant na sessão continua sem política (0 linhas, INSERT negado). Variante mais restrita (B1′): política de manutenção `using (tenant_id = plataforma.tenant_atual())` e `using (true)` só de leitura nas tabelas que as DEFINER entre tenants leem; custo extra: seed, as 5 fixtures e o --recriar passam a fazer `set_config(\'app.tenant_id\', ...)` por tenant (~8 arquivos em db/seeds e db/testes) e a política difere por tabela.',
    '',
    '**B2 — exclusão de tenant e --recriar sem session_replication_role (X2).** Migração nova recriando `plataforma.excluir_tenant(uuid, text)` (mesma assinatura e retorno da 0024; o down volta ao corpo da 0024) com DELETE em ordem de FK calculada no catálogo (filhas antes; ciclo como core.usuario <-> core.equipe quebrado com `update ... set <fk> = null` antes), sem desligar gatilhos: os gatilhos de DELETE listados no item B2 passam a disparar e precisam ignorar a exclusão de tenant (`current_setting(\'app.excluindo_tenant\', true) = \'on\'`, só na transação) ou ser aceitos. `db/seeds/demo/demo.ts` (apagarTenantDemo, ~10 linhas) chama a mesma ordem; `db/testes/lgpd-outbox.test.ts` ajusta. Custo: 1 migração + down, 2 arquivos TS; depende do B1 (o admin precisa enxergar as linhas). Alternativa sem código: pedir à Magalu `GRANT SET ON PARAMETER session_replication_role TO macuxi_admin` (só superusuário concede).',
    '',
    '**B3 — vector.** Se o CREATE EXTENSION direto falhar, pedir à Magalu a vector na lista do pgextwlist (extwlist.extensions) para o admin; sem a extensão, a busca semântica do Catálogo (embeddings, HNSW) não roda e o critério 4 reprova.',
    '',
    '**Ordem sugerida:** B0 (antes de qualquer nova execução com a suíte) → B1 → B2 → nova execução deste teste, que então deve sair com ✅/⚠️ apenas no que depender do provedor.',
  );
  return l;
}

/** Classifica o resultado da suíte: ❌ só por falha real; bloqueio de privilégio do DBaaS = ⚠️ (depende do plano B). */
export function classificarSuite(
  resumo: ResumoSuite,
  motivoGeral: string,
  travaLocal: RegExp,
): { situacao: Situacao; reais: ResumoSuite['falhas']; bloqueadas: ResumoSuite['falhas']; trava: ResumoSuite['falhas'] } {
  const trava = resumo.falhas.filter((f) => travaLocal.test(f.mensagem));
  const resto = resumo.falhas.filter((f) => !travaLocal.test(f.mensagem));
  const bloqueadas = resto.filter((f) => ehBloqueioDePrivilegio(f.mensagem));
  const reais = resto.filter((f) => !ehBloqueioDePrivilegio(f.mensagem));
  let situacao: Situacao;
  if (resumo.arquivos === 0) situacao = ehBloqueioDePrivilegio(motivoGeral) ? 'alternativa' : 'falha';
  else if (reais.length > 0) situacao = 'falha';
  else situacao = bloqueadas.length > 0 ? 'alternativa' : 'ok';
  return { situacao, reais, bloqueadas, trava };
}

export interface CabecalhoRelatorio {
  quando: string;
  alvo: string;
  versoes: string[];
  duracaoMs: number;
}

/** Relatório em Markdown (vai inteiro para o resumo do job do workflow dbaas-teste.yml). */
export function montarMarkdown(cab: CabecalhoRelatorio, itens: readonly Item[], explainHnsw: string | null, planoB: readonly string[] = []): string {
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
  if (planoB.length > 0) linhas.push('', ...planoB);
  linhas.push('', `Código de saída: ${r.codigo} (${LEGENDA_SAIDA})`, '');
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
