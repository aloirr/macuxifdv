-- 0084_core_almoco_gestor_alerta_produtividade (up) — T-0180 (alertas de produtividade e Parâmetros › Alertas, v1.0.14).
-- Decisões D3, D4 e D5 da T-0180 (R-20261115-123000 item 1 e R-20261115-120632; gerente-projetos por delegação escrita do
-- dono do produto). Desenho: docs/modulos/gestor/alertas-produtividade.md. Migração em cima da 0083 (número provisório até o
-- merge). Dicionário: docs/banco/core.md e docs/banco/gestor.md ("0084"). Teste:
-- db/testes/almoco-alerta-produtividade.db.test.ts (estático sempre; banco e up/down no CI).
--
-- Migração ADITIVA, sem backfill e sem andar o updated_at (nenhum aparelho puxa de novo por causa da 0084). Nenhum contrato
-- muda de versão; RLS, políticas e grants de core.usuario e gestor.alerta não mudam (as colunas herdam os da tabela), exceto o
-- macuxi_leitura (0078, ADR 0055): SELECT por coluna em core.usuario, então as 2 colunas novas recebem grant próprio.
--
-- 1. core.usuario (dono: Core) — almoço por pessoa (D5, RN-CORE-44):
--      almoco_inicio_min  smallint null  início do almoço em minutos do dia (0..1439, hora LOCAL do tenant: 12:00 = 720)
--      almoco_fim_min     smallint null  fim do almoço em minutos do dia (13:00 = 780)
--    Nulas = "Padrão da empresa" (parâmetro jornada.almoco_padrao do Core, 12:00–13:00 na D6): todo usuário tem horário, o
--    próprio ou o padrão; quem resolve é o domain do Core. Minutos do dia e não `time`: o mesmo número vai ao aparelho
--    (SQLite) e ao domain sem conversão de fuso.
--    CHECKs: usuario_almoco_par (as duas nulas ou as duas preenchidas); usuario_almoco_faixa (0..1439 cada);
--    usuario_almoco_duracao (fim > início e fim - início entre 15 e 180 min — almoço não cruza a meia-noite).
--    Quem grava: o BKO do Core (ficha do usuário). ERP e CSV da Equipe não tocam (usuário novo nasce com o padrão).
--    Volume: o de core.usuario (dezenas a centenas por tenant); leitura por PK (sync do usuário, Produtividade); sem índice.
-- 2. gestor.alerta (dono: Gestor) — tipos de produtividade que vão ao gestor (D3/D4): parado_entre_visitas e
--    sem_checkin_inicio entram no CHECK alerta_tipo_valido. alerta_regra_tipo_valido NÃO muda: as regras de produtividade
--    ficam no parâmetro alertas.produtividade do Core (JSON validado por Zod), sem linha em gestor.alerta_regra.
--    "Um aberto por pessoa" (D4): garantido pelo índice único alerta_vivo_uk (tenant_id, chave) que já existe, desde que os
--    dois tipos usem a MESMA chave por pessoa (sugestão: produtividade:<usuario_id>, definida pelo domain do Gestor); o mais novo substitui o anterior (encerra e abre na mesma
--    transação).
-- 3. core.usuario_contato (dono: Core; ADR 0059 §5, desenho docs/desenho/T-0180.md) — último contato do aparelho por usuário:
--      usuario_id   uuid not null       FK composta (tenant_id, usuario_id) -> core.usuario
--      contato_em   timestamptz not null instante (UTC) da última GET /v1/sync/novidades ou POST /v1/sync/push autenticada
--    Uma linha por usuário: usuario_contato_usuario_uk UNIQUE (tenant_id, usuario_id), NÃO parcial, porque o Core grava com
--    `insert ... on conflict (tenant_id, usuario_id) do update ... where contato_em < excluded.contato_em - 1 min` (trava de
--    frequência no SQL). id com default (o gancho não manda id). Fora de core.usuario para o updated_at do usuário não andar a
--    cada sincronização. Fora do sync (nunca vai ao aparelho): sem índice (tenant_id, updated_at, id); a leitura da consulta
--    core.produtividade_equipe@1 é por (tenant_id, usuario_id), coberta pelo unique. Volume: uma linha por usuário (dezenas a
--    centenas por tenant); escrita no máximo 1 por minuto por usuário. RLS ligado e forçado, isolamento_tenant e manutencao
--    como as do core; grant select, insert, update ao macuxi_app (sem delete). macuxi_leitura (0078): select e política leitura
--    (nenhuma coluna sensível).
--
-- Caminho de volta: 0084_core_almoco_gestor_alerta_produtividade.down.sql (APAGA os alertas dos 2 tipos novos, as 2 colunas e
-- core.usuario_contato; o almoço próprio gravado se perde e todos voltam ao padrão; o último contato some e volta no próximo
-- sync de cada aparelho). Volte antes o código do Core e do Gestor que lê ou grava.

alter table core.usuario add column almoco_inicio_min smallint;
alter table core.usuario add column almoco_fim_min smallint;

-- consulta só leitura (0078): a 0078 deu SELECT por coluna em core.usuario; coluna nova não herda
grant select (almoco_inicio_min, almoco_fim_min) on core.usuario to macuxi_leitura;
alter table core.usuario add constraint usuario_almoco_par
  check ((almoco_inicio_min is null) = (almoco_fim_min is null));
alter table core.usuario add constraint usuario_almoco_faixa
  check ((almoco_inicio_min is null or almoco_inicio_min between 0 and 1439)
     and (almoco_fim_min is null or almoco_fim_min between 0 and 1439));
alter table core.usuario add constraint usuario_almoco_duracao
  check (almoco_inicio_min is null or almoco_fim_min is null or (almoco_fim_min - almoco_inicio_min) between 15 and 180);

alter table gestor.alerta drop constraint alerta_tipo_valido;
alter table gestor.alerta add constraint alerta_tipo_valido check (tipo in ('cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps', 'parado_entre_visitas', 'sem_checkin_inicio'));

create table core.usuario_contato (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  contato_em   timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint usuario_contato_tenant_id_uk unique (tenant_id, id),
  constraint usuario_contato_usuario_uk unique (tenant_id, usuario_id),
  constraint usuario_contato_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)
);
create unique index usuario_contato_external_uk on core.usuario_contato (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger usuario_contato_updated_at before update on core.usuario_contato
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario_contato enable row level security;
alter table core.usuario_contato force row level security;
create policy isolamento_tenant on core.usuario_contato for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_contato for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.usuario_contato to macuxi_app;
grant select on core.usuario_contato to macuxi_leitura;
create policy leitura on core.usuario_contato for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());
