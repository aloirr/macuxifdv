-- 0015_promotor (down) — T-0056
-- Desfaz a 0015 inteira: drop schema promotor cascade. APAGA todas as visitas de loja e coletas do promotor (fotos — só
-- os metadados; os binários ficam em plataforma.arquivo/armazenamento —, checklist, gôndola, share, preço, ruptura, validade,
-- pontos extras, concorrência e tarefas) e todos os cadastros de trade do BKO (categorias, checklists, mix, metas de share,
-- concorrentes, fotos de referência, tarefas e pontos extras negociados). As funções do schema (instante_iso, data_iso e os
-- gatilhos derivar_*) e o grant de usage ao macuxi_app caem junto. O que ainda estiver na fila dos aparelhos volta a ficar
-- sem destino (a API do Promotor deve estar com o recebimento desligado, repositorio: null). A licença 'promotor' em
-- plataforma.tenant_modulo/perfil_modulo NÃO é dado desta migração e fica.
-- Pré-condição: 0016+ desfeitas. O papel macuxi_app é do cluster e fica.
drop schema if exists promotor cascade;
