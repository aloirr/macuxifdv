# Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075)

Dono: `banco-dados`. Código: `db/dbaas/` (`teste-compatibilidade.sh`, `teste-compatibilidade.ts`, `relatorio.ts`; testes
puros em `db/testes/dbaas.test.ts`). Quem dispara: o workflow manual `.github/workflows/dbaas-teste.yml`
(engenheiro-software), que entra na VM da demo por SSH, porque só ela está na VPC do DBaaS. O resultado entra no ADR do
DBaaS, em `docs/decisoes/`.

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
   - C2: papéis sem SUPERUSER/BYPASSRLS, base `macuxi_dbaas_AAAAMMDD_HHMMSS`, migrações 0001..0027,
     `db/scripts/conferir-rls.sql` com 0 linhas, SECURITY DEFINER com `search_path` fixo e `pg_temp` por último, papéis
     que não são donos de tabela, seed demo;
   - C3: RLS na prática (`macuxi_app`), `plataforma.tenants_ativos()` como `macuxi_worker` e a suíte do `@macuxi/db`
     (Vitest da versão do `pnpm-lock.yaml`, instalado só no contêiner; `MACUXI_PG_EXIGIR=1`);
   - C4: HNSW (`vector_cosine_ops`) em 5.000 vetores de dimensão 1536, no formato do futuro
     `catalogo.produto_embedding`, e o EXPLAIN da busca por vizinhos;
   - X1–X6 (complementares, que não mudam o código de saída): admin ignora RLS?, `SET session_replication_role`,
     parâmetros, outras extensões, p95 das consultas críticas e `hnsw.iterative_scan`;
   - L1–L2: apaga a base do teste e toda base criada durante o run.
4. **Saída**: `$DBAAS_RELATORIO` (Markdown só com ✅/❌, versões e tempos), além de `execucao.log`, `suite.json` e
   `suite.log` em `$DBAAS_SAIDA`, todos mascarados. O script também confere que a senha não aparece em nenhum arquivo.

Códigos de retorno: 0 = ok · 1 = critério ❌ · 2 = configuração · 3 = sem alcance ou rota · 4 = sobrou base de teste ·
130 = interrompido (as bases são apagadas antes de sair).

## O que o banco exige de um Postgres gerenciado (por que estes itens)
- **FORCE RLS em toda tabela, com políticas só para o `macuxi_app`.** O dono das tabelas (o admin que migra) só lê e grava
  linhas de tenant se for superusuário ou tiver BYPASSRLS. Isso vale para o seed, para a fixture dos testes e para as
  funções SECURITY DEFINER entre tenants (`plataforma.tenants_ativos`, worker). É o item X1, e o efeito aparece em C2.7,
  C3.2 e C3.4.
- **`session_replication_role`**: usado pelo `seed demo --recriar` e por `plataforma.excluir_tenant` (LGPD). No PG16 só
  superusuário muda esse parâmetro, ou quem recebeu `GRANT SET ON PARAMETER`. É o item X2.
- **Configuração de busca `portuguese`** (FTS do Catálogo, migração 0013) e **pgvector ≥ 0.8** (HNSW com busca filtrada
  por tenant).
- Bases e papéis criados pelo admin: o migrador (`db/src/migrador.ts`) e os bancos efêmeros dos testes precisam de
  CREATEDB e CREATEROLE.

À mão, na VM (sem workflow): `DBAAS_SENHA=… bash db/dbaas/teste-compatibilidade.sh`. Rode a partir de uma cópia de
`db/dbaas/`. A senha fica só no ambiente do processo e nunca vai para arquivo.
