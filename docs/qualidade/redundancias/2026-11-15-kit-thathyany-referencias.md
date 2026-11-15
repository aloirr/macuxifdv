# Kit da thathyany 1.0.5 · referência cruzada do produto · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 3 achados de gravidade baixa, do RD-0489 ao RD-0491, todos do **modulo-integracao**. Os 3 estão em código de produção ou em doc entregue ao cliente, então **seguram** o lote.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o branch `nuvem/referencia-cruzada-modulo-integracao`, `git diff 58b62e12..f4af0b16`: 0151c61 e f4af0b1, que só tira um `__pycache__`. O kit 58b62e12 já tinha sido liberado. Arquivos conferidos:
- `scripts/gerar.ts` e os gerados (`contrato.json`, `modelos/produto.csv`, `sql/criar-banco.sql`);
- `ROTEIRO.md` e `scripts/gerar-zip.mjs`;
- `kit-thathyany.test.ts` e `testes/test_carga_csv.py`;
- como referência do Hub, `modules/integracao/contracts/entidades.ts` (`LIMITES_REFERENCIA`, `LIMITES_CATALOGO_PRODUTO`).

## 1. O que foi pedido
| Ponto | Resultado |
|---|---|
| Regra repetida entre o `gerar.ts` e os gerados | Os gerados são cópias feitas por máquina a partir de uma fonte, e isso não conta. O `contrato.json` traz o texto de `referencia_N` 3 vezes e o `criar-banco.sql` traz 6 `ALTER`, mas os 2 saem do mesmo molde no `gerar.ts`. No próprio `gerar.ts`, o limite de 3 referências está em 3 lugares (**RD-0489**), e a coluna derivada `referencias` está em 3 listas (**RD-0490**). |
| Regra repetida entre o Python e o contrato do Hub | **Sem achado.** O `carga_csv.py` não mudou: ele lê `contrato.json` (`regras_entidade` "juntos", `tamanho_max`). Os tamanhos 30 e 120 vêm de `LIMITES_REFERENCIA` do Hub, e o teste confere que o que o kit gera passa no `SCHEMA_REGISTRO.produto`. A regra "juntos" (marca obrigatória) já existe no Hub; no kit, ela antecipa o erro na carga, e a API revalida (regra 2 do CLAUDE.md). |
| Texto do ROTEIRO que repete o contrato | Repete 4 regras do contrato (**RD-0491**). |

## 2. Achados
### RD-0489 · baixa · código · modulo-integracao · segura
- **Onde:** `kit-thathyany/scripts/gerar.ts`:
  - `const REFERENCIAS_POR_PRODUTO = 3`;
  - `REGRAS_ENTIDADE.produto` com o literal `[1, 2, 3].map(…)`;
  - `SQL_REFERENCIAS`, com `referencia_1..3` escritos à mão.

  O Hub já tem esse número: `LIMITES_CATALOGO_PRODUTO.referencias` (`contracts/entidades.ts:112`), que o teste confere com `toBe(3)`.
- **O que se repete:** o máximo de referências por produto (RN-CAT-09) está em 4 lugares, 3 deles no `gerar.ts`. Se o Hub passar a aceitar 4, o `gerar.ts` gera 3 colunas e a regra "juntos" continua só para 3.
- **Proposta:** `const N_REFERENCIAS = LIMITES_CATALOGO_PRODUTO.referencias;` (import de `../../contracts`, que já é usado para `LIMITES_REFERENCIA`), e o mesmo `Array.from({ length: N_REFERENCIAS }, …)` monta as 3 coisas:
  - `CAMPOS_SO_KIT`;
  - as regras "juntos";
  - o `VALUES (…)` e o `IS NULL AND …` do `SQL_REFERENCIAS`.

  `REFERENCIAS_POR_PRODUTO` sai.

