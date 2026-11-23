-- Conferência da 0098_core_integracao_pre_cadastro_revisao (ADR 0069 itens 6 e 10). SÓ INFORMATIVA: não é condição do "aprovo
-- deploy"; o gerente informa o resultado ao dono do produto. Rode ANTES da 0098 (depois dela o espelho já está gravado em todo tenant
-- e o caso (b) some). Só leitura; rode como administrador do banco (vê todos os tenants) ou como macuxi_app com app.tenant_id (vê só
-- o tenant). Sai só o código do tenant, nomes de campo e contagens (nenhum dado pessoal). Dicionário: docs/banco/core.md ("0098").
-- Duas consultas: (1) o que muda nos campos obrigatórios (item 6); (2) duplicados da v1.0.28 (item 10).
--
-- (1)
-- Mesmas regras da migração: E = lista efetiva da RN-CORE-16 (códigos conhecidos de cliente.campos_obrigatorios; nenhum = o
-- padrão; razão social e documento sempre); P = cliente.pre_cadastro.obrigatorios válido (inválido = vazio) com endereco expandido;
-- antes, o pré-cadastro exigia razão social, documento e P; depois exige (E ∪ P) menos complemento e geolocalização.
--   caso (a): campos de P fora de E — passam a valer no cadastro completo dos clientes do ERP (RN-CORE-17: pedido só como orçamento
--             para quem não os tiver) -> coluna novos_no_cadastro_completo;
--   caso (b): tenant sem nenhuma das duas chaves — o pré-cadastro passa a exigir o padrão da RN-CORE-16 (IE para CNPJ e endereço);
--   caso (c): os demais com campo novo no pré-cadastro (a lista da RN-CORE-16 passa a valer nele);
--   em todos: novos_no_pre_cadastro = o que o pré-cadastro passa a exigir e antes não exigia.
with canonico (campo, ordem) as (
  values ('razao_social', 1), ('documento', 2), ('inscricao_estadual', 3), ('logradouro', 4), ('numero', 5), ('bairro', 6),
         ('cidade', 7), ('uf', 8), ('cep', 9), ('nome_fantasia', 10), ('telefone', 11), ('email', 12), ('complemento', 13),
         ('geolocalizacao', 14)
),
padrao (campo) as (
  values ('razao_social'), ('documento'), ('inscricao_estadual'), ('logradouro'), ('numero'), ('bairro'), ('cidade'), ('uf'), ('cep')
),
configuraveis (campo) as (
  values ('nome_fantasia'), ('inscricao_estadual'), ('telefone'), ('email'), ('endereco')
),
endereco (campo) as (
  values ('logradouro'), ('numero'), ('bairro'), ('cidade'), ('uf'), ('cep')
),
chave_e as (
  select p.tenant_id, p.valor from plataforma.parametro p
   where p.modulo = 'core' and p.chave = 'cliente.campos_obrigatorios' and p.deleted_at is null
),
chave_p as (
  select p.tenant_id, p.valor from plataforma.parametro p
   where p.modulo = 'core' and p.chave = 'cliente.pre_cadastro.obrigatorios' and p.deleted_at is null
),
lista_e as (
  select e.tenant_id, x.campo
    from chave_e e
   cross join lateral jsonb_array_elements(case when jsonb_typeof(e.valor) = 'array' then e.valor else '[]'::jsonb end) el
   cross join lateral (select el #>> '{}' as campo where jsonb_typeof(el) = 'string') x
   where x.campo in (select campo from canonico)
),
p_valida as (
  select p.tenant_id, p.valor
    from chave_p p
   where jsonb_typeof(p.valor) = 'array'
     and jsonb_array_length(p.valor) <= 5
     and not exists (
       select 1 from jsonb_array_elements(p.valor) el
        where jsonb_typeof(el) <> 'string' or (el #>> '{}') not in (select campo from configuraveis))
     and (select count(distinct el #>> '{}') from jsonb_array_elements(p.valor) el) = jsonb_array_length(p.valor)
),
lista_p (tenant_id, campo) as (
  select p.tenant_id, x.campo
    from p_valida p
   cross join lateral jsonb_array_elements(p.valor) el
   cross join lateral (select el #>> '{}' as campo where el #>> '{}' <> 'endereco'
                       union all
                       select en.campo from endereco en where el #>> '{}' = 'endereco') x
),
e (tenant_id, campo) as (
  select l.tenant_id, l.campo from lista_e l
  union
  select t.id, d.campo from plataforma.tenant t cross join padrao d where not exists (select 1 from lista_e l where l.tenant_id = t.id)
  union
  select t.id, f.campo from plataforma.tenant t cross join (values ('razao_social'), ('documento')) f (campo)
),
uniao (tenant_id, campo) as (
  select tenant_id, campo from e
  union
  select tenant_id, campo from lista_p
),
pre_antes (tenant_id, campo) as (
  select t.id, f.campo from plataforma.tenant t cross join (values ('razao_social'), ('documento')) f (campo)
  union
  select tenant_id, campo from lista_p
),
resumo as (
  select t.id as tenant_id, t.codigo,
         exists (select 1 from chave_e x where x.tenant_id = t.id) as tem_chave_cliente,
         exists (select 1 from chave_p x where x.tenant_id = t.id) as tem_chave_pre_cadastro,
         (select string_agg(u.campo, ', ' order by c.ordem) from uniao u join canonico c on c.campo = u.campo
           where u.tenant_id = t.id and not exists (select 1 from e where e.tenant_id = t.id and e.campo = u.campo)) as novos_no_cadastro_completo,
         (select string_agg(u.campo, ', ' order by c.ordem) from uniao u join canonico c on c.campo = u.campo
           where u.tenant_id = t.id and u.campo not in ('complemento', 'geolocalizacao')
             and not exists (select 1 from pre_antes a where a.tenant_id = t.id and a.campo = u.campo)) as novos_no_pre_cadastro
    from plataforma.tenant t
)
select r.codigo as tenant,
       case when r.novos_no_cadastro_completo is not null then 'a'
            when not r.tem_chave_cliente and not r.tem_chave_pre_cadastro then 'b'
            else 'c' end as caso,
       r.tem_chave_cliente, r.tem_chave_pre_cadastro, r.novos_no_cadastro_completo, r.novos_no_pre_cadastro
  from resumo r
 where r.novos_no_cadastro_completo is not null or r.novos_no_pre_cadastro is not null
 order by r.codigo;

-- (2) Duplicados da v1.0.28 (ADR 0069 item 10): a carga do ERP chegou antes do vínculo e criou outro cliente com o código, e o
-- 'vinculado' do pré-cadastro caiu em codigo_em_uso. Conta, por tenant, os pré-cadastros vivos ainda sem Código ERP com essa
-- auditoria (cliente.vinculo_erp_recusado, resultado codigo_em_uso). A ADR não os corrige; o gerente leva a contagem ao dono do
-- produto. Sai só o código do tenant e a contagem.
select t.codigo as tenant, count(distinct c.id)::int as duplicados_v1028
  from core.cliente c
  join plataforma.tenant t on t.id = c.tenant_id
 where c.origem_cadastro <> 'erp' and c.deleted_at is null and c.external_id is null
   and exists (
     select 1 from plataforma.auditoria a
      where a.tenant_id = c.tenant_id and a.entidade_id = c.id and a.acao = 'cliente.vinculo_erp_recusado'
        and a.depois ->> 'resultado' = 'codigo_em_uso')
 group by t.codigo
 order by t.codigo;
