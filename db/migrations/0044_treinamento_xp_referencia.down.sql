-- 0044_treinamento_xp_referencia (down) — desfaz a 0044 (T-0106) e volta exatamente ao catálogo da 0043: CHECK de
-- referencia_id 1..128 e sem xp_lancamento_tenant_id_uk. Nenhum lançamento é apagado (XP é
-- append-only): se houver referência com mais de 128 caracteres, o down PARA com a contagem (P0001) e nada muda — decida
-- antes o que fazer com esses lançamentos (eles só existem com o código da T-0106).
-- Idempotente (if exists em tudo). Pré-condição: 0045+ desfeitas.

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from treinamento.xp_lancamento where char_length(referencia_id) > 128;
  if v_n > 0 then
    raise exception '0044 down: % lançamento(s) de XP com referencia_id acima de 128 caracteres; o CHECK da 0017 não cabe', v_n;
  end if;
end $$;

alter table treinamento.xp_lancamento drop constraint if exists xp_lancamento_tenant_id_uk;
alter table treinamento.xp_lancamento drop constraint if exists xp_lancamento_referencia_tamanho;
alter table treinamento.xp_lancamento add constraint xp_lancamento_referencia_tamanho
  check (char_length(referencia_id) between 1 and 128);
