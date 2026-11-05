# Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075)

Dono: `banco-dados`. Código: `db/dbaas/` (`teste-compatibilidade.sh`, `teste-compatibilidade.ts`, `relatorio.ts`; testes
puros em `db/testes/dbaas.test.ts`). Quem dispara: o workflow manual `.github/workflows/dbaas-teste.yml`
(engenheiro-software), que entra na VM da demo por SSH, porque só ela está na VPC do DBaaS. O resultado entra no ADR do
DBaaS: [ADR 0024](../decisoes/0024-dbaas-magalu-postgres-producao.md).

**Versão 3 do script (T-0075, depois do run 42021914715):** B0, B1 e B2 estão no código (`db/src/papeis.ts`, migrações
`0031_plataforma_manutencao` e `0032_plataforma_excluir_tenant_ordem_fk`). A 3ª execução migra até a última migração da
imagem e deve sair com 0 (tudo ✅) ou 5 (⚠️ só no que depende do provedor), com a suíte rodando. A imagem precisa ser de
um commit com B0–B2 (o `relatorio.ts` importa `db/src/scram.ts` e as migrações vêm da imagem).

## Como roda
1. **Na VM (host)**: confere a rota até `DBAAS_HOST` (não pode sair por `docker*`/`br-*`/`veth*`, porque uma sub-rede do
   compose pode colidir com a da VPC) e o TCP em `DBAAS_HOST:DBAAS_PORTA`. Recusa host local e recusa rodar se algo
   escutar em `127.0.0.1:5432`.
2. **Contêiner descartável da imagem da API** (`MACUXI_IMAGEM_API`): roda com `--network host`, sem a rede do compose e
   sem o `.env` da demo. Monta `db/dbaas` em `/app/db/dbaas` e recebe a senha do admin **pelo stdin** (não vai em argv nem
   no `docker inspect`). As senhas de `macuxi_app` e `macuxi_worker` são geradas ali, só na memória.
3. **Itens** (código estável, citado no ADR):
   - P0–P3: alcance, conexão/TLS, versão 16, CREATEDB/CREATEROLE do admin;
   - C1: `vector` disponível e `CREATE EXTENSION vector` com o admin;
   - C2: papéis sem SUPERUSER/BYPASSRLS, base `macuxi_dbaas_AAAAMMDD_HHMMSS`, migrações até `DBAAS_MIGRAR_ATE` (vazio = a
     última da imagem), `db/scripts/conferir-rls.sql` com 0 linhas (inclui a política `manutencao` da 0031), SECURITY
     DEFINER do Macuxi com `search_path` fixo e `pg_temp` por último (C2.5: só schemas do Macuxi ou dono = migrador; as do
     provedor, como `public.pgaudit_ddl_command_end` e `public.pgaudit_sql_drop` do pgaudit, saem como informativo), papéis
     que não são donos de tabela, seed demo;
   - C3: RLS na prática (`macuxi_app`), `plataforma.tenants_ativos()` como `macuxi_worker` e a suíte do `@macuxi/db`
     (Vitest da versão do `pnpm-lock.yaml`, que vem na imagem `macuxi-api-teste:<sha>`, alvo `teste-db` do
     `apps/api/Dockerfile`; o npm só entra se a imagem não o tiver; `MACUXI_PG_EXIGIR=1`);
   - C4: HNSW (`vector_cosine_ops`) em 5.000 vetores de dimensão 1536, no formato do futuro
     `catalogo.produto_embedding`, e o EXPLAIN da busca por vizinhos;
   - X1–X6 (complementares, que não mudam o código de saída): admin ignora RLS?, `SET session_replication_role`,
     parâmetros, outras extensões, p95 das consultas críticas e `hnsw.iterative_scan`;
   - B2 (plano B, informativo): `plataforma.excluir_tenant` instalada (0032) numa transação desfeita; só se ela falhar, a
     ordem de FK calculada pelo script;
   - A9, A11 e A12 (complementares da ADR 0024, itens 9, 11 e 12; não mudam o código de saída), detalhados abaixo;
   - L1–L3: apaga a base do teste, a restaurada do A9 (L1.2, logo depois do A9 e antes da suíte, porque o `DROP ROLE` do
     X7 falha se alguma base ainda tiver privilégio do `macuxi_app`), toda base criada durante o run e os papéis de teste
     (`macuxi_dbaas_*`, `macuxi_app`, `macuxi_worker`, `macuxi_manutencao`).
