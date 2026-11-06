#!/usr/bin/env bash
# "docker" falso do db/testes/backup-dbaas.test.ts (dono: banco-dados; T-0086). Emula só o que o backup-dbaas.sh e o
# ensaio-restauracao.sh pedem: "docker compose [--env-file X]... [--profile X] run --rm --no-deps -T [-v A:B] [--entrypoint E]
# <serviço> <comando...>" para os serviços pgcliente (psql/pg_dump/pg_restore), backup (backup.mjs) e banco (cat).
# Estado em $FALSO_DIR: chamadas.log (uma linha por chamada), bancos/ (bases criadas), s3/ (objetos), e os cenários:
#   FALSO_SEM_MANUTENCAO=1   o admin não herda o macuxi_manutencao (backup-dbaas.sh tem de parar sem enviar nada)
#   FALSO_INSTAVEL=1         cada contagem do macuxi sai diferente (uso durante o dump)
#   FALSO_RESTAURADA_DIFERE=1 a base restaurada conta uma linha a menos
#   FALSO_RESTORE_FALHA=1    o pg_restore da base temporária falha
#   FALSO_RLS_PROBLEMA=1     o conferir-rls.sql acha um problema na restaurada
set -uo pipefail
D="${FALSO_DIR:?FALSO_DIR}"
mkdir -p "$D/bancos" "$D/s3"
echo "$*" >> "$D/chamadas.log"

[ "${1:-}" = compose ] || { echo "docker falso: só compose" >&2; exit 90; }
shift
while [ $# -gt 0 ] && [ "$1" != run ]; do shift; done
[ "${1:-}" = run ] || { echo "docker falso: só compose run" >&2; exit 90; }
shift
entrada=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rm|--no-deps|-T) shift ;;
    -v) shift 2 ;;
    --entrypoint) entrada="$2"; shift 2 ;;
    *) break ;;
  esac
done
servico="$1"
shift

contagem_base() {
  printf 'force_rls|3\nlinhas|catalogo.produto|33\nlinhas|core.usuario|%s\nlinhas|public.macuxi_migracao|35\npoliticas|6\nprivilegios|macuxi_app|12\n' "$1"
}

