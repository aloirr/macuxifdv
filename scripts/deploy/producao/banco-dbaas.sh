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
#   5. "banco migrar up" (db/scripts/banco.ts, dono banco-dados): papéis macuxi_app e macuxi_worker pelo B0 (CREATE com os
#      atributos ou só LOGIN PASSWORD com verificador SCRAM; nunca ALTER de atributo, senha nunca em texto), o papel de
#      manutenção macuxi_manutencao com a filiação INHERIT do admin (0031, B1) e as migrações pendentes. 3 tentativas;
#   6. conferências (só leitura): macuxi_app/macuxi_worker com LOGIN, sem SUPERUSER/BYPASSRLS e fora do macuxi_manutencao;
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
                                   from pg_roles where rolname in ('macuxi_app', 'macuxi_worker') order by 1")"
esperado=$'macuxi_app|t|f|f|f\nmacuxi_worker|t|f|f|f'
[ "$papeis" = "$esperado" ] || erro 1 "papéis da aplicação fora do esperado (LOGIN, sem SUPERUSER/BYPASSRLS, fora do macuxi_manutencao): $(printf '%s' "$papeis" | tr '\n' ' ')"
log "papéis: macuxi_app e macuxi_worker com LOGIN, sem SUPERUSER/BYPASSRLS, fora do macuxi_manutencao"
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
