-- 0005_plataforma_arquivo (up) — T-0018 (desenho T-0016 §7, ADR 0010; pedido R-20261031-152927-engenheiro-software)
-- 1. plataforma.arquivo: metadados das fotos/arquivos enviados pelo aparelho (os bytes ficam atrás da porta
--    ArmazenamentoArquivos, nunca no banco). Quem cria a linha é o MÓDULO, na transação do comando que referencia
--    o arquivo (tx.registrarArquivo, situacao 'aguardando'); a rota PUT /v1/arquivos/:id só completa a linha
--    ('recebido', sha256, tamanho, chave). Fora do sync (não vai ao aparelho; db/src/excecoes.ts).
-- 2. plataforma.uuid_de_chave(text): UUID determinístico (formato v5) a partir de uma chave textual, para as linhas
--    PADRÃO que o banco semeia em todo tenant (ex.: motivos de sistema do Core, 0006). Gêmea de idDeChave em
--    db/src/ids.ts (mesmo resultado, conferido em teste): fixtures e seeds referenciam essas linhas sem consultar.
-- Caminho de volta: 0005_plataforma_arquivo.down.sql (APAGA os metadados de arquivo; os bytes no armazenamento
-- ficam órfãos e podem ser apagados pela chave <tenant_id>/...). Pré-condição: 0006+ desfeitas.

-- ---------------------------------------------------------------------------------------------
-- uuid_de_chave — md5('macuxi:' || chave) com a versão 5 e a variante RFC 4122 gravadas nos bits certos.
create function plataforma.uuid_de_chave(p_chave text) returns uuid
  language sql immutable strict parallel safe
  as $$
    select (substr(h, 1, 12) || '5' || substr(h, 14, 3)
            || substr('89ab', (('x' || substr(h, 17, 1))::bit(4)::int % 4) + 1, 1)
            || substr(h, 18, 15))::uuid
      from md5('macuxi:' || p_chave) as h
  $$;

-- ---------------------------------------------------------------------------------------------
-- arquivo — ADR 0010. id = UUID gerado no aparelho (o mesmo que o módulo grava na coluna que referencia a foto,
-- ex.: core.visita.foto_fachada_id). entidade/entidade_id = dono lógico (ex.: 'visita'/<id>); cliente_id = escopo
-- de carteira do GET. Volume: ~1 foto por visita com cliente fechado + fotos do Promotor/Pesquisa (Sprints 3+).
create table plataforma.arquivo (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  modulo               text not null,
  finalidade           text not null,
  entidade             text not null,
  entidade_id          uuid not null,
  cliente_id           uuid,
  enviado_por          uuid not null,
  tipo                 text not null default 'image/jpeg',
  tamanho_bytes        integer,
  sha256               text,
  largura_px           integer,
  altura_px            integer,
  situacao             text not null default 'aguardando',
  recebido_em          timestamptz,
  chave_armazenamento  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint arquivo_tenant_id_uk unique (tenant_id, id),
  constraint arquivo_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint arquivo_enviado_por_fk foreign key (tenant_id, enviado_por) references core.usuario (tenant_id, id),
  constraint arquivo_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint arquivo_finalidade_formato check (finalidade ~ '^[a-z][a-z0-9_]*$'),
  constraint arquivo_entidade_formato check (entidade ~ '^[a-z][a-z0-9_]*$'),
  constraint arquivo_tipo_valido check (tipo in ('image/jpeg')),
  constraint arquivo_situacao_valida check (situacao in ('aguardando', 'recebido')),
  constraint arquivo_tamanho_faixa check (tamanho_bytes is null or tamanho_bytes between 1 and 2097152),
  constraint arquivo_sha256_hex check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint arquivo_dimensoes_positivas check ((largura_px is null or largura_px > 0) and (altura_px is null or altura_px > 0)),
  constraint arquivo_recebido_completo check (
    situacao <> 'recebido'
    or (recebido_em is not null and sha256 is not null and tamanho_bytes is not null and chave_armazenamento is not null)
  )
);
create index arquivo_entidade_ix on plataforma.arquivo (tenant_id, entidade, entidade_id);
create index arquivo_aguardando_ix on plataforma.arquivo (tenant_id, situacao) where situacao = 'aguardando';
create index arquivo_cliente_ix on plataforma.arquivo (tenant_id, cliente_id) where cliente_id is not null;
create unique index arquivo_external_uk on plataforma.arquivo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger arquivo_updated_at before update on plataforma.arquivo
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.arquivo enable row level security;
alter table plataforma.arquivo force row level security;
create policy isolamento_tenant on plataforma.arquivo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.arquivo to macuxi_app;
