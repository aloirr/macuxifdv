-- 0077_core_usuario_filial (up) — T-0176 (RN-CORE-39): filial de CADASTRO e filiais de VENDA do usuário. Decisões do dono do
-- produto R-20261115-093000 (substitui "vendedor = 1 filial") e R-20261115-094500 (todo usuário tem filial de cadastro,
-- inclusive admin e analista; sem ela fica bloqueado; a de cadastro faz parte das de venda; backfill abaixo). Proposta do
-- modulo-core: docs/modulos/core/filial-cadastro-venda.md. Depende da 0056 (core.filial); número 0077 porque a 0070–0076 são
-- de outros lotes. Dicionário: docs/banco/core.md ("0077"). Teste: db/testes/usuario-filial.db.test.ts (estático sempre;
-- banco e up/down no CI).
--
-- core.usuario.filial_cadastro_id uuid NULO (nulo = usuário bloqueado; o bloqueio é do domain/API do Core, não do banco):
--   FK composta usuario_filial_cadastro_fk (tenant_id, filial_cadastro_id) -> core.filial (filial de outro tenant = 23503).
--   Índice usuario_filial_cadastro_ix (tenant_id, filial_cadastro_id) vivo: "usuários da filial" e a trava de inativar filial.
--   RLS e grants de core.usuario não mudam (a coluna herda os da tabela).
-- core.usuario_filial (dono: Core): FILIAIS DE VENDA do usuário, uma linha viva por (usuário, filial) — único parcial
--   usuario_filial_uk (tenant_id, usuario_id, filial_id) vivo, que também atende "filiais de venda do usuário". FKs compostas
--   para core.usuario e core.filial. Índice usuario_filial_filial_ix (tenant_id, filial_id) vivo: "usuários que vendem pela
--   filial". Índice de sync (tenant_id, updated_at, id). Remover = soft delete (deleted_at); o macuxi_app não tem DELETE.
--   Quantas filiais de venda cada usuário tem (mínimo 1) é do domain/API do Core (422), não do banco.
--   Volume: 1 a poucas linhas por usuário; centenas por tenant.
-- INVARIANTE "a filial de cadastro está entre as de venda" (R-20261115-094500, item 2): filial_cadastro_id preenchida num
--   usuário vivo exige linha viva em core.usuario_filial com essa filial. Gatilhos de restrição ADIADOS usuario_filial_inclui_cadastro
--   (no COMMIT; a ordem das gravações na transação não importa), um em cada tabela:
--     core.usuario         insert ou update de filial_cadastro_id, deleted_at (trocar o cadastro; restaurar o usuário);
--     core.usuario_filial  update de usuario_id, filial_id, deleted_at ou delete de linha viva (tirar a venda do cadastro).
--   Erro: 23514, constraint usuario_filial_inclui_cadastro, detail 'usuario_id=<uuid>', hint 'RN-CORE-39' (a API mapeia
--   para 422). Para o erro sair no comando e não no COMMIT: `set constraints core.usuario_filial_inclui_cadastro immediate`.
--   Concorrência: a conferência trava a linha do usuário (for no key update); quem troca o cadastro e quem apaga a venda do
--   mesmo usuário ficam em fila, e o segundo confere vendo o primeiro.
--   core.filial_cadastro_conferir() é SECURITY DEFINER (como a core.promotor_conferir da 0069): gatilho adiado dispara no
--   COMMIT com o papel da sessão, e o COMMIT de uma sa_* do macuxi_portal não tem acesso a core. Roda como o dono, só o
--   tenant e o usuário da linha; nenhum EXECUTE a ninguém.
-- BACKFILL (R-20261115-094500, item 5), nesta ordem:
--   1. "quem já tem filial vinculada": NÃO SE APLICA — antes da 0077 não há vínculo usuário–filial em tabela nenhuma
--      (core.usuario, core.equipe e plataforma.* não têm filial; core.usuario_filial nasce aqui, vazia).
--   2. empresa com UMA filial viva: todo usuário vivo (ativo ou não) recebe essa filial como cadastro e como venda.
--   3. quem sobra (empresa com 2+ filiais vivas) fica com filial_cadastro_id nulo, sem venda: bloqueado até o BKO ou a carga.
--   O updated_at dos usuários do passo 2 sobe (gatilho usuario_updated_at): o sync puxa a filial nova.
--
-- ADMIN INICIAL (R-20261115-094500): plataforma.sa_provisionar_tenant (create or replace, a partir do texto da 0068) dá ao admin
--   que ela CRIA a filial padrão do tenant como cadastro e como venda; sem isso ele nasceria bloqueado. Admin existente não muda.
-- RLS: core.usuario_filial com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert,
-- update. macuxi_worker e macuxi_portal: nada.
-- Caminho de volta: 0077_core_usuario_filial.down.sql — volta a sa_provisionar_tenant ao texto da 0068, apaga os 2 gatilhos,
-- a função, a tabela, o índice, a FK e a coluna (as filiais de cadastro e de venda se perdem; reaplicar a 0077 refaz o
-- backfill). Volte antes o código do Core que lê/grava.

-- =============================================================================================
-- core.usuario.filial_cadastro_id — filial de cadastro (RN-CORE-39)
-- =============================================================================================
alter table core.usuario add column filial_cadastro_id uuid;
alter table core.usuario add constraint usuario_filial_cadastro_fk
  foreign key (tenant_id, filial_cadastro_id) references core.filial (tenant_id, id);
create index usuario_filial_cadastro_ix on core.usuario (tenant_id, filial_cadastro_id) where deleted_at is null;

