#!/usr/bin/env bash
# Banco de produção no DBaaS da Magalu (T-0086; ADR 0024 plano B; ADR 0028). IDEMPOTENTE: o implantar.sh roda a cada
# publicação, e o mesmo script serve para o PRIMEIRO deploy (base vazia) e para rodar à mão na VM:
#
#   bash banco-dbaas.sh            (em qualquer pasta; usa /opt/macuxi, ou MACUXI_DIR)
#
# Pré-requisitos em /opt/macuxi: .env (preparar-vm.sh), banco.env e admin.env (workflow) e imagens.env (implantar.sh).
# Passos (qualquer falha para com código != 0 e NADA da aplicação é trocado; o implantar.sh só sobe a versão nova depois):
#   1. rota até o DBaaS fora das redes do Docker (docker*/br-*/veth*/lo = erro 3): a faixa de uma rede do compose
#      colidindo com a VPC mandaria a conexão do banco para dentro da VM;
#   2. conexão TLS como o admin (pg_stat_ssl.ssl = t, senão erro) e os privilégios dele: CREATEDB e CREATEROLE obrigatórios;
#      SUPERUSER/BYPASSRLS só informados (no DBaaS são "não": vale o plano B);
#   3. banco "macuxi": criado se falta (CREATE DATABASE pelo admin, C2.2 da ADR 0024);
#   4. extensão vector (create extension if not exists, pelo admin: o DBaaS libera pelo pgextwlist, C1.2) e versão >= 0.8;
#   5. "banco migrar up" (db/scripts/banco.ts, dono banco-dados): papéis macuxi_app, macuxi_worker e macuxi_portal (T-0091) pelo B0 (CREATE com os
#      atributos ou só LOGIN PASSWORD com verificador SCRAM; nunca ALTER de atributo, senha nunca em texto), o papel de
#      manutenção macuxi_manutencao com a filiação INHERIT do admin (0031, B1) e as migrações pendentes. 3 tentativas;
#   6. conferências (só leitura): macuxi_app/macuxi_worker/macuxi_portal com LOGIN, sem SUPERUSER/BYPASSRLS e fora do
#      macuxi_manutencao; macuxi_portal sem grant em tabela e o único (com o dono) que executa as plataforma.sa_* com grant; as internas só
#      pelo dono; sa_* fora das duas listas = erro (T-0091);
#      admin herdando o macuxi_manutencao; db/scripts/conferir-rls.sql com ZERO linhas; última migração aplicada.
# Nenhum segredo é impresso: as senhas só chegam aos contêineres pelos env_file do compose.
set -euo pipefail

PASTA="${MACUXI_DIR:-/opt/macuxi}"
BANCO=macuxi
log() { echo "[banco-dbaas] $(date -u +%H:%M:%S) $*"; }
erro() { echo "[banco-dbaas] ERRO: $2" >&2; exit "$1"; }

