# Backup do Postgres: demo (T-0074, item 5) e produção no DBaaS (T-0086)

Dono: `banco-dados`. Compose e agendamento na VM: `engenheiro-software` (`scripts/deploy/demo/`).

## O que acontece todo dia
`backup-vm.sh` roda no **host** da VM `macuxi-demo-se1`, em `/opt/macuxi`, pelo timer do systemd ou pelo cron:

1. `pg_dump -Fc` **dentro** do contêiner `postgres` (pg_dump 16, igual ao servidor; socket local, sem senha) grava um
   arquivo temporário no host (modo 600, apagado no fim);
2. `pg_restore -l` lê o índice do dump. Se o dump vier truncado ou vazio, o script para aqui e nada vai ao bucket;
3. o serviço `backup` do compose (imagem `macuxi-api`, `node db/backup/backup.mjs enviar`) envia o dump para
   `s3://macuxi-demo-arquivos/backups/macuxi-AAAAMMDDTHHMMSSZ.dump` (UTC), com o sha256 no metadado
   `x-amz-meta-sha256`. Em seguida confere o tamanho no bucket (HEAD);
4. só depois do envio conferido, apaga os backups com mais de 7 dias. Como roda um backup por dia, ficam 7 cópias.
   Sempre fica o mais novo, mesmo vencido. Só sai objeto com o nome exato de backup, então as fotos em `arquivos/`
   nunca são tocadas.

O cliente S3 está em `s3.mjs`: SigV4 em Node puro, sem SDK, com corpo assinado por sha256 e estilo `caminho`
(`MACUXI_S3_ESTILO=virtual` troca). Nenhuma mensagem de erro leva chave ou segredo, só operação, HTTP e código S3.

## Variáveis do serviço `backup`
`MACUXI_S3_ENDPOINT`, `MACUXI_S3_REGIAO` e `MACUXI_S3_BUCKET` vêm do compose. `MACUXI_S3_CHAVE_ID` e
`MACUXI_S3_SEGREDO` vêm do `segredos.env`. São opcionais:
- `MACUXI_S3_ESTILO`;
- `MACUXI_BACKUP_PREFIXO`, padrão `backups/`. O `MACUXI_S3_PREFIXO=arquivos/` das fotos é ignorado de propósito;
- `MACUXI_BACKUP_DIAS`, padrão 7;
- `MACUXI_PG_BANCO`, padrão `macuxi`.

O serviço **não** precisa do `.env` do admin nem da rede `interna`: o dump chega pelo stdin. Ele só precisa da rede
`borda`, para falar com o Object Storage.

## Comandos
| O quê | Onde | Comando |
|---|---|---|
| Backup agora | host da VM | `/opt/macuxi/backup/backup-vm.sh` |
| Listar backups | host da VM | `docker compose --env-file .env --env-file imagens.env --profile ferramentas run --rm -T backup listar` |
| Simular a poda | host da VM | `... run --rm -T backup podar --simular` |
| Restaurar ao lado (seguro) | host da VM | `/opt/macuxi/backup/restaurar-vm.sh [ultimo\|<chave>] [--destino NOME]` |
| Restaurar e trocar o banco em uso | host da VM | `/opt/macuxi/backup/restaurar-vm.sh ultimo --trocar` |
| Testes (S3 falso + restauração real) | PC/CI | `pnpm --filter @macuxi/db exec vitest run testes/backup.test.ts` |

## Restauração (`restaurar-vm.sh`)
1. Baixa o backup pelo serviço `backup`, que confere o sha256, e confere o índice com `pg_restore -l`.
2. Cria um banco **novo**, por padrão `macuxi_restaurado_<UTC>`, e faz `pg_restore --exit-on-error --single-transaction`.
   Se der erro, desfaz tudo e apaga o banco novo. Depois gira `plataforma.tenant.geracao_base` de **todos** os tenants
   do restaurado (`plataforma.girar_geracao_base(null)`, 0022, T-0079): os aparelhos percebem a base voltada, reenviam a
   fila e limpam a cópia local. Backup anterior à 0022 não tem a função; o `banco migrar up` do deploy cria o marcador.
3. Compara `contagem.sql` do restaurado com a do banco atual: linhas por tabela, políticas de RLS, tabelas com FORCE
   RLS e privilégios de `macuxi_app`/`macuxi_worker`. Diferença nas linhas é normal se houve uso depois do backup.
4. Sem `--trocar`, para aqui e o banco em uso não é tocado. Com `--trocar`:
   - para `api` e `worker`;
   - renomeia `macuxi` para `macuxi_antes_<UTC>`, que **fica guardado**;
   - renomeia o restaurado para `macuxi`;
   - sobe `api` e `worker` de novo.
   Se o rename falhar (conexão aberta), nada muda e `api`/`worker` voltam.