-- =============================================================================================
-- core.usuario_filial — filiais de venda do usuário (RN-CORE-39)
-- =============================================================================================
create table core.usuario_filial (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  filial_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint usuario_filial_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint usuario_filial_filial_fk foreign key (tenant_id, filial_id) references core.filial (tenant_id, id)
);
create unique index usuario_filial_uk on core.usuario_filial (tenant_id, usuario_id, filial_id) where deleted_at is null;
create index usuario_filial_filial_ix on core.usuario_filial (tenant_id, filial_id) where deleted_at is null;
create index usuario_filial_sync_ix on core.usuario_filial (tenant_id, updated_at, id);
create unique index usuario_filial_external_uk on core.usuario_filial (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger usuario_filial_updated_at before update on core.usuario_filial
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario_filial enable row level security;
alter table core.usuario_filial force row level security;
create policy isolamento_tenant on core.usuario_filial for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_filial for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.usuario_filial to macuxi_app;

-- =============================================================================================
-- Invariante: a filial de cadastro está entre as de venda (R-20261115-094500 item 2, RN-CORE-39)
-- =============================================================================================
-- Uma função de gatilho para as 2 tabelas, conferida no COMMIT. SECURITY DEFINER (ver o cabeçalho). Usuário apagado, sem
-- cadastro ou inexistente (exclusão do tenant em curso) = nada a conferir.
create function core.filial_cadastro_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, pg_temp
  as $$
declare
  v_tenant uuid;
  v_usuario uuid;
  v_cadastro uuid;
begin
  if tg_table_name = 'usuario' then
    v_tenant := new.tenant_id;
    v_usuario := new.id;
  else
    v_tenant := old.tenant_id;
    v_usuario := old.usuario_id;
  end if;
  select u.filial_cadastro_id into v_cadastro
    from core.usuario u
   where u.tenant_id = v_tenant and u.id = v_usuario and u.deleted_at is null
     for no key update;
  if v_cadastro is null then
    return null;
  end if;
  if not exists (select 1 from core.usuario_filial uf
                  where uf.tenant_id = v_tenant and uf.usuario_id = v_usuario and uf.filial_id = v_cadastro
                    and uf.deleted_at is null) then
    raise exception 'filial de cadastro fora das filiais de venda: a filial de cadastro também é de venda'
      using errcode = '23514', constraint = 'usuario_filial_inclui_cadastro', detail = 'usuario_id=' || v_usuario::text,
            hint = 'RN-CORE-39';
  end if;
  return null;
end
$$;
revoke all on function core.filial_cadastro_conferir() from public;

create constraint trigger usuario_filial_inclui_cadastro after insert or update of filial_cadastro_id, deleted_at on core.usuario
  deferrable initially deferred
  for each row when (new.filial_cadastro_id is not null and new.deleted_at is null)
  execute function core.filial_cadastro_conferir();
create constraint trigger usuario_filial_inclui_cadastro after update of usuario_id, filial_id, deleted_at or delete on core.usuario_filial
  deferrable initially deferred
  for each row when (old.deleted_at is null)
  execute function core.filial_cadastro_conferir();

-- =============================================================================================
-- Backfill (R-20261115-094500, item 5; passo 1 não se aplica, ver o cabeçalho)
-- =============================================================================================
-- Passo 2: empresa com UMA filial viva — todo usuário vivo recebe a filial como venda e como cadastro.
with filial_unica as (
  select f.tenant_id, min(f.id::text)::uuid as filial_id
    from core.filial f
   where f.deleted_at is null
   group by f.tenant_id
  having count(*) = 1
)
insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
select u.tenant_id, u.id, fu.filial_id
  from core.usuario u
  join filial_unica fu on fu.tenant_id = u.tenant_id
 where u.deleted_at is null;

update core.usuario u
   set filial_cadastro_id = uf.filial_id
  from core.usuario_filial uf
 where uf.tenant_id = u.tenant_id and uf.usuario_id = u.id and uf.deleted_at is null and u.deleted_at is null;

-- =============================================================================================
-- sa_provisionar_tenant: admin inicial com a filial padrão como cadastro e venda (RN-CORE-39, R-20261115-094500)
-- =============================================================================================
-- Texto da 0068 (a versão mais recente) mais o bloco 0077 depois da provisionar_tenant. A ordem das 2 gravações não importa:
-- usuario_filial_inclui_cadastro (adiado) confere no COMMIT, como o dono (core.filial_cadastro_conferir é DEFINER), também
-- no COMMIT do macuxi_portal. Grants e search_path da função não mudam (create or replace).
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
  v_tenant uuid;
  v_filial uuid;
  v_admin uuid;
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
  -- 0077 (RN-CORE-39, R-20261115-094500): o admin inicial criado aqui recebe a filial padrão do tenant (semeada pelo gatilho
  -- da 0056 ao inserir o tenant) como cadastro e como venda; sem ela nasceria bloqueado. Admin existente não muda.
  if v_r ->> 'admin' = 'criado' then
    v_tenant := (v_r ->> 'tenant_id')::uuid;
    v_filial := core.filial_padrao_id(v_tenant);
    select u.id into v_admin
      from core.usuario u
     where u.tenant_id = v_tenant and lower(u.email) = lower(btrim(p -> 'admin' ->> 'email')) and u.deleted_at is null;
    if v_filial is null or v_admin is null then
      raise exception 'sa_provisionar_tenant: tenant sem filial padrão viva ou admin inicial não encontrado' using errcode = '55000',
        hint = 'RN-CORE-39';
    end if;
    insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
    values (v_tenant, v_admin, v_filial)
    on conflict (tenant_id, usuario_id, filial_id) where deleted_at is null do nothing;
    update core.usuario u set filial_cadastro_id = v_filial where u.tenant_id = v_tenant and u.id = v_admin;
  end if;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados', 'admin', v_r -> 'admin'));
  return v_r;
end
$$;

