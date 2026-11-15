-- 0071_plataforma_listar_tenants_plano (down) — volta a plataforma.sa_listar_tenants(p_sid uuid) ao texto da 0039 (sem plano,
-- teste_ate e paga). create or replace: mesma assinatura e mesmo retorno (jsonb), o EXECUTE só ao macuxi_portal (0039) fica.
-- A API lê a lista com os 3 campos opcionais (ausentes = sem plano): nada quebra.

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
  -- contrato (MODULOS de packages/platform-sdk/src/nomes.ts; teste estático)
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'razao_social', t.nome, 'cnpj', t.documento, 'fuso', t.fuso, 'status', t.status,
             'criada_em', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'modulos', coalesce((
               select jsonb_agg(jsonb_build_object('modulo', tm.modulo, 'licencas', tm.licencas) order by tm.modulo)
                 from plataforma.tenant_modulo tm
                where tm.tenant_id = t.id and tm.deleted_at is null and tm.ativo
                  and tm.modulo = any (array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'])
             ), '[]'::jsonb)
           ) order by t.nome, t.id)
      from plataforma.tenant t
     where t.deleted_at is null
       and (v_tipo = 'super_admin'
            or exists (select 1 from plataforma.portal_sessao_empresa e
                        where e.sessao_id = p_sid and e.tenant_alvo_id = t.id and e.deleted_at is null))
  ), '[]'::jsonb));
end
$$;
