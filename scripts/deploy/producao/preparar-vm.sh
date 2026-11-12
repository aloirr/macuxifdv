#!/usr/bin/env bash
# Preparo da VM de PRODUÇÃO na Magalu Cloud (macuxi-prod-se1; T-0086, ADR 0028). Mesmo padrão da demo
# (scripts/deploy/demo/preparar-vm.sh, T-0074), sem Postgres local. IDEMPOTENTE: o workflow "producao — publicar" roda a
# cada publicação e só muda o que estiver diferente.
#
#   sudo bash preparar-vm.sh [usuario-de-deploy]      (padrão: o usuário que chamou o sudo, ou "ubuntu")
#
# O que faz:
#   1. fuso UTC;
#   2. pacotes: Docker Engine + plugin Compose (repositório oficial), fail2ban, unattended-upgrades, openssl, curl;
#   3. SSH só por chave (PasswordAuthentication/KbdInteractiveAuthentication/PermitRootLogin no), validado com sshd -t e
#      aplicado com reload; sem authorized_keys do usuário de deploy, para sem tocar no sshd;
#   4. fail2ban na jail sshd e atualizações de segurança automáticas (reinício às 07:30 UTC, se o pacote pedir);
#   5. Docker: rotação de log (10 MB x 3) e FAIXAS PRÓPRIAS para as redes (bip 192.168.199.1/24, default-address-pools
#      192.168.200.0/21 em /24). As faixas padrão (172.17.0.0/16, 172.18.0.0/16, ...) colidem com a VPC da Magalu (o
#      DBaaS de teste era 172.18.3.212): a rede do compose "engoliria" a rota até o banco. Troca por MACUXI_DOCKER_BIP e
#      MACUXI_DOCKER_POOL se a VPC usar 192.168.x;
#   6. /opt/macuxi (dono: usuário de deploy), /opt/macuxi/certs e /opt/macuxi/.env (modo 600) com os segredos GERADOS
#      AQUI (openssl rand): senhas de macuxi_app e macuxi_worker, MACUXI_JWT_SEGREDO e MACUXI_HUB_CHAVE_PEPPER. Nunca
#      saem da VM, nunca são impressos e nunca são regenerados. A senha do ADMIN do DBaaS não fica aqui: vem do secret
#      PROD_PG_ADMIN_SENHA para o admin.env, gravado pelo workflow. A senha do macuxi_portal (T-0091) fica à parte, em
#      /opt/macuxi/portal.env (600), que só a api e o passo de papéis leem (o worker nunca);
#   7. backup diário (código do banco-dados em db/backup/; os scripts chegam pelo implantar.sh, tirados da imagem):
#      timer macuxi-backup.timer às 06:15 UTC (02:15 em Manaus), Persistent=true, rodando /opt/macuxi/backup/backup-dbaas.sh
#      como o usuário de deploy. Enquanto o script não existe, a unidade é pulada sem erro (ConditionPathExists);
#   8. alerta de saúde (T-0078): /opt/macuxi/alerta-saude.sh (copiado de scripts/deploy/demo/alerta-saude.sh, que o
#      workflow manda junto) e o timer macuxi-alerta.timer a cada 5 min, como o usuário de deploy, com
#      MACUXI_ALERTA_NOME=producao. Log: journalctl -t macuxi-alerta.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "[preparar-vm] rode com sudo" >&2
  exit 1
fi

USUARIO="${1:-${SUDO_USER:-ubuntu}}"
if ! id "$USUARIO" >/dev/null 2>&1; then
  echo "[preparar-vm] usuário de deploy '$USUARIO' não existe" >&2
  exit 1
fi
ORIGEM="$(cd "$(dirname "$0")" && pwd)"
PASTA=/opt/macuxi
DOCKER_BIP="${MACUXI_DOCKER_BIP:-192.168.199.1/24}"
DOCKER_POOL="${MACUXI_DOCKER_POOL:-192.168.200.0/21}"
export DEBIAN_FRONTEND=noninteractive
log() { echo "[preparar-vm] $*"; }

# ---------- 1. fuso ----------
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "UTC" ]; then
  timedatectl set-timezone UTC
  log "fuso ajustado para UTC"