4. **Saída**: `$DBAAS_RELATORIO` (Markdown só com ✅/❌, versões e tempos), além de `execucao.log`, `suite.json` e
   `suite.log` em `$DBAAS_SAIDA`, todos mascarados. O script também confere que a senha não aparece em nenhum arquivo.

Códigos de retorno: 0 = ok · 1 = critério ❌ · 2 = configuração · 3 = sem alcance ou rota · 4 = sobrou base ou papel de
teste · 5 = critérios sem ❌, mas algum ⚠️ (só com o plano B) · 130 = interrompido (as bases são apagadas antes de sair).

A suíte (C3.4) roda sempre que a senha dos papéis vai como verificador SCRAM (B0: `password_encryption = scram-sha-256`,
o caso do DBaaS); só fica de fora se o servidor registrar comandos de papel **e** não usar SCRAM (aí `DBAAS_SUITE=forcar`).

## Complementares da ADR 0024 (3ª execução)
- **A9 — restauração do nosso dump** (item 9). `pg_dump -Fc --enable-row-security` da base do teste, já migrada, com
  seed e com a tabela do C4, como o admin. Depois `pg_restore` numa 2ª base de teste `<base>_r`, criada pelo
  `CREATE DATABASE` direto. A comparação cobre:
  - a contagem de linhas de toda tabela;
  - o retrato do catálogo: RLS e FORCE por tabela, políticas (comando, papéis, using, with check), índices, constraints,
    gatilhos, funções com DEFINER e search_path, privilégios do `macuxi_app`/`macuxi_worker`/`macuxi_manutencao` e
    extensões;
  - o `conferir-rls.sql` = 0 na base restaurada.

  Ficam fora da restauração (`pg_restore -L`) só os objetos do provedor que a base nova já traz do template1: as
  funções e os gatilhos de evento do pgaudit e o `COMMENT ON EXTENSION`, que só o dono da extensão (`postgres`) faz.
  - **Por que `--enable-row-security`.** O admin não tem BYPASSRLS e é dono de tabelas com FORCE RLS. Com o padrão do
    pg_dump (`row_security = off`), o dump aborta. Com a opção, ele lê todos os tenants pela política `manutencao` da
    0031.
  - **Vale também para o backup de produção** (`db/backup`, ADR 0024 item 9). Hoje ele roda como superusuário no
    contêiner da demo. No DBaaS, precisa da mesma opção.
  - **Binários.** O pg_dump e o pg_restore 16 vêm da imagem (PATH, `/usr/lib/postgresql/16/bin` ou `DBAAS_PG_BIN`).
    A `node:24-bookworm-slim` não traz nenhum dos dois. Nesse caso o A9 sai ❌ com a proposta: `postgresql-client-16`
    do PGDG no alvo `teste-db` do `apps/api/Dockerfile` (engenheiro-software). O cliente do Debian bookworm é o 15, que
    não faz dump de servidor 16.
- **A11 — vector do DBaaS × o 0.8.2 do CI** (item 11). Confere que a opclass `vector_cosine_ops` do HNSW usa o
  operador `<=>(vector,vector)`, o mesmo de `order by embedding <=> $1`. Num conjunto fixo (48 vetores e 3 consultas de
  dimensão 8, componentes inteiros, sem empate até o 10º vizinho), o HNSW (`ef_search` 200), a varredura exata e o
  cálculo do Node têm de dar os mesmos 10 vizinhos, com a mesma distância (diferença < 1e-9). Tudo roda numa transação
  desfeita.
  - A `catalogo.produto_embedding` ainda não existe (0013: entra com o ranking semântico). Por isso o item confere a
    forma prevista, a mesma do C4. Quando a tabela existir, ele lista as opclasses dos índices dela.
