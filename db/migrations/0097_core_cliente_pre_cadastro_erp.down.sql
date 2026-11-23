-- 0097_core_cliente_pre_cadastro_erp (down) — desfaz a 0097 (v1.0.28, RN-CORE-78) e volta exatamente ao catálogo e às ACLs da
-- 0096. APAGA motivo_recusa (os motivos de recusa do ERP se perdem; o status 'recusado' fica) e o índice
-- cliente_pre_cadastro_fila_ix; recria cliente_aprovado_sem_erp_ix, aprovado_por (com o SELECT do macuxi_leitura) e o CHECK
-- cliente_aprovacao_par. Os clientes aprovados pelo ERP têm aprovado_em sem aprovador: o down preenche aprovado_por com o UUID
-- nulo (00000000-0000-0000-0000-000000000000 = "aprovado pelo ERP", sem usuário) para o CHECK par valer. recebido_em volta a
-- aprovado_em em integracao.cliente_fila_erp. Idempotente.
-- Pré-condição: o código do Core e do Hub sem ler ou gravar motivo_recusa ou recebido_em (senão 42703).

-- 2. integracao.cliente_fila_erp
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'integracao.cliente_fila_erp'::regclass and attname = 'recebido_em' and not attisdropped) then
    alter table integracao.cliente_fila_erp rename column recebido_em to aprovado_em;
  end if;
end
$$;

-- 1. core.cliente
drop index if exists core.cliente_pre_cadastro_fila_ix;
alter table core.cliente drop constraint if exists cliente_motivo_recusa_status;
alter table core.cliente drop constraint if exists cliente_motivo_recusa_tamanho;
alter table core.cliente drop column if exists motivo_recusa;
alter table core.cliente add column if not exists aprovado_por uuid;
alter table core.cliente disable trigger cliente_updated_at;
update core.cliente set aprovado_por = '00000000-0000-0000-0000-000000000000'
  where aprovado_em is not null and aprovado_por is null;
alter table core.cliente enable trigger cliente_updated_at;
alter table core.cliente drop constraint if exists cliente_aprovacao_par;
alter table core.cliente add constraint cliente_aprovacao_par
  check ((aprovado_em is null) = (aprovado_por is null));
create index if not exists cliente_aprovado_sem_erp_ix on core.cliente (tenant_id, aprovado_em, id)
  where external_id is null and aprovado_em is not null and deleted_at is null;
grant select (aprovado_por) on core.cliente to macuxi_leitura;
