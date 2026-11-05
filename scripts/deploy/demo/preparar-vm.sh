#!/usr/bin/env bash
# Preparo da VM do ambiente demo/homologação na Magalu Cloud (T-0074, ADR 0020). IDEMPOTENTE: pode rodar de novo a
# qualquer momento (o workflow de deploy roda a cada publicação) e só muda o que estiver diferente.
#
#   sudo bash preparar-vm.sh [usuario-de-deploy]      (padrão: o usuário que chamou o sudo, ou "ubuntu")
#
# O que faz:
#   1. fuso UTC (timedatectl);
#   2. pacotes: Docker Engine + plugin Compose (repositório oficial da Docker), fail2ban, unattended-upgrades, openssl;
#   3. SSH só por chave: PasswordAuthentication no, KbdInteractiveAuthentication no, PermitRootLogin no. Antes de aplicar,
#      confere que o usuário de deploy TEM authorized_keys e valida com "sshd -t"; aplica com reload (sessões abertas
#      continuam vivas). Se a validação falhar, desfaz e para sem tocar no sshd;
#   4. fail2ban na jail sshd (backend systemd) e atualizações de segurança automáticas (reinício às 07:30 UTC, se o
#      pacote pedir; o compose volta sozinho com restart: unless-stopped);
#   5. rotação de log do Docker (10 MB x 3 por contêiner), para o disco de 40 GB não encher;
#   6. /opt/macuxi (dono: usuário de deploy) e /opt/macuxi/.env (modo 600) com os segredos GERADOS AQUI, na VM
#      (openssl rand): senhas do Postgres (admin, macuxi_app, macuxi_worker), MACUXI_JWT_SEGREDO e
#      MACUXI_HUB_CHAVE_PEPPER. Nunca saem da VM, nunca são impressos e nunca são regenerados (só acrescenta o que falta;
#      trocar a senha do admin depois do primeiro "up" exigiria ALTER ROLE);
#   7. backup diário do Postgres (código do banco-dados em db/backup/): pasta /opt/macuxi/backup (os scripts chegam
#      pelo implantar.sh, tirados da imagem publicada) e o timer do systemd macuxi-backup.timer, todo dia às 06:15 UTC
#      (02:15 em Manaus), Persistent=true (backup perdido com a VM desligada roda quando ela volta), rodando
#      /opt/macuxi/backup/backup-vm.sh como o usuário de deploy. Log: journalctl -u macuxi-backup.
# Os segredos que vêm do GitHub (S3 e token do túnel) NÃO passam por aqui: o workflow grava /opt/macuxi/segredos.env.
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
PASTA=/opt/macuxi
export DEBIAN_FRONTEND=noninteractive
log() { echo "[preparar-vm] $*"; }

# ---------- 1. fuso ----------
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "UTC" ]; then
  timedatectl set-timezone UTC
  log "fuso ajustado para UTC"
fi

# ---------- 2. pacotes ----------
precisa_apt=0
for p in ca-certificates curl gnupg fail2ban unattended-upgrades openssl; do
  dpkg -s "$p" >/dev/null 2>&1 || precisa_apt=1
done
if [ "$precisa_apt" = 1 ]; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg fail2ban unattended-upgrades openssl
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
# 00-: o sshd usa o PRIMEIRO valor que encontra, então este arquivo vence o 50-cloud-init.conf e o 60-cloudimg-settings.conf
SSHD_NOVO="# Gerado por scripts/deploy/demo/preparar-vm.sh (T-0074). Não edite à mão.
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
  # reload (SIGHUP): as sessões abertas, inclusive a deste script, continuam
  if systemctl is-active --quiet ssh; then systemctl reload ssh; fi
  log "sshd: só chave, sem senha e sem root (validado com sshd -t)"
fi
# conferência (sshd -T mostra a configuração efetiva)
efetivo="$(sshd -T 2>/dev/null | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) ' | sort | tr '\n' ' ')"
log "sshd efetivo: $efetivo"

# ---------- 4. fail2ban e atualizações automáticas ----------
F2B=/etc/fail2ban/jail.d/macuxi.local
F2B_NOVO="# Gerado por scripts/deploy/demo/preparar-vm.sh (T-0074).
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
REBOOT_NOVO='// Gerado por scripts/deploy/demo/preparar-vm.sh (T-0074): reinicia de madrugada (03:30 em Manaus) se a atualização pedir.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "07:30";'
[ "$(cat "$REBOOT" 2>/dev/null)" = "$REBOOT_NOVO" ] || printf '%s\n' "$REBOOT_NOVO" > "$REBOOT"
systemctl enable --now unattended-upgrades >/dev/null