cd "$PASTA"
for f in .env banco.env admin.env imagens.env; do
  [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (preparar-vm.sh, workflow e implantar.sh gravam antes)"
done
dc() { docker compose --env-file .env --env-file imagens.env --profile ferramentas "$@"; }
psqlc() { dc run --rm --no-deps -T pgcliente psql -X -v ON_ERROR_STOP=1 -At -F '|' "$@"; }

HOST="$(sed -n 's/^MACUXI_PG_HOST=//p' banco.env | tail -n 1)"
[[ "$HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || erro 2 "MACUXI_PG_HOST ausente ou inválido em banco.env (secret PROD_PG_HOST)"

# ---------- 1. rota ----------
if [ "${MACUXI_CONFERIR_ROTA:-1}" = 1 ]; then
  rota="$(ip -o route get "$HOST" 2>&1 || true)"
  dispositivo="$(printf '%s\n' "$rota" | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n 1)"
  [ -n "$dispositivo" ] || erro 3 "a VM não tem rota para o DBaaS (mesma VPC?)"
  case "$dispositivo" in
    docker*|br-*|veth*|lo) erro 3 "o DBaaS sai pela interface $dispositivo (rede do Docker ou loopback): faixa do Docker colide com a VPC (MACUXI_DOCKER_POOL no preparar-vm.sh)" ;;
  esac
  log "rota até o DBaaS: interface $dispositivo"
else
  log "rota: conferência desligada (MACUXI_CONFERIR_ROTA=0, só no stack isolado do CI)"
fi

# ---------- 2. conexão TLS e privilégios do admin ----------
info=""
for t in 1 2 3; do
  info="$(psqlc -d postgres -c "select current_setting('server_version'), s.ssl, coalesce(s.version, '-'), r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole
                                  from pg_stat_ssl s, pg_roles r where s.pid = pg_backend_pid() and r.rolname = current_user")" && break
  [ "$t" = 3 ] && erro 3 "sem conexão com o DBaaS como o admin (host, porta, usuário/senha do admin ou TLS; veja a linha do psql acima)"
  log "conexão falhou (tentativa $t); de novo em 10 s"
  sleep 10
done
IFS='|' read -r versao ssl tls super bypass createdb createrole <<< "$info"
[ "$ssl" = t ] || erro 3 "conexão SEM TLS com o DBaaS: recusado (produção só com TLS)"
log "DBaaS: PostgreSQL $versao, TLS $tls ($(grep -q '^MACUXI_PG_SSL_LIBPQ=verify-full' imagens.env && echo 'certificado conferido' || echo 'certificado NÃO conferido: sem PROD_PG_CA_CERT'))"
case "$versao" in 16.*) ;; *) erro 2 "esperado PostgreSQL 16 (ADR 0024), o servidor é $versao" ;; esac
[ "$createdb" = t ] && [ "$createrole" = t ] || erro 2 "o admin precisa de CREATEDB e CREATEROLE (tem createdb=$createdb createrole=$createrole)"
if [ "$super" = t ] || [ "$bypass" = t ]; then
  log "admin com superuser=$super bypassrls=$bypass (não é o DBaaS? o plano B funciona igual)"
else
  log "admin sem SUPERUSER e sem BYPASSRLS: plano B (B0 papéis, B1 macuxi_manutencao, B2 exclusão em ordem de FK)"
fi

# ---------- 3. banco ----------
if [ -z "$(psqlc -d postgres -c "select 1 from pg_database where datname = '$BANCO'")" ]; then
  psqlc -d postgres -c "create database $BANCO" > /dev/null
  log "banco $BANCO criado (primeiro deploy)"
else
  log "banco $BANCO já existe"
fi

# ---------- 4. extensão vector ----------
psqlc -d "$BANCO" -c "create extension if not exists vector" > /dev/null \
  || erro 2 "create extension vector negado (no DBaaS ela está no pgextwlist; confira extwlist.extensions)"
vec="$(psqlc -d "$BANCO" -c "select extversion from pg_extension where extname = 'vector'")"
case "$vec" in 0.[0-7].*|'') erro 2 "pgvector $vec: o Catálogo precisa de >= 0.8 (HNSW filtrado)" ;; esac
log "extensão vector $vec"

# ---------- 5. papéis (B0), manutenção (B1) e migrações ----------
for t in 1 2 3; do
  dc run --rm --no-deps -T banco migrar up && break
  [ "$t" = 3 ] && erro 1 "migrações falharam 3 vezes"
  log "migração falhou (tentativa $t); de novo em 10 s"
  sleep 10
done

# ---------- 6. conferências ----------
papeis="$(psqlc -d "$BANCO" -c "select rolname, rolcanlogin, rolsuper, rolbypassrls, pg_has_role(rolname, 'macuxi_manutencao', 'MEMBER')
                                   from pg_roles where rolname in ('macuxi_app', 'macuxi_portal', 'macuxi_worker') order by 1")"