- **A12 — collation e ctype** (item 12). Confere a collate, o ctype, o provedor e a versão da base, e depois:
  - a ordem de 16 nomes com acento por `order by nome` e `lower(nome)`, contra a `ORDEM_ESPERADA_NOMES`, que é a
    linguística: o acento só desempata;
  - o `collate "C"`, que ordena por bytes e manda Álvaro, Édson e Ícaro para o fim. Por isso não serve para nome na tela;
  - o `pt-BR-x-icu`, se existir;
  - `lower`/`upper` e `ILIKE` com acento. O ILIKE **não** ignora acento em nenhum servidor;
  - `catalogo.sem_acento` e a busca FTS `portuguese` do Catálogo;
  - a `unaccent`, só como informativo, porque o app não depende dela.

  O detalhe diz se precisamos de `COLLATE "C"` ou de ICU em algum índice ou ordenação.

**O esperado do CI.** A11 e A12 usam o mesmo código (`db/dbaas/referencias.ts`) do `db/testes/dbaas-referencia.test.ts`.
Esse teste roda no Postgres do CI (`pgvector/pgvector:pg16`: pgvector 0.8.2, `en_US.utf8` da glibc) e prova lá as
mesmas listas e os mesmos casos. A ordem só é exigida em base en_US. Também roda dentro da suíte do C3.4, contra o DBaaS.

**Locks na produção** (🟢 4 da revisão R-20261105-093536). Migração com `ALTER TABLE` em laço, como a 0031, pega
AccessExclusiveLock tabela por tabela. Na demo, o `implantar.sh` tenta 3 vezes. Na produção, migre na janela de
manutenção ou com `PGOPTIONS='-c lock_timeout=5s'` na conexão do migrador. Assim, a migração não muda.

## O que o banco exige de um Postgres gerenciado (por que estes itens)
- **FORCE RLS em toda tabela.** O dono das tabelas (o admin que migra) só lê e grava linhas de tenant se for superusuário,
  tiver BYPASSRLS ou, desde a 0031 (B1), herdar o `macuxi_manutencao` (política `manutencao` em toda tabela com RLS; ver
  [rls.md](rls.md)). Isso vale para o seed, a fixture dos testes, o backfill de migração e as funções SECURITY DEFINER
  entre tenants. É o item X1, e o efeito aparecia em C2.7, C3.2 e C3.4.
- **`session_replication_role`**: no PG16 só superusuário muda, ou quem recebeu `GRANT SET ON PARAMETER` (X2, negado no
  DBaaS). Desde a 0032 (B2) nem `plataforma.excluir_tenant` nem o `seed demo --recriar` o usam (ordem de FK do catálogo).
- **Papéis (B0)**: no PG16 quem não é superusuário não pode citar SUPERUSER/BYPASSRLS/REPLICATION num ALTER ROLE;
  `db/src/papeis.ts` cria com os atributos, no existente só dá LOGIN e senha (verificador SCRAM, nunca texto: o DBaaS
  carrega pgaudit) e, sem superusuário, dá ao admin SET (sem INHERIT) no papel criado, para o `set role` dos testes.
- **Configuração de busca `portuguese`** (FTS do Catálogo, migração 0013) e **pgvector ≥ 0.8** (HNSW com busca filtrada
  por tenant).
- Bases e papéis criados pelo admin: o migrador (`db/src/migrador.ts`) e os bancos efêmeros dos testes precisam de
  CREATEDB e CREATEROLE.

À mão, na VM (sem workflow): `DBAAS_SENHA=… bash db/dbaas/teste-compatibilidade.sh`. Rode a partir de uma cópia de
`db/dbaas/`. A senha fica só no ambiente do processo e nunca vai para arquivo.
