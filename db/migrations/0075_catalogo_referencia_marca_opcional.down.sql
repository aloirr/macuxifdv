-- 0075_catalogo_referencia_marca_opcional (down) — desfaz a 0075 e volta ao catálogo de antes dela (marca obrigatória e único
-- por produto, marca e código).
-- Ordem: confere que não há referência VIVA sem marca (raise com a contagem: informe a marca ou apague antes de voltar); apaga
-- de vez as referências JÁ APAGADAS sem marca (não cabem no NOT NULL; o aparelho já recebeu a exclusão delas); tira o único por
-- produto e código; devolve a vivas as que a 0075 apagou — as de deleted_at = public.macuxi_migracao.aplicada_em da 0075 (o
-- migrador apaga a linha só depois do down) — quando a ordem e a combinação marca + código delas seguem livres no produto;
-- recria produto_referencia_codigo_uk e o NOT NULL de marca_id.
-- Limites: referência apagada sem marca some de vez; a devolvida que colide com uma gravada depois da 0075 fica apagada.
-- Idempotente. Pré-condição: 0076+ desfeitas e o código do Catálogo que grava referência sem marca já desfeito.

do $$
declare
  v_vivas bigint;
begin
  select count(*) into v_vivas from catalogo.produto_referencia where marca_id is null and deleted_at is null;
  if v_vivas > 0 then
    raise exception '0075 down: % referência(s) cruzada(s) viva(s) sem marca; informe a marca ou apague antes de voltar', v_vivas;
  end if;
end $$;

delete from catalogo.produto_referencia where marca_id is null;

drop index if exists catalogo.produto_referencia_produto_codigo_uk;

update catalogo.produto_referencia r
   set deleted_at = null
 where r.deleted_at = (select m.aplicada_em from public.macuxi_migracao m where m.versao = '0075')
   and not exists (select 1 from catalogo.produto_referencia o
                    where o.tenant_id = r.tenant_id and o.produto_id = r.produto_id and o.deleted_at is null
                      and (o.ordem = r.ordem or (o.marca_id = r.marca_id and o.codigo_compacto = r.codigo_compacto)));

create unique index if not exists produto_referencia_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo_compacto) where deleted_at is null;
alter table catalogo.produto_referencia alter column marca_id set not null;