### RD-0490 · baixa · código · modulo-integracao · segura
- **Onde:** `gerar.ts`, em 3 lugares:
  - `COLUNAS_SO_CONECTOR` (ainda com `'referencias'`, `:32`);
  - `COLUNAS_DERIVADAS = { produto: ['referencias'] }` (`:46`), com o filtro `&& !derivadas.includes(col)` em `extras`;
  - `sqlView`: `if (ent.entidade === 'produto' && col === 'referencias') return SQL_REFERENCIAS;` (`:276`).
- **O que se repete:** o fato "no produto, `referencias` é montada pela view" está em 3 lugares, e um contradiz o outro. A 1ª lista diz que `referencias` é coluna só do Conector, nula, e a 2ª tira essa coluna da 1ª. O `'referencias'` em `COLUNAS_SO_CONECTOR` ficou morto: só o produto tem essa coluna no `conector.exemplo.json`. O comentário da constante ("ficam nulas = o Macuxi não altera") também deixou de valer para ela.
- **Proposta:** uma lista só, que dá a coluna e a expressão juntas:
  - `const COLUNAS_DERIVADAS: Record<string, Record<string, string>> = { produto: { referencias: SQL_REFERENCIAS } };`
  - na `sqlView`: `const derivada = COLUNAS_DERIVADAS[ent.entidade]?.[col]; if (derivada) return derivada;`
  - `'referencias'` sai de `COLUNAS_SO_CONECTOR`, e o `!derivadas.includes(col)` de `extras` sai também.

### RD-0491 · baixa · doc (entregue ao cliente) · modulo-integracao · segura
- **Onde:** `kit-thathyany/ROTEIRO.md`, Fase 1, passo 4, o parágrafo novo de `produto.csv`.
- **O que se repete:** o parágrafo copia 4 regras que o `carga_csv.py --validar` já aplica e explica com o motivo, vindo do `contrato.json`:
  - "até 30 caracteres";
  - "Preencha o código e a marca juntos, ou deixe os dois vazios";
  - o nome do aviso `marca_concorrente_desconhecida`;
  - "Com as três vazias, o Macuxi mantém…".

  O número 30 escrito à mão no ROTEIRO não acompanha o `LIMITES_REFERENCIA` se ele mudar. Quem roda o kit usa só 2 coisas para agir, porque o resto o validador ou o Monitor avisam na hora: a marca precisa estar cadastrada, e com as 3 colunas vazias nada é apagado.
- **Proposta (texto final):** "No `produto.csv`, `referencia_1` a `referencia_3` levam até 3 códigos da concorrência, e `marca_referencia_1` a `marca_referencia_3` levam a marca de cada um, já cadastrada em Marcas do Catálogo. Com as três vazias, o Macuxi mantém as referências do cadastro (para tirar uma, use o Backoffice)."

## 3. Conferido sem achado
- **`ALTER` idempotente:** é gerado pelo `sqlTabela` a partir de `so_kit`. Ele não repete o `CREATE`: o `CREATE` serve ao banco novo, e o `ALTER` serve ao banco criado pela 1.0.4.
- **Testes:** o TS confere o modelo, a view, o `ALTER` e o contrato do Hub. O Python confere a validação linha a linha. As camadas são diferentes, e nenhum caso se repete.
- **`VERSAO_KIT` e o nome do zip:** os 2 passaram para 1.0.5. O zip só aparece no ROTEIRO, que é o texto que o cliente lê.

## 4. Reteste (15/11/2026, commits 130de72 e 569f176 do modulo-integracao)
**Veredito: COM ACHADO.**
- **2 corrigidos:** RD-0489 e RD-0491.
- **1 reaberto, com sobra pequena em código:** RD-0490. **Segura** o lote.
- **1 achado novo, só em comentário e em comentário de teste:** RD-0503, de gravidade baixa. **Não segura** (R-20261111-190159).

Conferi `git diff f4af0b16..569f176b`:
- `gerar.ts` e os gerados;
- `carga_csv.py`, com a regra nova `requer` ("marca sem código é recusada");
- `ROTEIRO.md`;
- `contracts/entidades.ts` e `domain/catalogo-produto.ts`, com a marca opcional, decisão do dono do produto de 15/11;
- os testes TS e Python.