esperado=$'macuxi_app|t|f|f|f\nmacuxi_portal|t|f|f|f\nmacuxi_worker|t|f|f|f'
[ "$papeis" = "$esperado" ] || erro 1 "papéis da aplicação fora do esperado (LOGIN, sem SUPERUSER/BYPASSRLS, fora do macuxi_manutencao): $(printf '%s' "$papeis" | tr '\n' ' ')"
# (o começo da linha é o que o stack-isolado.yml procura: não mudar)
log "papéis: macuxi_app e macuxi_worker com LOGIN, sem SUPERUSER/BYPASSRLS, fora do macuxi_manutencao; macuxi_portal também (T-0091)"
# T-0091 (condição da ADR 0029): a sessão do super-admin só abre pelo macuxi_portal, e ele não lê tabela nenhuma
# As sa_* por classe: a lista é UMA só, a de db/testes/funcoes-sa.ts (do banco-dados; RD-0910), lida na imagem da versão que
# acabou de migrar: até o main (FUNCOES_SA_ATE_0080), uma constante por item do lote (FUNCOES_SA_CARGA da 0081, FUNCOES_SA_LOGO
# da 0083; RD-1628) e a interna (SA_INTERNA). SA_PORTAL só o macuxi_portal executa; SA_INTERNAS sem EXECUTE para ninguém além
# do dono. O apps/api/test/funcoes-sa.test.ts roda este mesmo LISTAS_SA_JS e confere a saída.
LISTAS_SA_JS='import("./db/testes/funcoes-sa.ts").then((m) => { const q = (xs) => xs.map((f) => `\x27${f}\x27`).join(", "); for (const xs of [m.FUNCOES_SA_ATE_0080, m.FUNCOES_SA_CARGA, m.FUNCOES_SA_LOGO, [m.SA_INTERNA]]) console.log(q(xs)); })'
listas_sa="$(dc run --rm --no-deps -T --entrypoint node banco --import tsx -e "$LISTAS_SA_JS")" || erro 1 "lista das plataforma.sa_* (db/testes/funcoes-sa.ts) não lida na imagem"
SA_PORTAL_ATE_MAIN="$(printf '%s\n' "$listas_sa" | sed -n 1p)"
SA_PORTAL_CARGA="$(printf '%s\n' "$listas_sa" | sed -n 2p)"
SA_PORTAL_LOGO="$(printf '%s\n' "$listas_sa" | sed -n 3p)"
SA_INTERNAS="$(printf '%s\n' "$listas_sa" | sed -n 4p)"
# só assinaturas entre aspas simples (o texto entra no SQL abaixo)
ASSINATURAS_SA_RE="^'plataforma\.sa_[a-z_]+\([][a-z, ]*\)'(, 'plataforma\.sa_[a-z_]+\([][a-z, ]*\)')*$"
for lista_sa in "$SA_PORTAL_ATE_MAIN" "$SA_PORTAL_CARGA" "$SA_PORTAL_LOGO" "$SA_INTERNAS"; do
  [[ "$lista_sa" =~ $ASSINATURAS_SA_RE ]] || erro 1 "lista das plataforma.sa_* fora do formato: $(printf '%s' "$listas_sa" | tr '\n' ' ')"
