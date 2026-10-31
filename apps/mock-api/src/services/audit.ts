import { randomUUID } from 'node:crypto';
import type { AuditRow } from '../excel/rows';
import type { Data } from './data';

export interface Actor {
  id: string;
  name: string;
  role: string;
  seller_id: string | null;
}

/** Nome curto para a trilha: "Juliana M." */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]}.` : full;
}

/** Toda gravação escreve uma linha em saida/auditoria.xlsx (quem, quando, entidade, antes, depois). */
export function audit(data: Data, actor: Actor, entity: string, entityId: string, action: string, before: unknown, after: unknown): AuditRow {
  const row: AuditRow = {
    id: randomUUID(),
    tenant_id: data.tenant.id,
    user_id: actor.id,
    user_name: shortName(actor.name),
    entity,
    entity_id: entityId,
    action,
    before: before === null || before === undefined ? '' : JSON.stringify(before),
    after: after === null || after === undefined ? '' : JSON.stringify(after),
    at: data.now().toISOString(),
  };
  data.t.audit_log.push(row);
  return row;
}

export function listAudit(data: Data, q: { entity?: string; entity_id?: string; limit?: number }) {
  const parse = (s: string) => {
    if (!s) return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return s;
    }
  };
  return data.t.audit_log
    .filter((a) => (!q.entity || a.entity === q.entity) && (!q.entity_id || a.entity_id === q.entity_id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, q.limit ?? 200)
    .map((a) => ({ ...a, before: parse(a.before), after: parse(a.after) }));
}
