# Parecer do corretor-redundancias: consulta só leitura na produção (ADR 0055)

- **Data**: 15/11/2026, por volta das 12h (Manaus)
- **Escopo** (comparado com `origin/main` 40f91c1e):
  - `origin/nuvem/consulta-producao-banco-dados` (f3c62620 + ccc0da95): migração 0078 (`macuxi_leitura`, SELECT por coluna,
    `core.v_leitura_usuario_senha`), `db/scripts/conferir-rls.sql`, `db/src/papeis.ts`, `db/src/config.ts`,
    `db/testes/papel-leitura.db.test.ts`, `docs/banco/rls.md`.
  - `origin/nuvem/consulta-producao-engenheiro-software` (aa15c16a, 6bf3e35a, 2d3c827c): `producao-consulta.yml`,
    `scripts/producao/consulta.mjs` e catálogo `consultas/*.sql`, `banco-dbaas.sh`, compose, `preparar-vm.sh`, ADR 0055,
    `scripts/ci/producao-consulta.test.mjs`.
- **Resultado**: **COM ACHADO**. RD-0526 (média) e RD-0527 a RD-0530 (baixa). Todos seguram o lote: estão em código de
  produção, script de deploy ou doc, e não só em comentário ou título de teste.

## 1. A lista de colunas sensíveis: fonte única ou cópia necessária?

| Cópia | Onde | Precisa existir? | Quem garante que não diverge |
|---|---|---|---|
| Fonte | `db/src/papeis.ts:255` `COLUNA_SENSIVEL_LEITURA` | sim, é a fonte única | — |
| SQL 3× | `0078_plataforma_papel_leitura.up.sql:99`, `:102`, `:154` | **sim**: a migração é SQL puro e não muda depois de aplicada, então não importa constante | `papel-leitura.db.test.ts:55` (conta as 3 ocorrências com o texto da constante) |
| SQL 1× | `db/scripts/conferir-rls.sql:128` (filtro) | **sim**: roda pelo `psql` puro, a partir da imagem da API, no `banco-dbaas.sh` | `papel-leitura.db.test.ts:56` |
| SQL texto | `conferir-rls.sql:124` (mensagem) | **não**: é uma cópia em texto e já diverge (falta `cifrad`) | ninguém → **RD-0527** |
| JS | `scripts/producao/consulta.mjs:67` `RE_SENSIVEL` | **sim, como camada própria**: `scripts/` roda com o Node puro, sem TS e sem dependência, e recusa o catálogo antes de chegar ao banco | **ninguém**, e a forma já é outra → **RD-0526** |

Conclusão: no lado SQL, as cópias são necessárias e o teste do banco-dados já compara cada uma com a constante. O que falta
é ligar a cópia JS à mesma fonte.

## 2. Achados

