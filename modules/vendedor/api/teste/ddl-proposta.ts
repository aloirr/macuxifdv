/**
 * Setup dos testes do Vendedor (T-0054): aplica a DDL PROPOSTA do faturamento no banco EFÊMERO do teste enquanto a
 * migração do banco-dados não chega ao `main`. Roda antes dos testes de cada arquivo, serializado por advisory lock
 * (`pg_advisory_xact_lock`): o primeiro cria, os outros esperam e encontram as tabelas. Assim nenhum arquivo consulta
 * `vendedor.pedido` enquanto o ALTER TABLE roda (evita deadlock entre arquivos). Com a migração real presente
 * (`to_regclass` não nulo), não faz nada. Sem Postgres, não faz nada.
 * APAGAR quando a migração do faturamento estiver no `main` (e tirar de `vitest.config.ts`).
 */
import { estadoBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { beforeAll } from 'vitest';

/** DDL PROPOSTA ao banco-dados (T-0054). Só roda se a migração ainda não criou as tabelas. */
export const DDL_PROPOSTA = `
alter table vendedor.pedido add column if not exists faturado_cents bigint not null default 0 check (faturado_cents >= 0);
alter table vendedor.pedido add column if not exists devolvido_cents bigint not null default 0 check (devolvido_cents >= 0);
alter table vendedor.pedido add column if not exists notas_faturamento integer not null default 0 check (notas_faturamento >= 0);
alter table vendedor.pedido add column if not exists ultima_nota_numero text;
alter table vendedor.pedido add column if not exists faturado_em timestamptz;
alter table vendedor.pedido_item add column if not exists quantidade_faturada integer not null default 0 check (quantidade_faturada >= 0);

create table vendedor.pedido_faturamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references plataforma.tenant (id),
  pedido_id uuid not null,
  evento_origem_id uuid not null,
  status_retorno text not null check (status_retorno in ('faturado_parcial', 'faturado_total')),
  parcial boolean not null,
  nota_numero text, nota_serie text, nota_emitida_em timestamptz,
  nota_total_cents bigint check (nota_total_cents is null or nota_total_cents >= 0),
  faturado_em timestamptz not null,
  itens jsonb not null default '[]' check (jsonb_typeof(itens) = 'array'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, external_id text,
  constraint pedido_faturamento_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_faturamento_evento_uk unique (tenant_id, evento_origem_id)
);
create index pedido_faturamento_pedido_ix on vendedor.pedido_faturamento (tenant_id, pedido_id, faturado_em);
create trigger pedido_faturamento_updated_at before update on vendedor.pedido_faturamento for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_faturamento enable row level security;
alter table vendedor.pedido_faturamento force row level security;
create policy isolamento_tenant on vendedor.pedido_faturamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());
grant select, insert on vendedor.pedido_faturamento to macuxi_app;

create table vendedor.pedido_devolucao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references plataforma.tenant (id),
  pedido_id uuid not null,
  nota_numero text not null, nota_serie text, emitida_em timestamptz not null,
  total_cents bigint not null check (total_cents >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  external_id text not null,
  constraint pedido_devolucao_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id)
);
create unique index pedido_devolucao_external_uk on vendedor.pedido_devolucao (tenant_id, external_id) where deleted_at is null;
create index pedido_devolucao_pedido_ix on vendedor.pedido_devolucao (tenant_id, pedido_id);
create trigger pedido_devolucao_updated_at before update on vendedor.pedido_devolucao for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_devolucao enable row level security;
alter table vendedor.pedido_devolucao force row level security;
create policy isolamento_tenant on vendedor.pedido_devolucao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on vendedor.pedido_devolucao to macuxi_app;
`;

beforeAll(async () => {
  const e = estadoBanco();
  if (!e.disponivel) return;
  const admin = new pg.Client({ connectionString: e.urlAdmin });
  await admin.connect();
  try {
    await admin.query('begin');
    await admin.query("select pg_advisory_xact_lock(hashtext('vendedor.T-0054.ddl-proposta'))");
    const existe = (await admin.query<{ t: string | null }>("select to_regclass('vendedor.pedido_faturamento')::text as t")).rows[0]!.t;
    if (!existe) await admin.query(DDL_PROPOSTA);
    await admin.query('commit');
  } catch (erro) {
    await admin.query('rollback').catch(() => undefined);
    throw erro;
  } finally {
    await admin.end();
  }
});
