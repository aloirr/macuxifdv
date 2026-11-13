-- 0064_core_tarefa (up) — T-0170 (tarefas do consultor; RN-CORE-TAR-01..12). Desenho docs/desenho/tarefas-consultor.md §3
-- (pedido ao banco-dados) e §5 (sync). Migração em cima da 0063. Dicionário: docs/banco/core.md ("0064").
-- Teste: db/testes/t0170-tarefa.db.test.ts (estático no PC; banco e up/down no CI).
--
-- Migração ADITIVA: 2 tabelas novas no Core, 1 coluna + FK + único + gatilho de coerência em core.notificacao e 2 gatilhos em
-- core.tarefa (destinatários e coerência).
--
-- core.tarefa (dono: Core): a tarefa como foi cadastrada no BKO. id gerado no BKO (idempotência do POST). autor_id (FK composta
--   core.usuario); titulo 1..120 (não vazio); descricao <= 1000; prazo = data civil no fuso do tenant; cliente_id (FK composta
--   core.cliente, nulo = sem cliente); tipo simples|foto|pesquisa; questionario_id SEM FK (schema pesquisa, regra 1), presente
--   só e sempre no tipo pesquisa; alvo usuarios|equipe|todos (só para o BKO mostrar), equipe_id (FK composta core.equipe) só e
--   sempre no alvo equipe; cancelada_em + cancelada_por (FK composta core.usuario) juntos (essas duas coerências, que amarram
--   coluna de FK, ficam no gatilho tarefa_conferir_coerencia e não em CHECK: a FK cruzada decide antes); motivo_cancelamento
--   <= 300, só na
--   cancelada. Volume: ~5 por semana por equipe; o BKO lista por autor e as atrasadas pelo prazo.
-- core.tarefa_destinatario (dono: Core): uma linha por consultor — é a linha que vai ao aparelho (pull `tarefa`, escopo
--   proprio, índice (tenant_id, usuario_id, updated_at, id)). tarefa_id (FK composta core.tarefa), usuario_id (FK composta
--   core.usuario), concluida_em (hora do aparelho) e recebida_em (hora do servidor) juntos, conclusao_id (UUID do comando,
--   único no tenant: idempotência do push `tarefa_conclusao`), observacao <= 500, resposta_id (resposta da Pesquisa, SEM FK),
--   suspeita (relógio adiantado, RN-CORE-TAR-06). A mesma tarefa vai uma vez a cada pessoa (único vivo
--   tarefa_dest_usuario_uk). Volume: ~20 linhas por consultor na janela de 30 dias; até 500 por tarefa.
-- core.notificacao.tarefa_id (§3.3): aviso da tarefa (tipo 'sistema', subtipo 'tarefa'), FK composta core.tarefa; só com
--   subtipo 'tarefa' (gatilho de restrição notificacao_tarefa_subtipo); um aviso por (usuário, tarefa) (notificacao_tarefa_uk):
--   criar a mesma tarefa de novo não duplica.
-- Gatilho tarefa_tocar_destinatarios (AFTER UPDATE em core.tarefa): mudou o que o aparelho mostra (titulo, descricao, prazo,
--   tipo, cliente_id, questionario_id, cancelada_em ou deleted_at) -> o updated_at das linhas de core.tarefa_destinatario da
--   tarefa anda (gatilho tarefa_destinatario_updated_at), e o pull, que lê pelo destinatário, traz a mudança.
--
-- RLS: as 2 tabelas com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert e
-- update, SEM delete (remover = deleted_at). macuxi_worker: sem acesso. Fotos da tarefa: plataforma.arquivo (ADR 0010;
-- modulo 'core', finalidade 'tarefa', entidade 'tarefa_destinatario'); nenhuma tabela de fotos nova.
--
-- Caminho de volta: 0064_core_tarefa.down.sql (APAGA as tarefas, os destinatários e as conclusões e a coluna
-- core.notificacao.tarefa_id — os avisos ficam, sem o vínculo; as fotos em plataforma.arquivo e os bytes ficam). Volte antes
-- o Core que lê ou grava as tabelas (senão 42P01/42703).

