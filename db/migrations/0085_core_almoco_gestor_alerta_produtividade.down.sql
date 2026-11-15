-- 0085_core_almoco_gestor_alerta_produtividade (down) — desfaz a 0085 (T-0180) e volta à core.usuario e ao gestor.alerta de antes.
-- APAGA (delete físico) os alertas dos tipos parado_entre_visitas e sem_checkin_inicio (derivados: a avaliação do Gestor os
-- recria se a 0085 voltar) e devolve o CHECK alerta_tipo_valido da 0014. APAGA os CHECKs usuario_almoco_* e as colunas
-- almoco_inicio_min e almoco_fim_min (o almoço próprio gravado no BKO se perde; reaplicar a 0085 volta todos ao padrão
-- da empresa). APAGA core.usuario_contato (o último contato de cada usuário volta no próximo sync do aparelho; até lá o Gestor
-- não abre alerta de produtividade). Volte antes o Core (BKO, sync `usuario`, Produtividade) e o Gestor (avaliação dos alertas de produtividade),
-- senão 42703 / 23514 / 42P01. Os grants e a política leitura do macuxi_leitura (0078) saem com a tabela e as colunas. Idempotente. Pré-condição: 0086+ desfeitas.

drop table if exists core.usuario_contato;

delete from gestor.alerta where tipo in ('parado_entre_visitas', 'sem_checkin_inicio');
alter table gestor.alerta drop constraint if exists alerta_tipo_valido;
alter table gestor.alerta add constraint alerta_tipo_valido check (tipo in ('cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps'));

alter table core.usuario drop constraint if exists usuario_almoco_duracao;
alter table core.usuario drop constraint if exists usuario_almoco_faixa;
alter table core.usuario drop constraint if exists usuario_almoco_par;
alter table core.usuario drop column if exists almoco_fim_min;
alter table core.usuario drop column if exists almoco_inicio_min;
