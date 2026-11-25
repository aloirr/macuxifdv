-- Diagnóstico da 0105_plataforma_perfis_sem_base_derivacao (perfis sem perfil base, ADR 0073; plano
-- docs/banco/plano-migracao-perfis-sem-base.md §4.4). Só leitura; rode como administrador do banco (vê todos os tenants) ou como
-- macuxi_app com app.tenant_id (vê só o tenant). Sem dado pessoal: ids e códigos. Dicionário: docs/banco/plataforma.md
-- ("0104 a 0106").
--
-- Consulta 1 — ANTES da 0104 (não usa nada novo): os casos que PARAM o tenant e não dependem do catálogo.
--   CARGO_DIFERENTE_DA_BASE com usuário; sobreposição concedida que a trava do CARGO corta (acesso.campo fora de vendedor e
--   promotor; acesso.gestao fora de supervisor e gerente; acesso.portal fora do administrativo ou em perfil sem a gestão
--   completa); perfil ativo com usuário cujas sobreposições revogam todo acesso.* que a base dá.
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
)
select f.tenant_id, f.codigo, 'CARGO_DIFERENTE_DA_BASE' as tipo, null as chave, f.base, f.cargo
  from perfis f where f.cargo <> f.cargo_da_base and f.com_usuarios
union all
select f.tenant_id, f.codigo, 'TRAVA_NOVA_CORTA', s.chave, f.base, f.cargo
  from perfis f join sob s on s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.concedida
 where f.com_usuarios
   and ((s.chave = 'acesso.campo' and f.cargo not in ('vendedor', 'promotor'))
     or (s.chave = 'acesso.gestao' and f.cargo not in ('supervisor', 'gerente'))
     or (s.chave = 'acesso.portal' and f.cargo <> 'administrativo'))
union all
select f.tenant_id, f.codigo, 'TRAVA_NOVA_CORTA', 'acesso.portal', f.base, f.cargo
  from perfis f
 where f.com_usuarios and f.base = 'admin'
   and exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and not s.concedida
                  and s.chave in ('acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'))
   and not exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.chave = 'acesso.portal' and not s.concedida)
union all
select f.tenant_id, f.codigo, 'PERFIL_SEM_ACESSO', null, f.base, f.cargo
  from perfis f
 where f.com_usuarios and f.ativo
   and not exists (select 1 from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and s.concedida and s.chave like 'acesso.%')
   and (select count(*) from sob s where s.tenant_id = f.tenant_id and s.perfil_id = f.id and not s.concedida and s.chave like 'acesso.%')
       = case f.base when 'gerente' then 2 when 'admin' then 2 else 1 end
 order by 1, 2, 3, 4;

-- Consulta 2 — DEPOIS da 0105 (ou numa cópia restaurada com as migrações): o diagnóstico completo, por tenant ainda em 'legado'.
-- select t.codigo, d.* from plataforma.tenant t
--   cross join lateral plataforma.diagnosticar_perfis_sem_base(t.id) d
--  where plataforma.leitura_de_perfis(t.id) = 'legado' order by t.codigo, d.efeito, d.tipo, d.perfil_codigo;

-- Consulta 3 — achados gravados pela migração e pelo espelho, abertos, por tenant e tipo (a lista que vai ao tenant).
-- select t.codigo, c.efeito, c.tipo, c.perfil_codigo, c.chave, c.antes, c.depois
--   from plataforma.perfil_migracao_conflito c join plataforma.tenant t on t.id = c.tenant_id
--  where c.resolvido_em is null and c.deleted_at is null order by t.codigo, c.efeito, c.tipo, c.perfil_codigo;

-- Consulta 4 — conferência por usuário (esperado: zero linhas DIFERENCA nos tenants 'concessao').
-- select t.codigo, c.* from plataforma.tenant t cross join lateral plataforma.conferir_perfis_sem_base(t.id) c
--  where plataforma.leitura_de_perfis(t.id) = 'concessao';
