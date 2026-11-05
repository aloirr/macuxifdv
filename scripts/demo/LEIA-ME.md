# Demonstração do Macuxi FDV

> **Desde 04/11/2026 (T-0074, ADR 0020) a demo fica na Magalu Cloud, sempre ligada.** O PC do dono do produto fica só
> com desenvolvimento, e este diretório vira **plano B local, só com túnel rápido**.
> **`configurar-dominio.ps1` está aposentado e recusa rodar**: ele reapontaria o DNS de `api-demo` e `bko-demo` para o
> PC e tiraria a VM do ar.

| Endereço | O que é | Onde roda |
|---|---|---|
| `https://api-demo.macuxifdv.com.br/v1` | API da demo (já vem nos APKs de preview; ninguém digita) | VM `macuxi-demo-se1` |
| `https://bko-demo.macuxifdv.com.br` | BKO da demo | VM `macuxi-demo-se1` |

`api`, `bko` e `app.macuxifdv.com.br` são de produção (reservados, doc 04).

## Demo na nuvem (o normal)
- **Onde**:
  - VM `macuxi-demo-se1`, br-se1-a, IP 177.93.129.233, Docker Compose em `/opt/macuxi`;
  - túnel `macuxi-demo-nuvem` da Cloudflare, conectado por token: `api-demo` → `http://api:8100` e `bko-demo` → `http://bko:3100`;
  - fotos no bucket privado `macuxi-demo-arquivos` (Object Storage br-se1).
  Arquivos em `scripts/deploy/demo/` (`preparar-vm.sh`, `compose.yml`, `implantar.sh`).
- **Publicar**: automático. Cada push no `main` com CI verde dispara o workflow **"demo — publicar"**, que monta as imagens
  no GHCR e publica na VM, com migrações, `compose up -d` e `docker image prune -f`. Para publicar na mão, vá em
  Actions → "demo — publicar" → Run workflow.
- **Base de demo do zero**: Actions → **"demo — recriar base demo"** → Run workflow, digitando `RECRIAR`. Equivale a
  `seed demo --recriar` e só mexe no tenant `demo`. No primeiro deploy, a base é carregada sozinha.
- **Segredos**: nenhum fica no repositório nem no PC.
  - As senhas do Postgres, o JWT e o pepper do Hub nascem na VM (`/opt/macuxi/.env`, modo 600, gerado pelo
    `preparar-vm.sh`).
  - S3 e token do túnel ficam nos secrets do environment `DEMO_SSH_KEY` do GitHub e chegam à VM pelo workflow
    (`segredos.env`, `tunel.env`, modo 600).
- **Conferir pela VM**, por SSH com a chave de deploy:
  ```
  cd /opt/macuxi && docker compose --env-file .env --env-file imagens.env ps
  curl -s http://127.0.0.1:8100/v1/saude
  docker compose --env-file .env --env-file imagens.env logs --tail 100 api
  ```
- **Fora do ar?** Em ordem:
  1. Actions → "demo — publicar": o último run ficou verde?
  2. Painel da Cloudflare: o túnel `macuxi-demo-nuvem` está Healthy?
  3. Na VM: `docker compose ... ps` e os `logs` acima.

### Backup e restauração (VM)
O Postgres da demo vai todo dia para `s3://macuxi-demo-arquivos/backups/` (7 dias). O código é do banco-dados
(`db/backup/`, LEIA-ME lá); o agendamento é do `preparar-vm.sh` e a cópia dos scripts é do `implantar.sh`.
- **Quando**: timer `macuxi-backup.timer`, 06:15 UTC (02:15 em Manaus), até 5 min de atraso aleatório. Se a VM estava
  desligada na hora, roda quando ela volta.
- **Conferência automática**: a cada deploy, o run do "demo — publicar" mostra um **aviso** (amarelo, não falha) se,
  depois do primeiro backup, o mais novo tiver 26 h ou mais, ou se a listagem do bucket falhar.
- **Comandos na VM** (por SSH, em `/opt/macuxi`; `dc` = `docker compose --env-file .env --env-file imagens.env`):

| O quê | Comando |
|---|---|
| Próxima e última execução | `systemctl list-timers macuxi-backup.timer` |
| Log dos backups | `journalctl -u macuxi-backup --since -3d` |
| Backup agora (e primeiro teste depois do deploy) | `/opt/macuxi/backup/backup-vm.sh` |
| Listar o que está no bucket | `dc --profile ferramentas run --rm -T backup listar` |
| Restaurar AO LADO (seguro, não toca no banco em uso) | `/opt/macuxi/backup/restaurar-vm.sh ultimo` |
| Restaurar e PÔR NO LUGAR | `/opt/macuxi/backup/restaurar-vm.sh ultimo --trocar` |

- **Restaurar, passo a passo**:
  1. `/opt/macuxi/backup/restaurar-vm.sh ultimo` (ou a chave de `listar`). Ele baixa, confere o sha256, restaura num banco
     novo `macuxi_restaurado_<UTC>` e compara linhas, políticas de RLS e privilégios com o banco atual. Diferença de linhas
     é normal se houve uso depois do backup.
  2. Conferido, rode de novo com `--trocar`: para `api` e `worker`, renomeia `macuxi` para `macuxi_antes_<UTC>` (fica
     guardado), põe o restaurado no lugar e sobe `api` e `worker`. Se algo falhar, nada muda.
  3. Confira `curl -s http://127.0.0.1:8100/v1/saude` e o login no app. O banco `macuxi_antes_<UTC>` e os
     `macuxi_restaurado_*` que sobrarem são apagados à mão, depois de conferir.
