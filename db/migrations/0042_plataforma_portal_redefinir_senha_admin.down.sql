-- 0042_plataforma_portal_redefinir_senha_admin (down) — desfaz a 0042 (T-0094, padrão de fábrica da T-0111) e volta exatamente
-- ao catálogo e às ACLs da 0041: saem as 2 sa_* do portal (lista dos admins da empresa e redefinição da senha do admin).
-- Dados NÃO voltam: senha já redefinida continua temporária (o admin troca no próximo acesso), e-mails já enfileirados seguem
-- para o despachante e a auditoria fica (append-only). Desfaça junto a rota do portal da fatia S (sem as funções ela dá 500).
-- Idempotente (rodar 2× não falha).

drop function if exists plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea);
drop function if exists plataforma.sa_admins_da_empresa(uuid, uuid);

-- Conferência (a da 0040): de volta às 12 sa_* executáveis pelo macuxi_portal
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 12 then
    raise exception '0042 down: esperadas 12 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
end
$$;
