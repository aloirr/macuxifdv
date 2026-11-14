# ADR 0024 — PostgreSQL gerenciado (DBaaS) da Magalu Cloud como banco de produção: teste de compatibilidade

- **Status**: **proposta**. O `dbaas-teste.yml` e o alvo `teste-db` saíram em 14/11/2026 com a VM da demo, por onde o teste
  entrava na VPC (ADR 0051); o que segue abaixo é o registro do teste. O veredito técnico está fechado: o DBaaS é **compatível com ajustes (plano B: B0, B1 e B2)**.
  A ADR passa a **aceita** quando três coisas acontecerem:
  1. o dono do produto confirmar o custo e aprovar o uso em produção;
  2. B0, B1 e B2 entrarem no `main`;
  3. uma 3ª execução do `dbaas-teste.yml`, com as migrações até a última e a suíte do `@macuxi/db`, sair sem ❌ (§ Por que proposta).
- **Data**: 2026-11-05
- **Tarefa**: T-0075 (roteiro e itens: [docs/banco/dbaas-magalu.md](../banco/dbaas-magalu.md))
- **Autor**: engenheiro-software (teste e plano B: banco-dados)
- **Base**: ADR 0020 (demo na Magalu; produção com ADR própria), ADR 0007 (macuxi_worker), ADR 0023 (imagem `--prod`), RN-CORE-05, CLAUDE.md regra 5, docs/banco/rls.md

## Contexto
O banco de produção ainda não tem casa. A ADR 0020 deixou "um Postgres gerenciado" para uma ADR própria, e a candidata é o **Database PostgreSQL da Magalu Cloud**.

**Maturidade do serviço:** o suporte da Magalu confirmou ao dono do produto que o PostgreSQL está em **GA**, não em preview (critério 5 da T-0075).

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
- um dono das tabelas que ignore RLS para seed, fixture e DEFINER entre tenants (hoje: superusuário);
- `SET session_replication_role` para o `seed --recriar` e `plataforma.excluir_tenant` (LGPD).

Os dois últimos itens são justamente o que um Postgres gerenciado costuma negar. O teste mede isso.

## Como o teste roda
`.github/workflows/dbaas-teste.yml` (manual, environment `DEMO_SSH_KEY`) faz assim:
1. entra na VM pelo SSH do deploy;
2. confere que a rota até o DBaaS não sai por `docker*`/`br-*`/`veth*`/`lo`;
3. copia só `db/dbaas/` para um `mktemp -d` (modo 700);
4. roda `timeout -k 2m 28m bash ./teste-compatibilidade.sh --senha-stdin`.

O código (migrações, seeds, `@macuxi/db`) vem de uma imagem do GHCR, baixada com um `DOCKER_CONFIG` isolado. Desde a 3ª execução é a `macuxi-api-teste:<sha>`, montada pelo próprio workflow (job `imagem`) a partir do alvo `teste-db` do `apps/api/Dockerfile` do mesmo commit do script: a imagem da API mais o Vitest da versão do `pnpm-lock.yaml`. A VM não tem saída para o `registry.npmjs.org` (aviso do run 42034633355), e o script só chama o npm quando falta o Vitest na imagem. Assim, a VM não precisa de nenhuma saída além do GHCR, e as migrações e o `db/src/scram.ts` são sempre os do commit testado. A imagem de teste tem só a tag do commit, nunca vai para a demo e é apagada da VM no fim do job. A `macuxi-api:<tag>` do demo-publicar continua aceita pelo input `imagem_tag`, mas sem o Vitest. A senha do admin vai mascarada pelo stdin. Nunca aparece em argv, em `-e`/`docker inspect` ou em disco. As senhas de `macuxi_app`/`macuxi_worker` vão como verificador SCRAM calculado no cliente.

Códigos de saída do script:
- 0 = aprovado;
- 5 = aprovado só com o plano B (job verde com aviso);
- 1 = critério ❌;
- 2/3/4 = configuração, alcance ou limpeza.

