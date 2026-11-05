-- 0031_plataforma_manutencao (down) — T-0075 (B1)
-- Desfaz a 0031: APAGA a política manutencao de toda tabela que a tem. Nenhuma tabela, coluna ou grant muda.
-- O papel macuxi_manutencao e a filiação do migrador FICAM: são objetos do cluster (como o macuxi_worker na 0003) e
-- outro banco do mesmo servidor (bancos de teste em paralelo, réplica da demo) pode ter políticas para eles; sem política
-- neste banco, o papel não dá acesso a nada aqui. Para remover de vez, num servidor sem nenhum banco que o use:
--   revoke macuxi_manutencao from <migrador>; drop role macuxi_manutencao;
-- Efeito: num servidor SEM superusuário (DBaaS), o seed, as fixtures e as funções SECURITY DEFINER voltam a enxergar
-- 0 linhas (FORCE RLS). No Postgres da demo e do CI (superusuário) nada muda. Idempotente.
-- Pré-condição: 0032+ desfeitas.

do $$
declare
  v_t record;
begin
  for v_t in
    select p.polrelid::regclass::text as tabela
      from pg_policy p
     where p.polname = 'manutencao'
     order by 1
  loop
    execute format('drop policy if exists manutencao on %s', v_t.tabela);
  end loop;
end
$$;
