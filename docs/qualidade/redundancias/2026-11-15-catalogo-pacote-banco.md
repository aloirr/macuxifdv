# Pacote da primeira carga, parte do banco (0074) · parecer do corretor-redundancias

Corretor-redundancias, 15/11/2026 (Manaus). Fiz o parecer com a regra da Definição de pronto (R-20261110-062506, R-20261110-093124 e R-20261110-192153).

**Escopo:** `git diff origin/main...origin/nuvem/catalogo-pacote-banco-dados`, com o branch em `4d20add5a` e o `main` em `5d744724d`. São 12 arquivos:
- a migração `0074_plataforma_sync_pacote` (up e down) e o espelho Drizzle;
- `excecoes.ts`, a fixture dois-tenants e os testes `estatico` e `sync-pacote.db`;
- `docs/banco/` (README, `plataforma.md`, `fixture-dois-tenants.md` e `sync-pacote.md`) e o diário do banco-dados.

Para conferir coerência e consultas, também li a ADR 0054, o desenho `docs/desenho/T-catalogo-pacote.md` e as consultas de `apps/api/src/sync-pacotes*.ts` no branch `origin/nuvem/catalogo-pacote-engenheiro-software` (`4e6fc2d19`).

**Parecer anterior:** não existe. Nenhum branch `origin/nuvem/*pacote*-corretor-redundancias` foi encontrado, então não há reteste.

**Veredito: COM ACHADO.** São 5 achados novos, de **RD-0580 a RD-0584**, todos do `banco-dados`:
- RD-0580 a RD-0583 seguram o lote: 2 estão em doc, 1 é comentário de SQL de produção e 1 é índice;
- RD-0584 não segura, porque está só em teste (precedente RD-0317) e entra no lote seguinte.

Nenhum defeito funcional foi encontrado, então não há encaminhamento ao `testes`.

---

## Achados