- **VM nova** (volume vazio): publique uma vez pelo workflow (cria `/opt/macuxi`, o `.env`, os papéis com
  `banco migrar up` e os scripts do backup) e só então restaure com `--trocar`. Os papéis não vão no dump.
- O serviço `backup` não recebe as senhas do Postgres: o `pg_dump` roda dentro do contêiner `postgres` e o dump chega
  pelo stdin. Ele só tem a chave do S3 (`segredos.env`).

### No celular
1. Abra o app (APK de preview). Não há endereço para digitar.
2. Código da empresa **`demo`**, senha **`demo-macuxi`**.
3. Se aparecer "Servidor indisponível — tente mais tarde": a demo não está no ar (veja "Fora do ar?" acima).

| App | E-mail | Quem |
|---|---|---|
| Campo | `vendedor@exemplo.com.br` | Lucas Andrade, vendedor, rota de hoje com 6 paradas |
| Campo | `vendedor2@exemplo.com.br` | Camila Freitas, vendedora, 4 paradas |
| Campo | `promotor@exemplo.com.br` | Joana Prado, promotora, 4 paradas (não faz pedido, RN-PRO-01) |
| Gestão | `supervisor@exemplo.com.br` | Renata Barros, Equipe Manaus, 30 clientes, 2 pedidos para aprovar |
| BKO | `analista@exemplo.com.br` / `admin@exemplo.com.br` | analista e administrador |

Módulos licenciados no tenant demo: core, catálogo, vendedor e promotor. O gestor não está licenciado; para licenciar, é
uma linha em `db/seeds/demo/demo.ts` (dono: banco-dados).

## Plano B local (PC, só túnel rápido)
Use só se a VM estiver fora do ar e não der para esperar. **Os APKs de preview não conectam por ele**: o endereço do
túnel rápido é aleatório (`https://<nome>.trycloudflare.com`) e muda a cada subida. Só o build de desenvolvimento
conecta, em login > Avançado > Servidor, com o endereço que o script imprime (com `/v1` no fim; ele também copia para a
área de transferência). O BKO abre pelo endereço rápido dele.

Antes:
- **Docker Desktop** instalado (o script abre se estiver parado);
- `pnpm install` feito na raiz;
- no `.env` da raiz, `MACUXI_JWT_SEGREDO` com 32+ caracteres. Sem ele, o script usa um segredo aleatório só daquela
  subida.

O Postgres da demo local é o do `db/docker-compose.yml` (5432), que agora só serve a este plano B. Os testes usam o
Postgres de testes (5434).

### Subir
`_instalar\subir-demo.cmd` (clique duas vezes) ou:
```
powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1
```
Etapas (de 2 a 4 min):
1. confere o Docker;
2. `banco subir`;
3. `banco seed demo --recriar`;
4. API (8100) e worker, com `MACUXI_TRUST_PROXY=loopback`;
5. `next build` do BKO;
6. dois túneis **rápidos**: API e BKO. O túnel nomeado `macuxi-demo` do PC não é mais usado;
7. `next start` do BKO (3100, só loopback) e conferência local.

Opções:
- `-Manter`: não apaga a base (upsert);
- `-Reiniciar`;
- `-SemWorker`, `-SemBko`, `-SemTunel`;
- `-Portatil`;
- `-Porta 8200`, `-PortaBko 3200`;
- `-TunelRapido`: aceito, mas não muda nada, porque agora o túnel é sempre o rápido.

Uma demo local por vez: com outra no ar, o script recusa (saída 2).

### Derrubar
`_instalar\derrubar-demo.cmd` ou:
```
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1             # túneis, BKO, worker e API (dados ficam)
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1 -PararBanco  # + para o Postgres (dados ficam)
```

### Problemas comuns (plano B)
- **"porta 8100 em uso"** / **"porta 3100 em uso"**: há outra API ou BKO rodando (`pnpm dev`?). Feche, ou use `-Porta`
  ou `-PortaBko`.
- **next build do BKO falhou**: o log completo fica em `.dados\demo\bko-build.log`.
- **Cloudflared demora na 1ª vez** (antivírus examinando o exe novo): o script espera até 3 min.
- Logs e PIDs ficam em `.dados\demo\`, fora do git.
- Testes dos scripts do túnel, com um cloudflared simulado:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\teste\tunel.test.ps1`. Eles passam
  `-EuSeiQueTiraAVmDoAr` ao `configurar-dominio.ps1`, que é simulado e não fala com a Cloudflare. **Nunca** use essa
  chave de verdade.

## Segurança
- **VM**:
  - SSH só por chave, sem senha e sem root;
  - fail2ban e atualizações de segurança automáticas;
  - fuso UTC;
  - só a porta 22 aberta no grupo de segurança;
  - Postgres só na rede interna do compose.
- **Demo**: só dados fictícios. A senha `demo-macuxi` é pública.
- **Plano B**: o túnel rápido expõe a API e o BKO do PC enquanto estiver no ar. Derrube ao terminar e nunca suba com
  dados reais.
- As credenciais da Cloudflare (`%USERPROFILE%\.cloudflared`) e a chave SSH de deploy ficam fora do repositório. Nunca as
  copie para cá.
