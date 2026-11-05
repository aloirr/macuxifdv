#!/usr/bin/env bash
# Alerta simples da demo (T-0078): lê o /v1/saude da API pelo loopback da VM e avisa quando muda de estado.
#
# A API devolve `alertas` (códigos: BANCO_FALHA, ERROS_5XX, OUTBOX_ATRASADA, OUTBOX_PARADA; apps/api/src/observabilidade.ts).
# Este script:
#   - sem resposta 200 da API → estado "fora";
#   - `"alertas":[]` → estado "ok"; qualquer outro → estado "alerta" (com os códigos);
#   - só avisa quando o estado MUDA (ok → alerta, alerta → ok etc.), para não repetir a cada 5 minutos;
#   - aviso: sempre no syslog (`logger -t macuxi-alerta`, ver com `journalctl -t macuxi-alerta`) e, se existir
#     /opt/macuxi/alerta.env com MACUXI_ALERTA_WEBHOOK (ex.: um tópico do ntfy.sh ou um webhook do Slack/Discord),
#     um POST com o texto. O arquivo fica fora do git (chmod 600), como os outros .env da VM.
# Só leitura: não reinicia nada, não mexe no Postgres.
#
# Instalação na VM (uma vez, como root), depois do implantar.sh:
#   install -m 755 alerta-saude.sh /opt/macuxi/alerta-saude.sh
#   echo '*/5 * * * * root /opt/macuxi/alerta-saude.sh' > /etc/cron.d/macuxi-alerta
# Teste manual: /opt/macuxi/alerta-saude.sh --mostrar   (imprime o estado e o corpo, sem avisar)
set -u

URL="${MACUXI_SAUDE_URL:-http://127.0.0.1:8100/v1/saude}"
ESTADO_ARQ="${MACUXI_ALERTA_ESTADO:-/var/tmp/macuxi-alerta.estado}"
ENV_ARQ="${MACUXI_ALERTA_ENV:-/opt/macuxi/alerta.env}"

corpo="$(curl -fsS -m 10 "$URL" 2>/dev/null)"
if [ -z "$corpo" ]; then
  estado="fora"
  detalhe="a API não respondeu 200 em ${URL}"
elif printf '%s' "$corpo" | grep -q '"alertas":\[\]'; then
  estado="ok"
  detalhe="sem alertas"
else
  estado="alerta"
  detalhe="$(printf '%s' "$corpo" | grep -o '"alertas":\[[^]]*\]' | head -1)"
fi

if [ "${1:-}" = "--mostrar" ]; then
  printf 'estado=%s %s\n%s\n' "$estado" "$detalhe" "$corpo"
  exit 0
fi

anterior="$(cat "$ESTADO_ARQ" 2>/dev/null || echo "desconhecido")"
[ "$estado" = "$anterior" ] && exit 0
printf '%s' "$estado" > "$ESTADO_ARQ"

texto="Macuxi demo: ${anterior} -> ${estado} (${detalhe}) em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
logger -t macuxi-alerta "$texto" 2>/dev/null || echo "$texto" >&2

if [ -f "$ENV_ARQ" ]; then
  # shellcheck disable=SC1090
  . "$ENV_ARQ"
  if [ -n "${MACUXI_ALERTA_WEBHOOK:-}" ]; then
    curl -fsS -m 10 -H 'Content-Type: text/plain; charset=utf-8' --data-binary "$texto" "$MACUXI_ALERTA_WEBHOOK" >/dev/null 2>&1 ||
      logger -t macuxi-alerta "falha ao enviar o aviso ao webhook" 2>/dev/null
  fi
fi
exit 0
