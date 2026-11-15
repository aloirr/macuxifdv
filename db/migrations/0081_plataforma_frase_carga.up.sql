-- 0081_plataforma_frase_carga (up) — T-0181 (tela de carga: frase sorteada abaixo do "Olá"; cadastro das frases pelo
-- super-admin no portal config.). Spec aprovada: docs/design/carga-aviso-frases/spec.md §2 a §4 e frases.md (commit 3cdb384;
-- R-20261115-070000, R-20261115-071500 e R-20261115-075500 do dono do produto). Dicionário: docs/banco/plataforma.md
-- ("Frases da carga (0081)"). Teste: db/testes/t0181-frase-carga.db.test.ts (estático na sessão; banco e up/down no CI).
-- Número 0081 (renumerada da 0075 pelo gerente na T-0181): as 0070 a 0080 estão em branches abertos; o migrador recusa buraco,
-- então esta só migra depois delas no main (a numeração final é conferida de novo no merge).
--
-- Migração ADITIVA: 1 tabela, 4 funções SECURITY DEFINER e a carga das 30 frases iniciais. Nada existente muda.
--
-- plataforma.frase_carga: TABELA GLOBAL, SEM tenant_id (exceção declarada em db/src/excecoes.ts, TABELAS_SEM_TENANT_ID e
--   TABELAS_SO_POR_FUNCAO). As frases valem para TODAS as empresas e só o super-admin (time Macuxi) cadastra (spec §4: frase
--   por empresa não foi pedida). Segue o precedente das tabelas globais de plataforma da 0035 e da 0039 (super_admin,
--   portal_sessao...): RLS ligado e FORÇADO, só a política manutencao (0031) e nenhum grant de tabela para macuxi_app,
--   macuxi_worker ou macuxi_portal; todo acesso passa pelas funções abaixo. Sem dado de tenant e sem dado pessoal.
--   numero (o "Nº" do portal): único global, >= 1; na inclusão = max(numero) + 1 (tabela travada na transação); nunca é
--     reusado (não há exclusão). texto: 1..90 caracteres depois do btrim (FRASE_CARGA_MAX do SDK), gravado sem espaços nas
--     pontas; único entre as vivas sem diferenciar maiúsculas nem espaços nas pontas (frase_carga_texto_uk). ativa: a inativa
--     sai do sorteio do app no próximo sync e continua no portal. ordem: ordem de leitura do app (a incluída recebe
--     max(ordem) + 1). Volume: dezenas de linhas. Fora do sync por linha: o app lê pela plataforma.frases_carga_ativas()
--     (GET /v1/sync/frases-carga) e guarda a lista no aparelho.
-- Carga das 30 (texto literal do frases.md, Nº e ordem 1..30, todas ativas): id = plataforma.uuid_de_chave(
--   'plataforma:frase_carga:NN'), NN = 01..30 com dois dígitos (a mesma regra do FRASES_CARGA_INICIAIS do SDK; gêmea TS:
--   idDeChave de db/src/ids.ts). ON CONFLICT DO NOTHING: idempotente (id, Nº ou texto vivo já existentes ficam como estão).
--
-- Funções (SECURITY DEFINER, search_path = pg_catalog, plataforma, pg_temp; padrão da 0058). Assinaturas alinhadas com a API
-- (docs/desenho/T-0174.md §3, branch nuvem/carga-frases-engenheiro-software):
--   plataforma.sa_listar_frases_carga(p_sid uuid) -> jsonb { itens: [{ id, numero, texto, ativa, ordem }] }: as vivas, ativas
--     primeiro e depois as inativas, cada grupo pelo numero. Audita sa.frase_carga.listar com a contagem.
--   plataforma.sa_incluir_frase_carga(p_sid uuid, p_id uuid, p_texto text) -> jsonb { id, numero, texto, ativa, ordem }: p_id
--     gerado pela API (nulo = o banco gera); nasce ativa, numero = max(numero) + 1, ordem = max(ordem) + 1. Reenvio com o mesmo
--     p_id e o mesmo texto devolve a frase já gravada (idempotente, sem nova auditoria); o mesmo p_id com outro texto = 23505.
--     Audita sa.frase_carga.incluir com o id e o numero (nunca o texto).
--   plataforma.sa_editar_frase_carga(p_sid uuid, p_id uuid, p_texto text, p_ativa boolean) -> jsonb (a frase depois): nulo =
--     não muda; os dois nulos devolvem a frase como está. Ativar e desativar = p_ativa com p_texto nulo. Audita
--     sa.frase_carga.editar com id, numero, texto_mudou e ativa.
--   As 3: EXECUTE só ao macuxi_portal. Sessão inválida ou vencida = 28000; admin do cliente = 42501; id não achado ou
--   apagado = P0002. Texto vazio ou acima de 90 = 23514 e repetida entre as vivas = 23505 vêm da própria tabela
--   (frase_carga_texto_tamanho e frase_carga_texto_uk; RD-0523): as funções não repetem o limite nem a busca de repetida e
--   propagam o erro do banco (a API traduz pelo código e recusa vazia e longa antes, com 422 pelo SDK). Pré-teste só onde a
--   tabela não decide: sessão e perfil (28000/42501), o id do reenvio idempotente (23505 com o mesmo id e outro texto) e a
--   frase não achada (P0002). Sem exclusão (não foi pedida; desativar basta).
--   plataforma.frases_carga_ativas() -> jsonb { frases: [{ id, texto, ordem }] }: as ativas e vivas, por ordem e numero.
--     EXECUTE só ao macuxi_app (a API chama dentro do comTenant da requisição; nada de tenant entra nem sai).
-- A conferência do fim não fixa o total de sa_* do portal (16 no main, mais as das 0070 a 0080 em branches abertos): confere
-- as 3 desta migração e que nenhuma sa_* é do app, do worker ou de PUBLIC. O total fica em db/testes/funcoes-sa.ts.
--
-- Caminho de volta: 0081_plataforma_frase_carga.down.sql (APAGA as frases, inclusive as incluídas e editadas no portal; a
-- auditoria em plataforma.auditoria_plataforma fica). Volte antes a API que chama as funções (senão 42883).

