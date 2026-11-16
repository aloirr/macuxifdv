# Testes antes do push (comando único, Postgres local sem Docker)

Origem: R-20261115-213600-alexandre e doc 07, seção 3.

Dono do comando: `testes`. Dono do Postgres local (`db/scripts/pg-local.sh`): `banco-dados`.

## Como usar

Da raiz do repositório, depois do `git commit --amend` e antes do push:

```bash
bash tests/scripts/rodar-antes-do-push.sh
```

O comando:

1. sobe o Postgres local (`bash db/scripts/pg-local.sh`: 5432 com superusuário e 5433 limpo, postgres/postgres,
   pgvector) e carrega o env do CI (`MACUXI_PG_*` e o Node 24 de `/opt/node24` no PATH: os testes exigem Node >= 24.7);
2. descobre os pacotes afetados contra o merge-base com `origin/main` pelo próprio `scripts/ci/escopo.mjs` (modo
   `workflow_dispatch`). Só conta o que está commitado: rode depois do amend;
3. `pnpm exec turbo run test --continue <filtro>` nos pacotes afetados (todos, se mudou arquivo fora de pacote, como
   lockfile, `turbo.json` ou `scripts/`);
4. se o `@macuxi/db` foi afetado, repete o passo do CI com o admin **sem superusuário** na 5433 (variáveis e passos:
   `docs/banco/README.md`, seção "Testes de banco na sessão da nuvem");
5. `pnpm test:tests` inteiro, sempre que há código (como o CI). Se só `docs/**`, `.coord/**` ou `*.md` da raiz mudaram,
   não roda nada (escopo `documentacao`);
6. imprime o bloco Markdown "Testes na sessão (antes do push)" entre as linhas `----- cole no corpo do PR -----`.

Código de saída: 0 = tudo verde; 1 = alguma etapa vermelha; 2 = erro de preparação (sem `pg-local.sh`, Node < 24.7, sem
`node_modules`, Postgres fora do ar, opção inválida).

### Opções

| Opção | Para quê |
|---|---|
| (nenhuma) | afetados contra `origin/main`: é o que vai no PR |
| `--tudo` | todos os pacotes, o passo sem superusuário e `tests/` (o que o push ao `main` roda) |
| `--pacote <nome>` (repetível) | só esses pacotes (`@macuxi/db`, `api`...), mais `tests/`; com `@macuxi/db`, também o passo sem superusuário |
| `--so-tests` | só `pnpm test:tests` |
| `--arquivo <caminho>` (repetível) | só esses arquivos de `tests/` (ex.: `tests/integracao/banco/conformidade.test.ts`) |
| `--sem-tests` | não roda `tests/` |
| `--pg-local-de <ref>` | executa o `db/scripts/pg-local.sh` de um ref do git, sem gravar arquivo em `db/`; serve só enquanto o script do banco-dados não está no `main` (ex.: `--pg-local-de origin/nuvem/pg-local-banco-dados`) |
| `--saida <arquivo>` | grava também o bloco Markdown nesse arquivo |

Com `--pacote`, `--so-tests`, `--arquivo` ou `--sem-tests`, o bloco diz **PARCIAL**: serve para investigar, não para o PR.
Os logs completos de cada etapa ficam numa pasta temporária, impressa no fim; `MACUXI_ANTES_DO_PUSH_LOGS=<pasta>` fixa a pasta.

Sem o `db/scripts/pg-local.sh` no branch, o comando para com código 2 e manda esperar o PR do banco-dados ou usar
`--pg-local-de`.

## O que colar no PR

Tudo o que fica entre as duas linhas `-----`. Exemplo real (prova de 15/11/2026, ~22h Manaus; com `--so-tests`, por isso
PARCIAL):

```markdown
### Testes na sessão (antes do push)

- **Status geral:** VERDE — PARCIAL: só tests/ (--so-tests)
- **HEAD:** `6787e4494dd9dd33eb1b059ffe33bafe96c6c882` (com mudanças não commitadas: rode de novo depois do commit)
- **Base:** `origin/main` (merge-base `077bb32e7ffe71061ad59a7c0ff76ce87c5e5400`), 2 arquivo(s) alterado(s), escopo `codigo`, modo `so-tests`
- **Ambiente:** Node v24.22.3, PostgreSQL 16.15 local sem Docker (5432 superusuário, 5433 sem superusuário)
- **Comando:** `bash tests/scripts/rodar-antes-do-push.sh --pg-local-de origin/nuvem/pg-local-banco-dados --so-tests`
- **Tempo total:** 4min49s

| Etapa | Comando | Tempo | Passados | Falhos | Pulados | Resultado |
|---|---|---|---|---|---|---|
| tests/ | `pnpm test:tests` | 4min49s | 2027 | 0 | 24 | verde |
```

Regras do bloco:

- **HEAD** tem de ser o SHA do commit que vai no push. Se aparecer "com mudanças não commitadas", rode de novo depois do
  amend.
- **Pulados** soma `skipped` e `todo` do vitest. A contagem vem das linhas `Tests ...` de cada pacote.
- Etapa vermelha: o PR não sobe. Corrija, ou, se a falha é de outro dono, mande recado a ele com o log e cite a falha no PR.

## Tempos medidos (sessão da nuvem, 15/11/2026, ~21h50–22h05 Manaus)

| Execução | Etapa | Tempo | Passados | Falhos | Pulados | Resultado |
|---|---|---|---|---|---|---|
| `--arquivo tests/integracao/banco/conformidade.test.ts` | tests/ (1 arquivo) | 5s | 38 | 0 | 0 | verde |
| `--pacote @macuxi/db --sem-tests` | `turbo run test --filter=@macuxi/db` | 1min41s | 1909 | 0 | 1 | verde |
| | admin sem superusuário (5433) | 1s | — | — | — | verde |
| | `@macuxi/db` sem superusuário | 1min32s | 1895 | 1 | 14 | vermelho (intermitente, abaixo) |
| | total | 3min15s | | | | |
| `--so-tests` | `pnpm test:tests` inteiro | 4min49s | 2027 | 0 | 24 | verde |

Estimativa do padrão com o `@macuxi/db` afetado: cerca de 8 min (3min15s + 4min49s), mais os outros pacotes afetados.

**Intermitência conhecida** (dono: `banco-dados`): no modo sem superusuário, `db/testes/usuario-filial.db.test.ts` ›
"apagar a venda que é o cadastro = 23514 ..." recebeu `40P01` (deadlock) no lugar de `23514` (linha 273) com a suíte
inteira em paralelo. Isolado, com o mesmo env, o arquivo passou 3 de 3 vezes (16/16). Se acontecer, rode o arquivo
isolado para confirmar e cite no PR.