## Custo
- Tipo testado (BV1-4-10): **a confirmar pelo Alexandre no console da Magalu** (R$/hora e R$/mês). Nenhum agente acessa a conta, e por isso o valor não está aqui.
- Tipo pretendido para produção: **a definir** (§ O que falta para produção, item 6), com o custo do armazenamento (R$/GB-mês) e do backup do serviço. Também **a confirmar pelo Alexandre no console**.
- Custo total do teste: horas de vida da instância × R$/hora do BV1-4-10. Fica **a confirmar pelo Alexandre** quando ele apagar a instância.

## Resultado do teste

### Execuções

| Execução | Run | Commit do script | Imagem | Resultado |
|---|---|---|---|---|
| 1ª | 42015544833 (2026-11-05 11:02 UTC) | 5d1f9d0 | `macuxi-api:main` | ❌ em 12 critérios, todos por uma causa só |
| 2ª | 42021914715 (2026-11-05 11:48 UTC) | c6a60b5 | `macuxi-api:main` (migrações 0001..0027) | ❌ só no C2.5, que é falso positivo (abaixo); ⚠️ em C2.7, C3.2 e C3.4 |

**1ª execução.** O globalSetup e o `criarBanco` do `@macuxi/db` fazem `ALTER ROLE ... nosuperuser nobypassrls` num papel que já existe. No PG 16, só superusuário pode citar SUPERUSER, BYPASSRLS ou REPLICATION num ALTER ROLE, mesmo com o prefixo NO. Daí o "permission denied to alter role", e nada mais rodou. Isso deu origem ao **B0**.

**2ª execução.** O script foi refeito para medir o que o admin consegue fazer e, onde falta privilégio, rodar o caminho alternativo.

### Servidor
- PostgreSQL **16.14** (Ubuntu 16.14-1.pgdg22.04+1);
- vector **0.8.5** (a referência local é 0.8.2);
- TLS **1.3** (`sslmode=prefer`, sem conferir o certificado);
- `TimeZone=Etc/UTC`, `server_encoding=UTF8`, collate `en_US.UTF-8`;
- `max_connections=100`, `shared_buffers=976MB`;
- `pgaudit.log=DDL`: comandos de papel vão para o log do servidor;
- extensões disponíveis: pg_stat_statements, pgcrypto, pg_trgm, unaccent, citext, uuid-ossp, btree_gin, btree_gist.

Privilégios do admin `macuxi_admin`:
- **SUPERUSER: não. BYPASSRLS: não.** CREATEDB: sim. CREATEROLE: sim.
- Membro de `mgc_superuser`, `pg_read_all_data`, `pg_write_all_data` e dos papéis que criou.

### Itens da 2ª execução