-- =============================================================================================
-- plataforma.frase_carga
-- =============================================================================================
create table plataforma.frase_carga (
  id           uuid primary key default gen_random_uuid(),
  numero       integer not null,
  texto        text not null,
  ativa        boolean not null default true,
  ordem        integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint frase_carga_numero_positivo check (numero >= 1),
  constraint frase_carga_ordem_positiva check (ordem >= 1),
  constraint frase_carga_texto_tamanho check (char_length(btrim(texto)) between 1 and 90)
);
create unique index frase_carga_numero_uk on plataforma.frase_carga (numero);
create unique index frase_carga_texto_uk on plataforma.frase_carga (lower(btrim(texto))) where deleted_at is null;
create index frase_carga_ativa_ix on plataforma.frase_carga (ordem, numero) where ativa and deleted_at is null;
create trigger frase_carga_updated_at before update on plataforma.frase_carga
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.frase_carga enable row level security;
alter table plataforma.frase_carga force row level security;
create policy manutencao on plataforma.frase_carga for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.frase_carga from public, macuxi_app, macuxi_worker;
revoke all on plataforma.frase_carga from macuxi_portal;

-- =============================================================================================
-- Carga das 30 frases iniciais (frases.md; Nº e ordem 1..30; todas ativas; idempotente)
-- =============================================================================================
insert into plataforma.frase_carga (id, numero, texto, ativa, ordem)
select plataforma.uuid_de_chave('plataforma:frase_carga:' || lpad(f.numero::text, 2, '0')), f.numero, f.texto, true, f.numero
  from (values
  (1, 'Os Macuxi se autodenominam Pemon e falam uma língua da família Karib.'),
  (2, 'O território Macuxi vai do lavrado, ao sul, às serras com floresta, ao norte.'),
  (3, 'Em 2020, o povo Macuxi somava 37.250 pessoas em Roraima.'),
  (4, 'Os Macuxi chamam de tuma a damurida, caldo de pimenta com peixe ou carne.'),
  (5, 'A Raposa Serra do Sol, terra dos Macuxi e vizinhos, foi homologada em 2005.'),
  (6, 'Em Bonfim, a Lei 211/2014 tornou cooficiais as línguas Macuxi e Wapichana.'),
  (7, 'A pintora Macuxi Carmézia Emiliano nasceu na Maloca do Japó.'),
  (8, 'O artista Macuxi Jaider Esbell ilustrou Do Roraima ao Orinoco em português.'),
  (9, 'Com 2.734,9 m, o Monte Roraima é o 7º ponto mais alto do Brasil.'),
  (10, 'O Monte Roraima fica na fronteira do Brasil com a Venezuela e a Guiana.'),
  (11, 'O Parque Nacional do Monte Roraima foi criado em 28 de junho de 1989.'),
  (12, 'As rochas que formam o Monte Roraima têm até 1,95 bilhão de anos.'),
  (13, 'Um mapa de 1654 chama o Monte Roraima de "montanha de cristais".'),
  (14, 'Um relato de 1885 sobre o Monte Roraima influenciou O Mundo Perdido.'),
  (15, 'Em 2019, ICMBio e Ingarikó catalogaram novas espécies no parque do monte.'),
  (16, 'Ingarikó e Pemon formam um só mundo cultural em torno do Monte Roraima.'),
  (17, 'Makunaimã, das narrativas Macuxi e Pemon, inspirou Mário de Andrade.'),
  (18, 'Segundo a tradição Macuxi, Makunaimã e Enxikirang são irmãos, filhos do Sol.'),
  (19, 'Segundo a tradição Macuxi, o Monte Roraima é o tronco da árvore Wazacá.'),
  (20, 'Segundo a tradição Taurepang, Makunaimã fez gente e bichos de barro.'),
  (21, 'Segundo a tradição Ingarikó, o povo descende de Siikë, irmão de Makunaimã.'),
  (22, 'Segundo a tradição Ingarikó, as plantas cultivadas vêm das sementes da Wayaka.'),
  (23, 'Entre 1911 e 1913, Koch-Grünberg registrou narrativas de Makunaimã.'),
  (24, 'A peça Makunaimã (2019) reúne autores Macuxi, Taurepang e Wapichana.'),
  (25, 'O Forte São Joaquim, de 1775, é o único bem tombado pelo Iphan em Roraima.'),
  (26, 'Na Pedra Pintada, em Pacaraima, há marcas humanas de cerca de 4.000 anos.'),
  (27, 'Roraima nasceu em 1943 como Território do Rio Branco; o nome veio em 1962.'),
  (28, 'O lavrado, a savana de Roraima, cobre cerca de 17% do estado.'),
  (29, 'O ponto mais ao norte do Brasil é a nascente do rio Ailã, em Uiramutã.'),
  (30, 'Uiramutã tem a maior proporção de indígenas do Brasil: 96,6% em 2022.')
  ) as f(numero, texto)
