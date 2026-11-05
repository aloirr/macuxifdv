# ADR 0024 — PostgreSQL gerenciado (DBaaS) da Magalu Cloud como banco de produção: teste de compatibilidade

- **Status**: proposta — resultado a preencher depois do run do `dbaas-teste.yml`
- **Data**: 2026-11-05
- **Tarefa**: T-0075 (roteiro e itens: [docs/banco/dbaas-magalu.md](../banco/dbaas-magalu.md))
- **Autor**: engenheiro-software (rascunho do teste: banco-dados)
- **Base**: ADR 0020 (demo na Magalu; produção com ADR própria), ADR 0007 (macuxi_worker), ADR 0023 (imagem `--prod`), RN-CORE-05, CLAUDE.md regra 5, docs/banco/rls.md

## Contexto
O banco de produção ainda não tem casa. A ADR 0020 deixou "um Postgres gerenciado" para uma ADR própria, e a candidata é o **Database PostgreSQL da Magalu Cloud**. O **suporte da Magalu confirmou ao dono do produto que o serviço está em GA**, não em preview.

Instância de teste, temporária:
- PostgreSQL **16**;
- tipo **BV1-4-10** (1 vCPU, 4 GB, 10 GB), zona br-se1-a, criptografia em repouso ativa;
- IP privado na VPC da VM da demo, alcançável só de dentro da VPC;
- admin `macuxi_admin`.

O teste roda a partir da VM, pelo workflow manual `dbaas-teste.yml`, e cria e apaga uma base própria. Nunca toca o Postgres da demo.

O que o Macuxi exige de qualquer Postgres:
- pgvector ≥ 0.8 (HNSW do Catálogo, com busca filtrada por tenant);
- papéis `macuxi_app`/`macuxi_worker` com LOGIN e sem SUPERUSER/BYPASSRLS, e FORCE RLS em toda tabela;
- funções SECURITY DEFINER com search_path fixo;
- configuração de busca `portuguese`;
- CREATEDB/CREATEROLE para o migrador e para os bancos efêmeros dos testes;
- um dono das tabelas que ignore RLS para seed, fixture e DEFINER entre tenants;
- `SET session_replication_role` para o `seed --recriar` e `plataforma.excluir_tenant` (LGPD).

## Como o teste roda
`.github/workflows/dbaas-teste.yml` (manual, environment `DEMO_SSH_KEY`) entra na VM pelo SSH do deploy, confere que a rota até o DBaaS não sai por `docker*`/`br-*`/`veth*`/`lo`, copia só `db/dbaas/` para um `mktemp -d` (modo 700) e roda `timeout -k 2m 28m bash ./teste-compatibilidade.sh --senha-stdin`. O código (migrações 0001..0027, seeds, `@macuxi/db`) vem da imagem `macuxi-api:<SHA do commit>` do GHCR (a do `demo-publicar`), baixada com um `DOCKER_CONFIG` isolado no diretório temporário. A senha (secret `DBAAS_TESTE_SENHA`) vai mascarada pelo stdin do ssh e, dentro do script, pelo stdin do `docker run -i`: nunca em argv, `-e`/`docker inspect` ou disco. A VM precisa de saída para `registry.npmjs.org:443` (Vitest instalado em /tmp do contêiner; sem ela, C3.3 sai ❌). O Postgres e o compose da demo não são tocados.

## Custo
- Tipo testado (BV1-4-10): **R$ ____/hora · R$ ____/mês** (a preencher pelo gerente-projetos).
- Tipo pretendido para produção: **______ — R$ ____/mês**, mais armazenamento **R$ ____/GB-mês** e backup **R$ ____** (a preencher).
- Tempo de vida da instância de teste: **__ h** (custo total do teste: R$ ____).

## Resultado do teste
- Run: ______ (link) · data/hora (UTC): ______ · imagem: `macuxi-api:______`
- Servidor: PostgreSQL ______ · vector ______ · TLS: ______ · admin: SUPERUSER __ / BYPASSRLS __ / CREATEDB __ / CREATEROLE __

| Item | O que confere | Resultado |
|---|---|---|
| P0–P3 | alcance da VM, conexão/TLS, versão 16, CREATEDB/CREATEROLE | |
| C1.1–C1.2 | vector disponível; CREATE EXTENSION vector com o admin | |
| C2.1–C2.7 | papéis sem SUPERUSER/BYPASSRLS; base nova; migrações 0001..0027; conferir-rls.sql = 0; DEFINER com search_path seguro; papéis não donos; seed demo | |
| C3.1–C3.4 | RLS na prática (macuxi_app); tenants_ativos() como macuxi_worker; suíte @macuxi/db (com o vazamento entre tenants) | |
| C4.1–C4.2 | HNSW em 5.000 × 1536 criado; EXPLAIN usa o índice (p95) | |
| X1–X6 | admin ignora RLS; session_replication_role; parâmetros; outras extensões (quais não existem); p95 < 300 ms; iterative_scan | |
| L1–L2 | bases de teste apagadas | |

**Resultado: [ aprovado | plano B | reprovado ]** (a preencher)

O que falhou e por quê: ______ (a preencher)

## Decisão (fechar conforme o resultado)
- **Aprovado**: a produção usa o DBaaS PostgreSQL da Magalu, com conexão por TLS (`sslmode` ______), o tipo ______ e o backup do serviço ______. O dump diário próprio (db/backup) fica ______. A demo continua na VM (ADR 0020).
- **Plano B** (o serviço atende, mas sem um privilégio de que dependemos):
  - admin sem BYPASSRLS (X1): migração nova com política de manutenção para o papel dono nas tabelas lidas por funções DEFINER entre tenants, e seed/fixture gravando com `app.tenant_id`;
  - sem `session_replication_role` (X2): `--recriar` e `excluir_tenant` apagam na ordem das FKs;
  - se o problema for da vector: busca do Catálogo só por FTS até a Magalu atualizar.

  Cada adaptação tem tarefa e ADR próprias antes da produção.
- **Reprovado**: Postgres próprio em VM (`pgvector/pgvector:pg16`, como a demo) com backup no Object Storage, ou outro provedor (ADR nova).

## Consequências
- O que o teste provar vira premissa da produção. O script (`db/dbaas/teste-compatibilidade.sh`) roda de novo em cada troca de versão ou de tipo do DBaaS.
- Diferenças de privilégio do admin gerenciado (X1, X2) passam a ser regra para migrações novas: nada que dependa de superusuário sem alternativa documentada.

## Instância temporária
Apagada em ______ (UTC) por Alexandre, no console da Magalu. Confirmação: ______ (a preencher).
