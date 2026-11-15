-- descricao: Vendedor do ERP x usuário do BKO (caso VEN-000034): usuário pelo código, provisórios, carteira, staging, erros de carga e outbox
-- parametros: external_id
--
-- Diagnóstico do modulo-core (15/11/2026, hipóteses H1 a H4). Sem nome nem e-mail: o usuário é achado pelo external_id e
-- os demais aparecem só por id e flags (provisório = e-mail terminado em @sem-email.invalid, consumidor do vendedor do ERP).

-- @consulta usuario_pelo_codigo
-- @colunas id, perfil, ativo, desligado_no_bko, sem_senha, provisorio, tem_equipe, apagado, ja_entrou, carteira_ativa
select u.id, u.perfil, u.ativo, (u.desligado_no_bko_em is not null) as desligado_no_bko, (not s.tem_senha) as sem_senha,
       (u.email like '%@sem-email.invalid') as provisorio, (u.equipe_id is not null) as tem_equipe,
       (u.deleted_at is not null) as apagado, (u.ultimo_login_em is not null) as ja_entrou,
       (select count(*) from core.carteira c
         where c.tenant_id = u.tenant_id and c.usuario_id = u.id and c.deleted_at is null) as carteira_ativa
  from core.usuario u
  join core.v_leitura_usuario_senha s on s.id = u.id
 where u.tenant_id = :'tenant_id' and u.external_id = :'external_id';

-- @consulta usuarios_de_campo_por_tipo
-- @colunas perfil, ativo, tem_external_id, provisorio, sem_senha, apagado, usuarios, com_carteira
select u.perfil, u.ativo, (u.external_id is not null) as tem_external_id, (u.email like '%@sem-email.invalid') as provisorio,
       (not s.tem_senha) as sem_senha, (u.deleted_at is not null) as apagado, count(*) as usuarios,
       count(*) filter (where exists (select 1 from core.carteira c
                                       where c.tenant_id = u.tenant_id and c.usuario_id = u.id and c.deleted_at is null)) as com_carteira
  from core.usuario u
  join core.v_leitura_usuario_senha s on s.id = u.id
 where u.tenant_id = :'tenant_id' and u.perfil in ('vendedor', 'promotor')
 group by 1, 2, 3, 4, 5, 6
 order by 1, 2, 3, 4, 5, 6;

-- @consulta provisorios_com_carteira
-- @colunas usuario_id, codigo_erp, ativo, apagado, carteira_ativa, criado_em
select u.id as usuario_id, u.external_id as codigo_erp, u.ativo, (u.deleted_at is not null) as apagado,
       count(c.id) as carteira_ativa, u.created_at as criado_em
  from core.usuario u
  left join core.carteira c on c.tenant_id = u.tenant_id and c.usuario_id = u.id and c.deleted_at is null
 where u.tenant_id = :'tenant_id' and u.email like '%@sem-email.invalid'
 group by u.id, u.external_id, u.ativo, u.deleted_at, u.created_at
 order by carteira_ativa desc, criado_em desc
 limit 50;

-- @consulta vendedores_sem_codigo_com_login
-- @colunas usuario_id, ativo, ja_entrou, carteira_ativa, criado_em
select u.id as usuario_id, u.ativo, (u.ultimo_login_em is not null) as ja_entrou, count(c.id) as carteira_ativa,
       u.created_at as criado_em
  from core.usuario u
  join core.v_leitura_usuario_senha s on s.id = u.id
  left join core.carteira c on c.tenant_id = u.tenant_id and c.usuario_id = u.id and c.deleted_at is null
 where u.tenant_id = :'tenant_id' and u.perfil = 'vendedor' and u.external_id is null and s.tem_senha
   and u.deleted_at is null
 group by u.id, u.ativo, u.ultimo_login_em, u.created_at
 order by criado_em desc
 limit 50;

-- @consulta carteira_por_usuario
-- @colunas usuario_id, ativos, encerrados
select c.usuario_id, count(*) filter (where c.deleted_at is null) as ativos,
       count(*) filter (where c.deleted_at is not null) as encerrados
  from core.carteira c
 where c.tenant_id = :'tenant_id' and c.papel = 'vendedor'
 group by c.usuario_id
 order by ativos desc
 limit 20;

-- @consulta filiais_da_carteira_do_codigo
-- @colunas usuario_id, clientes, filiais_da_carteira
select u.id as usuario_id, count(distinct c.cliente_id) as clientes, count(distinct cl.filial_id) as filiais_da_carteira
  from core.usuario u
  left join core.carteira c on c.tenant_id = u.tenant_id and c.usuario_id = u.id and c.deleted_at is null and c.papel = 'vendedor'
  left join core.cliente cl on cl.tenant_id = c.tenant_id and cl.id = c.cliente_id
 where u.tenant_id = :'tenant_id' and u.external_id = :'external_id'
 group by u.id;

