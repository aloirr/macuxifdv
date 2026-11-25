-- Ensaio das migrações em produção: DEPOIS das migrações (dentro da mesma transação, que termina em ROLLBACK). Consultas 2 a 4
-- de db/scripts/diagnostico-0106.sql (#771, 3acce47), só com contagens: o código da empresa e números, sem ids, nomes,
-- e-mails, documentos ou códigos de perfil. Define :ensaio_falhou (DIFERENCA em tenant derivado ou tenant em 'concessao').
\echo
\echo '== depois das migrações (na transação do ensaio)'
\echo 'tenants por leitura de perfis (esperado: nenhum em concessao)'
select plataforma.leitura_de_perfis(t.id) as leitura, count(*) as tenants from plataforma.tenant t group by 1 order by 1;
select count(*) as em_concessao from plataforma.tenant t where plataforma.leitura_de_perfis(t.id) = 'concessao' \gset

\echo 'catalogo_aplicado vivo por versão e leitura'
select c.versao, c.leitura, count(*) as tenants
  from plataforma.catalogo_aplicado c where c.deleted_at is null group by 1, 2 order by 1, 2;

\echo 'perfil_concessao viva'
select count(*) as concessoes, count(distinct c.perfil_id) as perfis, count(distinct c.tenant_id) as tenants
  from plataforma.perfil_concessao c where c.deleted_at is null;

\echo 'perfil_migracao_conflito em aberto por efeito e tipo (consulta 3)'
select c.efeito, c.tipo, count(*) as achados, count(distinct c.tenant_id) as tenants
  from plataforma.perfil_migracao_conflito c
 where c.resolvido_em is null and c.deleted_at is null
 group by 1, 2 order by 1, 2;

\echo 'diagnosticar_perfis_sem_base nos tenants em legado, por efeito e tipo (consulta 2)'
select d.efeito, d.tipo, count(*) as achados, count(distinct t.id) as tenants
  from plataforma.tenant t
 cross join lateral plataforma.diagnosticar_perfis_sem_base(t.id) d
 where plataforma.leitura_de_perfis(t.id) = 'legado'
 group by 1, 2 order by 1, 2;

\echo 'conferência por empresa: conferir_perfis_sem_base (consulta 4; esperado 0 DIFERENCA em todo tenant derivado)'
select t.codigo as empresa,
       plataforma.perfis_derivados(t.id) as derivado,
       count(c.tipo) filter (where c.tipo = 'DIFERENCA') as diferenca,
       count(c.tipo) filter (where c.tipo = 'NOME_DIVERGENTE') as nome_divergente,
       case when not plataforma.perfis_derivados(t.id) then 'NAO_DERIVADO'
            when count(c.tipo) filter (where c.tipo = 'DIFERENCA') > 0 then 'DIFERENCA'
            else 'OK' end as resultado
  from plataforma.tenant t
  left join lateral plataforma.conferir_perfis_sem_base(t.id) c on true
 where t.deleted_at is null
 group by t.id, t.codigo
 order by t.codigo;

select count(*) filter (where x.derivado and x.diferenca > 0) as tenants_com_diferenca,
       count(*) filter (where not x.derivado) as tenants_nao_derivados,
       count(*) as tenants_conferidos
  from (select plataforma.perfis_derivados(t.id) as derivado,
               (select count(*) from plataforma.conferir_perfis_sem_base(t.id) c where c.tipo = 'DIFERENCA') as diferenca
          from plataforma.tenant t where t.deleted_at is null) x \gset
select (:tenants_com_diferenca > 0 or :em_concessao > 0) as ensaio_falhou \gset
\echo 'resumo: tenants conferidos' :tenants_conferidos '| com DIFERENCA (derivados)' :tenants_com_diferenca '| não derivados' :tenants_nao_derivados '| em concessao' :em_concessao