| Item | O que confere | Resultado |
|---|---|---|
| P0–P3 | alcance da VM pela VPC (ens3, 6 ms), conexão TLS 1.3, versão 16, CREATEDB/CREATEROLE | ✅ |
| C1.1–C1.2 | vector disponível; `CREATE EXTENSION vector` com o admin | ✅ direto, pelo `pgextwlist` (a vector está em `extwlist.extensions`); dono da extensão: `postgres` |
| C2.1 | `macuxi_app`/`macuxi_worker` com LOGIN, sem SUPERUSER/BYPASSRLS | ✅ |
| C2.2 | base nova (`CREATE DATABASE` direto, sem ALTER ROLE) | ✅ |
| C2.3 | migrações 0001..0027 | ✅ (27 aplicadas, 19 s) |
| C2.4 | RLS ligado e FORCE em toda tabela (`conferir-rls.sql` = 0) | ✅ 115 tabelas, 0 problema |
| C2.5 | SECURITY DEFINER com search_path seguro e sem EXECUTE para PUBLIC | ❌ **falso positivo** (abaixo): as funções do Macuxi passaram |
| C2.6 | `macuxi_app`/`macuxi_worker` não ignoram RLS e não são donos de tabela | ✅ |
| C2.7 | seed demo como o admin | ⚠️ como está: "new row violates row-level security policy for table tenant"; pelo **B1**: 41 tabelas, 1.342 linhas |
| C3.1 | RLS na prática como `macuxi_app` (sem tenant 0 · demo 30 · outro 0) | ✅ |
| C3.2 | `plataforma.tenants_ativos()` (DEFINER) como `macuxi_worker` | ⚠️ como está: 0 tenants (o dono não enxerga por causa do FORCE RLS); pelo **B1**: 1 tenant |
| C3.4 | suíte do `@macuxi/db` (com o vazamento entre tenants) | ⚠️ **não rodou**. O servidor registra comandos de papel (pgaudit), e o `db/src/papeis.ts` ainda manda a senha em texto: precisa do **B0** |
| C4.1–C4.2 | HNSW (`vector_cosine_ops`) em 5.000 × 1536; EXPLAIN | ✅ índice criado em 5,2 s; o EXPLAIN usa o HNSW; **p95 de 2 ms** em 20 rodadas |
| X1 | admin ignora RLS (SUPERUSER ou BYPASSRLS) | ❌ não ignora |
| X1.1 | `SET ROLE mgc_superuser` | funciona e dá **BYPASSRLS**, mas **não SUPERUSER**; sob ele, `session_replication_role` continua negado, e `CREATE ROLE ... BYPASSRLS` é permitido |
| X1.2 | admin concede BYPASSRLS a si ou a papel novo (`ALTER ROLE`, `CREATE ROLE`, `GRANT SET ON PARAMETER`) | ❌ tudo negado (sem o `SET ROLE`) |
| X2 | `SET session_replication_role` | ❌ negado: vale o **B2** |
| X3–X6 | parâmetros; extensões; p95 de sync e busca (FTS) < 300 ms; busca filtrada com `hnsw.iterative_scan = relaxed_order` | ✅ p95 de 1 ms nas três consultas críticas; 10 vizinhos com o filtro de tenant |
| B2 | exclusão do tenant demo sem `session_replication_role` | ⚠️ `excluir_tenant` da 0024 como está: negado. **DELETE em ordem de FK**: 115 passos, 1.802 linhas em 175 ms, ciclo `core.equipe` quebrado antes, nenhuma linha restante. Os 5 gatilhos de DELETE do Treinamento disparam |
| L1–L3 | base, bases da suíte e papéis de teste apagados | ✅ |

**C2.5 é falso positivo.** São 8 funções SECURITY DEFINER, com dois donos: `macuxi_admin` e `postgres`. As duas apontadas são do **pgaudit do provedor**, não do Macuxi:
- `public.pgaudit_ddl_command_end()`;
- `public.pgaudit_sql_drop()`.

Isso se confirma de três formas:
- nenhuma migração do repositório cria função em `public` nem cita pgaudit;
- as nossas DEFINER estão nas migrações 0001, 0010, 0011, 0012, 0014, 0018, 0024 e 0027, criadas pelo migrador (`macuxi_admin`), e todas passaram;
- o `pgaudit` está em `shared_preload_libraries` do servidor.

Além disso, as duas são funções de event trigger, que não se chamam diretamente. O EXECUTE para PUBLIC delas não abre nada. O item fica ✅ para o Macuxi. O verificador vai ser restrito às funções do migrador (§ O que falta, item 4).

**Resultado: plano B.** Nenhum critério reprova pelo Macuxi. Seed, DEFINER entre tenants e exclusão de tenant funcionaram pelo B1 e pelo B2. A suíte depende do B0 para rodar.

## Decisão
**O DBaaS PostgreSQL da Magalu é compatível com o Macuxi com os ajustes B0, B1 e B2 e é o candidato da produção.** O banco não depende de nenhum privilégio que o provedor nega.

1. **B0: papéis sem ALTER de atributo** (`db/src/papeis.ts`, banco-dados; sem migração).
   - Papel novo: `CREATE ROLE` com os atributos.
   - Papel existente: só `ALTER ROLE ... LOGIN PASSWORD <verificador SCRAM>`, e os atributos são conferidos em `pg_roles` (erro claro se tiver SUPERUSER/BYPASSRLS).
   - A senha nunca vai em texto ao servidor, porque o pgaudit a registraria. Vale para qualquer Postgres gerenciado.