on conflict do nothing;

-- =============================================================================================
-- Portal: lista (só super-admin)
-- =============================================================================================
create function plataforma.sa_listar_frases_carga(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_itens jsonb;
  v_total integer;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_frases_carga: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_listar_frases_carga: só o super-admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero, 'texto', f.texto, 'ativa', f.ativa, 'ordem', f.ordem)
                            order by f.ativa desc, f.numero), '[]'::jsonb),
         count(*)::integer
    into v_itens, v_total
    from plataforma.frase_carga f
   where f.deleted_at is null;

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.frase_carga.listar',
    jsonb_build_object('itens', v_total));
  return jsonb_build_object('itens', v_itens);
end
$$;
revoke all on function plataforma.sa_listar_frases_carga(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_listar_frases_carga(uuid) to macuxi_portal;

-- =============================================================================================
-- Portal: incluir (só super-admin; nasce ativa, numero e ordem = max + 1; idempotente pelo id)
-- =============================================================================================
create function plataforma.sa_incluir_frase_carga(p_sid uuid, p_id uuid, p_texto text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_f record;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_incluir_frase_carga: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_incluir_frase_carga: só o super-admin' using errcode = '42501';
  end if;

  -- numero e ordem = max + 1 sem corrida entre dois super-admins (dezenas de linhas; a trava dura só a transação)
  lock table plataforma.frase_carga in share row exclusive mode;
  if p_id is not null then
    select x.id, x.numero, x.texto, x.ativa, x.ordem, x.deleted_at into v_f from plataforma.frase_carga x where x.id = p_id;
    if found then
      -- reenvio do mesmo pedido: devolve a frase já gravada; o mesmo id com outro texto (ou apagada) é conflito
      if v_f.deleted_at is null and lower(btrim(v_f.texto)) = lower(v_texto) then
        return jsonb_build_object('id', v_f.id, 'numero', v_f.numero, 'texto', v_f.texto, 'ativa', v_f.ativa, 'ordem', v_f.ordem);
      end if;
      raise exception 'sa_incluir_frase_carga: id já usado por outra frase' using errcode = '23505';
    end if;
  end if;
  -- vazia ou acima de 90: o CHECK frase_carga_texto_tamanho recusa (23514); repetida entre as vivas: o índice
  -- frase_carga_texto_uk recusa (23505). Nada é auditado quando a tabela recusa.
  insert into plataforma.frase_carga (id, numero, texto, ativa, ordem)
  select coalesce(p_id, gen_random_uuid()), n.numero, v_texto, true, n.ordem
    from (select coalesce(max(x.numero), 0) + 1 as numero, coalesce(max(x.ordem), 0) + 1 as ordem from plataforma.frase_carga x) n
  returning id, numero, texto, ativa, ordem, deleted_at into v_f;

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.frase_carga.incluir',
    jsonb_build_object('frase_id', v_f.id, 'numero', v_f.numero));
  return jsonb_build_object('id', v_f.id, 'numero', v_f.numero, 'texto', v_f.texto, 'ativa', v_f.ativa, 'ordem', v_f.ordem);
end
$$;
revoke all on function plataforma.sa_incluir_frase_carga(uuid, uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_incluir_frase_carga(uuid, uuid, text) to macuxi_portal;

-- =============================================================================================
-- Portal: editar o texto e/ou a situação (só super-admin; nulo = não muda; sem exclusão)
-- =============================================================================================
create function plataforma.sa_editar_frase_carga(p_sid uuid, p_id uuid, p_texto text, p_ativa boolean)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_texto text := btrim(p_texto);
  v_antes text;
  v_f record;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_editar_frase_carga: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_editar_frase_carga: só o super-admin' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'sa_editar_frase_carga: p_id obrigatório' using errcode = '22023';
  end if;

  select x.texto into v_antes
    from plataforma.frase_carga x
   where x.id = p_id and x.deleted_at is null
     for update;
  if not found then
    raise exception 'sa_editar_frase_carga: frase não encontrada' using errcode = 'P0002';
  end if;
  -- só grava quando muda (updated_at fica parado se o portal repetir o mesmo pedido). Vazia ou acima de 90: o CHECK
  -- frase_carga_texto_tamanho recusa (23514); repetida entre as vivas: o índice frase_carga_texto_uk recusa (23505).
  update plataforma.frase_carga x
     set texto = coalesce(v_texto, x.texto),
         ativa = coalesce(p_ativa, x.ativa)
   where x.id = p_id
     and (x.texto is distinct from coalesce(v_texto, x.texto) or x.ativa is distinct from coalesce(p_ativa, x.ativa));
  select x.id, x.numero, x.texto, x.ativa, x.ordem into v_f from plataforma.frase_carga x where x.id = p_id;

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.frase_carga.editar',
    jsonb_build_object('frase_id', v_f.id, 'numero', v_f.numero, 'texto_mudou', v_f.texto is distinct from v_antes, 'ativa', v_f.ativa));
  return jsonb_build_object('id', v_f.id, 'numero', v_f.numero, 'texto', v_f.texto, 'ativa', v_f.ativa, 'ordem', v_f.ordem);
end
$$;
revoke all on function plataforma.sa_editar_frase_carga(uuid, uuid, text, boolean) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_editar_frase_carga(uuid, uuid, text, boolean) to macuxi_portal;

-- =============================================================================================
-- App: as ativas e vivas (GET /v1/sync/frases-carga; o aparelho guarda a lista e sorteia offline)
-- =============================================================================================
create function plataforma.frases_carga_ativas()
  returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object('frases', coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'texto', f.texto, 'ordem', f.ordem)
                                                           order by f.ordem, f.numero), '[]'::jsonb))
      from plataforma.frase_carga f
     where f.ativa and f.deleted_at is null
  $$;
revoke all on function plataforma.frases_carga_ativas() from public;
grant execute on function plataforma.frases_carga_ativas() to macuxi_app;

-- =============================================================================================
-- Conferência pelo catálogo (aborta com 42501 e nada muda)
-- =============================================================================================
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0081: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_listar_frases_carga', 'sa_incluir_frase_carga', 'sa_editar_frase_carga')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 3 then
    raise exception '0081: esperadas as 3 sa_* das frases executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  select string_agg(r, ', ') into v_f
    from unnest(array['macuxi_worker', 'macuxi_portal']) r
   where has_function_privilege(r, 'plataforma.frases_carga_ativas()', 'execute');
  if v_f is not null or not has_function_privilege('macuxi_app', 'plataforma.frases_carga_ativas()', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = 'plataforma.frases_carga_ativas()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0081: plataforma.frases_carga_ativas fora do desenho (só o macuxi_app executa): %', v_f using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_app', 'plataforma.frase_carga', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_worker', 'plataforma.frase_carga', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'plataforma.frase_carga', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0081: privilégio de tabela fora do desenho em plataforma.frase_carga' using errcode = '42501';
  end if;
end
$$;