-- =============================================================================================
-- core.tarefa — a tarefa como foi cadastrada (desenho §3.1)
-- =============================================================================================
create table core.tarefa (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  autor_id             uuid not null,
  titulo               text not null,
  descricao            text,
  prazo                date not null,
  cliente_id           uuid,
  tipo                 text not null,
  questionario_id      uuid,
  alvo                 text not null,
  equipe_id            uuid,
  cancelada_em         timestamptz,
  cancelada_por        uuid,
  motivo_cancelamento  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint tarefa_tenant_id_uk unique (tenant_id, id),
  constraint tarefa_autor_fk foreign key (tenant_id, autor_id) references core.usuario (tenant_id, id),
  constraint tarefa_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint tarefa_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id),
  constraint tarefa_cancelada_por_fk foreign key (tenant_id, cancelada_por) references core.usuario (tenant_id, id),
  constraint tarefa_titulo_tamanho check (btrim(titulo) <> '' and char_length(titulo) <= 120),
  constraint tarefa_descricao_tamanho check (descricao is null or char_length(descricao) <= 1000),
  constraint tarefa_tipo_valido check (tipo in ('simples', 'foto', 'pesquisa')),
  constraint tarefa_questionario_coerente check ((tipo = 'pesquisa') = (questionario_id is not null)),
  constraint tarefa_alvo_valido check (alvo in ('usuarios', 'equipe', 'todos')),
  constraint tarefa_motivo_tamanho check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 300),
  constraint tarefa_motivo_so_cancelada check (motivo_cancelamento is null or cancelada_em is not null)
);
create index tarefa_sync_ix on core.tarefa (tenant_id, updated_at, id);
create index tarefa_autor_ix on core.tarefa (tenant_id, autor_id, created_at desc);
create index tarefa_prazo_abertas_ix on core.tarefa (tenant_id, prazo) where cancelada_em is null and deleted_at is null;
create unique index tarefa_external_uk on core.tarefa (tenant_id, external_id) where external_id is not null and deleted_at is null;
-- Coerência que amarra coluna de FK composta (tarefa_equipe_coerente: equipe_id só e sempre no alvo equipe;
-- tarefa_cancelamento_par: cancelada_em e cancelada_por juntos): gatilho de restrição AFTER, não CHECK. O CHECK roda na escrita
-- da linha, ANTES da FK (gatilho no fim do comando): apontar equipe_id/cancelada_por para linha de outro tenant seria recusado
-- pela coerência (23514) e não pela FK (23503), que é quem prova o isolamento (S0-025,
-- tests/integracao/multitenant/vazamento-escrita.test.ts). Mesma regra, mesmo SQLSTATE (23514) e o nome da regra na mensagem
-- e em CONSTRAINT; o nome em minúsculas ordena o gatilho depois dos da FK ("RI_ConstraintTrigger_*": ordem alfabética).
create function core.tarefa_conferir_coerencia() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
declare
  v_regra text;
begin
  if (new.alvo = 'equipe') is distinct from (new.equipe_id is not null) then
    v_regra := 'tarefa_equipe_coerente';
  elsif (new.cancelada_em is null) <> (new.cancelada_por is null) then
    v_regra := 'tarefa_cancelamento_par';
  end if;
  if v_regra is not null then
    raise exception 'new row for relation "%" violates check constraint "%"', tg_table_name, v_regra
      using errcode = 'check_violation', constraint = v_regra, schema = tg_table_schema, table = tg_table_name;
  end if;
  return null;
end
$$;
revoke all on function core.tarefa_conferir_coerencia() from public;
create constraint trigger tarefa_conferir_coerencia
  after insert or update of alvo, equipe_id, cancelada_em, cancelada_por on core.tarefa
  for each row execute function core.tarefa_conferir_coerencia();
create trigger tarefa_updated_at before update on core.tarefa
  for each row execute function plataforma.definir_updated_at();
alter table core.tarefa enable row level security;
alter table core.tarefa force row level security;
create policy isolamento_tenant on core.tarefa for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.tarefa for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.tarefa to macuxi_app;