2. **B1: papel de manutenção no lugar do BYPASSRLS** (migração nova do banco-dados).
   - `macuxi_manutencao` NOLOGIN, sem BYPASSRLS, herdado pelo migrador.
   - Política `manutencao` `for all ... using (true) with check (true)` em toda tabela com RLS, no mesmo padrão das políticas do `macuxi_worker` (0003).
   - Seed, fixtures e as funções SECURITY DEFINER entre tenants (0001, 0010, 0011, 0024, 0027, 0029) voltam a funcionar sem mudar código.
   - `conferir-rls.sql` e o teste de conformidade passam a exigir a política, e toda tabela nova a cria junto.
   - **Backfill de migração depende disto.** Sem o B1, todo `UPDATE`/`INSERT ... SELECT` de dado de tenant numa migração (ex.: o backfill de `subtipo` da 0030) roda como o migrador sem política. Afeta **0 linhas, sem erro**. Por isso o B1 entra antes de qualquer migração com backfill aplicada no DBaaS.
   - **Risco aceito:** é o mesmo de hoje com superusuário. A conexão do migrador vê todos os tenants. A API e o worker nunca usam essa conexão (S0-028), e os papéis `macuxi_app`/`macuxi_worker` continuam sem BYPASSRLS e com FORCE RLS.
3. **B2: exclusão de tenant e `--recriar` sem `session_replication_role`** (migração nova do banco-dados, depende do B1).
   - `plataforma.excluir_tenant(uuid, text)` é recriada com a mesma assinatura. Ela apaga em ordem de FK calculada no catálogo: filhas antes, e o ciclo `core.usuario` ↔ `core.equipe` quebrado com `update ... set ... = null` antes.
   - Os gatilhos de DELETE do Treinamento passam a ignorar a exclusão de tenant (`app.excluindo_tenant`, só na transação).
   - `db/seeds/demo/demo.ts` usa a mesma ordem.
4. **Numeração:** B1 e B2 entram nas **próximas migrações livres do banco-dados** (pedido do gerente: "0030+"). A 0030 já é `core_notificacao_subtipo`, então hoje elas começam na 0031. Têm desenho curto e tarefa própria antes da produção.
5. **Não dependemos do `mgc_superuser`.** O `SET ROLE mgc_superuser` funcionou e dá BYPASSRLS, mas é um papel interno do provedor, sem contrato público. Ele não resolve o `session_replication_role` nem dá SUPERUSER. Só pode virar atalho, e mesmo assim só para manutenção manual, se a **Magalu confirmar por escrito** que o papel é estável e suportado. Mesmo nesse caso, B1 e B2 continuam sendo o caminho do código.
6. **Regra para migrações novas:** nada pode depender de superusuário, BYPASSRLS ou `session_replication_role` sem alternativa documentada. Toda tabela nova leva a política `manutencao` junto com a `isolamento_tenant`.
7. **A demo continua na VM** (ADR 0020), com o Postgres em contêiner, até a produção existir.

### Por que **proposta**, e não "aceita com ressalvas"
- O veredito técnico é firme. Mas a ADR vira premissa da produção, e três condições ainda não estão cumpridas:
  - **custo:** não registrado, e nenhum agente acessa a conta;
  - **suíte do `@macuxi/db`:** não rodou contra o DBaaS (critério 3 da T-0075), e o vazamento entre tenants só foi visto na amostra do C3.1;
  - **ajustes:** B0, B1 e B2 ainda não existem no código.
- Aceitar agora anteciparia uma decisão de gasto que é do dono do produto. Também daria por provado o critério 3, que não foi provado.
- As condições para aceitar estão no início da ADR. Cumpridas, o status muda sem precisar de ADR nova.