| ID | Onde | Tipo | O que se repete | Impacto | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0526 | `scripts/producao/consulta.mjs:67` | código | A regra da coluna sensível tem uma 2ª implementação, em JS, com outra forma: `/hash\|token\|segredo\|chave\|carga\|cifrad\|(?:^\|_)senha(?:_\|$)/i`. Em SQL, `senha` vale em qualquer posição e o boolean fica de fora pelo tipo. Em JS, `senha` só vale como pedaço entre `_`, e a exceção é por nome (`SENSIVEIS_PERMITIDAS = tem_senha`). Nenhum teste compara as duas. | manutenção: um termo novo na 0079+ (ou em `papeis.ts`) não chega ao verificador, e o catálogo só falha na hora, em produção, com 42501 | média | (a) `const TERMOS_SENSIVEIS = ['hash','token','senha','segredo','chave','carga','cifrad']` exportado e `RE_SENSIVEL = new RegExp(TERMOS_SENSIVEIS.join('\|'), 'i')`, com `senha` em qualquer posição, como no SQL, e `SENSIVEIS_PERMITIDAS` no lugar do teste de tipo. (b) Um teste em `scripts/ci/producao-consulta.test.mjs` lê `db/src/papeis.ts`, extrai o literal de `COLUNA_SENSIVEL_LEITURA` (`/COLUNA_SENSIVEL_LEITURA = '\((.+)\)'/`) e exige `split('\|')` igual a `TERMOS_SENSIVEIS`. Assim a lista do banco-dados vira a fonte e o script segue sem importar TS. | engenheiro-software |
| RD-0527 | `db/scripts/conferir-rls.sql:124` | código | A mensagem `' (0078: hash, token, senha, segredo, chave, carga)'` é a 6ª cópia da lista em texto e **já divergiu** (falta `cifrad`). O filtro da linha 128 é o que vale. | leitura: a mensagem diz uma regra que não é a aplicada | baixa | `' (0078: hash, token, senha, segredo, chave, carga)'` → `' (0078)'` | banco-dados |
| RD-0528 | `scripts/producao/consulta.mjs:61` | código | `'senha_hash'` e `'senha_temporaria_hash'` estão em `PESSOAIS_SQL`, mas nunca são alcançados: em `usosPessoaisIndevidos`, a verificação de `RE_SENSIVEL` (`:160`) pega os dois antes e faz `continue`, antes do `PESSOAIS_SQL.has` (`:164`). | manutenção: 2 entradas mortas e a impressão de que a senha passaria como flag | baixa | tirar as duas de `PESSOAIS_SQL`. `'senha'`, `'hash'`, `'token'` e `'segredo'` ficam em `PESSOAIS`, porque `colunaPessoal` ainda usa essa lista na saída. | engenheiro-software |
| RD-0529 | `scripts/deploy/producao/banco-dbaas.sh:153-164` | código · rotina | (1) A coluna `exists (select 1 from pg_auth_members ...)` repete o que o `conferir-rls.sql` já devolve como `(papel) macuxi_leitura · membro de ...`. (2) O bloco `problemas_leitura` (`grep -F 'macuxi_leitura'` em `$problemas`) mostra de novo linhas que o `if [ -n "$problemas" ]` logo abaixo já imprime e com que já para; cada linha já cita o `macuxi_leitura`, então o papel com problema já aparece no erro. | manutenção: 2 caminhos de erro para a mesma linha | baixa | ficar só com a consulta de `pg_roles`: existência e `rolsuper`/`rolbypassrls`, que o `conferir-rls.sql` não confere, mais o `rolcanlogin` do log. Tirar a coluna de filiação e o bloco `problemas_leitura` (`:160-164`). O `case` vira `f\|f\|*)`. | engenheiro-software |
| RD-0530 | `docs/decisoes/0055-consulta-so-leitura-na-producao.md:29` e `:33`; `.github/workflows/producao-consulta.yml:9-12` | doc | A lista "hash, token, senha, segredo, chave, carga, cifrad" aparece 2× na própria ADR (itens 3 e 4), e o cabeçalho do workflow faz uma 3ª cópia, junto com o que o papel faz. A fonte da regra é `docs/banco/rls.md` (papéis), da migração 0078. | leitura: 3 textos para manter iguais | baixa | ADR, item 3: "coluna sensível (hash, token, senha, segredo, chave, carga, cifrad) recusada em qualquer uso" → "coluna sensível (a do item 4) recusada em qualquer uso". Workflow, `:9-12`: "papel macuxi_leitura (só SELECT, sem BYPASSRLS, sem as colunas sensíveis — hash, … —; senha do leitura.env gerada NA VM, sem secret novo)" → "papel macuxi_leitura (só SELECT, sem coluna sensível; ADR 0055), senha do leitura.env gerada na VM". | engenheiro-software |

## 3. Olhado e sem achado (`manter`)

- **Timeouts e só leitura em 3 camadas**: o papel (`AJUSTES_LEITURA`/0078), o `PGOPTIONS` do `pgleitura` e o `set local` do
  `montarScript`. É a defesa em camadas da ADR 0055, item 4: cada camada vale mesmo se outra for trocada. É redundância útil.
- **`AJUSTES_LEITURA`** em `papeis.ts` e na 0078: são necessários (migração em SQL puro), e o teste
  `papel-leitura.db.test.ts:48` já compara.
