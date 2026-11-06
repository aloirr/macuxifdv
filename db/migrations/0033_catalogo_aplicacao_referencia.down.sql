-- 0033_catalogo_aplicacao_referencia (down) — T-0084/T-0085
-- Desfaz a 0033 na ordem inversa. APAGA catalogo.produto_referencia com os dados (origem: BKO do Catálogo e Hub, que
-- reenviam), as etiquetas do conteúdo, as colunas aplicacao/referencias do documento de busca do servidor e
-- vendedor.pedido_item.aplicacao com os retratos (o pedido NÃO perde valor nem item; só sai o texto "Aplicação: …" do
-- detalhe, dos PDFs e do pedido ao ERP). O gatilho produto_busca_documento volta aos pesos da 0013 e o documento é
-- recalculado. O corte em 2.000 de produto_conteudo.aplicacoes feito no up (se houve) não volta. Idempotente.
-- Pré-condição: 0034+ desfeitas.

-- vendedor.pedido_item
alter table vendedor.pedido_item drop constraint if exists pedido_item_aplicacao_tamanho;
alter table vendedor.pedido_item drop column if exists aplicacao;

-- catalogo.produto_referencia (índices, gatilho, políticas e grants vão junto com a tabela)
drop table if exists catalogo.produto_referencia;

-- catalogo.produto_busca: gatilho da 0013 (A = sku/ean/nome, B = marca/categoria, C = atributos, D = conteúdo)
create or replace function catalogo.produto_busca_documento() returns trigger
  language plpgsql
  set search_path = pg_catalog, catalogo, pg_temp
  as $$
begin
  new.documento :=
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.sku, new.ean, new.nome))), 'A') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.marca, new.categoria))), 'B') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(new.atributos)), 'C') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(new.conteudo)), 'D');
  return new;
end
$$;
alter table catalogo.produto_busca drop column if exists referencias;
alter table catalogo.produto_busca drop column if exists aplicacao;
-- recalcula o documento sem as colunas que saíram (o gatilho roda no UPDATE)
update catalogo.produto_busca set documento = documento;

-- catalogo.produto_conteudo
alter table catalogo.produto_conteudo drop constraint if exists produto_conteudo_etiquetas_validas;
alter table catalogo.produto_conteudo drop column if exists etiquetas;
drop function if exists catalogo.etiquetas_validas(text[]);
alter table catalogo.produto_conteudo drop constraint if exists produto_conteudo_aplicacoes_tamanho;
