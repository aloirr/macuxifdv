# ADR 0028 — Produção na Magalu Cloud: VM com Compose, banco no DBaaS por TLS, publicação só por tag com aprovação

- **Status**: proposta (vira aceita com o primeiro deploy verde de produção e a revisão do dono do produto)
- **Data**: 2026-11-05
- **Tarefa**: T-0086 (desenho e roteiro: [docs/desenho/T-0086.md](../desenho/T-0086.md))
- **Autor**: engenheiro-software
- **Base**: ADR 0020 (demo na Magalu, "produção com ADR própria"), ADR 0024 (DBaaS, plano B0/B1/B2), ADR 0023 (imagem `--prod`), ADR 0010 (fotos em S3), mensagem do Alexandre de 05/11 21h50

## Contexto
A produção liga em 06/11 com recursos que o Alexandre cria às 8h: VM `macuxi-prod-se1`, DBaaS `macuxi-prod-db`, bucket `macuxi-prod`, túnel `macuxi-prod` (api., bko., config.) e o environment `PRODUCAO` com aprovação dele. A demo (ADR 0020) já provou o padrão VM + Compose + túnel + GHCR. O que muda: o banco deixa a VM e vai para o DBaaS (sem superusuário, ADR 0024), e a publicação passa a exigir uma decisão humana.

## Decisão
1. **Mesmo padrão da demo, sem Postgres local** (`scripts/deploy/producao/`): serviços `api`, `worker`, `bko` e `cloudflared`; ferramentas `banco` (migrações), `tenant` (`tenant:criar`), `pgcliente` (psql/pg_dump 16) e `backup` (S3). Uma rede só, com saída.
2. **TLS sempre com o DBaaS.** O node-postgres lê o `PGSSLMODE` (a URL não traz `sslmode`). Há dois modos:
   - com a CA do DBaaS (secret opcional `PROD_PG_CA_CERT`): `verify-full` (CA em `NODE_EXTRA_CA_CERTS` e `PGSSLROOTCERT`);
   - sem ela: `no-verify`/`require`, que cifra mas não autentica o servidor, como no teste da ADR 0024. O deploy avisa no log.

   `disable` nunca vale, e o `banco-dbaas.sh` recusa uma conexão sem TLS (`pg_stat_ssl`).
3. **Faixas próprias para as redes do Docker** (`bip 192.168.199.1/24`, pools `192.168.200.0/21`). As faixas padrão `172.17–31.x` colidem com a VPC (o DBaaS de teste era 172.18.3.212). A rota até o banco é conferida a cada deploy.
4. **A imagem da API vai por digest.** É a `macuxi-api:<sha>` que o CI aprovou e que o "demo — publicar" já publicou e roda na demo. O workflow confere três coisas: a tag aponta para um commit do `main`, há um CI verde de push e a imagem existe. **O BKO é a exceção:** a origem pública fica gravada no `next build`, então o workflow monta a `macuxi-bko-prod` do mesmo commit, com `MACUXI_BKO_ORIGEM=https://bko.macuxifdv.com.br`.
5. **Publicação só por tag `v*`, com aprovação.** O job de deploy usa o environment `PRODUCAO`, que tem revisor obrigatório. Não há `workflow_dispatch` nem gatilho por branch. Para voltar a uma versão, basta reexecutar o run da tag anterior.
6. **Banco pelo plano B da ADR 0024**, a cada deploy e de forma idempotente (`banco-dbaas.sh`):
   - confere a rota e o TLS;
   - confere o admin: CREATEDB e CREATEROLE são obrigatórios, e não ser superusuário é o esperado;
   - cria o banco `macuxi` e a extensão `vector` (≥ 0.8);
   - roda `banco migrar up`, que aplica o B0 nos papéis, a 0031 de manutenção e as migrações;
   - confere os papéis, a herança do `macuxi_manutencao` e o `conferir-rls.sql` com 0 linhas.
7. **Voltar atrás é automático na conferência.** O `implantar.sh` guarda o `imagens.env` e o `compose.yml` em uso. Se o `/v1/saude` não mostrar `banco ok` e a versão da tag, ou se o BKO não responder, ele restaura a versão anterior e sai com código 3. **A migração não é desfeita:** as migrações são aditivas (ADR 0024, item 6) e a versão anterior roda sobre o esquema novo.
8. **Segredos:**
   - o que só existe fora (admin do DBaaS, S3, token do túnel, SSH) fica nos secrets do `PRODUCAO` e chega à VM pelo stdin do ssh, em arquivos modo 600;
   - o que pode nascer na VM (senhas de `macuxi_app`/`macuxi_worker`, JWT, pepper do Hub) é gerado nela e nunca sai de lá;
   - a API e o worker nunca recebem a senha do admin (`admin.env` só vai para as ferramentas).
9. **Alerta e backup instalados pelo deploy, não à mão** (timers do systemd no `preparar-vm.sh`):
   - `macuxi-alerta.timer` a cada 5 min, rodando o alerta da T-0078;
   - `macuxi-backup.timer` diário, com o `db/backup/backup-dbaas.sh` do banco-dados: `pg_dump --enable-row-security` para `macuxi-prod/backups/`, guardado por 30 dias;
   - ensaio de restauração por workflow manual, numa base temporária.

## Alternativas consideradas
- **Postgres na VM, como na demo:** é mais simples, mas deixa backup, HA e atualizações por nossa conta. Fica como plano C da ADR 0024.
- **Publicar no push ao `main`, como na demo:** rejeitada. Produção exige decisão explícita (tag + aprovação).
- **Reaproveitar a imagem do BKO da demo:** impossível, porque a origem está gravada no build. Tornar a origem configurável na execução fica com o engenheiro-apps, como evolução.
- **JWT e pepper como secrets do GitHub:** sobreviveriam à perda da VM, mas são mais um segredo para colar às 8h. Por ora ficam gerados na VM. Se a VM for perdida, os usuários entram de novo e as chaves do Conector são reemitidas. Revisar antes do primeiro cliente com Conector.
- **`verify-full` obrigatório:** depende de a Magalu entregar a CA e de o certificado ter o IP privado no SAN, o que ainda não foi medido. Por isso fica opcional, com aviso.

## Consequências
- Toda publicação de produção é rastreável: tag → commit do `main` → CI verde → digest → aprovação.
- O stack isolado do CI (job `stack-producao`) ensaia o mesmo caminho num Postgres de teste com TLS obrigatório e admin sem superusuário:
  - os dois deploys;
  - a volta atrás com uma imagem quebrada;
  - o alerta;
  - o `tenant:criar`.
- Uma migração que não for aditiva exige janela e plano de volta próprios. A volta atrás automática não a cobre.
- Pendências: CA do DBaaS para o `verify-full`; `backup-dbaas.sh` e `ensaio-restauracao.sh` (banco-dados); origem `config.` aceita no BKO (engenheiro-apps); custo e tipo do DBaaS confirmados pelo Alexandre (ADR 0024).
