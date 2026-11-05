# ADR 0020 — Ambiente demo/homologação na Magalu Cloud: VM com Docker Compose, túnel da Cloudflare, imagens no GHCR e fotos em Object Storage S3

- **Status**: aprovada (04/11/2026, por Alexandre, R-20261104-213539)
- **Data**: 2026-11-04
- **Tarefa**: T-0074 (desenho: [docs/desenho/T-0074.md](../desenho/T-0074.md))
- **Autor**: engenheiro-software
- **Base**: ADR 0007 (worker da outbox), ADR 0010 (fotos; esta ADR é o complemento do §3), ADR 0014 (CI), doc 04
  (arquitetura, "Domínio e endereços"), RN-CORE-05 (isolamento entre tenants), CLAUDE.md regras 5, 8

## Contexto
Até 03/11, a demo rodava no PC do dono do produto (`scripts/demo/subir-demo.ps1`): Postgres no Docker Desktop, API, worker
e BKO como processos, e o túnel nomeado `macuxi-demo` da Cloudflare para `api-demo` e `bko-demo.macuxifdv.com.br`. Com o PC
desligado, a demo saía do ar, e a carga dos testes chegou a derrubar o Postgres da demo (02/11). Em 04/11, o dono do produto
decidiu levar a demo e a homologação para a Magalu Cloud, **sempre ligadas**, e deixar o PC só para desenvolvimento. Ele já
criou a VM `macuxi-demo-se1` (br-se1-a, Ubuntu 24.04, 2 vCPU, 8 GB, 40 GB; só TCP 22 de entrada), o bucket privado
`macuxi-demo-arquivos` (br-se1) com a API Key `macuxi-demo-s3` (válida até 31/12/2026), o túnel `macuxi-demo-nuvem`
(conectado por token, rotas `api-demo` → `http://api:8100` e `bko-demo` → `http://bko:3100`) e o GitHub Environment
`DEMO_SSH_KEY` com os secrets do deploy.

## Decisão
1. **Uma VM, um Docker Compose** (`scripts/deploy/demo/compose.yml`, instalado em `/opt/macuxi`), com os serviços:
   - `api` (8100), `worker` (despachante da outbox, ADR 0007) e `bko` (3100). Os nomes `api` e `bko` são os das rotas do túnel;
   - `postgres` (`pgvector/pgvector:pg16`, a mesma imagem do CI), com volume nomeado, só numa rede `internal` (sem porta
     publicada, sem saída para a internet);
   - `cloudflared` (`tunnel run`, com `TUNNEL_TOKEN` vindo de `DEMO_CLOUDFLARE_TUNNEL_TOKEN`).

   Nenhuma porta abre para a internet: o túnel é uma conexão de saída. As portas 8100 e 3100 ficam publicadas só em
   `127.0.0.1`, para conferência por SSH. Kubernetes, um Postgres gerenciado e um balanceador ficam para produção, que terá
   ADR própria.
2. **Uma imagem por aplicação, montada no GitHub Actions e publicada no GHCR** (pacotes privados, com o `GITHUB_TOKEN`):
   - `macuxi-api` (`apps/api/Dockerfile`) serve à API, ao worker, às migrações e ao seed. Os pacotes do monorepo são
     TypeScript puro e rodam com `tsx`, como no `pnpm dev` (sem etapa de build nova);
   - `macuxi-bko` (`apps/web/Dockerfile`, do engenheiro-apps) roda o `next start -p 3100`, com o rewrite `/api-proxy`
     apontando para `http://api:8100/v1`.

   As tags são `<sha>` e `main`. A VM só baixa a imagem: nunca monta.
3. **Publicação** (`.github/workflows/demo-publicar.yml`). Dispara quando o CI termina verde num push ao `main`
   (`workflow_run`) ou manualmente, e roda com `environment: DEMO_SSH_KEY`. Os passos:
   1. monta e publica as imagens;
   2. copia `scripts/deploy/demo` para a VM;
   3. roda o `preparar-vm.sh`, que é idempotente;
   4. grava os segredos do GitHub em `/opt/macuxi/segredos.env` e `/opt/macuxi/tunel.env` (modo 600, pelo stdin do ssh);
   5. faz login no GHCR **na VM** com o `GITHUB_TOKEN` do run (expira no fim do job; logout no fim);
   6. roda o `implantar.sh`: pull, migrações, seed da demo só no 1º deploy, `compose up -d --wait`, conferência local de
      `/v1/saude` e `/login` e `docker image prune -f`.

   O workflow manual `demo-recriar-base.yml` (confirmação "RECRIAR") roda `seed demo --recriar`. Um grupo de concorrência
   (`demo-vm`) impede dois deploys ao mesmo tempo.