-- @consulta clientes_do_codigo
-- @colunas no_staging, no_staging_ativos, em_core, com_carteira, na_carteira_do_codigo
with staging as (
  select r.external_id, r.ativo
    from integracao.registro_atual r
   where r.tenant_id = :'tenant_id' and r.entidade = 'cliente' and r.deleted_at is null
     and r.payload->>'vendedor_external_id' = :'external_id'
), dono as (
  select u.id from core.usuario u where u.tenant_id = :'tenant_id' and u.external_id = :'external_id'
)
select count(*) as no_staging, count(*) filter (where s.ativo) as no_staging_ativos, count(cl.id) as em_core,
       count(cl.id) filter (where exists (select 1 from core.carteira c
                                           where c.tenant_id = cl.tenant_id and c.cliente_id = cl.id and c.papel = 'vendedor'
                                             and c.deleted_at is null)) as com_carteira,
       count(cl.id) filter (where exists (select 1 from core.carteira c join dono d on d.id = c.usuario_id
                                           where c.tenant_id = cl.tenant_id and c.cliente_id = cl.id and c.papel = 'vendedor'
                                             and c.deleted_at is null)) as na_carteira_do_codigo
  from staging s
  left join core.cliente cl on cl.tenant_id = :'tenant_id' and cl.external_id = s.external_id and cl.deleted_at is null;

-- @consulta vendedor_no_staging
-- @colunas ativo, nome_vazio, sem_email, apagado, alterado_em, aplicado_em
select r.ativo, (coalesce(trim(r.payload->>'nome'), '') = '') as nome_vazio,
       (coalesce(trim(r.payload->>'email'), '') = '') as sem_email, (r.deleted_at is not null) as apagado,
       r.alterado_em, r.aplicado_em
  from integracao.registro_atual r
 where r.tenant_id = :'tenant_id' and r.entidade = 'vendedor' and r.external_id = :'external_id';

-- @consulta erros_de_carga
-- @colunas entidade, codigo, campo, reprocessavel, resolvido, linhas, ultimo_lote_em
select l.entidade, e.codigo, e.campo, e.reprocessavel, (e.resolvido_em is not null) as resolvido, count(*) as linhas,
       max(l.recebido_em) as ultimo_lote_em
  from integracao.lote l
  join integracao.lote_linha_erro e on e.tenant_id = l.tenant_id and e.lote_id = l.id and e.deleted_at is null
 where l.tenant_id = :'tenant_id' and l.entidade in ('cliente', 'vendedor', 'filial') and l.deleted_at is null
 group by 1, 2, 3, 4, 5
 order by 1, 2, 3, 4, 5;

-- @consulta erros_de_carga_do_codigo
-- @colunas entidade, codigo, campo, resolvido, linhas
select l.entidade, e.codigo, e.campo, (e.resolvido_em is not null) as resolvido, count(*) as linhas
  from integracao.lote l
  join integracao.lote_linha_erro e on e.tenant_id = l.tenant_id and e.lote_id = l.id and e.deleted_at is null
 where l.tenant_id = :'tenant_id' and l.deleted_at is null
   and (e.external_id = :'external_id' or e.payload->>'vendedor_external_id' = :'external_id')
 group by 1, 2, 3, 4
 order by 1, 2, 3, 4;

-- @consulta filiais_e_clientes_na_padrao
-- @colunas filiais, filiais_do_erp, clientes_na_padrao_com_outra_filial_no_erp
select (select count(*) from core.filial f where f.tenant_id = :'tenant_id' and f.deleted_at is null) as filiais,
       (select count(*) from core.filial f
         where f.tenant_id = :'tenant_id' and f.deleted_at is null and f.external_id is not null) as filiais_do_erp,
       (select count(*)
          from core.cliente cl
          join core.filial f on f.tenant_id = cl.tenant_id and f.id = cl.filial_id and f.padrao
         where cl.tenant_id = :'tenant_id' and cl.deleted_at is null
           and exists (select 1 from integracao.registro_atual r
                        where r.tenant_id = cl.tenant_id and r.entidade = 'cliente' and r.deleted_at is null
                          and r.external_id = cl.external_id
                          and coalesce(r.payload->>'filial_external_id', '') <> ''
                          and r.payload->>'filial_external_id' is distinct from f.external_id)) as clientes_na_padrao_com_outra_filial_no_erp;

-- @consulta outbox_do_erp
-- @colunas entidade, publicado, com_falha, eventos, tentativas_max, mais_antigo_em
select case when e.nome = 'integracao.cliente.atualizado@1' then 'cliente' else 'vendedor' end as entidade,
       (e.publicado_em is not null) as publicado, (e.ultimo_erro is not null) as com_falha, count(*) as eventos,
       max(e.tentativas) as tentativas_max, min(e.ocorrido_em) as mais_antigo_em
  from plataforma.evento e
 where e.tenant_id = :'tenant_id' and e.deleted_at is null
   and e.nome in ('integracao.cliente.atualizado@1', 'integracao.vendedor.atualizado@1')
 group by 1, 2, 3
 order by 1, 2, 3;
