-- 0071_plataforma_listar_tenants_plano (up) — a lista de empresas do portal ganha o plano (portal config. enxuto, coluna Plano;
-- R-20261114-170600 e R-20261114-181000; ADR 0047). Contrato: packages/platform-sdk/src/plataforma.ts (EmpresaResumoSchema:
-- plano, teste_ate e em_teste; a API lê paga e calcula o em_teste no fuso de cada empresa). Dicionário: docs/banco/plataforma.md
-- ("Planos e assinatura (0070)", 0071). Teste: db/testes/plano-assinatura.db.test.ts.
--
-- create or replace plataforma.sa_listar_tenants(p_sid uuid) returns jsonb: mesma assinatura, mesmo retorno e tudo o que a
-- 0039 já fazia (sessão viva conferida a cada chamada: 28000; super-admin vê todas as vivas; admin do cliente só as conferidas
-- no login; módulos vivos e ativos do contrato). Cada item ganha, por left join na assinatura VIVA do tenant (uma por tenant,
-- assinatura_tenant_uk) e no plano dela (o nome fica mesmo se a linha do plano tiver sido trocada por versão nova):
--   plano      text | null     plataforma.plano.nome; null = empresa sem assinatura (legado anterior aos planos)
--   teste_ate  text | null     to_char(assinatura.teste_ate, 'YYYY-MM-DD'); null = sem teste ou sem assinatura
--   paga       boolean         coalesce(assinatura.paga, false)
-- O EXECUTE só ao macuxi_portal (0039) continua (create or replace mantém a ACL). Nenhuma tabela, índice ou política muda.
-- Consulta: 1 linha de assinatura por tenant pelo índice único parcial assinatura_tenant_uk (tenant_id) e o plano pela PK.
--
-- Caminho de volta: 0071_plataforma_listar_tenants_plano.down.sql (texto da 0039; a API trata os 3 campos como opcionais).

create or replace function plataforma.sa_listar_tenants(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
begin
  select v.tipo into v_tipo from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_tenants: sessão do portal inválida' using errcode = '28000';
  end if;
  -- super-admin: todas as vivas; admin do cliente: só as conferidas no login. Módulos: só os vivos e ativos, e só os do
  -- contrato (MODULOS de packages/platform-sdk/src/nomes.ts; teste estático). Plano (0071): a assinatura viva e o plano dela.
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'razao_social', t.nome, 'cnpj', t.documento, 'fuso', t.fuso, 'status', t.status,
             'criada_em', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'modulos', coalesce((
               select jsonb_agg(jsonb_build_object('modulo', tm.modulo, 'licencas', tm.licencas) order by tm.modulo)
                 from plataforma.tenant_modulo tm
                where tm.tenant_id = t.id and tm.deleted_at is null and tm.ativo
                  and tm.modulo = any (array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'])
             ), '[]'::jsonb),
             'plano', pl.nome,
             'teste_ate', to_char(a.teste_ate, 'YYYY-MM-DD'),
             'paga', coalesce(a.paga, false)
           ) order by t.nome, t.id)
      from plataforma.tenant t
      left join plataforma.assinatura a on a.tenant_id = t.id and a.deleted_at is null
      left join plataforma.plano pl on pl.id = a.plano_id
     where t.deleted_at is null
       and (v_tipo = 'super_admin'
            or exists (select 1 from plataforma.portal_sessao_empresa e
                        where e.sessao_id = p_sid and e.tenant_alvo_id = t.id and e.deleted_at is null))
  ), '[]'::jsonb));
end
$$;
