-- 0102_plataforma_dados_da_empresa (up) — cadastro da empresa no portal (endereço, contato e inscrição estadual), "quem sou eu"
-- do topo do portal e troca da senha do super-admin (v1.0.34; autorização do dono do produto R-20261124-191902-alexandre;
-- especificação do engenheiro-software). Dicionário: docs/banco/plataforma.md, "Dados da empresa, quem sou eu e senha do
-- super-admin (0102)". Teste: db/testes/dados-empresa.db.test.ts. Migração ADITIVA: nenhuma coluna, política ou grant existente
-- muda; a sa_sessao_valida e a sa_gravar_nome_fantasia (0083) ficam como estão.
--
-- 1. plataforma.tenant ganha 10 colunas text nulas (o resto do cadastro já existe: razão social = nome; CNPJ = documento; nome
--    fantasia = nome_fantasia, 0083). Cada uma com o CHECK tenant_<col>_formato: nula ou sem espaço nas pontas, não vazia e no
--    tamanho/formato:
--      logradouro ≤ 200 · numero ≤ 20 · complemento ≤ 100 · bairro ≤ 100 · municipio ≤ 100
--      uf                 ^[A-Z]{2}$ e uma das 27 UFs
--      cep                ^[0-9]{8}$ (só dígitos)
--      telefone           ^[0-9]{10,11}$ (DDD + número, só dígitos)
--      email              ≤ 254 e a regex da super_admin_email_formato (0035)
--      inscricao_estadual ^(ISENTO|[0-9]{2,14})$
--    Nenhum índice novo (lida sempre pela PK). O macuxi_app já lê a própria linha (isolamento_tenant, 0001) e não grava; o
--    macuxi_leitura ganha SELECT nas 10 (SELECT por coluna desde a 0083; nenhuma é sensível pelo nome).
-- 2. Funções do portal (SECURITY DEFINER, search_path fixo com pg_temp por último; EXECUTE só ao macuxi_portal; sessão
--    inválida = 28000):
--    - sa_dados_da_empresa(p_sid uuid, p_tenant uuid) -> jsonb DadosDaEmpresa: { tenant_id, cnpj, razao_social, nome_fantasia,
--      logradouro, numero, complemento, bairro, municipio, uf, cep, telefone, email, inscricao_estadual, atualizado_em }.
--      Acesso pela sa_tenant_ativo: super-admin em qualquer empresa ativa; admin do cliente só na empresa da sessão (senão
--      42501); tenant nulo = 22023.
--    - sa_gravar_dados_da_empresa(p_sid uuid, p_tenant uuid, p jsonb) -> o mesmo jsonb. Mesmo acesso. p com EXATAMENTE as 11
--      chaves razao_social, logradouro, numero, complemento, bairro, municipio, uf, cep, telefone, email, inscricao_estadual
--      (faltando, a mais, p não objeto ou valor que não seja texto/null = 22023). Cada valor passa por btrim; vazio vira null.
--      razao_social obrigatória (null/vazia = 22023; fora de 2..200 caracteres = 23514); as outras 10 caem nos CHECKs (23514).
--      O CNPJ e o nome fantasia NÃO entram (o nome fantasia segue na sa_gravar_nome_fantasia, 0083). Trava a linha (for
--      update); nada mudou = não grava nem audita; senão grava e audita 'sa.empresa.cadastro' { campos: [chaves alteradas] },
--      SEM os valores.
--    - sa_quem_sou(p_sid uuid) -> table (nome, perfil, cargo): super-admin = super_admin.nome, perfil e cargo nulos; admin do
--      cliente com empresa escolhida = core.usuario.nome + plataforma.perfil.nome e .cargo do vínculo vivo em
--      plataforma.usuario_perfil (sem vínculo = perfil e cargo nulos); admin sem empresa escolhida = 0 linhas. Lê core.usuario
--      como a sa_sessao_valida (0077) e a sa_contas_para_login (0039): o macuxi_portal não lê tabela nenhuma direto.
--    - sa_gravar_senha_super_admin(p_sid uuid, p_hash_atual text, p_hash_novo text) -> boolean: SÓ super-admin (admin do
--      cliente = 42501). Hash novo no formato PHC argon2id (senão 22023; hash atual nulo = 22023). Grava só se senha_hash =
--      p_hash_atual (false se não achou: a API releu o hash na sa_reautenticar, conferiu a senha atual com o argon2 e conta a
--      falha em sa_tentativa_*); zera falhas e bloqueado_ate; revoga TODAS as sessões vivas do super-admin, inclusive a atual;
--      auditoria 'sa.senha.trocada' { sessoes_revogadas }.
--
-- Caminho de volta: 0102_plataforma_dados_da_empresa.down.sql (apaga as 4 funções e as 10 colunas; os grants por coluna do
-- macuxi_leitura saem com as colunas). PERDE o cadastro das empresas: anote antes com "select id, logradouro, numero,
-- complemento, bairro, municipio, uf, cep, telefone, email, inscricao_estadual from plataforma.tenant where num_nonnulls(
-- logradouro, numero, complemento, bairro, municipio, uf, cep, telefone, email, inscricao_estadual) > 0". A senha trocada fica
-- (é a coluna senha_hash da 0035). As linhas 'sa.empresa.cadastro' e 'sa.senha.trocada' da auditoria ficam (append-only).
-- Antes do down, volte a API sem as rotas novas (sem as funções elas respondem 503).

