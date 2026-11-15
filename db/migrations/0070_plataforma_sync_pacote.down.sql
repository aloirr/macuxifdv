-- 0070_plataforma_sync_pacote (down) — desfaz a 0070 (pacote pronto da primeira carga, ADR 0054) e volta ao catálogo da 0069.
-- APAGA plataforma.sync_pacote (metadados dos pacotes) e plataforma.sync_pacote_pedido (fila de geração) e o índice
-- catalogo.tabela_preco_item_filial_sync_ix. Os arquivos no armazenamento (sync-pacotes/<tenant_id>/...) FICAM: antes do
-- down, liste as chaves com
--   select chave_armazenamento from plataforma.sync_pacote where situacao <> 'apagado';
-- e apague os objetos. Pré-condição: a API e o worker sem as rotas /v1/sync/pacotes e sem o gerador (MACUXI_SYNC_PACOTES
-- desligado; senão 42P01). O aparelho sem pacote segue no pull paginado. Idempotente.

drop index if exists catalogo.tabela_preco_item_filial_sync_ix;
-- cada tabela leva junto índices, gatilho, políticas e grants
drop table if exists plataforma.sync_pacote_pedido;
drop table if exists plataforma.sync_pacote;
