-- 0045_catalogo_marca_concorrente (down) — desfaz a 0045 (T-0113; ADR 0034 §4.6) e volta ao catálogo da 0044.
-- 1. Devolve ao Promotor as linhas do Catálogo, POR ID e campo a campo (id, tenant_id, nome, ativo, created_at, updated_at,
--    deleted_at, external_id): apaga de promotor.concorrente as linhas cujos ids estão no Catálogo e insere todas as do
--    Catálogo (sem FK apontando para elas depois do up, e sem o gatilho de updated_at, que é só de update; apagar e inserir
--    evita a colisão momentânea do nome único numa troca de nomes). Linhas só do Promotor (não deveria haver) ficam.
-- 2. Confere que todo promotor.produto_concorrente aponta para um concorrente do mesmo tenant (raise com a contagem) e
--    recria produto_concorrente_concorrente_fk; devolve insert e update do macuxi_app em promotor.concorrente.
-- 3. Tira a FK produto_referencia_marca_fk e o índice produto_referencia_marca_ix e apaga catalogo.marca_concorrente.
--    O retrato produto_referencia.marca_nome FICA (ADR 0034 §4.6). A volta só vale com o código anterior do Catálogo e do
--    Promotor (o BKO antigo volta a gravar no Promotor).
-- Idempotente: rodar de novo sem a tabela do Catálogo não devolve nada e não falha. Pré-condição: 0046+ desfeitas.

do $$
declare
  v_orfaos bigint;
begin
  if to_regclass('catalogo.marca_concorrente') is not null then
    delete from promotor.concorrente c using catalogo.marca_concorrente m where m.id = c.id;
    insert into promotor.concorrente (id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id)
    select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from catalogo.marca_concorrente;
  end if;
  select count(*) into v_orfaos
    from promotor.produto_concorrente p
   where not exists (select 1 from promotor.concorrente c where c.tenant_id = p.tenant_id and c.id = p.concorrente_id);
  if v_orfaos > 0 then
    raise exception '0045 down: % produto(s) do concorrente com concorrente_id sem concorrente no mesmo tenant', v_orfaos;
  end if;
end $$;

alter table promotor.produto_concorrente drop constraint if exists produto_concorrente_concorrente_fk;
alter table promotor.produto_concorrente add constraint produto_concorrente_concorrente_fk
  foreign key (tenant_id, concorrente_id) references promotor.concorrente (tenant_id, id);
grant select, insert, update on promotor.concorrente to macuxi_app;

alter table catalogo.produto_referencia drop constraint if exists produto_referencia_marca_fk;
drop index if exists catalogo.produto_referencia_marca_ix;
drop table if exists catalogo.marca_concorrente;