-- =============================================================================================
-- 1. Colunas em plataforma.tenant
-- =============================================================================================
alter table plataforma.tenant add column logradouro text;
alter table plataforma.tenant add column numero text;
alter table plataforma.tenant add column complemento text;
alter table plataforma.tenant add column bairro text;
alter table plataforma.tenant add column municipio text;
alter table plataforma.tenant add column uf text;
alter table plataforma.tenant add column cep text;
alter table plataforma.tenant add column telefone text;
alter table plataforma.tenant add column email text;
alter table plataforma.tenant add column inscricao_estadual text;

alter table plataforma.tenant add constraint tenant_logradouro_formato check (
  logradouro is null or (logradouro = btrim(logradouro) and logradouro <> '' and char_length(logradouro) <= 200));
alter table plataforma.tenant add constraint tenant_numero_formato check (
  numero is null or (numero = btrim(numero) and numero <> '' and char_length(numero) <= 20));
alter table plataforma.tenant add constraint tenant_complemento_formato check (
  complemento is null or (complemento = btrim(complemento) and complemento <> '' and char_length(complemento) <= 100));
alter table plataforma.tenant add constraint tenant_bairro_formato check (
  bairro is null or (bairro = btrim(bairro) and bairro <> '' and char_length(bairro) <= 100));
alter table plataforma.tenant add constraint tenant_municipio_formato check (
  municipio is null or (municipio = btrim(municipio) and municipio <> '' and char_length(municipio) <= 100));
alter table plataforma.tenant add constraint tenant_uf_formato check (
  uf is null or (uf ~ '^[A-Z]{2}$' and uf in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                                              'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO')));