fi

# ---------- 2. pacotes ----------
precisa_apt=0
for p in ca-certificates curl gnupg fail2ban unattended-upgrades openssl iproute2; do
  dpkg -s "$p" >/dev/null 2>&1 || precisa_apt=1
done
if [ "$precisa_apt" = 1 ]; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg fail2ban unattended-upgrades openssl iproute2
fi

if ! docker compose version >/dev/null 2>&1; then
  log "instalando Docker Engine + Compose (repositório oficial)"
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -s /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  # shellcheck disable=SC1091
  codinome="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codinome} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker >/dev/null
if ! id -nG "$USUARIO" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "$USUARIO"
  log "$USUARIO entrou no grupo docker (vale a partir da próxima sessão SSH)"
fi

# ---------- 3. SSH só por chave ----------
CHAVES="$(getent passwd "$USUARIO" | cut -d: -f6)/.ssh/authorized_keys"
if [ ! -s "$CHAVES" ]; then
  echo "[preparar-vm] $CHAVES vazio ou ausente: NÃO desligo a senha do SSH (você ficaria trancado fora)" >&2
  exit 1
fi
SSHD_CONF=/etc/ssh/sshd_config.d/00-macuxi.conf
SSHD_NOVO="# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086). Não edite à mão.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 4
X11Forwarding no"
if [ "$(cat "$SSHD_CONF" 2>/dev/null)" != "$SSHD_NOVO" ]; then
  anterior="$(mktemp)"
  tinha=0
  if [ -f "$SSHD_CONF" ]; then cp -p "$SSHD_CONF" "$anterior"; tinha=1; fi
  printf '%s\n' "$SSHD_NOVO" > "$SSHD_CONF"
  chmod 644 "$SSHD_CONF"
  mkdir -p /run/sshd
  if ! sshd -t; then
    if [ "$tinha" = 1 ]; then cp -p "$anterior" "$SSHD_CONF"; else rm -f "$SSHD_CONF"; fi
    rm -f "$anterior"
    echo "[preparar-vm] sshd -t falhou: configuração desfeita, sshd intocado" >&2
    exit 1
  fi
  rm -f "$anterior"
  if systemctl is-active --quiet ssh; then systemctl reload ssh; fi
  log "sshd: só chave, sem senha e sem root (validado com sshd -t)"
fi
efetivo="$(sshd -T 2>/dev/null | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) ' | sort | tr '\n' ' ')"
log "sshd efetivo: $efetivo"

# ---------- 4. fail2ban e atualizações automáticas ----------
F2B=/etc/fail2ban/jail.d/macuxi.local
F2B_NOVO="# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086).
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h"
if [ "$(cat "$F2B" 2>/dev/null)" != "$F2B_NOVO" ]; then
  printf '%s\n' "$F2B_NOVO" > "$F2B"
  systemctl restart fail2ban
  log "fail2ban: jail sshd ligada"
fi
systemctl enable --now fail2ban >/dev/null

AUTO=/etc/apt/apt.conf.d/20auto-upgrades
AUTO_NOVO='APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";'
[ "$(cat "$AUTO" 2>/dev/null)" = "$AUTO_NOVO" ] || printf '%s\n' "$AUTO_NOVO" > "$AUTO"
REBOOT=/etc/apt/apt.conf.d/52macuxi-reboot
REBOOT_NOVO='// Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086): reinicia de madrugada (03:30 em Manaus) se a atualização pedir.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "07:30";'
[ "$(cat "$REBOOT" 2>/dev/null)" = "$REBOOT_NOVO" ] || printf '%s\n' "$REBOOT_NOVO" > "$REBOOT"
systemctl enable --now unattended-upgrades >/dev/null

