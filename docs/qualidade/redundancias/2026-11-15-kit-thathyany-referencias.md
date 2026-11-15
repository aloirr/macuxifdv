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