# ---------- 5. log do Docker ----------
DAEMON=/etc/docker/daemon.json
DAEMON_NOVO='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}'
if [ "$(cat "$DAEMON" 2>/dev/null)" != "$DAEMON_NOVO" ]; then
  printf '%s\n' "$DAEMON_NOVO" > "$DAEMON"
  systemctl restart docker
  log "docker: rotação de log ligada"
fi

# ---------- 6. /opt/macuxi e segredos gerados na VM ----------
install -d -m 750 -o "$USUARIO" -g "$USUARIO" "$PASTA"
ENV="$PASTA/.env"
umask 077
[ -f "$ENV" ] || : > "$ENV"
acrescentar() { # nome valor: só se a variável ainda não existir (nunca regenera)
  grep -q "^$1=" "$ENV" || { printf '%s=%s\n' "$1" "$2" >> "$ENV"; log "gerado $1"; }
}
acrescentar MACUXI_PG_ADMIN_USUARIO postgres
acrescentar MACUXI_PG_ADMIN_SENHA "$(openssl rand -hex 32)"
acrescentar MACUXI_PG_APP_SENHA "$(openssl rand -hex 32)"
acrescentar MACUXI_PG_WORKER_SENHA "$(openssl rand -hex 32)"
acrescentar MACUXI_JWT_SEGREDO "$(openssl rand -hex 48)"
acrescentar MACUXI_HUB_CHAVE_PEPPER "$(openssl rand -hex 32)"
chown "$USUARIO:$USUARIO" "$ENV"
chmod 600 "$ENV"
[ -f "$PASTA/segredos.env" ] && { chown "$USUARIO:$USUARIO" "$PASTA/segredos.env"; chmod 600 "$PASTA/segredos.env"; }

# ---------- 7. backup diário (timer do systemd) ----------
install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$PASTA/backup"
UNIDADE_SVC=/etc/systemd/system/macuxi-backup.service
UNIDADE_SVC_NOVO="# Gerado por scripts/deploy/demo/preparar-vm.sh (T-0074). Não edite à mão.
[Unit]
Description=Macuxi demo: backup diario do Postgres para o Object Storage (db/backup/backup-vm.sh)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service
# antes do primeiro deploy com os scripts, o timer dispara e a unidade só é pulada (sem erro)
ConditionPathExists=$PASTA/backup/backup-vm.sh

[Service]
Type=oneshot
User=$USUARIO
Group=$USUARIO
SupplementaryGroups=docker
WorkingDirectory=$PASTA
Environment=MACUXI_DIR=$PASTA
ExecStart=$PASTA/backup/backup-vm.sh
TimeoutStartSec=1h"
UNIDADE_TMR=/etc/systemd/system/macuxi-backup.timer
UNIDADE_TMR_NOVO="# Gerado por scripts/deploy/demo/preparar-vm.sh (T-0074). Não edite à mão.
[Unit]
Description=Macuxi demo: backup diario as 06:15 UTC (02:15 em Manaus)

[Timer]
OnCalendar=*-*-* 06:15:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target"
mudou_unidade=0
if [ "$(cat "$UNIDADE_SVC" 2>/dev/null)" != "$UNIDADE_SVC_NOVO" ]; then
  printf '%s\n' "$UNIDADE_SVC_NOVO" > "$UNIDADE_SVC"; chmod 644 "$UNIDADE_SVC"; mudou_unidade=1
fi
if [ "$(cat "$UNIDADE_TMR" 2>/dev/null)" != "$UNIDADE_TMR_NOVO" ]; then
  printf '%s\n' "$UNIDADE_TMR_NOVO" > "$UNIDADE_TMR"; chmod 644 "$UNIDADE_TMR"; mudou_unidade=1
fi
# falha do systemd aqui é AVISO: o deploy da demo não depende do agendamento do backup
if [ "$mudou_unidade" = 1 ]; then
  systemctl daemon-reload || echo "::warning::backup: systemctl daemon-reload falhou"
  log "backup: unidades macuxi-backup.service/.timer gravadas"
fi
if ! systemctl is-enabled --quiet macuxi-backup.timer || ! systemctl is-active --quiet macuxi-backup.timer; then
  if systemctl enable --now macuxi-backup.timer >/dev/null 2>&1; then
    log "backup: timer ligado (próximo: $(systemctl show macuxi-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo '?'))"
  else
    echo "::warning::backup: não consegui ligar o macuxi-backup.timer (systemctl status macuxi-backup.timer)"
  fi
elif [ "$mudou_unidade" = 1 ]; then
  systemctl restart macuxi-backup.timer || echo "::warning::backup: restart do macuxi-backup.timer falhou"
fi

log "pronto: docker $(docker --version | awk '{print $3}' | tr -d ,), compose $(docker compose version --short), fuso $(timedatectl show -p Timezone --value)"
