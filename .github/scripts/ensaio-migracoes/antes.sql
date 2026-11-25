-- Ensaio das migrações em produção: ANTES das migrações (dentro da transação do ensaio). Consulta 1 de
-- db/scripts/diagnostico-0106.sql (#771, 3acce47), só com as contagens por tipo: sem ids, sem códigos de perfil.
\echo
\echo '== antes das migrações'
select count(*) as tenants, count(*) filter (where t.deleted_at is null) as tenants_vivos from plataforma.tenant t;
\echo 'casos que param o tenant e não dependem do catálogo (consulta 1 do diagnostico-0106), por tipo'
with perfis as (
  select p.tenant_id, p.id, p.codigo, p.base, p.cargo, p.ativo,
         plataforma.cargo_da_base(p.base) as cargo_da_base,
         exists (select 1 from plataforma.usuario_perfil up
                   join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.deleted_at is null
                  where up.tenant_id = p.tenant_id and up.perfil_id = p.id and up.deleted_at is null) as com_usuarios
    from plataforma.perfil p
   where p.deleted_at is null
),
sob as (
  select s.tenant_id, s.perfil_id, s.chave, s.concedida from plataforma.perfil_permissao s where s.deleted_at is null
),
achados as (
  select f.tenant_id, 'CARGO_DIFERENTE_DA_BASE' as tipo
    from perfis f where f.cargo <> f.cargo_da_base and f.com_usuarios
  union all
  select f.tenant_id, 'TRAVA_NOVA_CORTA'
    from perfis f join sob s on s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.concedida
   where f.com_usuarios
     and ((s.chave = 'acesso.campo' and f.cargo not in ('vendedor', 'promotor'))
       or (s.chave = 'acesso.gestao' and f.cargo not in ('supervisor', 'gerente'))
       or (s.chave = 'acesso.portal' and f.cargo <> 'administrativo'))
  union all
  select f.tenant_id, 'TRAVA_NOVA_CORTA'
    from perfis f
   where f.com_usuarios and f.base = 'admin'
     and exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and not s.concedida
                    and s.chave in ('acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'))
     and not exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.chave = 'acesso.portal' and not s.concedida)
  union all
  select f.tenant_id, 'PERFIL_SEM_ACESSO'
    from perfis f
   where f.com_usuarios and f.ativo
     and not exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.concedida and s.chave like 'acesso.%')
     and (select count(*) from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and not s.concedida and s.chave like 'acesso.%')
         = case f.base when 'gerente' then 2 when 'admin' then 2 else 1 end
)
select tipo, count(*) as achados, count(distinct tenant_id) as tenants from achados group by tipo order by tipo;
