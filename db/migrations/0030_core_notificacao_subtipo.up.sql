-- 0030_core_notificacao_subtipo (up) — T-0039 (alerta da etapa pendente no checkout; pedido R-20261105-071918-modulo-core,
-- origem R-20261105-061802). Dicionário: docs/banco/core.md.
-- Migração ADITIVA: uma coluna nula, sem padrão, sem índice; nenhuma coluna existente muda.
--
-- core.notificacao.subtipo (text, null): marcador ESTÁVEL do tipo de notificação dentro do `tipo` (que é a categoria
--   larga da caixa: recado | sistema | pedido | treinamento | trade), para o app (Gestão) reconhecer uma notificação sem
--   depender do texto do título. null = sem subtipo (todas as notificações anteriores, salvo o backfill abaixo, e as que
--   não precisam). Formato livre, validado: CHECK notificacao_subtipo_formato (^[a-z_]{1,40}$). A lista de valores mora
--   no Core (contrato NotificacaoSyncSchema, aditivo e opcional), não no banco: subtipo novo não pede migração.
--   Valor conhecido hoje: 'etapa_pendente_checkout' — alerta da etapa obrigatória pendente no checkout (RN-CORE-12,
--   complemento; T-0039 §2), gravado pelo job do alerta em modules/core/api/etapas-pendencia.ts.
--   Sem índice: a leitura é a do pull da caixa do usuário (notificacao_usuario_sync_ix, 0006), que leva a coluna; o app
--   filtra em memória. Volume: o mesmo da notificação.
--
-- Backfill (opcional no pedido; feito aqui): as notificações do alerta já gravadas — tipo 'sistema', origem 'core',
--   título 'Etapa pendente na visita…' e envio_id = id de uma core.visita_etapa do MESMO tenant que esteve pendente
--   (pendente_desde preenchido; é o envio_id que o job grava) — ganham subtipo = 'etapa_pendente_checkout'. O gatilho
--   notificacao_updated_at (0006) avança updated_at dessas linhas: elas voltam no próximo pull com o subtipo (poucas
--   linhas; só existem desde 05/11). Com um dono das tabelas que NÃO seja superusuário (DBaaS, plano B), o FORCE RLS faz
--   este UPDATE não ver linha nenhuma: o backfill vira nada e a migração segue (as linhas antigas ficam null; o Gestão
--   mantém o fallback pelo título).
--
-- RLS: a tabela já tem enable/force e a política isolamento_tenant (0006); nenhuma política nova, grants iguais (o
-- macuxi_app já tem select, insert, update, delete).
-- Caminho de volta: 0030_core_notificacao_subtipo.down.sql (APAGA a coluna e o CHECK; as notificações ficam intactas e o
-- Gestão volta a reconhecer o alerta pelo título).

alter table core.notificacao add column subtipo text;
alter table core.notificacao add constraint notificacao_subtipo_formato check (subtipo is null or subtipo ~ '^[a-z_]{1,40}$');

-- backfill do alerta de etapa pendente já gravado (T-0039 §2.3)
update core.notificacao n
   set subtipo = 'etapa_pendente_checkout'
 where n.subtipo is null
   and n.tipo = 'sistema'
   and n.origem_modulo = 'core'
   and n.titulo like 'Etapa pendente na visita%'
   and exists (
     select 1 from core.visita_etapa e
      where e.tenant_id = n.tenant_id and e.id = n.envio_id and e.pendente_desde is not null
   );
