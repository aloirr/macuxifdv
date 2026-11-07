/**
 * Nome do banco SQLite do usuário no aparelho (desenho T-0088 §1.1; ADR 0003, adendo de 2026-11-06): um arquivo por
 * usuário e tenant, `macuxi-u-<usuarioId>-t-<tenantId|demo>.db`. O tenant entra porque uma base recriada (demo, ensaio)
 * pode repetir o UUID do usuário num tenant novo: a fila de um tenant nunca cai no arquivo de outro.
 * Função pura, a mesma no shell (abrir e, no bloqueio do aparelho, apagar) e no teste do banco (`db/testes`).
 */

/** Arquivos de usuário na pasta do SQLite (com os anexos do WAL). Casa só nomes montados por `arquivoDoUsuario`. */
export const ARQUIVO_DE_USUARIO_RE = /^macuxi-u-[0-9a-f-]{36}-t-([0-9a-f-]{36}|demo)\.db(-wal|-shm|-journal)?$/;

const UUID_RE = /^[0-9a-f-]{36}$/;
/** Tenant da demonstração (mock-api, sem tenant na sessão). */
export const TENANT_DEMO = 'demo';

/**
 * Nome do arquivo do usuário, ou `null` se algum id não tem o formato de UUID (a sessão fica no AsyncStorage, reserva
 * do §4). Sem tenant (demonstração) = `demo`. Maiúsculas viram minúsculas (o UUID não diferencia).
 */
export function arquivoDoUsuario(ids: { usuarioId: string; tenantId?: string | null }): string | null {
  const u = ids.usuarioId.trim().toLowerCase();
  const t = (ids.tenantId ?? '').trim().toLowerCase() || TENANT_DEMO;
  if (!UUID_RE.test(u) || (t !== TENANT_DEMO && !UUID_RE.test(t))) return null;
  return `macuxi-u-${u}-t-${t}.db`;
}

/**
 * Bancos de usuário entre os nomes da pasta do SQLite (sem os anexos `-wal`/`-shm`/`-journal`, sem repetição): o que o
 * bloqueio do aparelho (RN-CORE-15) apaga. Nome fora do padrão (ex.: `macuxi-diagnostico-carga.db`) fica de fora.
 */
export function bancosDeUsuario(nomes: readonly string[]): string[] {
  const bancos = new Set<string>();
  for (const n of nomes) if (ARQUIVO_DE_USUARIO_RE.test(n)) bancos.add(n.replace(/-(wal|shm|journal)$/, ''));
  return [...bancos].sort();
}
