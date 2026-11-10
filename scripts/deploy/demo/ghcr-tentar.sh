#!/usr/bin/env bash
# T-0154 (R-20261110-062241): novas tentativas quando o GHCR recusa por motivo passageiro.
# Em 09/11 a publicação da demo falhou com "403 Forbidden" no HEAD de uma camada (run 42707736877) e passou sozinha depois.
#
# Uso (executado):  bash ghcr-tentar.sh "<rótulo>" -- <comando> [argumentos...]
# Uso (carregado):  source ghcr-tentar.sh; ghcr_tentar "<rótulo>" <comando ou função> [argumentos...]
#
# Repete SÓ quando a saída mostra erro passageiro do registro: HTTP 403, 429 ou 5xx, ou rede (timeout, conexão
# derrubada). Qualquer outro erro (Dockerfile, imagem inexistente, tag inválida) sai na hora com o código do comando.
# Tentativas: GHCR_TENTATIVAS (padrão 5, mínimo 4). Espera crescente: GHCR_ESPERA_S × 2^(n-1) (padrão 15 → 15, 30, 60, 120 s).
# Sem segredo em log: o comando não recebe token (o login é feito antes, pela entrada padrão) e o comando não é ecoado.
# A saída do comando vai para a saída padrão como veio; as mensagens daqui vão para a saída de erro (anotações do Actions).

GHCR_TRANSITORIO='(403 Forbidden|429 Too Many Requests|toomanyrequests|unexpected status[^0-9]{0,80}(403|429|5[0-9][0-9])|(500|502|503|504) (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)|TLS handshake timeout|connection reset by peer|i/o timeout|net/http: request canceled)'

ghcr_tentar() {
  local rotulo="$1"
  shift
  [ "${1:-}" = "--" ] && shift
  if [ "$#" -eq 0 ]; then
    echo "::error::ghcr-tentar: informe o comando depois do rótulo" >&2
    return 2
  fi
  local max="${GHCR_TENTATIVAS:-5}" base="${GHCR_ESPERA_S:-15}"
  [[ "$max" =~ ^[0-9]+$ ]] && [ "$max" -ge 4 ] || max=4
  [[ "$base" =~ ^[0-9]+$ ]] || base=15
  local i rc saida espera
  saida="$(mktemp)"
  for ((i = 1; i <= max; i++)); do
    rc=0
    # dentro de "|| true": vale também com set -euo pipefail no script que carrega este arquivo (implantar.sh)
    { "$@" 2>&1 | tee "$saida"; rc=${PIPESTATUS[0]}; } || true
    if [ "$rc" -eq 0 ]; then
      [ "$i" -gt 1 ] && echo "::notice::$rotulo: ok na tentativa $i de $max" >&2
      rm -f "$saida"
      return 0
    fi
    if ! grep -Eqi "$GHCR_TRANSITORIO" "$saida"; then
      echo "::error::$rotulo: falhou (código $rc) com erro que não é passageiro do GHCR; sem nova tentativa" >&2
      rm -f "$saida"
      return "$rc"
    fi
    if [ "$i" -lt "$max" ]; then
      espera=$((base * (1 << (i - 1))))
      echo "::warning::$rotulo: GHCR recusou por motivo passageiro (403/429/5xx/rede) na tentativa $i de $max; nova tentativa em ${espera} s" >&2
      sleep "$espera"
    fi
  done
  rm -f "$saida"
  echo "::error::$rotulo: o GHCR recusou nas $max tentativas (403/429/5xx/rede). Rode o workflow de novo em alguns minutos; se repetir, confira https://www.githubstatus.com e a permissão packages: write do workflow." >&2
  return 1
}

# executado (não carregado com source): roda o comando com as tentativas
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  ghcr_tentar "$@"
  exit $?
fi