done
SA_PORTAL="$SA_PORTAL_ATE_MAIN, $SA_PORTAL_CARGA, $SA_PORTAL_LOGO"
sa_fora="$(psqlc -d "$BANCO" -c "with sa as (
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as f,
           has_function_privilege('macuxi_app', p.oid, 'EXECUTE')
             or has_function_privilege('macuxi_worker', p.oid, 'EXECUTE')
             or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as fora,
           has_function_privilege('macuxi_portal', p.oid, 'EXECUTE') as portal
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'plataforma' and p.proname like 'sa\_%')
  select coalesce(string_agg(x, '; ' order by x), '') from (
    select f || ' (app/worker/PUBLIC executa)' as x from sa where fora
    union all select f || ' (portal sem EXECUTE)' from sa where f = any (array[$SA_PORTAL]) and not portal
    union all select f || ' (interna com EXECUTE do portal)' from sa where f = any (array[$SA_INTERNAS]) and portal
    union all select f || ' (fora de SA_PORTAL e SA_INTERNAS)' from sa where not f = any (array[$SA_PORTAL, $SA_INTERNAS])
    union all select e || ' (falta no banco)' from unnest(array[$SA_PORTAL, $SA_INTERNAS]) e where e not in (select f from sa)
      -- por item (RD-1628): sem a migração do item, só as sa_* dele podem faltar; com ela, conferência exata
      -- carga (T-0181, 0081): a tabela plataforma.frase_carga
      and not (e = any (array[$SA_PORTAL_CARGA]) and to_regclass('plataforma.frase_carga') is null)
      -- logo (T-0182, 0083): a coluna plataforma.tenant.logo_sha256
      and not (e = any (array[$SA_PORTAL_LOGO]) and not exists (select 1 from pg_attribute
                 where attrelid = 'plataforma.tenant'::regclass and attname = 'logo_sha256' and not attisdropped))
  ) t")"
[ -z "$sa_fora" ] || erro 1 "funções plataforma.sa_* fora da regra do T-0091: $sa_fora"
grants_portal="$(psqlc -d "$BANCO" -c "select count(*) from pg_class c, aclexplode(c.relacl) a where a.grantee = 'macuxi_portal'::regrole")"
[ "$grants_portal" = 0 ] || erro 1 "macuxi_portal com grant em tabela ($grants_portal): ele só executa as plataforma.sa_*"
# (a 1ª linha é a frase exata que o stack-isolado.yml procura: não mudar)
log "super-admin: plataforma.sa_* só pelo macuxi_portal, sem grant em tabela"
log "super-admin: as internas ($SA_INTERNAS) só pelo dono"
# T-0093 (0039): o super-admin nasce pelo deploy (CLI super-admin, conexão de administração); ninguém além do dono executa
criar_sa="$(psqlc -d "$BANCO" -c "select coalesce(string_agg(r, ', '), '') from unnest(array['macuxi_app', 'macuxi_worker', 'macuxi_portal']) r
  where has_function_privilege(r, 'plataforma.criar_super_admin(jsonb)', 'EXECUTE')")"
[ -z "$criar_sa" ] || erro 1 "plataforma.criar_super_admin executável por $criar_sa: só a conexão de administração cria super-admin"
log "super-admin: criar_super_admin só pela conexão de administração (T-0093)"
[ "$(psqlc -d "$BANCO" -c "select pg_has_role(current_user, 'macuxi_manutencao', 'USAGE')")" = t ] \
  || erro 1 "o admin não herda o macuxi_manutencao (0031): seed, DEFINER entre tenants e backup com RLS veriam 0 linhas"
log "admin herda o macuxi_manutencao (0031, B1)"

# conferir-rls.sql (dono banco-dados) sai da PRÓPRIA imagem da API (mesma versão das migrações)
problemas="$(dc run --rm --no-deps -T --entrypoint cat banco db/scripts/conferir-rls.sql | psqlc -d "$BANCO")"
if [ -n "$problemas" ]; then
  printf '%s\n' "$problemas" | head -n 40 >&2
  erro 1 "conferir-rls.sql achou $(printf '%s\n' "$problemas" | wc -l) problema(s) de RLS (lista acima)"
fi
ultima="$(psqlc -d "$BANCO" -c "select versao || '_' || nome from public.macuxi_migracao order by versao desc limit 1")"
tabelas="$(psqlc -d "$BANCO" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and c.relrowsecurity and n.nspname not like 'pg\_%' and n.nspname not in ('information_schema','public')")"
log "pronto: RLS ok em $tabelas tabelas (conferir-rls.sql = 0), última migração $ultima"
