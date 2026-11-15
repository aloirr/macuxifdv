-- 0085_core_almoco_gestor_alerta_produtividade (up) — T-0180 (alertas de produtividade e Parâmetros › Alertas, v1.0.13).
-- Decisões D3, D4 e D5 da T-0180 (R-20261115-123000 item 1 e R-20261115-120632; gerente-projetos por delegação escrita do
-- dono do produto). Desenho: docs/modulos/gestor/alertas-produtividade.md. Migração em cima da 0084 (números 0075 a 0084
-- reservados para os lotes em andamento). Dicionário: docs/banco/core.md e docs/banco/gestor.md ("0085"). Teste:
-- db/testes/almoco-alerta-produtividade.db.test.ts (estático sempre; banco e up/down no CI).
--
-- Migração ADITIVA, sem backfill e sem andar o updated_at (nenhum aparelho puxa de novo por causa da 0085). Nenhum contrato
-- muda de versão; RLS, políticas e grants de core.usuario e gestor.alerta não mudam (as colunas herdam os da tabela).
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
--
-- Caminho de volta: 0085_core_almoco_gestor_alerta_produtividade.down.sql (APAGA os alertas dos 2 tipos novos e as 2 colunas;
-- o almoço próprio gravado se perde e todos voltam ao padrão). Volte antes o código do Core e do Gestor que lê ou grava.

alter table core.usuario add column almoco_inicio_min smallint;
alter table core.usuario add column almoco_fim_min smallint;

alter table core.usuario add constraint usuario_almoco_par
  check ((almoco_inicio_min is null) = (almoco_fim_min is null));
alter table core.usuario add constraint usuario_almoco_faixa
  check ((almoco_inicio_min is null or almoco_inicio_min between 0 and 1439)
     and (almoco_fim_min is null or almoco_fim_min between 0 and 1439));
alter table core.usuario add constraint usuario_almoco_duracao
  check (almoco_inicio_min is null or almoco_fim_min is null or (almoco_fim_min - almoco_inicio_min) between 15 and 180);

alter table gestor.alerta drop constraint alerta_tipo_valido;
alter table gestor.alerta add constraint alerta_tipo_valido check (tipo in ('cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps', 'parado_entre_visitas', 'sem_checkin_inicio'));