| ID | Onde | Tipo | O que se repete | Severidade | Proposta (antes → depois) |
|---|---|---|---|---|---|
| RD-0580 | `docs/banco/sync-pacote.md:76-80` (§ RLS e grants) | doc | A tabela de papéis (linhas 70-74) já diz o UPDATE do worker "em linha que **não** está `apagado`", o DELETE "só de linha `apagado`", o `pendente` e o "não `pendente`", e o INSERT do app só nas 6 colunas. O parágrafo "Políticas do worker" repete as 4 condições. A frase "O app não escolhe `situacao`, `gerar_apos` nem `atendido_em` (sem INSERT na coluna)" repete a linha do app. São 2 lugares no mesmo doc para a mesma regra. | média | Trocar o parágrafo inteiro por: "Políticas do worker (como as `despacho_*` das outboxes): `sync_pacote_gerador`, `_gravar`, `_marcar` e `_expurgar`, e as `sync_pacote_pedido_gerador*` correspondentes; as condições estão na tabela acima. A `origem` gravada pela API é sempre `manifesto` (regra da API; o banco não distingue)." |
| RD-0581 | `db/migrations/0074_plataforma_sync_pacote.up.sql:25-46` (cabeçalho) | comentário de SQL de produção · doc | O cabeçalho aponta o dicionário (`docs/banco/sync-pacote.md`, linha 3) e mesmo assim copia o dicionário em 3 blocos: **Acesso** (linhas 25-33, que repetem a tabela de RLS e grants do doc e os `grant` logo abaixo), **Índices** (linhas 35-40, que repetem a seção Índices do doc e os `create index`) e **Caminho de volta** (linhas 42-46, que repetem o cabeçalho da `down.sql:1-7` e o § Caminho de volta do doc). O "Caminho de volta" fica em 3 lugares, e o acesso e os índices também ficam em 3 (cabeçalho, doc e o próprio SQL). Precedente: RD-0334 (0069, decisão só na ADR 0049). | média | Manter no cabeçalho a origem, "ADITIVA", 1 frase por tabela, "Fora do sync" e o ponteiro ao dicionário. Trocar os 3 blocos por 1 linha: `-- Acesso, índices e volume: docs/banco/sync-pacote.md. Caminho de volta: 0074_plataforma_sync_pacote.down.sql (cabeçalho).` Os comentários de 1 linha antes de cada bloco de políticas no corpo continuam. |
| RD-0582 | `docs/banco/sync-pacote.md:105-107` (§ Fixture dois-tenants) | doc | O conteúdo da fixture 0074 está descrito 3 vezes com o mesmo texto: no cabeçalho de `db/seeds/fixtures/dois-tenants.ts:81-83`, em `docs/banco/fixture-dois-tenants.md` § 0074 (a fonte de cada fixture, por convenção) e nesta seção do dicionário. | baixa | Apagar a seção do dicionário, ou deixar 1 linha: "Fixture: [fixture-dois-tenants.md](fixture-dois-tenants.md) § 0074." |
| RD-0583 | `0074_plataforma_sync_pacote.up.sql:89` e `:149` (`sync_pacote_filial_ix`, `sync_pacote_pedido_filial_ix`) | código (índice) | Nenhuma consulta filtra por `filial_id` nas 2 tabelas. A API (`sync-pacotes.ts:189,198`) lê por `tenant_id` + `modulo` + `situacao`, ou por `id`. O gerador (`sync-pacotes-gerador.ts:173-193,258,266-267`) lê por `tenant_id`/`situacao`/`created_at`, `gerar_apos`, `substituido_em` e `atendido_em`. A partição já leva o uuid da filial e é coberta pelo `sync_pacote_pronto_uk` e pelo `sync_pacote_pedido_pendente_uk`. São 2 índices que todo insert mantém e ninguém lê. A filial removida sai pela lista de partições (`particoesPacote`), e não por consulta por `filial_id`. | baixa | Tirar os 2 `create index` da up; da lista estática e da de `pg_indexes` em `sync-pacote.db.test.ts:104,108,359`; e das linhas `sync-pacote.md:37` e `:59`. **`manter?`:** se o banco-dados tiver uma consulta planejada por filial (ex.: expurgo por filial apagada), basta citá-la no doc no lugar de "pacotes de uma filial", e o achado vira `manter`. |
| RD-0584 | `db/testes/sync-pacote.db.test.ts:53-56` e `:138-147` | teste | **(a)** O caso "nome e posição" (`nomes[73]`) repete `estatico.test.ts:199`, que é o registro único da numeração (nenhum outro `*.db.test.ts` confere a posição). O próprio título do caso diz "registro único". **(b)** Os 8 grants do `macuxi_worker` repetem a lista exaustiva do worker em `estatico.test.ts:330-338` (bloco "0003 macuxi_worker"). O teste do diagnóstico (0058) não repete essa lista. | baixa (não segura: só teste) | (a) Apagar o caso. (b) No `toEqual` dos grants, deixar só as 3 linhas do `macuxi_app` e trocar as 8 do worker por um comentário: `// worker: lista exaustiva em estatico.test.ts (0003 macuxi_worker)`. |

## O que passou sem achado

- **ADR 0054 × banco:** a ADR e o desenho mandam no comportamento, e o dicionário manda nas colunas, nos CHECKs e nos papéis. O "Ciclo de vida" do `sync-pacote.md` resume o §1.4 do desenho do ponto de vista das tabelas e cita a fonte. A "retenção de 2 pacotes por partição" da ADR bate com o pronto mais o substituído por 1 h. Não há contradição.
- **CHECKs iguais nas 2 tabelas** (`*_modulo_formato`, `*_particao_valida`): cada tabela precisa do seu próprio CHECK, então a repetição é necessária.
- **Índice `tabela_preco_item_filial_sync_ix`** `(tenant_id, filial_id, updated_at, id)`: não duplica o `tabela_preco_item_sync_ix` `(tenant_id, updated_at, id)` (0008) nem o `tabela_preco_item_filial_ix` `(tenant_id, tabela_preco_id, filial_id)` (0056). Ele serve outra ordem de leitura.
- **Espelho Drizzle** (`db/esquema/plataforma.ts`): o JSDoc segue o mesmo tamanho do de `diagnostico`, que é a convenção do arquivo.
- **`estatico.test.ts`:** a linha `nomes[73]` e o bloco do worker são os registros únicos, e ficam.
- **Diário do banco-dados:** 2 linhas da mesma tarefa (a entrega e a renumeração). O diário é histórico, então as 2 ficam.
- **Resíduos de "0070"** em valores de teste e da fixture (`geracao_base …000070`, ids `00700000-…`, tenant `pacote70`): são valores fixos, não são texto nem regra, e não há achado.

