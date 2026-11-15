-- 0077_core_usuario_filial (down) — desfaz a 0077 (filial de cadastro e filiais de venda) e volta ao catálogo da 0076 (a
-- anterior). Ordem: a sa_provisionar_tenant volta ao texto da 0068; o gatilho adiado em core.usuario (a tabela que fica); a
-- tabela core.usuario_filial (leva o gatilho dela, os índices e as políticas); a função; por fim o índice, a FK e a coluna
-- filial_cadastro_id de core.usuario.
-- Limites: as filiais de cadastro e de venda se perdem (a 0077, reaplicada, refaz o backfill da empresa com uma filial viva;
-- nas demais a carga do ERP ou o BKO regrava). O updated_at que o backfill subiu não volta.
-- Idempotente. Pré-condição: 0078+ desfeitas e o código do Core que lê/grava a coluna e a tabela já desfeito.

-- sa_provisionar_tenant volta ao texto da 0068 (sem o bloco da filial do admin inicial), antes de sair a tabela e a coluna.
create or replace function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_entrada jsonb;
  v_r jsonb;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_provisionar_tenant: só com sessão de super-admin' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  -- o portal nunca troca senha de usuário existente (RN-CORE-31) e não escolhe sem_admin: ele vem do admin informado
  if p ? 'redefinir_senha' or p ? 'sem_admin' then
    raise exception 'sa_provisionar_tenant: o portal não aceita redefinir_senha nem sem_admin' using errcode = '22023';
  end if;
  -- admin inicial (RN-CORE-34): { email, nome, senha_hash argon2id }, validado pela provisionar_tenant. Empresa NOVA sem admin
  -- = 22023 com hint RN-CORE-34 (a API traduz em 422); empresa existente sem admin = sem_admin (só módulos e parâmetros). Código
  -- fora do formato segue para a provisionar_tenant, que dá o 22023 dela.
  if coalesce(jsonb_typeof(p -> 'admin'), 'null') = 'null' then
    -- 0068: sem codigo (ausente, nulo ou vazio) = código da licença; é empresa nova se o id não é de um tenant vivo
    if (jsonb_typeof(p -> 'codigo') = 'string' and (p ->> 'codigo') ~ '^[a-z0-9][a-z0-9-]{1,39}$'
        and not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(p ->> 'codigo') and t.deleted_at is null))
       or (coalesce(p ->> 'codigo', '') = ''
           and not exists (select 1 from plataforma.tenant t where t.id::text = lower(p ->> 'id') and t.deleted_at is null)) then
      raise exception 'sa_provisionar_tenant: empresa nova exige o admin inicial' using errcode = '22023', hint = 'RN-CORE-34';
    end if;
    v_entrada := (p - 'ator_id' - 'admin') || jsonb_build_object('sem_admin', true, 'ator_id', v_sa);
  else
    v_entrada := (p - 'ator_id') || jsonb_build_object('ator_id', v_sa);
  end if;
  v_r := plataforma.provisionar_tenant(v_entrada);
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados', 'admin', v_r -> 'admin'));
  return v_r;
end
$$;

drop trigger if exists usuario_filial_inclui_cadastro on core.usuario;
drop table if exists core.usuario_filial;
drop function if exists core.filial_cadastro_conferir();
drop index if exists core.usuario_filial_cadastro_ix;
alter table core.usuario drop constraint if exists usuario_filial_cadastro_fk;
alter table core.usuario drop column if exists filial_cadastro_id;