**VM nova** (volume vazio): rode `banco migrar up` uma vez **antes** de restaurar. É ele que cria os papéis
`macuxi_app` e `macuxi_worker` com as senhas do `/opt/macuxi/.env` e o `macuxi_manutencao` (0031, NOLOGIN). Os papéis
são do cluster e não vão no dump; os GRANTs e as políticas do dump (`manutencao ... to macuxi_manutencao`) citam esses
papéis.

Teste local (critério 3 da T-0074): `db/testes/backup.test.ts` monta a base de demo num banco de teste e segue o
caminho completo: `pg_dump -Fc` → `enviarBackup` → S3 falso, que recalcula a assinatura → `baixarBackup` →
`pg_restore` num banco novo. Depois exige `contagem.sql` idêntica. No PC usa o pg_dump do contêiner
`macuxi-postgres-testes` (5434); no CI usa o do PATH, se a versão principal for pelo menos a do servidor (senão pula com
aviso).

## Produção no DBaaS (T-0086; ADR 0028 e ADR 0024, plano B)
Na produção **não há Postgres local**: o banco é o DBaaS `macuxi-prod-db`, por IP privado e sempre com TLS. O admin do
DBaaS **não** tem SUPERUSER nem BYPASSRLS. Ele herda o `macuxi_manutencao` (0031, B1), e a política `manutencao` de cada
tabela mostra todos os tenants a ele. Os dois scripts rodam no host da VM `macuxi-prod-se1`, em `/opt/macuxi`. O
`implantar.sh` os copia da imagem publicada para `/opt/macuxi/backup/`, junto com o `contagem.sql`.
- O psql, o pg_dump e o pg_restore 16 vêm do serviço `pgcliente` do compose, como o admin. A senha chega ao contêiner
  pelo `admin.env` (env_file), nunca pelo argv.
- O bucket é acessado pelo serviço `backup`, com o `segredos.env`.
- Os scripts não leem nenhum dos dois arquivos.

### `backup-dbaas.sh` (timer `macuxi-backup.timer`, 06:15 UTC)
1. **Confere a conexão.** Ela precisa ter TLS (`pg_stat_ssl.ssl = t`), e o admin precisa ver todas as linhas
   (SUPERUSER, BYPASSRLS ou herança do `macuxi_manutencao`). Se o admin não herdar o papel, o script para com código 2:
   o dump sairia **sem** as linhas protegidas pela RLS, sem dar erro.
2. **Faz o dump.** A ordem é `contagem.sql` antes → `pg_dump -Fc -Z 6 --enable-row-security` → `pg_restore -l` →
   `contagem.sql` depois.
   - A opção `--enable-row-security` é obrigatória. Com o padrão (`row_security = off`), o pg_dump de um dono sem
     BYPASSRLS aborta nas tabelas com FORCE RLS (A9, `docs/banco/dbaas-magalu.md`).
   - Contagem igual antes e depois quer dizer que nada mudou durante o dump: a contagem gravada é a do dump.
   - Se mudou (uso no momento), o script repete até 3 vezes (`MACUXI_BACKUP_TENTATIVAS`, pausa `MACUXI_BACKUP_PAUSA_S`,
     padrão 30 s). Na última, segue com a contagem de depois e a marca `estavel=nao`.
3. **Envia ao bucket** `macuxi-prod`, sempre com o mesmo carimbo UTC (o do início do dump):
   - primeiro a contagem, em `backups/macuxi-AAAAMMDDTHHMMSSZ.contagem.txt`;
   - depois o dump, em `backups/macuxi-AAAAMMDDTHHMMSSZ.dump`, com o sha256 nos metadados e o tamanho conferido;
   - por fim a poda de **30 dias** (`MACUXI_BACKUP_DIAS=30` no compose): a contagem sai junto do dump dela, e o mais
     novo fica sempre.
4. A última linha é `[backup-dbaas] ... pronto: ...`. Qualquer falha dá código diferente de 0 (o journal do systemd
   registra). A rota até o DBaaS não é conferida aqui: quem faz isso é o `banco-dbaas.sh`, a cada deploy
   (`MACUXI_CONFERIR_ROTA`).

### `ensaio-restauracao.sh [ultimo|<chave>]` (workflow "producao — ensaio de restauração" e job `stack-producao`)
1. Acha o dump pelo serviço `backup` (`resolver`). Depois baixa o dump, conferindo o sha256, e a contagem gravada junto
   dele.
2. Roda `pg_restore -l` e monta a lista **sem** os objetos do provedor que a base nova já traz do `template1`: gatilhos
   de evento e funções do pgaudit, e o `COMMENT ON EXTENSION`, que só o dono da extensão faz. É o mesmo filtro do A9.
