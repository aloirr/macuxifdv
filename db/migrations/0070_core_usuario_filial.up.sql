-- 0070_core_usuario_filial (up) — T-0176: filial do usuário (vendedor com UMA filial; supervisor, promotor e gerente com
-- várias). Decisão do dono do produto R-20261115-073000, item 1 (muda a RN-CORE-39, que dizia que o vendedor não tem filial
-- própria), e R-20261115-080000 (o vendedor sem filial fica BLOQUEADO no app; a migração não dá filial provisória nem a
-- padrão). Migração em cima da 0069 (core_cargo_hierarquia). Dicionário: docs/banco/core.md ("0070"). Teste:
-- db/testes/usuario-filial.db.test.ts (estático sempre; banco e up/down no CI).
-- Migração ADITIVA: 1 tabela nova (vazia), 3 funções e 6 gatilhos; SEM backfill. Nenhuma coluna nova em tabela existente; nenhum
-- contrato muda de versão (o filial_ids do usuário é do modulo-core, aditivo).
--
-- core.usuario_filial (dono: Core): uma linha viva por (usuário, filial) — único parcial usuario_filial_uk (tenant_id,
--   usuario_id, filial_id) vivo, que também atende "filiais do usuário". FKs compostas para core.usuario e core.filial (filial
--   de outro tenant = 23503). Índice usuario_filial_filial_ix (tenant_id, filial_id) vivo: "usuários da filial" (BKO e a trava
--   de inativar filial com usuário). Índice de sync (tenant_id, updated_at, id): a linha pode ir ao aparelho (o pull é decisão
--   do modulo-core). Remover o vínculo = soft delete (deleted_at); o macuxi_app não tem DELETE.
--   Volume: 1 linha por vendedor; poucas por supervisor, promotor e gerente; centenas por tenant.
-- MÁXIMO DE 1 FILIAL VIVA PARA O VENDEDOR (cargo vendedor do perfil único, core.v_usuario_hierarquia da 0069 — a mesma régua
--   do promotor; perfil personalizado de cargo vendedor conta, o de cargo promotor com base vendedor não): gatilhos de
--   restrição ADIADOS (no COMMIT; a ordem das gravações na transação não importa — trocar a filial = apagar a antiga e inserir
--   a nova em qualquer ordem), função core.conferir_filial_vendedor. Erro:
--     usuario_filial_vendedor_uma (23514)  vendedor vivo com 2+ vínculos vivos em core.usuario_filial; detail
--                                          'usuario_id=<uuid>', hint 'RN-CORE-39'. A API do Core mapeia para 422.
--   Valem para GRAVAÇÕES novas ou alteradas: core.usuario_filial (insert; update de usuario_id, filial_id, deleted_at),
--   core.usuario (update de deleted_at: usuário restaurado), plataforma.usuario_perfil (insert; update de perfil_id,
--   deleted_at: o usuário vira vendedor) e plataforma.perfil (update de cargo: os usuários do perfil). Para o erro sair no
--   comando e não no COMMIT, a API pode rodar `set constraints usuario_filial_conferir_vendedor immediate` antes de terminar.
--   Concorrência: o gatilho usuario_filial_travar (BEFORE, imediato) e a conferência pegam pg_advisory_xact_lock por (tenant,
--   usuário); duas transações que dão filial ao mesmo vendedor ficam em fila e a segunda vê a primeira no COMMIT.
--   O MÍNIMO (exatamente 1 para o vendedor; 1+ para supervisor, promotor e gerente) NÃO é do banco: é do domain/API do Core
--   (validarFiliaisDoUsuario, RN-CORE-39, 422). Vendedor sem filial PASSA no banco (carga do ERP, cadastro antigo): nenhum
--   gatilho recusa o zero; ele fica BLOQUEADO no app até a carga do ERP ou o BKO informar a filial, e vira aviso ao admin
--   (consulta: vendedor vivo e ativo sem linha viva aqui).
--   core.filial_vendedor_conferir() é SECURITY DEFINER (como a core.promotor_conferir da 0069): gatilho adiado dispara no
--   COMMIT com o papel da sessão, e o COMMIT de uma sa_* do macuxi_portal não tem acesso a core. Roda como o dono, só LÊ, só o
--   tenant da linha; nenhum EXECUTE a ninguém.
-- SEM BACKFILL (R-20261115-080000): a tabela nasce vazia; todo vendedor existente fica sem filial (bloqueado no app) até a
--   carga do ERP ou o BKO gravar a filial dele.
--
-- RLS: core.usuario_filial com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert,
-- update. macuxi_worker e macuxi_portal: nada.
-- Caminho de volta: 0070_core_usuario_filial.down.sql — apaga os 6 gatilhos, as 3 funções e a tabela (os vínculos de filial dos
-- usuários se perdem; reaplicar a 0070 recria a tabela vazia). Volte antes o código do Core que lê/grava a tabela.

