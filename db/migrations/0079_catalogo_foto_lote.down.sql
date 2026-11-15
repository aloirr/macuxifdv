-- 0079_catalogo_foto_lote (down) — desfaz a 0079 (T-0174, ADR 0054) e volta ao catálogo de antes dela.
-- APAGA catalogo.foto_lote_item, catalogo.foto_lote e plataforma.trabalho (lotes, relatórios e trabalhos), as 3 funções do
-- worker, a coluna catalogo.produto_midia.hash_conteudo (com o CHECK e o único) e os índices produto_midia_ordem_foto_uk e
-- core.produto_sku_lower_ix; o padrão de produto_midia.ordem volta a 0. As fotos ligadas pelo lote FICAM em produto_midia
-- (sem o hash) e as principais ficam com ordem 1 (a 0013 aceita qualquer ordem).
-- plataforma.arquivo volta aos CHECKs da 0005 (só image/jpeg, até 2 MiB, sha256 obrigatório no recebido): o down FALHA (55000)
-- antes de mudar qualquer coisa se houver arquivo PNG, WEBP, ZIP ou acima de 2 MiB, e diz quantos são. Nada é apagado sozinho: apague antes as linhas (e os
-- bytes pela chave_armazenamento) ou as referências que as usam, e rode de novo.
-- macuxi_leitura (0078): as políticas leitura e os grants das 3 tabelas saem com elas; em produto_midia volta o SELECT de tabela.
-- Volte antes a API, o worker e o Catálogo que usam as tabelas e as funções (senão 42P01/42883). Idempotente. Pré-condição:
-- 0080+ desfeitas.

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from plataforma.arquivo a
   where a.tipo <> 'image/jpeg' or (a.tamanho_bytes is not null and a.tamanho_bytes > 2097152);
  if v_n > 0 then
    raise exception '0079 down: % arquivo(s) PNG, WEBP, ZIP ou acima de 2 MiB não cabem nos CHECKs da 0005', v_n
      using errcode = '55000',
            hint = 'Apague essas linhas de plataforma.arquivo (e os bytes pela chave_armazenamento) e rode o down de novo.';
  end if;
end
$$;

drop index if exists core.produto_sku_lower_ix;

drop index if exists catalogo.produto_midia_ordem_foto_uk;
alter table catalogo.produto_midia drop constraint if exists produto_midia_principal_ordem;
alter table catalogo.produto_midia alter column ordem set default 0;
drop index if exists catalogo.produto_midia_hash_uk;
alter table catalogo.produto_midia drop constraint if exists produto_midia_hash_hex;
alter table catalogo.produto_midia drop column if exists hash_conteudo;
-- sem a coluna sensível, o macuxi_leitura volta ao SELECT de tabela da 0078 (revoke de tabela leva o por coluna)
revoke select on catalogo.produto_midia from macuxi_leitura;
grant select on catalogo.produto_midia to macuxi_leitura;

drop table if exists catalogo.foto_lote_item;
drop table if exists catalogo.foto_lote; -- leva junto índices, gatilho, políticas (inclusive a leitura) e grants

drop function if exists plataforma.trabalho_renovar(uuid, text, integer);
drop function if exists plataforma.trabalho_devolver(uuid, text, text, text, integer);
drop function if exists plataforma.trabalho_reservar(text, integer);
drop table if exists plataforma.trabalho;

alter table plataforma.arquivo drop constraint if exists arquivo_recebido_completo;
alter table plataforma.arquivo add constraint arquivo_recebido_completo check (
  situacao <> 'recebido'
  or (recebido_em is not null and sha256 is not null and tamanho_bytes is not null and chave_armazenamento is not null)
);
alter table plataforma.arquivo drop constraint if exists arquivo_tamanho_faixa;
alter table plataforma.arquivo add constraint arquivo_tamanho_faixa check (tamanho_bytes is null or tamanho_bytes between 1 and 2097152);
alter table plataforma.arquivo drop constraint if exists arquivo_tipo_valido;
alter table plataforma.arquivo add constraint arquivo_tipo_valido check (tipo in ('image/jpeg'));
