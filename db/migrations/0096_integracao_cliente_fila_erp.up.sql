-- 0096_integracao_cliente_fila_erp (up) — fila do pré-cadastro de cliente aprovado para o ERP (v1.0.27, RF-CORE-10). Número
-- provisório (ordem de merge). Mesmo padrão de integracao.pedido_fila_erp (0010): o Hub recebe o cadastro canônico aprovado (pelo
-- evento do Core; o Hub não lê core.cliente), o Conector retira por poll com for update skip locked e devolve o vínculo
-- (external_id do ERP) ou a rejeição. Aditiva: 1 tabela no schema integracao; nada que existe muda. Fora do sync
-- (db/src/excecoes.ts). Dicionário: docs/banco/integracao.md ("0096"). Teste: db/testes/cliente-fila-erp.db.test.ts.
--   estado: pendente -> enviado (Conector retirou; enviado_em, tentativas + 1, conector_id) -> vinculado (o ERP criou o cliente) |
--           rejeitado (motivo). 'enviado' com enviado_em vencido volta a ser entregue (reentrega após o timeout).
--   Poll: where estado = 'pendente' or (estado = 'enviado' and enviado_em < now() - timeout) order by aprovado_em limit N
--         for update skip locked — índice parcial cliente_fila_erp_poll_ix (tenant_id, aprovado_em) nos dois estados vivos.
-- RLS e grants iguais aos da pedido_fila_erp: isolamento_tenant (macuxi_app: select, insert, update), manutencao
-- (macuxi_manutencao, 0031) e leitura (macuxi_leitura, 0078: SELECT por coluna, SEM payload e SEM motivo — o payload traz
-- CPF/CNPJ, telefone, e-mail e endereço e a saída desse papel vai para o log do Actions). Sem DELETE (remoção por deleted_at).
-- Caminho de volta: 0096_integracao_cliente_fila_erp.down.sql (APAGA a fila com tudo o que tiver; os pré-cadastros aprovados
-- ainda não vinculados precisam ser reenfileirados depois de um novo up). Volte antes o código do Hub que lê ou grava a tabela
-- (senão 42P01).

create table integracao.cliente_fila_erp (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  cliente_uuid  uuid not null,
  payload       jsonb not null,
  aprovado_em   timestamptz not null,
  estado        text not null default 'pendente',
  enviado_em    timestamptz,
  tentativas    integer not null default 0,
  conector_id   uuid,
  motivo        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint cliente_fila_erp_tenant_id_uk unique (tenant_id, id),
  constraint cliente_fila_erp_cliente_uk unique (tenant_id, cliente_uuid),
  constraint cliente_fila_erp_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint cliente_fila_erp_estado_valido check (estado in ('pendente', 'enviado', 'vinculado', 'rejeitado')),
  constraint cliente_fila_erp_enviado_coerente check (estado <> 'enviado' or enviado_em is not null),
  constraint cliente_fila_erp_payload_objeto check (jsonb_typeof(payload) = 'object'),
  constraint cliente_fila_erp_tentativas_validas check (tentativas >= 0)
);
-- poll do Conector (pendentes e reentrega dos enviados vencidos), na ordem da aprovação
create index cliente_fila_erp_poll_ix on integracao.cliente_fila_erp (tenant_id, aprovado_em) where estado in ('pendente', 'enviado') and deleted_at is null;
create trigger cliente_fila_erp_updated_at before update on integracao.cliente_fila_erp
  for each row execute function plataforma.definir_updated_at();
alter table integracao.cliente_fila_erp enable row level security;
alter table integracao.cliente_fila_erp force row level security;
create policy isolamento_tenant on integracao.cliente_fila_erp for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.cliente_fila_erp for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on integracao.cliente_fila_erp to macuxi_app;
grant select (id, tenant_id, cliente_uuid, aprovado_em, estado, enviado_em, tentativas, conector_id, created_at, updated_at, deleted_at, external_id) on integracao.cliente_fila_erp to macuxi_leitura;
create policy leitura on integracao.cliente_fila_erp for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());