## O que falta para produção
| # | Item | Dono |
|---|---|---|
| 1 | **B0** em `db/src/papeis.ts` + teste sem banco | banco-dados |
| 2 | **B1** (migração de manutenção + `conferir-rls.sql` + teste de conformidade + `docs/banco/rls.md`) | banco-dados |
| 3 | **B2** (`excluir_tenant` em ordem de FK, gatilhos do Treinamento, `demo.ts`, `lgpd-outbox.test.ts`) | banco-dados (gatilhos: com o modulo-treinamento) |
| 4 | Verificador do C2.5 restrito às funções do migrador (ou fora de extensão e de `public`), para o pgaudit do provedor não dar falso positivo | banco-dados |
| 5 | **3ª execução** do `dbaas-teste.yml` com as migrações até a última (hoje 0030; esta rodou só até 0027), B0–B2, a suíte do `@macuxi/db` verde (vazamento entre tenants) e o S0-025 | banco-dados, testes; disparo pelo gerente/Alexandre |
| 6 | Tipo da produção (vCPU/RAM/disco), alta disponibilidade/réplica, backup e PITR do serviço com retenção, **e o custo de cada um**. Confirmar no console | Alexandre, com proposta do engenheiro-software |
| 7 | TLS com `sslmode=verify-full` e a CA da Magalu (no teste foi `prefer`, sem conferir o certificado) | engenheiro-software (bootstrap da API e worker) |
| 8 | Pool de conexões da API + worker + pg-boss abaixo de `max_connections=100`, com folga para manutenção | engenheiro-software |
| 9 | Backup próprio (dump diário de `db/backup` para o Object Storage) além do backup do serviço, com **teste de restauração** | banco-dados |
| 10 | Logs do pgaudit (DDL e papéis): retenção, quem acessa e garantia de que nenhuma senha ou dado pessoal chega ao log (LGPD) | banco-dados, engenheiro-software |
| 11 | pgvector: o DBaaS tem 0.8.5, e o CI e a demo têm 0.8.2. Decidir se o CI e a demo sobem para 0.8.5 ou se a diferença é aceita (mesma série 0.8) | banco-dados |
| 12 | Collation `en_US.UTF-8`: conferir a ordenação de nomes com acento contra a da demo; se divergir, ordenar com `collate` ICU pt-BR onde a tela ordena | banco-dados |
| 13 | Rede: a API de produção na mesma VPC (o DBaaS só tem IP privado); política de janelas de manutenção e atualização de versão menor do provedor | engenheiro-software, Alexandre |
| 14 | Pergunta formal à Magalu sobre o `mgc_superuser` (estável? suportado?) e sobre `GRANT SET ON PARAMETER session_replication_role` ao admin | Alexandre |
| 15 | **Instância temporária apagada** e a confirmação registrada abaixo (critério 7 da T-0075) | Alexandre |

## Alternativas consideradas
- **Depender do `mgc_superuser`** em vez do B1/B2: menos código, mas preso a um papel interno do provedor, sem garantia. Rejeitada enquanto a Magalu não confirmar o papel (Decisão, item 5).
- **B1′ (manutenção restrita por tenant):** política `using (tenant_id = plataforma.tenant_atual())`, com leitura aberta só nas tabelas que as DEFINER leem. É mais restrita, mas obriga seed, as 5 fixtures e o `--recriar` a gravar por tenant (~8 arquivos), e a política diferiria por tabela. Fica como evolução, se a auditoria pedir.
- **Postgres próprio em VM** (`pgvector/pgvector:pg16`, como a demo): controle total, mas o backup, a alta disponibilidade e as atualizações ficam por nossa conta. Continua como plano C, se o custo do DBaaS não fechar.

## Consequências
- O que o teste provou vira premissa da produção. O script (`db/dbaas/teste-compatibilidade.sh`) roda de novo a cada troca de versão ou de tipo do DBaaS e antes de virar a produção.
- O modelo de privilégio fica igual em todo ambiente. Com o B1 e o B2, o CI, a demo e a produção deixam de depender de superusuário para seed, fixture, DEFINER e exclusão de tenant. O Postgres local do CI continua com superusuário, mas o código não usa mais isso.
- Toda migração nova com tabela leva a política `manutencao`, e o CI cobra isso pelo `conferir-rls.sql`.

## Instância temporária
- Apagada em: **a confirmar pelo Alexandre** (data e hora UTC, no console da Magalu).
- Confirmação: **a registrar** (print ou ID da operação no console).
- Tempo de vida e custo do teste: **a confirmar pelo Alexandre** (§ Custo).