4. **Segredos.** Os que nascem na VM ficam na VM: o `preparar-vm.sh` gera com `openssl rand` as senhas do Postgres
   (admin, `macuxi_app`, `macuxi_worker`), o `MACUXI_JWT_SEGREDO` e o `MACUXI_HUB_CHAVE_PEPPER` em `/opt/macuxi/.env`
   (modo 600, dono `ubuntu`). Ele só acrescenta o que falta e nunca regenera nem imprime. Os que vêm de fora (S3 e token
   do túnel) ficam só nos secrets do environment e chegam à VM pelo stdin. Nada disso entra no repositório nem na imagem
   (`.dockerignore` exclui `.env*`, `.dados`, `.git`, `.claude` e `.coord`).
5. **Base de demonstração na VM.** O `@macuxi/db` só aceita o seed da demo (dados fictícios, senha `demo-macuxi`
   documentada) num Postgres local ou com a permissão explícita `MACUXI_AMBIENTE=demo` (`exigirBancoDemo`, banco-dados).
   Na VM, o serviço avulso `seed-demo` usa o mesmo host `postgres` e o mesmo `NODE_ENV=production` dos outros, com
   `MACUXI_AMBIENTE: demo`. A permissão vale só para o seed demo e os seeds de módulo em `db/seeds/demo/`: não libera a
   senha pública dos papéis, o seed da Fase M nem a fixture. API, worker e migrações falham fechados (sem segredo JWT ou
   com a senha pública local, não sobem). *Atualizado em 04/11: substitui o alias de rede `macuxi-postgres` com
   `NODE_ENV=development`, que era transitório.*
6. **Endurecimento da VM** (`preparar-vm.sh`):
   - SSH só por chave (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, num
     `sshd_config.d/00-macuxi.conf`, que vence os arquivos do cloud-init). Antes de aplicar, o script confere se há
     `authorized_keys` e valida com `sshd -t`, e aplica com reload, sem derrubar as sessões abertas;
   - fail2ban na jail `sshd`;
   - `unattended-upgrades`, com reinício automático às 07:30 UTC (03:30 em Manaus) se o pacote pedir;
   - fuso UTC e rotação de log do Docker (10 MB × 3).
7. **Complemento da ADR 0010 §3: adaptador S3 genérico** (`apps/api/src/armazenamento-s3.ts`):
   - fala o protocolo S3 (PUT/GET/DELETE de objeto, AWS Signature V4) com `fetch` e `node:crypto`, **sem SDK** (nenhuma
     dependência nova; a assinatura confere com o vetor de teste público da AWS). Vale para a Magalu, o MinIO e a AWS;
   - configuração por variável: `MACUXI_ARQUIVOS_DRIVER=s3` com `MACUXI_S3_ENDPOINT`, `MACUXI_S3_REGIAO`,
     `MACUXI_S3_BUCKET`, `MACUXI_S3_CHAVE_ID`, `MACUXI_S3_SEGREDO` e, opcionais, `MACUXI_S3_PREFIXO` e
     `MACUXI_S3_ESTILO=caminho|virtual`. Se faltar alguma, a API não sobe (a mensagem dá o nome da variável, nunca o valor);
   - na demo: endpoint `https://br-se1.magaluobjects.com`, região `br-se1`, bucket `macuxi-demo-arquivos`, prefixo
     `arquivos/` (os backups do banco-dados ficam em `backups/`), endereçamento por caminho;
   - a chave do objeto continua `<tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`, conferida contra o formato fechado antes de
     virar URL;
   - quem autoriza continua sendo a rota (RLS em `plataforma.arquivo`, licença, perfil e carteira). O bucket é privado,
     só a API tem a chave e não há URL pré-assinada no v1;
   - o **disco local continua o padrão** em dev e no CI (`MACUXI_ARQUIVOS_DRIVER` ausente ou `disco`) e é o plano B da VM
     (volume `arquivos`);
   - os testes usam um S3 falso local que confere a assinatura do pedido recebido, nunca o bucket real. O isolamento entre
     tenants (RN-CORE-05) está em `apps/api/test/arquivos-s3.banco.test.ts`.
8. **Plano B local.** `scripts/demo/subir-demo.ps1` e `derrubar-demo.ps1` continuam valendo, **só com túnel rápido**
   (trycloudflare). O `configurar-dominio.ps1` fica bloqueado, porque reapontaria o DNS de `api-demo`/`bko-demo` para o
   PC e tiraria a VM do ar.

## Alternativas consideradas
- **Manter a demo no PC.** Fica fora do ar com o PC desligado e disputa recursos com os testes. Rejeitada pelo dono do
  produto.