3. Cria `macuxi_ensaio_<AAAAMMDDHHMMSS>` (CREATE DATABASE pelo admin) e a extensão `vector`. Depois roda
   `pg_restore --exit-on-error --single-transaction -L lista`. O dump e a lista ficam numa pasta ao lado do script
   (`MACUXI_ENSAIO_TMP`, modo 700), montada só leitura no `pgcliente`.
4. Compara o `contagem.sql` da base restaurada com a contagem gravada no backup e roda o `db/scripts/conferir-rls.sql`
   da imagem na restaurada, que precisa dar zero linhas.
5. **Apaga a base temporária sempre** (trap no EXIT, também em falha e em Ctrl+C), com `drop database ... with (force)`.
   O banco `macuxi` **nunca** é tocado: o script só se conecta a `postgres` (create/drop) e à temporária, e o nome dela
   é conferido.
6. A última linha diz o resultado:

| Última linha | Código | Quando |
|---|---|---|
| `[ensaio] resultado: IGUAL (N tabelas, M linhas, P políticas; conferir-rls: 0 problemas; backup <chave>; base temporária apagada)` | 0 | contagem igual e RLS ok |
| `[ensaio] resultado: DIFERENTE (...)` | 1 (ou o código da falha) | contagem diferente, conferir-rls com problema, restauração que falhou, backup sem contagem (os da demo) ou base temporária que não saiu |
| (sem linha de resultado) | 2 | uso ou pré-requisito: chave inválida, falta `contagem.sql` ou arquivo da VM. Nada foi criado |

O workflow e o CI procuram exatamente `^\[ensaio\] resultado: IGUAL`. Contagem marcada `estavel=nao` pode dar DIFERENTE
sem defeito na restauração. Nesse caso, rode o ensaio de novo depois do próximo backup.

**Disco do DBaaS:** a base temporária ocupa o mesmo que a de produção enquanto o ensaio roda. Antes de ensaiar, confira
se há espaço livre para mais uma cópia.

**Restauração de verdade** (troca do banco em uso) na produção é manual: banco-dados com o Alexandre, partindo de um
ensaio IGUAL. O `restaurar-vm.sh` é da demo (Postgres local, superusuário).

### Comandos na VM de produção (`/opt/macuxi`)
| O quê | Comando |
|---|---|
| Backup agora | `sudo systemctl start macuxi-backup.service` (ou `/opt/macuxi/backup/backup-dbaas.sh` como o usuário de deploy) |
| Log do último backup | `journalctl -u macuxi-backup --no-pager -n 50` |
| Listar backups | `docker compose --env-file .env --env-file imagens.env --profile ferramentas run --rm -T backup listar` |
| Ensaio de restauração | `/opt/macuxi/backup/ensaio-restauracao.sh ultimo` (ou a chave `backups/macuxi-...dump`) |

### Testes
`pnpm --filter @macuxi/db exec vitest run testes/backup-dbaas.test.ts testes/backup.test.ts`:
- **estático:** `bash -n`, `--enable-row-security`, nenhuma senha no script, trap, nome da base e o banco em uso nunca
  tocado;
- **ponta a ponta com um `docker` falso** (`testes/backup-dbaas/docker-falso.sh`, só fora do Windows): backup → bucket
  falso → ensaio IGUAL, e DIFERENTE em quatro casos (contagem, restauração, conferir-rls e backup sem contagem), sempre
  com a base temporária apagada;
- **`backup.test.ts`:** carimbo, contagem irmã, poda de 30 dias com as contagens, S3 falso com assinatura conferida.

O caminho real, com Postgres 16, TLS obrigatório, admin sem superusuário e S3 falso, é o job `stack-producao` do
`.github/workflows/stack-isolado.yml`.

## Arquivos
| Arquivo | Papel |
|---|---|
| `backup.mjs` | CLI e funções `enviar` (com `--carimbo`), `enviar-contagem`, `resolver`, `baixar`, `baixar-contagem`, `listar` e `podar`, com retenção pura em `selecionarExpirados` e `selecionarContagensExpiradas` |
| `s3.mjs` | cliente S3 mínimo: SigV4 com query string, PUT por stream, GET, HEAD, DELETE e ListObjectsV2 paginado |
| `backup-vm.sh` | backup diário da demo (host da VM, Postgres local) |
| `restaurar-vm.sh` | restauração da demo, ao lado ou com troca (host da VM) |
| `backup-dbaas.sh` | backup diário da produção (DBaaS, pelo `pgcliente`), com a contagem junto |
| `ensaio-restauracao.sh` | ensaio de restauração da produção numa base temporária do DBaaS |
| `contagem.sql` | retrato para conferir a restauração |