| RD | Situação | Evidência |
|---|---|---|
| RD-0489 | **corrigido** | O `N_REFERENCIAS` vem de `LIMITES_CATALOGO_PRODUTO.referencias`, e `NUMEROS_REFERENCIA` monta os campos, as regras e o `SQL_REFERENCIAS` (`gerar.ts:41-50`). `REFERENCIAS_POR_PRODUTO` e o `[1, 2, 3]` saíram. |
| RD-0490 | **reaberto** (sobra) | `'referencias'` saiu de `COLUNAS_SO_CONECTOR`. O `COLUNAS_DERIVADAS` virou o mapa coluna → expressão, e a `sqlView` lê o mapa, sem o `if`. **Sobra:** `gerar.ts:237`, `extras = … .filter((col) => COLUNAS_SO_CONECTOR.includes(col) && !derivadas.includes(col))`. Como as 2 listas não têm mais coluna em comum, o `&& !derivadas.includes(col)` não muda nada, e só repete na `extras` a exclusão que a `faltando` (`:238`) já faz. **Proposta:** `const extras = colunasDoConector(exemplo, e).filter((col) => COLUNAS_SO_CONECTOR.includes(col));` |
| RD-0491 | **corrigido** | O ROTEIRO tem o texto proposto, ajustado à marca opcional: "…levam a marca de cada um (opcional), já cadastrada em Marcas do Catálogo. Com as três vazias, o Macuxi mantém as referências do cadastro (para tirar uma, use o Backoffice)." O limite de 30, o "juntos" e o nome do aviso não aparecem mais. |

### Mudanças novas (130de72 e a regra `requer`)
- **Hub:** `referenciaValida` deixou de exigir a marca, e o aviso `referencia_descartada` deixou de falar em "sem marca". O comentário de `ReferenciaCruzada` diz o mesmo. Não vi texto velho no Hub.
- **`carga_csv.py`:** a regra `requer` é genérica e lê o `contrato.json`, como a `juntos`. O motivo ("marca_referencia_N só vale com referencia_N preenchida") e a observação do campo ("opcional, só com referencia_N") cumprem 2 papéis: o motivo é a mensagem do erro, e a observação é o dicionário. Não é repetição.
- **Observação sem RD:** a marca sem código é recusada pelo kit (a linha volta no relatório), e o Hub descarta a referência sem código com um aviso, carregando o produto. É uma escolha de comportamento entre as 2 camadas, não redundância.

### RD-0503 · baixa · comentário · modulo-integracao · não segura
- **Onde:**
  - `gerar.ts:33-36`: o JSDoc de `CAMPOS_SO_KIT` ainda diz "(RN-CAT-09: até 3 por produto, **marca obrigatória**)" e ficou separado da constante por outro JSDoc (`:37`);
  - `gerar.ts:89`: a documentação de `RegraEntidade.regra` descreve `juntos` e `data_nao_anterior`, mas não `requer`;
  - `testes/test_carga_csv.py:238`: o comentário diz "toda referência leva a marca (o Hub descartaria sem ela)".
- **O que se repete:** os 3 comentários repetem a regra antiga, que contradiz o código ao lado (marca opcional e `requer`). O "até 3" também repete o número que o `N_REFERENCIAS` acabou de centralizar.
- **Proposta:**
  - `:33-36`: "Colunas que o kit acrescenta ao CSV e a `tha_<entidade>` e que não são campos do Hub: a view monta o campo do Hub a partir delas (produto: `referencia_N` e `marca_referencia_N` → `referencias`; RN-CAT-09)." Esse bloco fica junto do `CAMPOS_SO_KIT`.
  - `:89`: acrescentar "`requer`: o 1º campo só vale com o 2º preenchido".
  - `test_carga_csv.py:238`: "RN-CAT-09: até N referências por produto; a marca é opcional".
