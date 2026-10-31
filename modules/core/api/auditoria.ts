/** Auditoria do Core (RN-AUD-01): grava em `plataforma.auditoria` na transação já aberta. Sem dado pessoal além de ids. */
import type { ClienteBanco, ContextoBase } from '@macuxi/platform-sdk';

export interface RegistroAuditoria {
  acao: string;
  entidade: string;
  entidadeId: string | null;
  antes: unknown;
  depois: unknown;
}

export async function auditar(db: ClienteBanco, ctx: Pick<ContextoBase, 'usuario' | 'requestId'>, r: RegistroAuditoria): Promise<void> {
  await db.query(
    `insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, request_id)
     values (plataforma.tenant_atual(), $1, 'core', $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [ctx.usuario.id, r.acao, r.entidade, r.entidadeId, JSON.stringify(r.antes), JSON.stringify(r.depois), ctx.requestId],
  );
}
