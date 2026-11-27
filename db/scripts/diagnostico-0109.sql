-- Diagnóstico da 0109_plataforma_perfis_leitura_concessao (troca de leitura dos perfis, ADR 0073 E6; plano
-- docs/banco/plano-migracao-perfis-sem-base.md §4.1 e §4.4). Só leitura; rode DEPOIS da 0108 e ANTES da 0109, como administrador
-- do banco (vê todos os tenants) ou como macuxi_app com app.tenant_id (vê só o tenant). Sem dado pessoal: ids, códigos e
-- contagens. Dicionário: docs/banco/plataforma.md ("0109 — leitura por concessão").
--
-- Uma linha por tenant, com o que a 0109 vai fazer nele (coluna previsto):
--   ja_ligado  já está em 'concessao' (a 0109 não muda nada)
--   parado     algum achado 'para_tenant' (diagnosticar_perfis_sem_base, 0106): fica em 'legado', com os conflitos gravados
--   ABORTA     derivado, mas a conferência (conferir_perfis_sem_base, 0107) acha DIFERENCA: a 0109 inteira volta (23514);
--              é defeito da derivação, leve ao banco-dados antes do deploy
--   derivar    ainda sem catalogo_aplicado: a 0109 deriva e confere na hora (a diferença, se houver, aborta)
--   ligado     derivado, sem conflito que pare e sem diferença: passa a 'concessao'
with t as (
  select t.id as tenant_id, t.codigo,
         plataforma.leitura_de_perfis(t.id) as leitura_atual,
         (select count(*) from plataforma.diagnosticar_perfis_sem_base(t.id) d where d.efeito = 'para_tenant') as conflitos_que_param,
         exists (select 1 from plataforma.catalogo_aplicado c where c.tenant_id = t.id and c.deleted_at is null) as derivado,
         (select count(*) from plataforma.conferir_perfis_sem_base(t.id) x where x.tipo = 'DIFERENCA') as diferencas
    from plataforma.tenant t
)
select t.tenant_id, t.codigo, t.leitura_atual, t.conflitos_que_param, case when t.derivado then t.diferencas end as diferencas,
       case when t.leitura_atual = 'concessao' then 'ja_ligado'
            when t.conflitos_que_param > 0 then 'parado'
            when not t.derivado then 'derivar'
            when t.diferencas > 0 then 'ABORTA'
            else 'ligado' end as previsto
  from t
 order by t.codigo;
