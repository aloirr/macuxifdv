/**
 * Nome do banco SQLite do usuário no aparelho (desenho T-0088 §1.1; ADR 0003, adendo de 2026-11-06): um arquivo por
 * usuário e tenant, `macuxi-u-<usuario>-t-<tenant|demo>.db`. O tenant entra porque uma base recriada (demo, ensaio)
 * pode repetir o UUID do usuário num tenant novo: a fila de um tenant nunca cai no arquivo de outro.
 * Função pura, a mesma no shell (abrir e, no bloqueio do aparelho, apagar) e no teste do banco (`db/testes`).
 *
 * Cada id vira um segmento seguro de nome de arquivo (revisão da T-0088, 2026-11-07: a demonstração tem ids fora do
 * formato de UUID e precisa do SQLite também):
 * - id no formato de UUID: o próprio id em minúsculas (36 caracteres de `[0-9a-f-]`; o UUID não diferencia caixa);
 * - qualquer outro id: `h` + 32 hex do SHA-256 do id exato (128 bits). O id nunca entra cru no nome (nada de `/`, `..`,
 *   espaço ou acento), e o `h` fora do alfabeto do UUID impede que um id com hash caia no nome de um UUID;
 * - sem tenant (demonstração no mock-api): `demo`. Um tenant cujo id é a palavra `demo` vira hash, não o `demo`.
 */
import { sha256Hex } from '../sha256';

/** Arquivos de usuário na pasta do SQLite (com os anexos do WAL). Casa só nomes montados por `arquivoDoUsuario`. */
export const ARQUIVO_DE_USUARIO_RE =
  /^macuxi-u-([0-9a-f-]{36}|h[0-9a-f]{32})-t-([0-9a-f-]{36}|h[0-9a-f]{32}|demo)\.db(-wal|-shm|-journal)?$/;

const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Tenant da demonstração (mock-api, sem tenant na sessão). */
export const TENANT_DEMO = 'demo';

/** Segmento do nome para um id: UUID em minúsculas, ou `h` + 32 hex do SHA-256 do id exato. */
export function segmentoDoId(id: string): string {
  return UUID_RE.test(id) ? id.toLowerCase() : `h${sha256Hex(id).slice(0, 32)}`;
}

/**
 * Nome do arquivo do usuário. Aceita qualquer id (UUID fica legível; o resto vira hash, sem colisão prática entre
 * usuários e tenants). `null` só sem id de usuário (vazio ou só espaços): a sessão fica no AsyncStorage (reserva, §4).
 * Sem tenant, ou tenant vazio, = `demo`.
 */
export function arquivoDoUsuario(ids: { usuarioId: string; tenantId?: string | null }): string | null {
  const u = ids.usuarioId ?? '';
  if (!u.trim()) return null;
  const t = ids.tenantId ?? '';
  return `macuxi-u-${segmentoDoId(u)}-t-${t.trim() ? segmentoDoId(t) : TENANT_DEMO}.db`;
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