- **Predicado "tabela de tenant com RLS"** no laço e na conferência final da 0078 e no `conferir-rls.sql`: segue o padrão
  da 0031/0038 (a migração se confere e o deploy confere de novo, com a imagem).
- **`options` do `workflow_dispatch`** igual aos nomes do catálogo: o GitHub exige a lista fixa, e
  `producao-consulta.test.mjs:43` compara.
- **"Regra para tabela nova"** no cabeçalho da 0078 e no `rls.md`: segue o padrão da 0031 (`:24`) e da 0038 (`:26`).
- **Testes**: não há caso repetido entre `papel-leitura.db.test.ts` (banco) e `producao-consulta.test.mjs` (verificador e
  workflow). As camadas são diferentes.
- **Catálogo `consultas/*.sql`**: os blocos repetem joins (`core.carteira`, a view da senha), mas cada bloco é um comando
  isolado de propósito (um bloco, um comando; sem função com schema). Não há o que fatorar.

## 4. Recados

Não gravados: a CLI deu 403 na escrita (GraphQL bloqueado na sessão). O texto foi entregue ao gerente-projetos para reenvio.

- engenheiro-software: RD-0526, 0528, 0529 e 0530 (cc gerente-projetos).
- banco-dados: RD-0527 (cc gerente-projetos).

## 5. Reteste (15/11/2026, ~12h30, Manaus)

Branches: `origin/nuvem/consulta-producao-banco-dados` 0cf0b3a2 e `origin/nuvem/consulta-producao-engenheiro-software` 1384dbb3.
**Resultado: LIMPO.** Os 5 achados estão fechados e não apareceu redundância nova.

| ID | Evidência | Status |
|---|---|---|
| RD-0526 | `consulta.mjs`: `export const TERMOS_SENSIVEIS = [...]` e `RE_SENSIVEL = new RegExp(TERMOS_SENSIVEIS.join('\|'), 'i')`, com `senha` em qualquer posição, como no SQL. O teste `producao-consulta.test.mjs:130` compara a lista com `COLUNA_SENSIVEL_LEITURA` (`db/src/papeis.ts`). `node --test` só no branch do engenheiro: 22 ok, 1 pulado. Com o `papeis.ts` e a 0078 do branch do banco no checkout: 23 ok, 0 pulado. `consulta.mjs verificar`: catálogo ok. | corrigido |
| RD-0527 | `conferir-rls.sql:124` → `' (0078)'`. A expectativa no `papel-leitura.db.test.ts` acompanhou a mudança. | corrigido |
| RD-0528 | `PESSOAIS_SQL` sem `senha_hash` e sem `senha_temporaria_hash`. | corrigido |
| RD-0529 | `banco-dbaas.sh:150-157`: só existência e `rolsuper`/`rolbypassrls`. Sem a filiação e sem o bloco `problemas_leitura`. O cabeçalho (`:21-22`) e a ADR 0055, item 4, acompanharam a mudança. | corrigido |
| RD-0530 | ADR 0055, item 3 → "coluna sensível (a do item 4)". O cabeçalho do workflow → "sem coluna sensível; ADR 0055". A lista ficou num lugar só da ADR (`:33`). | corrigido |

**O teste pulado (RD-0526) é aceitável.** O pulo só acontece quando nem a constante nem a 0078 estão no checkout, ou seja, no
branch do engenheiro antes do merge do banco. Depois desse merge, a migração fica para sempre no `main`, então o pulo não
volta: se a constante sumir, o teste lê o regex da 0078, e se faltarem as duas, o teste falha. O fallback para a 0078 não é
redundância: é o que mantém o teste útil se a constante mudar de nome. Condição: o merge do banco-dados entra no mesmo
lote. Se o PR do engenheiro entrar antes, o `main` fica com o teste pulado até o merge do banco.

Observação sem RD: o título do teste `producao-consulta.test.mjs:118` ainda lista os 7 termos. É só título de teste, de
gravidade baixa, e não segura o lote (R-20261111-190159). Também não precisa de correção: o título descreve o caso testado.
