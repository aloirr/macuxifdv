-- 0061_vendedor_reserva_filial (up) — T-0149 (RN-VEN-20 por filial, RN-CORE-39). Migração em cima da 0060.
-- Dicionário: docs/banco/vendedor.md ("0061 — filial no item, para a reserva por filial").
-- Migração ADITIVA: 1 coluna NULA em vendedor.pedido_item, 1 índice parcial, 2 funções e 2 gatilhos; backfill dos itens que já
-- têm pedido com filial. Nenhum contrato muda de versão; RLS, políticas e grants não mudam.
--
-- Não existe tabela de reserva gravada: a reserva do RN-VEN-20 são os ITENS dos pedidos aceitos e ainda não faturados,
-- cancelados ou rejeitados (vendedor.pedido_item ⨝ vendedor.pedido por status). A filial mora em vendedor.pedido.filial_id
-- (0056); a soma "reservado do produto P na filial F" precisava atravessar as duas tabelas. Esta migração traz a filial para o
-- item, DERIVADA por gatilho (mesmo padrão de quantidade_base, 0013, e medida, 0018): a API NUNCA grava nela (o valor enviado é
-- sobrescrito), e o índice da soma fica numa tabela só.
--
-- vendedor.pedido_item.filial_id uuid: = vendedor.pedido.filial_id do pedido do item (sem FK: core.filial é de outro schema).
--   Nulo = pedido sem filial (anterior à 0056). Gatilho pedido_item_filial (BEFORE INSERT/UPDATE OF pedido_id, tenant_id,
--   filial_id): copia do pedido. Gatilho pedido_filial_nos_itens (AFTER UPDATE OF filial_id em vendedor.pedido, só quando muda):
--   leva a filial nova aos itens (edição do orçamento). Os itens tocados ganham updated_at novo (voltam no pull; a coluna não
--   está no contrato de sync).
-- Índice pedido_item_reserva_filial_ix (tenant_id, produto_id, filial_id) include (pedido_id, quantidade_base,
--   quantidade_faturada) where deleted_at is null and filial_id is not null: a soma por (tenant, produto, filial) com o join ao
--   pedido só pelo status. Consulta-modelo (API do Vendedor, RN-VEN-20):
--     select i.filial_id, sum(i.quantidade_base - i.quantidade_faturada) as reservado
--       from vendedor.pedido_item i join vendedor.pedido p on p.tenant_id = i.tenant_id and p.id = i.pedido_id
--      where i.tenant_id = $1 and i.produto_id = $2 and i.filial_id = $3 and i.deleted_at is null
--        and p.deleted_at is null and p.tipo = 'pedido'
--        and p.status in ('received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial')
--      group by i.filial_id;
-- Volume: o de pedido_item (dezenas de milhares por tenant); o índice só cobre itens vivos com filial.
--
-- Caminho de volta: 0061_vendedor_reserva_filial.down.sql (apaga gatilhos, funções, índice e a coluna; a filial continua em
-- vendedor.pedido.filial_id, então nada se perde — volte antes o Vendedor que lê pedido_item.filial_id, senão 42703).

alter table vendedor.pedido_item add column filial_id uuid;

-- Backfill: a filial do pedido, quando houver. Gatilho de updated_at desligado só neste UPDATE (dentro da transação da migração):
-- nenhum item é puxado de novo pelo app só por causa da 0061.
alter table vendedor.pedido_item disable trigger pedido_item_updated_at;
update vendedor.pedido_item i
   set filial_id = p.filial_id
  from vendedor.pedido p
 where p.tenant_id = i.tenant_id and p.id = i.pedido_id and p.filial_id is not null;
alter table vendedor.pedido_item enable trigger pedido_item_updated_at;

create function vendedor.pedido_item_filial() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  new.filial_id := (select p.filial_id from vendedor.pedido p where p.tenant_id = new.tenant_id and p.id = new.pedido_id);
  return new;
end
$$;
create trigger pedido_item_filial before insert or update of pedido_id, tenant_id, filial_id on vendedor.pedido_item
  for each row execute function vendedor.pedido_item_filial();

create function vendedor.pedido_filial_nos_itens() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  update vendedor.pedido_item i
     set filial_id = new.filial_id
   where i.tenant_id = new.tenant_id and i.pedido_id = new.id and i.filial_id is distinct from new.filial_id;
  return null;
end
$$;
create trigger pedido_filial_nos_itens after update of filial_id on vendedor.pedido
  for each row when (old.filial_id is distinct from new.filial_id)
  execute function vendedor.pedido_filial_nos_itens();

create index pedido_item_reserva_filial_ix on vendedor.pedido_item (tenant_id, produto_id, filial_id)
  include (pedido_id, quantidade_base, quantidade_faturada)
  where deleted_at is null and filial_id is not null;
