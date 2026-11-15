-- 0079_catalogo_foto_lote (up) — T-0174 (fotos dos produtos em lote por ZIP; RF-CAT-07, RN-CAT-14, RN-CAT-04). Decisão: ADR 0054;
-- desenho docs/desenho/T-0174.md §2; formatos JPEG, PNG e WEBP (R-20261115-074500). Número 0079, correção da sessão principal em 15/11; as 0070–0078 vêm de outros branches.
-- Dicionário: docs/banco/catalogo.md ("0079") e docs/banco/plataforma.md ("0079"). Teste: db/testes/foto-lote.db.test.ts
-- (estático no PC; banco e up/down no CI).
--
-- 1. plataforma.arquivo aceita a foto do lote e o ZIP: arquivo_tipo_valido com image/jpeg, image/png, image/webp e
--    application/zip; arquivo_tamanho_faixa por tipo (imagem 1..8388608 = 8 MiB; ZIP 1..524288000 = 500 MiB). A rota antiga
--    de foto continua com 2 MB no código (o teto por categoria é da API); só a foto do lote chega a 8 MiB.
--    arquivo_recebido_completo: o ZIP fica 'recebido' sem sha256 (o SHA vai para catalogo.foto_lote.sha256, no trabalho); a
--    chave_armazenamento do ZIP é a da parte 1 (<id>.p001.zip). Para as imagens nada muda (sha256 obrigatório no recebido).
-- 2. plataforma.trabalho (novo): trabalho sob demanda de um módulo, disparado por evento da outbox (ADR 0054), executado em
--    fatias com trava por processo. Um vivo por (tenant, módulo, nome, alvo) (trabalho_alvo_uk: o consumidor grava com
--    insert ... on conflict do nothing). macuxi_app: select e insert no próprio tenant (RLS). macuxi_worker: SEM acesso à
--    tabela; só EXECUTE nas 3 funções SECURITY DEFINER (dono = migrador; só tenants ativos):
--      trabalho_reservar(p_processo, p_trava_s)  -> o próximo vencido (pendente com proxima_em <= now() ou em_execucao com a
--        trava vencida), um por chamada, for update skip locked; marca em_execucao + travado_ate/travado_por;
--      trabalho_devolver(p_id, p_processo, p_resultado, p_erro, p_espera_s) -> boolean (false = a trava não é mais deste
--        processo; nada muda). p_resultado: 'continua' (pendente já, fatias + 1) | 'concluido' (fatias + 1) | 'adiar' (pendente
--        daqui a p_espera_s, sem contar tentativa: licença inativa) | 'erro' (tentativas + 1 e ultimo_erro; com p_espera_s =
--        pendente daqui a p_espera_s; com p_espera_s nulo = falhou, definitivo);
--      trabalho_renovar(p_id, p_processo, p_trava_s) -> boolean (estende a trava; false = não é mais deste processo).
--    ultimo_erro só aceita CÓDIGO (^[A-Za-z0-9_.:-]{1,100}$): nunca mensagem nem dado pessoal.
-- 3. catalogo.foto_lote (novo): um envio de ZIP. Idempotência do ZIP: foto_lote_sha256_uk (tenant, sha256) entre os vivos que
--    não são 'falhou' nem 'duplicado' (o reenvio do mesmo ZIP vira 'duplicado' com duplicado_de). Coerências: motivo só e
--    sempre no 'recusado'; duplicado_de só e sempre no 'duplicado'; concluido_em só e sempre nos finais (concluido, recusado,
--    falhou, duplicado). enviado_por (core.usuario) e arquivo_id (plataforma.arquivo) SEM FK (fronteira de schema, ADR 0005/0010).
-- 4. catalogo.foto_lote_item (novo): uma linha por entrada considerada do ZIP. Checkpoint: foto_lote_item_indice_uk (tenant,
--    lote, indice) — a conferência regrava com on conflict do nothing; a fatia segue pelos 'pendente' em ordem de indice
--    (foto_lote_item_fila_ix). arquivo_id e midia_id são reservados na conferência (únicos no tenant): repetir a fatia regrava
--    os mesmos ids, sem mídia duplicada. foto_lote_item_ordem_uk (tenant, lote, produto, ordem) entre os 'ligado' = motivo
--    'ordem_repetida_no_lote'. Coerências: motivo só e sempre no 'recusado'; codigos_candidatos (1..5) só e sempre no
--    'ambiguo'; produto e ordem sempre no 'ligado' e no 'repetido'.
-- 5. catalogo.produto_midia: hash_conteudo (SHA-256 hex da imagem; nulo na foto da ficha) e produto_midia_hash_uk (tenant,
--    produto, hash) entre as vivas = 'repetido'. Ordem das fotos: a principal passa a ter ordem 1 (produto_midia_principal_ordem)
--    e a ordem de foto viva >= 1 é única por produto (produto_midia_ordem_foto_uk); o padrão de ordem passa de 0 a 1 (quem grava a
--    principal sem informar a ordem — definirFotoPrincipal de hoje — continua válido).
--    DADOS: as principais antigas (ordem 0) vão para ordem 1 COM O GATILHO produto_midia_updated_at DESLIGADO nesta migração:
--    o updated_at não anda, o pull não devolve as linhas e nenhum aparelho baixa as miniaturas de novo. A atualização cobre
--    também as removidas (o CHECK vale para toda linha). Antes, aborta (55000) se houver foto viva NÃO principal com ordem 1 no
--    produto de uma principal (colidiria no único novo; o único produto_midia_principal_uk já garante uma principal viva).
-- 6. core.produto: produto_sku_lower_ix (tenant, lower(sku)) entre os vivos, para core.produtos_por_sku@1 (casamento sem
--    diferenciar maiúsculas). O EAN já tem produto_ean_ix (0002).
--
-- RLS: as 3 tabelas novas com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app sem DELETE
-- (remover = deleted_at); plataforma.trabalho só select e insert (quem muda a situação são as funções do worker).
-- Fora do sync (db/src/excecoes.ts): plataforma.trabalho, catalogo.foto_lote e catalogo.foto_lote_item nunca vão ao aparelho.
--
-- Caminho de volta: 0079_catalogo_foto_lote.down.sql (APAGA lotes, itens e trabalhos; tira hash_conteudo e os índices novos;
-- devolve os CHECKs de plataforma.arquivo da 0005 — FALHA (55000) se houver arquivo PNG, WEBP, ZIP ou acima de 2 MB; as
-- principais ficam com ordem 1, que a 0013 aceita). Volte antes a API, o worker e o Catálogo que usam as tabelas.