alter table plataforma.tenant add constraint tenant_cep_formato check (cep is null or cep ~ '^[0-9]{8}$');
alter table plataforma.tenant add constraint tenant_telefone_formato check (telefone is null or telefone ~ '^[0-9]{10,11}$');
alter table plataforma.tenant add constraint tenant_email_formato check (
  email is null or (email = btrim(email) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
alter table plataforma.tenant add constraint tenant_inscricao_estadual_formato check (
  inscricao_estadual is null or inscricao_estadual ~ '^(ISENTO|[0-9]{2,14})$');

grant select (logradouro, numero, complemento, bairro, municipio, uf, cep, telefone, email, inscricao_estadual) on plataforma.tenant to macuxi_leitura;

-- =============================================================================================
-- 2. Portal: leitura do cadastro (super-admin em qualquer empresa ativa; admin do cliente só na da sessão)
-- =============================================================================================
create function plataforma.sa_dados_da_empresa(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
begin
  select v.tipo into v_tipo from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_dados_da_empresa: sessão do portal inválida' using errcode = '28000';
  end if;
  if p_tenant is null then
    raise exception 'sa_dados_da_empresa: tenant obrigatório' using errcode = '22023';
  end if;
  if not plataforma.sa_tenant_ativo(p_sid, p_tenant) then
    raise exception 'sa_dados_da_empresa: só o super-admin (empresa ativa) ou o admin da própria empresa' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
                   'tenant_id', t.id, 'cnpj', t.documento, 'razao_social', t.nome, 'nome_fantasia', t.nome_fantasia,
                   'logradouro', t.logradouro, 'numero', t.numero, 'complemento', t.complemento, 'bairro', t.bairro,
                   'municipio', t.municipio, 'uf', t.uf, 'cep', t.cep, 'telefone', t.telefone, 'email', t.email,
                   'inscricao_estadual', t.inscricao_estadual, 'atualizado_em', plataforma.instante_iso(t.updated_at))
            from plataforma.tenant t
           where t.id = p_tenant);
end
$$;
revoke all on function plataforma.sa_dados_da_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_dados_da_empresa(uuid, uuid) to macuxi_portal;

-- =============================================================================================
-- 3. Portal: gravar o cadastro (mesmo acesso; chaves exatas; auditado sem valores)
-- =============================================================================================
create function plataforma.sa_gravar_dados_da_empresa(p_sid uuid, p_tenant uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_usuario uuid;
  v_chaves constant text[] := array['razao_social', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep',
                                    'telefone', 'email', 'inscricao_estadual'];
  v_novo jsonb := '{}'::jsonb;
  v_antes jsonb;
  v_campos text[];
  k text;
begin
  select v.tipo, v.super_admin_id, v.usuario_id into v_tipo, v_sa, v_usuario from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_dados_da_empresa: sessão do portal inválida' using errcode = '28000';
  end if;
  if p_tenant is null then
    raise exception 'sa_gravar_dados_da_empresa: tenant obrigatório' using errcode = '22023';
  end if;
  if not plataforma.sa_tenant_ativo(p_sid, p_tenant) then
    raise exception 'sa_gravar_dados_da_empresa: só o super-admin (empresa ativa) ou o admin da própria empresa' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object'
     or (select array_agg(c order by c) from jsonb_object_keys(p) c) is distinct from (select array_agg(c order by c) from unnest(v_chaves) c) then
    raise exception 'sa_gravar_dados_da_empresa: p deve ter exatamente as chaves %', array_to_string(v_chaves, ', ') using errcode = '22023';
  end if;
  foreach k in array v_chaves loop
    if jsonb_typeof(p -> k) not in ('string', 'null') then
      raise exception 'sa_gravar_dados_da_empresa: % deve ser texto ou null', k using errcode = '22023';
    end if;
    -- btrim; vazio vira null
    v_novo := v_novo || jsonb_build_object(k, nullif(btrim(p ->> k), ''));
  end loop;
  if v_novo ->> 'razao_social' is null then
    raise exception 'sa_gravar_dados_da_empresa: razao_social obrigatória' using errcode = '22023';
  end if;
  if char_length(v_novo ->> 'razao_social') not between 2 and 200 then
    raise exception 'sa_gravar_dados_da_empresa: razao_social com 2 a 200 caracteres' using errcode = '23514';
  end if;

  select jsonb_build_object(
           'razao_social', t.nome, 'logradouro', t.logradouro, 'numero', t.numero, 'complemento', t.complemento,
           'bairro', t.bairro, 'municipio', t.municipio, 'uf', t.uf, 'cep', t.cep, 'telefone', t.telefone, 'email', t.email,
           'inscricao_estadual', t.inscricao_estadual)
    into v_antes
    from plataforma.tenant t
   where t.id = p_tenant
     for update;
  select coalesce(array_agg(c order by c), '{}') into v_campos
    from unnest(v_chaves) c
   where (v_antes -> c) is distinct from (v_novo -> c);
  if cardinality(v_campos) = 0 then
    return plataforma.sa_dados_da_empresa(p_sid, p_tenant);
  end if;

  update plataforma.tenant
     set nome = v_novo ->> 'razao_social',
         logradouro = v_novo ->> 'logradouro',
         numero = v_novo ->> 'numero',
         complemento = v_novo ->> 'complemento',
         bairro = v_novo ->> 'bairro',
         municipio = v_novo ->> 'municipio',
         uf = v_novo ->> 'uf',
         cep = v_novo ->> 'cep',
         telefone = v_novo ->> 'telefone',
         email = v_novo ->> 'email',
         inscricao_estadual = v_novo ->> 'inscricao_estadual'
   where id = p_tenant;
  -- só os nomes dos campos alterados, nunca os valores
  perform plataforma.sa_registrar_auditoria(v_tipo, v_sa, v_usuario, p_sid, p_tenant, 'sa.empresa.cadastro',
    jsonb_build_object('campos', to_jsonb(v_campos)));
  return plataforma.sa_dados_da_empresa(p_sid, p_tenant);
end
$$;
revoke all on function plataforma.sa_gravar_dados_da_empresa(uuid, uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_dados_da_empresa(uuid, uuid, jsonb) to macuxi_portal;

-- =============================================================================================
-- 4. Portal: quem sou eu (nome, perfil e cargo do topo do portal)
-- =============================================================================================
create function plataforma.sa_quem_sou(p_sid uuid)
  returns table (nome text, perfil text, cargo text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tipo text;
  v_sa uuid;
  v_tenant uuid;
  v_usuario uuid;
begin
  select v.tipo, v.super_admin_id, v.tenant_id, v.usuario_id into v_tipo, v_sa, v_tenant, v_usuario
    from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_quem_sou: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo = 'super_admin' then
    return query select s.nome, null::text, null::text from plataforma.super_admin s where s.id = v_sa;
    return;
  end if;
  -- admin do cliente: sem empresa escolhida = 0 linhas
  return query
    select u.nome, p.nome, p.cargo
      from core.usuario u
      left join lateral (
        select pf.nome, pf.cargo
          from plataforma.usuario_perfil up
          join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null
         where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
         order by up.created_at, up.id
         limit 1) p on true
     where v_tenant is not null and u.tenant_id = v_tenant and u.id = v_usuario;
end
$$;
revoke all on function plataforma.sa_quem_sou(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_quem_sou(uuid) to macuxi_portal;

-- =============================================================================================
-- 5. Portal: troca da senha do super-admin (a API confere a senha atual com o argon2; aqui, só o hash)
-- =============================================================================================
create function plataforma.sa_gravar_senha_super_admin(p_sid uuid, p_hash_atual text, p_hash_novo text)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_revogadas integer;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_senha_super_admin: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_senha_super_admin: só o super-admin' using errcode = '42501';
  end if;
  -- nunca o hash na mensagem: o erro pode ir a log
  if p_hash_atual is null then
    raise exception 'sa_gravar_senha_super_admin: hash atual obrigatório' using errcode = '22023';
  end if;
  if p_hash_novo is null or p_hash_novo !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$' then
    raise exception 'sa_gravar_senha_super_admin: hash novo fora do formato PHC argon2id' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set senha_hash = p_hash_novo, falhas = 0, bloqueado_ate = null
   where s.id = v_sa and s.senha_hash = p_hash_atual and s.deleted_at is null and s.ativo;
  if not found then
    return false;
  end if;
  update plataforma.portal_sessao x
     set revogada_em = now()
   where x.tipo = 'super_admin' and x.super_admin_id = v_sa and x.revogada_em is null;
  get diagnostics v_revogadas = row_count;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.senha.trocada',
    jsonb_build_object('sessoes_revogadas', v_revogadas));
  return true;
end
$$;
revoke all on function plataforma.sa_gravar_senha_super_admin(uuid, text, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_senha_super_admin(uuid, text, text) to macuxi_portal;
