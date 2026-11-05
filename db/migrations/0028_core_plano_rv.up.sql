-- 0028_core_plano_rv (up) — T-0082 (Plano de RV no BKO; pedido R-20261105-060422-engenheiro-software; desenho
-- docs/desenho/T-0082.md §5; RN-CORE-29 cálculo e RN-CORE-30 plano e vigência, doc 03). Dicionário: docs/banco/core.md.
-- Migração ADITIVA e idempotente (if not exists / drop if exists + create): só uma tabela nova; nenhuma tabela, coluna,
-- política ou grant existente muda.
--
-- core.plano_rv — plano de remuneração variável do tenant, VERSIONADO por mês de início: vale de vigencia_inicio até o
--   mês anterior ao início do próximo plano vivo (RN-CORE-30). Um plano vivo por (tenant, mês de início): único parcial
--   plano_rv_vigencia_uk. Calculado na hora da consulta (RN-CORE-29); nada de RV é gravado aqui.
--   nome (1..80, não vazio), vigencia_inicio 'AAAA-MM' (mesmo CHECK de core.meta.periodo), perfis text[] não vazio,
--   1 dimensão, sem nulo, contido em {vendedor, promotor} (plano_rv_perfis_validos), valor_maximo_cents bigint > 0
--   (centavos, regra 4), regras jsonb = array (plano_rv_regras_array); o FORMATO de cada regra
--   ({ indicador, peso_pct, gatilho, faixas: [{ de_pct, modo, pagamento_pct }] }, RegraRvSchema de
--   modules/core/contracts/plano-rv.ts) e os pesos/faixas são validados no domain do Core (validarPlanoRv) e na API,
--   não no banco: o plano é lido e gravado inteiro e nunca filtrado por faixa.
--   atualizado_por: quem gravou a versão (analista/admin), FK composta plano_rv_atualizado_por_fk (tenant_id,
--   atualizado_por) -> core.usuario (tenant_id, id); null = carga (seed) ou usuário anonimizado.
--   Plano que já valeu para mês fechado não muda (RN-CORE-30): regra da API (depende do fechamento da RN-CORE-21), não
--   do banco. Exclusão = soft delete (deleted_at), que libera o mês de início para outra versão.
-- Índices: plano_rv_vigencia_uk (tenant_id, vigencia_inicio) where deleted_at is null (vigente = maior início <= mês,
--   leitura por tenant: poucas linhas); plano_rv_sync_ix (tenant_id, updated_at, id) da regra (fora de TABELAS_SYNC nesta
--   tarefa: o aparelho não recebe o plano); plano_rv_external_uk como nas demais tabelas.
-- RLS: enable + force + isolamento_tenant (falha fechada sem contexto); macuxi_app com select/insert/update/delete.
-- Caminho de volta: 0028_core_plano_rv.down.sql (APAGA a tabela e os planos gravados pelo BKO).

create table if not exists core.plano_rv (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  nome                text not null,
  vigencia_inicio     text not null,
  perfis              text[] not null,
  valor_maximo_cents  bigint not null,
  regras              jsonb not null,
  atualizado_por      uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint plano_rv_tenant_id_uk unique (tenant_id, id),
  constraint plano_rv_atualizado_por_fk foreign key (tenant_id, atualizado_por) references core.usuario (tenant_id, id),
  constraint plano_rv_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 80),
  constraint plano_rv_vigencia_formato check (vigencia_inicio ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint plano_rv_perfis_validos check (
    cardinality(perfis) >= 1 and array_ndims(perfis) = 1 and array_position(perfis, null) is null
    and perfis <@ array['vendedor', 'promotor']::text[]
  ),
  constraint plano_rv_valor_maximo_positivo check (valor_maximo_cents > 0),
  constraint plano_rv_regras_array check (jsonb_typeof(regras) = 'array')
);
create unique index if not exists plano_rv_vigencia_uk on core.plano_rv (tenant_id, vigencia_inicio) where deleted_at is null;
create index if not exists plano_rv_sync_ix on core.plano_rv (tenant_id, updated_at, id);
create unique index if not exists plano_rv_external_uk on core.plano_rv (tenant_id, external_id)
  where external_id is not null and deleted_at is null;
drop trigger if exists plano_rv_updated_at on core.plano_rv;
create trigger plano_rv_updated_at before update on core.plano_rv
  for each row execute function plataforma.definir_updated_at();
alter table core.plano_rv enable row level security;
alter table core.plano_rv force row level security;
drop policy if exists isolamento_tenant on core.plano_rv;
create policy isolamento_tenant on core.plano_rv for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.plano_rv to macuxi_app;