case "$servico" in
  pgcliente)
    prog="$1"
    shift
    case "$prog" in
      psql)
        db="" sql=""
        while [ $# -gt 0 ]; do
          case "$1" in
            -d) db="$2"; shift 2 ;;
            -c) sql="$2"; shift 2 ;;
            -F|-v) shift 2 ;;
            *) shift ;;
          esac
        done
        echo "psql -d $db" >> "$D/chamadas.log"
        if [ -z "$sql" ]; then
          sql="$(cat)"
          case "$sql" in
            *"'linhas|'"*)
              if [ "$db" = macuxi ]; then
                n=4
                if [ "${FALSO_INSTAVEL:-0}" = 1 ]; then n=$(( $(cat "$D/n" 2>/dev/null || echo 4) + 1 )); echo "$n" > "$D/n"; fi
                contagem_base "$n"
              else
                [ -e "$D/bancos/$db" ] || { echo "psql: database \"$db\" does not exist" >&2; exit 2; }
                [ -e "$D/bancos/$db.restaurado" ] || { echo "falso: contagem de base não restaurada" >&2; exit 2; }
                if [ "${FALSO_RESTAURADA_DIFERE:-0}" = 1 ]; then contagem_base 3; else contagem_base 4; fi
              fi
              exit 0 ;;
            *conferir-rls*)
              [ "${FALSO_RLS_PROBLEMA:-0}" = 1 ] && echo "catalogo.produto|sem política manutencao"
              exit 0 ;;
          esac
          echo "falso: psql com stdin desconhecido" >&2
          exit 91
        fi
        case "$sql" in
          *rolcreatedb*) echo 't|t' ;;
          *pg_stat_ssl*) if [ "${FALSO_SEM_MANUTENCAO:-0}" = 1 ]; then echo 't|f|f|f'; else echo 't|f|f|t'; fi ;;
          *string_agg*) echo '' ;;
          "create database "*) n="${sql#create database }"; touch "$D/bancos/$n"; echo "criou $n" >> "$D/bancos.log" ;;
          "drop database if exists "*) n="${sql#drop database if exists }"; n="${n%% *}"; rm -f "$D/bancos/$n" "$D/bancos/$n.restaurado"; echo "apagou $n" >> "$D/bancos.log" ;;
          *"from pg_database where datname = '"*) n="${sql#*datname = \'}"; n="${n%%\'*}"; [ -e "$D/bancos/$n" ] && echo 1 ;;
          "create extension if not exists vector") ;;
          *) echo "falso: SQL desconhecido: $sql" >&2; exit 92 ;;
        esac ;;
      pg_dump)
        echo "pg_dump $*" >> "$D/dump.log"
        printf 'PGDMP'; head -c 200 /dev/zero | tr '\0' 'x' ;;
      pg_restore)
        if [ "${1:-}" = -l ]; then
          # do stdin (backup-dbaas.sh) ou do arquivo montado em /trabalho (ensaio): o conteúdo do dump falso não importa
          [ $# -ge 2 ] || cat > /dev/null
          printf ';\n; Archive created at falso\n;\n3; 3079 16385 EXTENSION - vector\n4; 0 0 COMMENT - EXTENSION vector\n5; 1255 16390 FUNCTION public pgaudit_ddl_command_end() postgres\n6; 3466 16391 EVENT TRIGGER - pgaudit_ddl_command_end postgres\n210; 1259 16400 TABLE core usuario admin\n4100; 0 16400 TABLE DATA core usuario admin\n4101; 0 16401 TABLE DATA catalogo produto admin\n'
          exit 0
        fi
        db="" lista=""
        while [ $# -gt 0 ]; do
          case "$1" in
            -d) db="$2"; shift 2 ;;
            -L) lista="$2"; shift 2 ;;
            *) echo "$1" >> "$D/restore-args.log"; shift ;;
          esac
        done
        echo "pg_restore -d $db -L $lista" >> "$D/chamadas.log"
        [ -e "$D/bancos/$db" ] || { echo "pg_restore: error: database \"$db\" does not exist" >&2; exit 1; }
        # a lista vem da pasta montada: o teste a acha em $FALSO_TRABALHO (o ensaio usa MACUXI_ENSAIO_TMP)
        cp "$(ls -d "$FALSO_TRABALHO"/ensaio.*/lista | head -n 1)" "$D/lista-usada.txt" 2>/dev/null || true
        [ "${FALSO_RESTORE_FALHA:-0}" = 1 ] && { echo 'pg_restore: error: could not execute query: ERROR:  falso' >&2; exit 1; }
        touch "$D/bancos/$db.restaurado" ;;
      *) echo "falso: programa desconhecido no pgcliente: $prog" >&2; exit 93 ;;
    esac ;;
  backup)
    cmd="$1"
    shift
    carimbo=""
    pos=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --carimbo) carimbo="$2"; shift 2 ;;
        *) pos+=("$1"); shift ;;
      esac
    done
    case "$cmd" in
      enviar-contagem) cat > "$D/s3/macuxi-$carimbo.contagem.txt"; echo "enviar-contagem $carimbo" >> "$D/s3.log" ;;
      enviar) cat > "$D/s3/macuxi-$carimbo.dump"; echo "enviar $carimbo" >> "$D/s3.log" ;;
      resolver)
        ultimo="$(ls "$D/s3" | grep '\.dump$' | sort | tail -n 1)"
        [ -n "$ultimo" ] || { echo "[backup] nenhum backup em backups/" >&2; exit 1; }
        if [ "${pos[0]}" = ultimo ]; then echo "backups/$ultimo"; else echo "${pos[0]}"; fi ;;
      baixar) cat "$D/s3/${pos[0]#backups/}" ;;
      baixar-contagem)
        c="${pos[0]#backups/}"
        c="$D/s3/${c%.dump}.contagem.txt"
        [ -f "$c" ] || { echo "[backup] não existe a contagem" >&2; exit 1; }
        cat "$c" ;;
      *) echo "falso: comando do backup desconhecido: $cmd" >&2; exit 94 ;;
    esac ;;
  banco)
    [ "$entrada" = cat ] || { echo "falso: banco só com --entrypoint cat" >&2; exit 95; }
    printf -- '-- conferir-rls (falso)\nselect 1 where false;\n' ;;
  *) echo "falso: serviço desconhecido: $servico" >&2; exit 96 ;;
esac