- **Postgres gerenciado da Magalu.** Custa mais e é exagero para a demo. Fica para produção.
- **Montar as imagens na VM.** Gasta CPU e memória da VM de 2 vCPU (o `pnpm install` leva ~15 min) e deixa o deploy
  depender do npm na hora. Fica só como recurso manual de emergência.
- **SDK oficial da AWS (`@aws-sdk/client-s3`).** Tem dezenas de pacotes, exige `pnpm install` e lockfile novo, e só
  usamos três operações. SigV4 cabe em ~40 linhas testáveis. Se precisarmos de multipart ou URL pré-assinada, revemos.
- **Portas abertas com Caddy/Let's Encrypt.** Exigiria abrir 80/443 no grupo de segurança. O túnel já dá HTTPS sem
  porta de entrada.
- **Kubernetes ou Swarm.** Exagero para uma VM.

## Consequências
- A demo não depende mais do PC. Um merge verde no `main` publica sozinho em ~10–15 min depois do CI.
- **O commit que cria ou altera `.github/workflows/**` precisa do trailer `Agente: alexandre`** (guarda
  `brechas-governanca` do CI). O dono do produto autorizou os workflows no pedido v2 da T-0074.
- O deploy depende do CI verde do `main`. Se o CI ficar vermelho por outro motivo, o dono do produto pode rodar
  "demo — publicar" manualmente.
- A chave do host SSH é aceita na primeira conexão de cada runner (`ssh-keyscan`). Endurecer depois com um secret
  `DEMO_HOST_KEY` fixo.
- API e worker leem a configuração com `lerConfigApp` (banco-dados, 04/11): fora do local só exigem
  `MACUXI_PG_APP_SENHA` (e `MACUXI_PG_WORKER_SENHA` no worker). O `compose.yml` zera `MACUXI_PG_ADMIN_SENHA` nos dois,
  porque o `.env` da VM (que também serve às migrações e ao seed) traz a senha do admin; `urlAdmin` lança se alguém a
  chamar ali. Migrações, papéis e seed continuam com `lerConfig` (admin obrigatório).
- **Premissa a confirmar no primeiro upload.** O endpoint `https://br-se1.magaluobjects.com` (Object Storage da Magalu
  Cloud, compatível com S3) e o endereçamento por caminho vêm da documentação pública da Magalu, mas não foram
  conferidos online nesta rodada (o agente não tem acesso à web). Se o primeiro upload falhar com `SignatureDoesNotMatch`
  ou `NoSuchBucket`, troque `MACUXI_S3_ESTILO` para `virtual` no `compose.yml`. Se falhar com erro de DNS, corrija o
  endpoint.
- Renovar a API Key `macuxi-demo-s3` antes de 31/12/2026 (o gerente avisa o dono do produto em 15/12), e depois
  atualizar os secrets `DEMO_S3_KEY_ID` e `DEMO_S3_SECRET` e rodar "demo — publicar".
- **Backup diário** (`pg_dump -Fc` → `backups/` do mesmo bucket, 7 dias; código do banco-dados em `db/backup/`):
  - o timer do systemd `macuxi-backup.timer` (`preparar-vm.sh`) roda todo dia às 06:15 UTC (02:15 em Manaus), com
    `Persistent=true` (backup perdido com a VM desligada roda quando ela volta) e até 5 min de atraso aleatório. Ele chama
    `/opt/macuxi/backup/backup-vm.sh` como o usuário de deploy. Timer em vez de serviço no compose porque o `pg_dump`
    roda dentro do contêiner `postgres` e o envio é um `compose run` avulso: nada fica ligado o dia todo;
  - os scripts do host (`backup-vm.sh`, `restaurar-vm.sh`, `contagem.sql`) saem da própria imagem publicada pelo
    `implantar.sh`, a cada deploy, porque o workflow só copia `scripts/deploy/demo`. Assim a versão dos scripts é a do
    serviço `backup`;
  - o serviço `backup` do compose (perfil `ferramentas`, imagem `macuxi-api`, `node db/backup/backup.mjs`) não recebe o
    `.env` nem a rede interna: o dump chega pelo stdin e ele só fala com o Object Storage (`segredos.env`);
  - a cada deploy, o `implantar.sh` lista `backups/` e **avisa** (`::warning::`, sem falhar) se, depois do primeiro
    backup, o mais novo tiver 26 h ou mais;
  - restauração: `/opt/macuxi/backup/restaurar-vm.sh` (ao lado, num banco novo, e `--trocar` para pôr no lugar),
    descrita em `scripts/demo/LEIA-ME.md` e `db/backup/LEIA-ME.md`. Testada no PC (`db/testes/backup.test.ts`).