# ---------- 5. Docker: log e faixas das redes ----------
[[ "$DOCKER_BIP" =~ ^[0-9.]+/[0-9]{1,2}$ && "$DOCKER_POOL" =~ ^[0-9.]+/[0-9]{1,2}$ ]] || { echo "[preparar-vm] MACUXI_DOCKER_BIP/POOL inválidos" >&2; exit 2; }
DAEMON=/etc/docker/daemon.json
DAEMON_NOVO="{
  \"log-driver\": \"json-file\",
  \"log-opts\": { \"max-size\": \"10m\", \"max-file\": \"3\" },
  \"bip\": \"$DOCKER_BIP\",
  \"default-address-pools\": [{ \"base\": \"$DOCKER_POOL\", \"size\": 24 }]
}"
if [ "$(cat "$DAEMON" 2>/dev/null)" != "$DAEMON_NOVO" ]; then
  printf '%s\n' "$DAEMON_NOVO" > "$DAEMON"
  systemctl restart docker
  log "docker: rotação de log e faixas $DOCKER_BIP / $DOCKER_POOL"
fi

# ---------- 6. /opt/macuxi e segredos gerados na VM ----------
install -d -m 750 -o "$USUARIO" -g "$USUARIO" "$PASTA"
# certs/: só a CA pública do DBaaS (644), lida pelo usuário node dos contêineres pelo volume ./certs:/certs:ro
install -d -m 755 -o "$USUARIO" -g "$USUARIO" "$PASTA/certs"
ENV="$PASTA/.env"
umask 077
[ -f "$ENV" ] || : > "$ENV"
acrescentar() { # nome valor: só se a variável ainda não existir (nunca regenera)
  grep -q "^$1=" "$ENV" || { printf '%s=%s\n' "$1" "$2" >> "$ENV"; log "gerado $1"; }
}
acrescentar MACUXI_PG_APP_SENHA "$(openssl rand -hex 32)"
acrescentar MACUXI_PG_WORKER_SENHA "$(openssl rand -hex 32)"
acrescentar MACUXI_JWT_SEGREDO "$(openssl rand -hex 48)"
acrescentar MACUXI_HUB_CHAVE_PEPPER "$(openssl rand -hex 32)"
# T-0087/ADR 0029 (super-admin do portal): token de plataforma com segredo próprio e a chave que cifra o segredo TOTP.
# A chave do TOTP NUNCA pode ser regenerada (o acrescentar não regenera): trocar = o 2º fator cadastrado deixa de abrir.
# T-0093/ADR 0031: o portal entra só com e-mail e senha; a chave do TOTP continua gerada, sem uso (reserva para o TOTP opcional
# do backlog). O super-admin nasce pelo workflow "producao — super-admin".
acrescentar MACUXI_JWT_SEGREDO_PLATAFORMA "$(openssl rand -hex 48)"
acrescentar MACUXI_CHAVE_TOTP "$(openssl rand -base64 32)"
chown "$USUARIO:$USUARIO" "$ENV"
chmod 600 "$ENV"
# T-0091 (condição da ADR 0029): senha do papel macuxi_portal (o único com EXECUTE nas plataforma.sa_*) num arquivo
# PRÓPRIO, fora do .env: o worker lê o .env e nunca pode abrir sessão de super-admin. Só o contêiner api e o passo de
# papéis (serviço banco) recebem o portal.env (compose.yml). Gerada uma vez, nunca regenerada, nunca impressa.
PORTAL_ENV="$PASTA/portal.env"
[ -f "$PORTAL_ENV" ] || : > "$PORTAL_ENV"
grep -q '^MACUXI_PG_PORTAL_SENHA=' "$PORTAL_ENV" || { printf 'MACUXI_PG_PORTAL_SENHA=%s\n' "$(openssl rand -hex 32)" >> "$PORTAL_ENV"; log "gerado MACUXI_PG_PORTAL_SENHA (portal.env)"; }
chown "$USUARIO:$USUARIO" "$PORTAL_ENV"
chmod 600 "$PORTAL_ENV"
for f in banco.env admin.env segredos.env email.env tunel.env alerta.env recados.env; do
  [ -f "$PASTA/$f" ] && { chown "$USUARIO:$USUARIO" "$PASTA/$f"; chmod 600 "$PASTA/$f"; }
done