## Recados

Este parecer foi pedido pelo gerente-projetos, que repassa os achados ao dono, como fez com os RD-0507 a 0515. Por isso não abri recado próprio ao `banco-dados`.

---

## Reteste (15/11, 38de0194)

Pedido do gerente-projetos. Li `git diff a260d823 38de0194`, que é a correção do banco-dados. Também conferi o merge do `main` (`a260d823`) no `git diff 5d744724d 38de0194`.

**Veredito: LIMPO.** Os 5 achados estão corrigidos e o merge não trouxe repetição nova. Não há achado novo, então a faixa RD-0585 a 0589 não foi usada.

| RD | Status | Evidência |
|---|---|---|
| RD-0580 | corrigido | `docs/banco/sync-pacote.md` § RLS e grants: o parágrafo "Políticas do worker" ficou só com os nomes das políticas, "as condições estão na tabela acima" e a frase da `origem`. A frase "O app não escolhe…" saiu. |
| RD-0581 | corrigido | `0074_plataforma_sync_pacote.up.sql:25`: os blocos Acesso, Índices e Caminho de volta viraram 1 linha de remissão ao dicionário e à `down.sql`. |
| RD-0582 | corrigido | `sync-pacote.md` § Fixture dois-tenants: ficou só a remissão a `fixture-dois-tenants.md` § 0074. |
| RD-0583 | corrigido | `sync_pacote_filial_ix` e `sync_pacote_pedido_filial_ix` saíram da up, dos 2 testes (lista estática e `pg_indexes`) e do dicionário. O `git grep` no 38de0194 não acha nenhuma das duas. |
| RD-0584 | corrigido | `sync-pacote.db.test.ts`: o caso "nome e posição" saiu, e os grants ficaram filtrados para o `macuxi_app`, com o comentário que remete à lista exaustiva do worker no `estatico.test.ts`. |

**Merge do main:**
- **Fixture:** a 0070 do `main` ocupou o grupo `0x67` (`assinatura`), e a 0074 passou para `0x68` (`sync_pacote`) e `0x69` (`sync_pacote_pedido`). No mapa `G` não há grupo repetido. O cabeçalho de `dois-tenants.ts:81` e `fixture-dois-tenants.md:245,248` estão iguais ao mapa, e não sobrou `0x67` ligado ao pacote.
- **`docs/banco/plataforma.md`:** a 0074 tem uma entrada só, que remete ao `sync-pacote.md`, sem repetir o dicionário.
- **`docs/banco/README.md`:** a 0074 tem uma entrada só, no padrão das outras migrações, com o resumo e a remissão.
- **Espelho Drizzle:** a 0074 entrou uma vez na lista do cabeçalho de `db/esquema/plataforma.ts`, depois da 0073 do `main`.

**Conferência do 21d619dd (15/11, `git diff 38de0194 21d619dd`): LIMPO, sem RD novo.** A lista das 5 tabelas com política do worker aparece em 2 camadas, e cada uma tem um papel diferente. A primeira é o `db/scripts/conferir-rls.sql`, que roda no stack isolado e no ensaio de restauração; o `where` dele é o filtro, a mensagem é o que o operador lê na saída, e o cabeçalho segue o padrão das outras regras do script. A segunda é o `senha-email-saida.test.ts`, que é o teste de banco do CI. As 2 camadas já existiam antes, com 3 tabelas, e o diff só acrescenta as 2 da 0074. Fica `manter`.