-- =============================================================================================
-- core.usuario_filial — filiais do usuário (RN-CORE-39)
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
-- Vendedor: no máximo 1 filial viva (R-20261115-073000, RN-CORE-39)
-- =============================================================================================
-- Trava por (tenant, usuário) até o fim da transação: a 2ª gravação concorrente espera e a conferência dela, no COMMIT, vê a 1ª.
create function core.usuario_filial_travar() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if new.deleted_at is null then
    perform pg_advisory_xact_lock(hashtextextended('core.usuario_filial:' || new.tenant_id::text || ':' || new.usuario_id::text, 0));
  end if;
  return new;
end
$$;
revoke all on function core.usuario_filial_travar() from public;

-- Confere os usuários dados: vendedor vivo (cargo pela view da 0069) com 2+ filiais vivas = erro. Sem tenant (exclusão do tenant
-- em curso) = nada a conferir. count(distinct): no meio da troca de perfil a view pode trazer 2 linhas do mesmo usuário (a
-- exclusão usuario_perfil_um_vivo é conferida no mesmo COMMIT).
create function core.conferir_filial_vendedor(p_tenant uuid, p_usuarios uuid[]) returns void
  language plpgsql volatile
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_usuario uuid;
  v record;
begin
  if p_tenant is null or not exists (select 1 from plataforma.tenant t where t.id = p_tenant) then
    return;
  end if;
  for v_usuario in select distinct x from unnest(coalesce(p_usuarios, '{}')) as x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('core.usuario_filial:' || p_tenant::text || ':' || v_usuario::text, 0));
  end loop;
  for v in
    select h.usuario_id, count(distinct uf.id) as filiais
      from core.v_usuario_hierarquia h
      join core.usuario_filial uf on uf.tenant_id = h.tenant_id and uf.usuario_id = h.usuario_id and uf.deleted_at is null
     where h.tenant_id = p_tenant and h.cargo = 'vendedor' and h.usuario_id = any(coalesce(p_usuarios, '{}'))
     group by h.usuario_id
    having count(distinct uf.id) > 1
  loop
    raise exception 'vendedor com mais de uma filial: o vendedor tem uma filial só'
      using errcode = '23514', constraint = 'usuario_filial_vendedor_uma', detail = 'usuario_id=' || v.usuario_id::text,
            hint = 'RN-CORE-39';
  end loop;
end
$$;
revoke all on function core.conferir_filial_vendedor(uuid, uuid[]) from public;

-- Uma função de gatilho para as 4 tabelas, conferida no COMMIT. SECURITY DEFINER (ver o cabeçalho).
create function core.filial_vendedor_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
begin
  case tg_table_schema || '.' || tg_table_name
    when 'core.usuario_filial' then
      if new.deleted_at is null then
        perform core.conferir_filial_vendedor(new.tenant_id, array[new.usuario_id]);
      end if;
    when 'core.usuario' then
      if new.deleted_at is null then
        perform core.conferir_filial_vendedor(new.tenant_id, array[new.id]);
      end if;
    when 'plataforma.usuario_perfil' then
      if new.deleted_at is null then
        perform core.conferir_filial_vendedor(new.tenant_id, array[new.usuario_id]);
      end if;
    when 'plataforma.perfil' then
      if new.cargo = 'vendedor' then
        perform core.conferir_filial_vendedor(new.tenant_id,
          array(select up.usuario_id from plataforma.usuario_perfil up
                 where up.tenant_id = new.tenant_id and up.perfil_id = new.id and up.deleted_at is null));
      end if;
  end case;
  return null;
end
$$;
revoke all on function core.filial_vendedor_conferir() from public;

create trigger usuario_filial_travar before insert or update of usuario_id, deleted_at on core.usuario_filial
  for each row execute function core.usuario_filial_travar();
create constraint trigger usuario_filial_conferir_vendedor after insert or update of usuario_id, filial_id, deleted_at on core.usuario_filial
  deferrable initially deferred
  for each row execute function core.filial_vendedor_conferir();
create constraint trigger usuario_conferir_filial_vendedor after update of deleted_at on core.usuario
  deferrable initially deferred
  for each row execute function core.filial_vendedor_conferir();
create constraint trigger usuario_perfil_conferir_filial_vendedor after insert or update of perfil_id, deleted_at on plataforma.usuario_perfil
  deferrable initially deferred
  for each row execute function core.filial_vendedor_conferir();
create constraint trigger perfil_conferir_filial_vendedor after update of cargo on plataforma.perfil
  deferrable initially deferred
  for each row execute function core.filial_vendedor_conferir();