-- =============================================================================================
-- core.tarefa_destinatario — uma linha por consultor, a que vai ao aparelho (desenho §3.2)
-- =============================================================================================
create table core.tarefa_destinatario (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  tarefa_id     uuid not null,
  usuario_id    uuid not null,
  concluida_em  timestamptz,
  recebida_em   timestamptz,
  conclusao_id  uuid,
  observacao    text,
  resposta_id   uuid,
  suspeita      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint tarefa_destinatario_tenant_id_uk unique (tenant_id, id),
  constraint tarefa_dest_tarefa_fk foreign key (tenant_id, tarefa_id) references core.tarefa (tenant_id, id),
  constraint tarefa_dest_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint tarefa_dest_conclusao_par check ((concluida_em is null) = (recebida_em is null)),
  constraint tarefa_dest_observacao_tamanho check (observacao is null or char_length(observacao) <= 500)
);
create unique index tarefa_dest_usuario_uk on core.tarefa_destinatario (tenant_id, tarefa_id, usuario_id) where deleted_at is null;
create unique index tarefa_dest_conclusao_uk on core.tarefa_destinatario (tenant_id, conclusao_id) where conclusao_id is not null;
create index tarefa_dest_sync_ix on core.tarefa_destinatario (tenant_id, updated_at, id);
create index tarefa_dest_usuario_sync_ix on core.tarefa_destinatario (tenant_id, usuario_id, updated_at, id);
create index tarefa_dest_abertas_ix on core.tarefa_destinatario (tenant_id, usuario_id) where concluida_em is null and deleted_at is null;
create index tarefa_dest_tarefa_ix on core.tarefa_destinatario (tenant_id, tarefa_id);
create unique index tarefa_destinatario_external_uk on core.tarefa_destinatario (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tarefa_destinatario_updated_at before update on core.tarefa_destinatario
  for each row execute function plataforma.definir_updated_at();
alter table core.tarefa_destinatario enable row level security;
alter table core.tarefa_destinatario force row level security;
create policy isolamento_tenant on core.tarefa_destinatario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.tarefa_destinatario for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.tarefa_destinatario to macuxi_app;

-- =============================================================================================
-- Gatilho: mudança na tarefa anda o updated_at dos destinatários (desenho §3.3)
-- =============================================================================================
create function core.tocar_destinatarios_tarefa() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  update core.tarefa_destinatario d
     set updated_at = now()
   where d.tenant_id = new.tenant_id and d.tarefa_id = new.id;
  return null;
end
$$;
revoke all on function core.tocar_destinatarios_tarefa() from public;
grant execute on function core.tocar_destinatarios_tarefa() to macuxi_app;

create trigger tarefa_tocar_destinatarios after update on core.tarefa
  for each row
  when ((old.titulo, old.descricao, old.prazo, old.tipo, old.cliente_id, old.questionario_id, old.cancelada_em, old.deleted_at)
        is distinct from
        (new.titulo, new.descricao, new.prazo, new.tipo, new.cliente_id, new.questionario_id, new.cancelada_em, new.deleted_at))
  execute function core.tocar_destinatarios_tarefa();

-- =============================================================================================
-- core.notificacao.tarefa_id — o aviso da tarefa (desenho §3.3)
-- =============================================================================================
alter table core.notificacao add column tarefa_id uuid;
alter table core.notificacao add constraint notificacao_tarefa_fk
  foreign key (tenant_id, tarefa_id) references core.tarefa (tenant_id, id);
-- notificacao_tarefa_subtipo: tarefa_id só com subtipo 'tarefa' (subtipo nulo também recusa). Gatilho de restrição AFTER e não
-- CHECK, pelo mesmo motivo de tarefa_conferir_coerencia: a FK notificacao_tarefa_fk decide primeiro (23503) quando a tarefa é de
-- outro tenant; a coerência recusa com 23514 e o nome da regra.
create function core.notificacao_conferir_tarefa() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if new.tarefa_id is not null and new.subtipo is distinct from 'tarefa' then
    raise exception 'new row for relation "%" violates check constraint "%"', tg_table_name, 'notificacao_tarefa_subtipo'
      using errcode = 'check_violation', constraint = 'notificacao_tarefa_subtipo', schema = tg_table_schema, table = tg_table_name;
  end if;
  return null;
end
$$;
revoke all on function core.notificacao_conferir_tarefa() from public;
create constraint trigger notificacao_tarefa_subtipo after insert or update of tarefa_id, subtipo on core.notificacao
  for each row when (new.tarefa_id is not null) execute function core.notificacao_conferir_tarefa();
create unique index notificacao_tarefa_uk on core.notificacao (tenant_id, usuario_id, tarefa_id) where tarefa_id is not null;