# Grava uma unidade do systemd só se mudou; devolve 0 se gravou.
gravar_unidade() { # caminho conteúdo
  if [ "$(cat "$1" 2>/dev/null)" != "$2" ]; then
    printf '%s\n' "$2" > "$1"; chmod 644 "$1"; return 0
  fi
  return 1
}
ligar_timer() { # nome-do-timer mudou(0|1)
  if ! systemctl is-enabled --quiet "$1" || ! systemctl is-active --quiet "$1"; then
    if systemctl enable --now "$1" >/dev/null 2>&1; then
      log "$1 ligado (próximo: $(systemctl show "$1" -p NextElapseUSecRealtime --value 2>/dev/null || echo '?'))"
    else
      echo "::warning::não consegui ligar o $1 (systemctl status $1)"
    fi
  elif [ "$2" = 1 ]; then
    systemctl restart "$1" || echo "::warning::restart do $1 falhou"
  fi
}

# ---------- 7. backup diário (timer do systemd) ----------
install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$PASTA/backup"
mudou=0
gravar_unidade /etc/systemd/system/macuxi-backup.service "# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086). Não edite à mão.
[Unit]
Description=Macuxi producao: backup diario do DBaaS para o Object Storage (db/backup/backup-dbaas.sh)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service
# antes do primeiro deploy com o script, o timer dispara e a unidade só é pulada (sem erro)
ConditionPathExists=$PASTA/backup/backup-dbaas.sh

[Service]
Type=oneshot
User=$USUARIO
Group=$USUARIO
SupplementaryGroups=docker
WorkingDirectory=$PASTA
Environment=MACUXI_DIR=$PASTA
ExecStart=$PASTA/backup/backup-dbaas.sh
TimeoutStartSec=2h" && mudou=1
gravar_unidade /etc/systemd/system/macuxi-backup.timer "# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086). Não edite à mão.
[Unit]
Description=Macuxi producao: backup diario as 06:15 UTC (02:15 em Manaus)

[Timer]
OnCalendar=*-*-* 06:15:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target" && mudou=1
[ "$mudou" = 1 ] && { systemctl daemon-reload || echo "::warning::systemctl daemon-reload falhou"; log "backup: unidades gravadas"; }
ligar_timer macuxi-backup.timer "$mudou"

# ---------- 8. alerta de saúde (T-0078), instalado pelo deploy ----------
if [ -f "$ORIGEM/alerta-saude.sh" ]; then
  if ! cmp -s "$ORIGEM/alerta-saude.sh" "$PASTA/alerta-saude.sh" 2>/dev/null; then
    install -m 755 -o root -g root "$ORIGEM/alerta-saude.sh" "$PASTA/alerta-saude.sh"
    log "alerta: $PASTA/alerta-saude.sh atualizado"
  fi
else
  echo "::warning::alerta: $ORIGEM/alerta-saude.sh ausente (o workflow copia scripts/deploy/demo/alerta-saude.sh junto)"
fi
mudou=0
gravar_unidade /etc/systemd/system/macuxi-alerta.service "# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086). Não edite à mão.
[Unit]
Description=Macuxi producao: alerta de saude (/v1/saude, T-0078)
ConditionPathExists=$PASTA/alerta-saude.sh

[Service]
Type=oneshot
User=$USUARIO
Group=$USUARIO
Environment=MACUXI_ALERTA_NOME=producao
Environment=MACUXI_ALERTA_ENV=$PASTA/alerta.env
Environment=MACUXI_ALERTA_ESTADO=$PASTA/.alerta.estado
ExecStart=$PASTA/alerta-saude.sh
TimeoutStartSec=60" && mudou=1
gravar_unidade /etc/systemd/system/macuxi-alerta.timer "# Gerado por scripts/deploy/producao/preparar-vm.sh (T-0086). Não edite à mão.
[Unit]
Description=Macuxi producao: alerta de saude a cada 5 minutos

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target" && mudou=1
[ "$mudou" = 1 ] && { systemctl daemon-reload || echo "::warning::systemctl daemon-reload falhou"; log "alerta: unidades gravadas"; }
ligar_timer macuxi-alerta.timer "$mudou"

log "pronto: docker $(docker --version | awk '{print $3}' | tr -d ,), compose $(docker compose version --short), fuso $(timedatectl show -p Timezone --value)"
