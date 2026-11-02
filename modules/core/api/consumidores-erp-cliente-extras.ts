/**
 * Partes do cliente do ERP além do cadastro (T-0066; RN-INT-02/04): carteira (vínculo cliente x vendedor), contatos e
 * financeiro (limite, bloqueio; o saldo vem dos títulos). Tudo idempotente e só sobre linhas "do ERP" (as que têm
 * `external_id`): vínculos e contatos criados à mão no BKO/app (`external_id` nulo) nunca são removidos nem trocados.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { ReferenciaAusenteErp, usuarioPorExternalId } from './erp-apoio';

export interface ContatoErp {
  nome: string;
  cargo?: string | null;
  telefone?: string | null;
  email?: string | null;
}

/**
 * Carteira do vendedor: o ERP manda um vendedor por cliente. Troca de vendedor encerra (`deleted_at`) o vínculo do ERP
 * anterior; sem vendedor no payload, encerra o vínculo do ERP. Vendedor ainda ausente = `ReferenciaAusenteErp`.
 */
export async function aplicarCarteiraDoErp(db: ClienteBanco, clienteId: string, clienteExternalId: string, vendedorExternalId: string | null | undefined, agora: Date): Promise<void> {
  const usuarioId = vendedorExternalId ? await usuarioPorExternalId(db, vendedorExternalId) : null;
  if (vendedorExternalId && !usuarioId) throw new ReferenciaAusenteErp('vendedor');

  await db.query(
    "update core.carteira set deleted_at = $3 where cliente_id = $1 and papel = 'vendedor' and deleted_at is null and external_id is not null and usuario_id is distinct from $2::uuid",
    [clienteId, usuarioId, agora],
  );
  if (!usuarioId) return;
  const existente = await db.query<{ id: string }>("select id from core.carteira where cliente_id = $1 and usuario_id = $2 and papel = 'vendedor' and deleted_at is null", [clienteId, usuarioId]);
  if (existente.rows[0]) {
    await db.query('update core.carteira set external_id = coalesce(external_id, $2) where id = $1', [existente.rows[0].id, clienteExternalId]);
    return;
  }
  await db.query("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel, external_id) values (plataforma.tenant_atual(), $1, $2, 'vendedor', $3)", [clienteId, usuarioId, clienteExternalId]);
}

/** Contatos do ERP: `external_id = <cliente>:<posição>`; os que sobram (posição maior que a lista nova) são encerrados. O 1º é o principal se não houver outro. */
export async function aplicarContatosDoErp(db: ClienteBanco, clienteId: string, clienteExternalId: string, contatos: readonly ContatoErp[], agora: Date): Promise<void> {
  const chaves = contatos.map((_, i) => `${clienteExternalId}:${String(i)}`);
  await db.query(
    'update core.cliente_contato set deleted_at = $4 where cliente_id = $1 and deleted_at is null and external_id is not null and starts_with(external_id, $2) and not (external_id = any($3::text[]))',
    [clienteId, `${clienteExternalId}:`, chaves, agora],
  );
  const aparar = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  for (const [i, c] of contatos.entries()) {
    const nome = c.nome.trim();
    if (!nome) continue;
    const outroPrincipal = i === 0 ? (await db.query('select 1 from core.cliente_contato where cliente_id = $1 and principal and deleted_at is null and external_id is distinct from $2', [clienteId, chaves[0]])).rows.length > 0 : true;
    await db.query(
      `insert into core.cliente_contato (tenant_id, cliente_id, external_id, nome, cargo, telefone, email, principal)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set cliente_id = excluded.cliente_id, nome = excluded.nome, cargo = excluded.cargo, telefone = excluded.telefone,
                     email = excluded.email, principal = excluded.principal`,
      [clienteId, chaves[i], nome, aparar(c.cargo), aparar(c.telefone), aparar(c.email), !outroPrincipal],
    );
  }
}

/**
 * Financeiro: limite e bloqueio vêm do cliente; o saldo em aberto é a soma dos títulos abertos (já existentes);
 * `credito_disponivel_cents` fica nulo (o domínio calcula limite - saldo). Desbloqueio limpa o motivo.
 */
export async function aplicarFinanceiroDoErp(db: ClienteBanco, clienteId: string, clienteExternalId: string, limiteCents: number | null | undefined, bloqueado: boolean | undefined, alteradoEm: string): Promise<void> {
  await db.query(
    `insert into core.cliente_financeiro (tenant_id, cliente_id, external_id, limite_cents, bloqueado, atualizado_erp_em, saldo_aberto_cents)
     values (plataforma.tenant_atual(), $1, $2, $3, $4, $5::timestamptz,
             (select coalesce(sum(saldo_cents), 0) from core.titulo where cliente_id = $1 and situacao = 'aberto' and deleted_at is null))
     on conflict (tenant_id, cliente_id) where deleted_at is null
     do update set limite_cents = excluded.limite_cents, bloqueado = excluded.bloqueado, atualizado_erp_em = excluded.atualizado_erp_em,
                   external_id = coalesce(core.cliente_financeiro.external_id, excluded.external_id),
                   motivo_bloqueio = case when excluded.bloqueado then core.cliente_financeiro.motivo_bloqueio else null end`,
    [clienteId, clienteExternalId, Math.max(0, limiteCents ?? 0), bloqueado === true, alteradoEm],
  );
}
