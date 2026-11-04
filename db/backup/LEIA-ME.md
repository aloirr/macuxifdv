# Backup do Postgres da demo (T-0074, item 5)

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
   Se der erro, desfaz tudo e apaga o banco novo.
3. Compara `contagem.sql` do restaurado com a do banco atual: linhas por tabela, políticas de RLS, tabelas com FORCE
   RLS e privilégios de `macuxi_app`/`macuxi_worker`. Diferença nas linhas é normal se houve uso depois do backup.
4. Sem `--trocar`, para aqui e o banco em uso não é tocado. Com `--trocar`:
   - para `api` e `worker`;
   - renomeia `macuxi` para `macuxi_antes_<UTC>`, que **fica guardado**;
   - renomeia o restaurado para `macuxi`;
   - sobe `api` e `worker` de novo.
   Se o rename falhar (conexão aberta), nada muda e `api`/`worker` voltam.

**VM nova** (volume vazio): rode `banco migrar up` uma vez **antes** de restaurar. É ele que cria os papéis
`macuxi_app` e `macuxi_worker` com as senhas do `/opt/macuxi/.env`. Os papéis são do cluster e não vão no dump; os
GRANTs do dump citam esses papéis.

Teste local (critério 3 da T-0074): `db/testes/backup.test.ts` monta a base de demo num banco de teste e segue o
caminho completo: `pg_dump -Fc` → `enviarBackup` → S3 falso, que recalcula a assinatura → `baixarBackup` →
`pg_restore` num banco novo. Depois exige `contagem.sql` idêntica. No PC usa o pg_dump do contêiner
`macuxi-postgres-testes` (5434); no CI usa o do PATH, se a versão principal for pelo menos a do servidor (senão pula com
aviso).

## Arquivos
| Arquivo | Papel |
|---|---|
| `backup.mjs` | CLI e funções `enviar`, `baixar`, `listar` e `podar`, com retenção pura em `selecionarExpirados` |
| `s3.mjs` | cliente S3 mínimo: SigV4 com query string, PUT por stream, GET, HEAD, DELETE e ListObjectsV2 paginado |
| `backup-vm.sh` | backup diário (host da VM) |
| `restaurar-vm.sh` | restauração ao lado ou com troca (host da VM) |
| `contagem.sql` | retrato para conferir a restauração |