-- =============================================================================================
-- 1. plataforma.arquivo — tipos e faixas de tamanho
-- =============================================================================================
alter table plataforma.arquivo drop constraint arquivo_tipo_valido;
alter table plataforma.arquivo add constraint arquivo_tipo_valido
  check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'application/zip'));
alter table plataforma.arquivo drop constraint arquivo_tamanho_faixa;
alter table plataforma.arquivo add constraint arquivo_tamanho_faixa check (
  tamanho_bytes is null
  or (tipo in ('image/jpeg', 'image/png', 'image/webp') and tamanho_bytes between 1 and 8388608)
  or (tipo = 'application/zip' and tamanho_bytes between 1 and 524288000)
);
-- o ZIP fica 'recebido' no concluir SEM sha256 (o SHA é calculado no trabalho e fica em catalogo.foto_lote.sha256)
alter table plataforma.arquivo drop constraint arquivo_recebido_completo;
alter table plataforma.arquivo add constraint arquivo_recebido_completo check (
  situacao <> 'recebido'
  or (recebido_em is not null and tamanho_bytes is not null and chave_armazenamento is not null
      and (sha256 is not null or tipo = 'application/zip'))
);

-- =============================================================================================
-- 2. plataforma.trabalho — trabalho sob demanda (ADR 0054)
-- =============================================================================================
create table plataforma.trabalho (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  modulo        text not null,
  nome          text not null,
  alvo_id       uuid not null,
  evento_id     uuid,
  situacao      text not null default 'pendente',
  tentativas    integer not null default 0,
  fatias        integer not null default 0,
  proxima_em    timestamptz not null default now(),
  travado_ate   timestamptz,
  travado_por   text,
  ultimo_erro   text,
  concluido_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint trabalho_tenant_id_uk unique (tenant_id, id),
  constraint trabalho_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint trabalho_nome_formato check (nome ~ '^[a-z][a-z0-9_]*$' and char_length(nome) <= 100),
  constraint trabalho_situacao_valida check (situacao in ('pendente', 'em_execucao', 'concluido', 'falhou')),
  constraint trabalho_contadores check (tentativas >= 0 and fatias >= 0),
  constraint trabalho_trava_par check ((travado_ate is null) = (travado_por is null)),
  constraint trabalho_trava_em_execucao check (situacao <> 'em_execucao' or travado_ate is not null),
  constraint trabalho_travado_por_tamanho check (travado_por is null or char_length(travado_por) between 1 and 200),
  constraint trabalho_ultimo_erro_codigo check (ultimo_erro is null or ultimo_erro ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  constraint trabalho_concluido_coerente check ((situacao in ('concluido', 'falhou')) = (concluido_em is not null))
);
create unique index trabalho_alvo_uk on plataforma.trabalho (tenant_id, modulo, nome, alvo_id) where deleted_at is null;
create index trabalho_fila_ix on plataforma.trabalho (situacao, proxima_em);
create unique index trabalho_external_uk on plataforma.trabalho (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger trabalho_updated_at before update on plataforma.trabalho
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.trabalho enable row level security;
alter table plataforma.trabalho force row level security;
create policy isolamento_tenant on plataforma.trabalho for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.trabalho for all to macuxi_manutencao using (true) with check (true);
grant select, insert on plataforma.trabalho to macuxi_app;

-- trabalho_reservar: um trabalho vencido por chamada, de tenant ativo; duas chamadas concorrentes nunca pegam o mesmo (skip locked).
create function plataforma.trabalho_reservar(p_processo text, p_trava_s integer)
  returns table (id uuid, tenant_id uuid, modulo text, nome text, alvo_id uuid, tentativas integer, fatias integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_processo is null or char_length(p_processo) not between 1 and 200 or p_trava_s is null or p_trava_s not between 1 and 3600 then
    raise exception 'trabalho_reservar: p_processo de 1 a 200 caracteres e p_trava_s de 1 a 3600' using errcode = '22023';
  end if;
  return query
    with alvo as (
      select t.id
        from plataforma.trabalho t
        join plataforma.tenant tn on tn.id = t.tenant_id and tn.status = 'ativo' and tn.deleted_at is null
       where t.deleted_at is null
         and ((t.situacao = 'pendente' and t.proxima_em <= now()) or (t.situacao = 'em_execucao' and t.travado_ate < now()))
       order by t.proxima_em, t.id
       limit 1
         for update of t skip locked
    )
    update plataforma.trabalho t
       set situacao = 'em_execucao', travado_ate = now() + make_interval(secs => p_trava_s), travado_por = p_processo
      from alvo
     where t.id = alvo.id
    returning t.id, t.tenant_id, t.modulo, t.nome, t.alvo_id, t.tentativas, t.fatias;
end
$$;
revoke all on function plataforma.trabalho_reservar(text, integer) from public;
grant execute on function plataforma.trabalho_reservar(text, integer) to macuxi_worker;

-- trabalho_devolver: só o processo que tem a trava devolve; false = perdeu a trava (venceu e outro reservou) e nada muda.
create function plataforma.trabalho_devolver(p_id uuid, p_processo text, p_resultado text, p_erro text, p_espera_s integer)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_n integer;
begin
  if p_id is null or p_processo is null or p_resultado is null or p_resultado not in ('continua', 'concluido', 'adiar', 'erro')
     or (p_resultado = 'adiar' and p_espera_s is null)
     or (p_espera_s is not null and p_espera_s not between 0 and 86400)
     or (p_resultado = 'erro' and p_erro is null) then
    raise exception 'trabalho_devolver: p_resultado continua|concluido|adiar|erro; adiar com p_espera_s; erro com p_erro; p_espera_s de 0 a 86400'
      using errcode = '22023';
  end if;
  update plataforma.trabalho t
     set situacao = case
                      when p_resultado in ('continua', 'adiar') then 'pendente'
                      when p_resultado = 'concluido' then 'concluido'
                      when p_espera_s is null then 'falhou'
                      else 'pendente'
                    end,
         fatias = t.fatias + case when p_resultado in ('continua', 'concluido') then 1 else 0 end,
         tentativas = t.tentativas + case when p_resultado = 'erro' then 1 else 0 end,
         ultimo_erro = case when p_resultado = 'erro' then p_erro else t.ultimo_erro end,
         proxima_em = case
                        when p_resultado = 'continua' then now()
                        when p_resultado in ('adiar', 'erro') and p_espera_s is not null then now() + make_interval(secs => p_espera_s)
                        else t.proxima_em
                      end,
         concluido_em = case when p_resultado = 'concluido' or (p_resultado = 'erro' and p_espera_s is null) then now() end,
         travado_ate = null,
         travado_por = null
   where t.id = p_id and t.situacao = 'em_execucao' and t.travado_por = p_processo and t.deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end
$$;
revoke all on function plataforma.trabalho_devolver(uuid, text, text, text, integer) from public;
grant execute on function plataforma.trabalho_devolver(uuid, text, text, text, integer) to macuxi_worker;

-- trabalho_renovar: estende a trava entre os itens de uma fatia longa.
create function plataforma.trabalho_renovar(p_id uuid, p_processo text, p_trava_s integer)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_n integer;
begin
  if p_id is null or p_processo is null or p_trava_s is null or p_trava_s not between 1 and 3600 then
    raise exception 'trabalho_renovar: p_id, p_processo e p_trava_s de 1 a 3600' using errcode = '22023';
  end if;
  update plataforma.trabalho t
     set travado_ate = now() + make_interval(secs => p_trava_s)
   where t.id = p_id and t.situacao = 'em_execucao' and t.travado_por = p_processo and t.deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end
$$;
revoke all on function plataforma.trabalho_renovar(uuid, text, integer) from public;
grant execute on function plataforma.trabalho_renovar(uuid, text, integer) to macuxi_worker;

-- =============================================================================================
-- 3. catalogo.foto_lote — um envio de ZIP (RN-CAT-14)
-- =============================================================================================
create table catalogo.foto_lote (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  enviado_por    uuid not null,
  arquivo_id     uuid not null,
  nome_arquivo   text not null,
  tamanho_bytes  bigint not null,
  sha256         text,
  situacao       text not null default 'aguardando_envio',
  motivo         text,
  duplicado_de   uuid,
  total          integer,
  iniciado_em    timestamptz,
  concluido_em   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint foto_lote_tenant_id_uk unique (tenant_id, id),
  constraint foto_lote_duplicado_de_fk foreign key (tenant_id, duplicado_de) references catalogo.foto_lote (tenant_id, id),
  constraint foto_lote_nome_tamanho check (btrim(nome_arquivo) <> '' and char_length(nome_arquivo) <= 255),
  constraint foto_lote_tamanho_faixa check (tamanho_bytes between 1 and 524288000),
  constraint foto_lote_sha256_hex check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint foto_lote_situacao_valida check (situacao in ('aguardando_envio', 'enfileirado', 'conferindo', 'processando', 'concluido', 'recusado', 'falhou', 'duplicado')),
  constraint foto_lote_motivo_valido check (motivo in ('zip_grande', 'muitos_arquivos', 'descompactado_grande', 'zip_invalido', 'zip64_nao_suportado', 'zip_incompleto')),
  constraint foto_lote_motivo_coerente check ((situacao = 'recusado') = (motivo is not null)),
  constraint foto_lote_duplicado_coerente check ((situacao = 'duplicado') = (duplicado_de is not null) and (duplicado_de is null or duplicado_de <> id)),
  constraint foto_lote_total_faixa check (total is null or total >= 0),
  constraint foto_lote_concluido_coerente check ((situacao in ('concluido', 'recusado', 'falhou', 'duplicado')) = (concluido_em is not null))
);
create unique index foto_lote_sha256_uk on catalogo.foto_lote (tenant_id, sha256)
  where sha256 is not null and deleted_at is null and situacao not in ('falhou', 'duplicado');
create unique index foto_lote_arquivo_uk on catalogo.foto_lote (tenant_id, arquivo_id) where deleted_at is null;
create index foto_lote_recentes_ix on catalogo.foto_lote (tenant_id, created_at desc);
create index foto_lote_ativos_ix on catalogo.foto_lote (tenant_id, situacao) where situacao in ('enfileirado', 'conferindo', 'processando');
create unique index foto_lote_external_uk on catalogo.foto_lote (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger foto_lote_updated_at before update on catalogo.foto_lote
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.foto_lote enable row level security;
alter table catalogo.foto_lote force row level security;
create policy isolamento_tenant on catalogo.foto_lote for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on catalogo.foto_lote for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on catalogo.foto_lote to macuxi_app;

-- =============================================================================================
-- 4. catalogo.foto_lote_item — uma entrada considerada do ZIP (checkpoint pela situação)
-- =============================================================================================
create table catalogo.foto_lote_item (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  lote_id             uuid not null,
  indice              integer not null,
  caminho             text not null,
  situacao            text not null default 'pendente',
  motivo              text,
  tipo_detectado      text,
  codigo              text,
  ordem               smallint,
  produto_id          uuid,
  produto_codigo      text,
  codigos_candidatos  text[],
  arquivo_id          uuid not null,
  midia_id            uuid not null,
  sha256              text,
  processado_em       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint foto_lote_item_tenant_id_uk unique (tenant_id, id),
  constraint foto_lote_item_lote_fk foreign key (tenant_id, lote_id) references catalogo.foto_lote (tenant_id, id),
  constraint foto_lote_item_indice_faixa check (indice >= 0),
  constraint foto_lote_item_caminho_tamanho check (char_length(caminho) between 1 and 1024),
  constraint foto_lote_item_situacao_valida check (situacao in ('pendente', 'ligado', 'sem_produto', 'ambiguo', 'recusado', 'repetido')),
  constraint foto_lote_item_motivo_valido check (motivo in ('caminho_invalido', 'criptografado', 'compressao_nao_suportada', 'arquivo_vazio', 'foto_grande', 'compressao_suspeita', 'entrada_corrompida', 'tipo_nao_aceito', 'foto_ilegivel', 'nome_invalido', 'ordem_repetida_no_lote')),
  constraint foto_lote_item_motivo_coerente check ((situacao = 'recusado') = (motivo is not null)),
  constraint foto_lote_item_tipo_valido check (tipo_detectado in ('image/jpeg', 'image/png', 'image/webp')),
  constraint foto_lote_item_codigo_tamanho check (codigo is null or char_length(codigo) between 1 and 100),
  constraint foto_lote_item_ordem_faixa check (ordem between 1 and 99),
  constraint foto_lote_item_produto_coerente check (situacao not in ('ligado', 'repetido') or (produto_id is not null and ordem is not null)),
  constraint foto_lote_item_candidatos_coerente check (
    (situacao = 'ambiguo') = (codigos_candidatos is not null) and (codigos_candidatos is null or cardinality(codigos_candidatos) between 1 and 5)
  ),
  constraint foto_lote_item_sha256_hex check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);
create unique index foto_lote_item_indice_uk on catalogo.foto_lote_item (tenant_id, lote_id, indice);
create unique index foto_lote_item_ordem_uk on catalogo.foto_lote_item (tenant_id, lote_id, produto_id, ordem) where situacao = 'ligado';
create unique index foto_lote_item_arquivo_uk on catalogo.foto_lote_item (tenant_id, arquivo_id);
create unique index foto_lote_item_midia_uk on catalogo.foto_lote_item (tenant_id, midia_id);
create index foto_lote_item_fila_ix on catalogo.foto_lote_item (tenant_id, lote_id, situacao, indice);
create unique index foto_lote_item_external_uk on catalogo.foto_lote_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger foto_lote_item_updated_at before update on catalogo.foto_lote_item
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.foto_lote_item enable row level security;
alter table catalogo.foto_lote_item force row level security;
create policy isolamento_tenant on catalogo.foto_lote_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on catalogo.foto_lote_item for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on catalogo.foto_lote_item to macuxi_app;

-- =============================================================================================
-- 5. catalogo.produto_midia — hash da imagem e ordem das fotos
-- =============================================================================================
alter table catalogo.produto_midia add column hash_conteudo text;
alter table catalogo.produto_midia add constraint produto_midia_hash_hex check (hash_conteudo is null or hash_conteudo ~ '^[0-9a-f]{64}$');
create unique index produto_midia_hash_uk on catalogo.produto_midia (tenant_id, produto_id, hash_conteudo)
  where hash_conteudo is not null and deleted_at is null;

do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from catalogo.produto_midia m
   where m.tipo = 'foto' and not m.principal and m.ordem = 1 and m.deleted_at is null
     and exists (select 1 from catalogo.produto_midia p
                  where p.tenant_id = m.tenant_id and p.produto_id = m.produto_id and p.principal and p.deleted_at is null);
  if v_n > 0 then
    raise exception '0079: % foto(s) viva(s) não principal(is) com ordem 1 no produto de uma principal (colidiriam em produto_midia_ordem_foto_uk)', v_n
      using errcode = '55000',
            hint = 'Mude a ordem dessas fotos (2 em diante) ou remova-as (deleted_at) e rode a migração de novo.';
  end if;
end
$$;

-- principais antigas (ordem 0) -> ordem 1 SEM andar o updated_at (o aparelho não baixa as miniaturas de novo)
alter table catalogo.produto_midia disable trigger produto_midia_updated_at;
update catalogo.produto_midia set ordem = 1 where principal and ordem <> 1;
alter table catalogo.produto_midia enable trigger produto_midia_updated_at;

alter table catalogo.produto_midia alter column ordem set default 1;
alter table catalogo.produto_midia add constraint produto_midia_principal_ordem check (not principal or ordem = 1);
create unique index produto_midia_ordem_foto_uk on catalogo.produto_midia (tenant_id, produto_id, ordem)
  where tipo = 'foto' and ordem >= 1 and deleted_at is null;

-- =============================================================================================
-- 6. core.produto — casamento do código sem diferenciar maiúsculas (core.produtos_por_sku@1)
-- =============================================================================================
create index produto_sku_lower_ix on core.produto (tenant_id, lower(sku)) where deleted_at is null;
