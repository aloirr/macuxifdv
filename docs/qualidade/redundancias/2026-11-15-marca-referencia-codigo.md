# Lote "marca da referência pelo código" · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado).** São 7 achados, todos de gravidade baixa (RD-0590 a RD-0596). Seguram o lote porque estão em doc, em código de produção ou em código de teste, e não só em comentário ou título (R-20261111-190159). Juntos levam uns 15 minutos.

Corretor-redundancias, 15/11/2026, por volta de 9h50 (Manaus). Regra do lote: R-20261115-094000 e R-20261115-094500-alexandre. Com código e nome, a carga cria ou atualiza a marca concorrente pelo código; sem código, entra só a referência.

Heads conferidos (depois de um `git fetch` novo):
- `origin/nuvem/marca-referencia-codigo-modulo-integracao` em **b3a7d2b5**, comparado com `origin/main` 5d744724;
- `origin/nuvem/marca-referencia-codigo-modulo-catalogo` em **f1943395**, comparado com `origin/nuvem/referencia-sem-marca-modulo-catalogo` 9edb3fd9.

## 1. Os quatro pontos pedidos
| Ponto | Resultado |
|---|---|
| O código da marca não chega em dois campos | **Limpo.** `ReferenciaCruzada` (`contracts/entidades.ts`) só tem `marca_external_id` e `marca_nome`. O `marca_codigo` da referência saiu do contrato, do OpenAPI, do `referenciaValida` e do `LIMITES_REFERENCIA`. A view do kit manda `r.marca_external_id`, e o Catálogo lê só `marca_external_id`. O teste `marca-codigo.test.ts` "não tem um segundo campo" guarda a decisão. `marca_referencia_codigo_N` é só o nome da coluna do CSV e do `tha_produto`; a view o converte, e ele não chega ao Hub. O `marca_codigo` do **produto** é outro dado (a marca do próprio produto) e não conta como repetição. |
| A regra "cria a marca" mora num lugar só | **Limpo.** A decisão está só em `planejarMarcasDoErp` (`modules/catalogo/domain/marcas.ts`). O consumidor só executa o plano. O kit e o `hub-api.md` não repetem a regra. A observação de `marca_referencia_N` só diz o caso sem código. Há duas sobras dentro da função: RD-0594 e RD-0595. |
| Os testes não se repetem | **3 achados:** RD-0591, RD-0592 e RD-0596. |
| O ROTEIRO não diz a mesma coisa duas vezes | **1 achado (RD-0590):** o verbo "levam" aparece duas vezes na mesma frase. O fato não se repete: "código da marca no ERP" aparece duas vezes, mas cada vez fala de uma marca diferente. |

## 2. Achados
| ID | Onde | Tipo | O que se repete | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|
| RD-0590 | `modules/integracao/kit-thathyany/ROTEIRO.md:35` | doc | Na mesma frase: "`referencia_1` a `referencia_3` **levam** até 3 códigos da concorrência e, de cada um, **levam** o código da marca no ERP (…) e o nome da marca (…), os dois opcionais." | baixa | → "`referencia_1` a `referencia_3` levam até 3 códigos da concorrência; de cada um, o código da marca no ERP (`marca_referencia_codigo_1` a `_3`) e o nome (`marca_referencia_1` a `_3`), os dois opcionais." | modulo-integracao |
| RD-0591 | `modules/integracao/contracts/marca-codigo.test.ts:22-26` | teste | O 1º `it` do novo `describe` repete dois testes que já existem. `ref({ codigo: 'N-1' }).success` é o mesmo de `domain/catalogo-produto.test.ts:17`. A referência com `marca_external_id: '980'` e `marca_nome` passando no `ProdutoPayload` é o que `kit-thathyany.test.ts:308` ("o que o kit gera cabe no contrato do Hub") já prova, com o mesmo formato. | baixa | → apagar o 1º `it` e manter só o "não tem um segundo campo marca_codigo". | modulo-integracao |
| RD-0592 | `modules/integracao/kit-thathyany/kit-thathyany.test.ts:288` | teste | `expect(view).toContain('marca_nome')` ficou contido na linha nova `toContain('r.marca_external_id, r.marca_nome, r.codigo')`, que é mais forte. | baixa | → apagar a linha 288. | modulo-integracao |
| RD-0593 | `modules/integracao/kit-thathyany/scripts/gerar.ts:105-106` | código | São dois `NUMEROS_REFERENCIA.map(...)` iguais, que só mudam o prefixo da coluna (`marca_referencia_` e `marca_referencia_codigo_`). | baixa | → `...NUMEROS_REFERENCIA.flatMap((n) => [\`marca_referencia_codigo_${n}\`, \`marca_referencia_${n}\`].map((c): RegraEntidade => ({ regra: 'requer', campos: [c, \`referencia_${n}\`], motivo: \`${c} só vale com referencia_${n} preenchida\` })))` (o `contrato.json` é gerado de novo pelo script). | modulo-integracao |
| RD-0594 | `modules/catalogo/domain/marcas.ts:103` | código | `.slice(0, 120)` repete à mão o `LIMITE_NOME_MARCA` (`marcas-cadastro.ts:14`), do mesmo módulo. O mesmo número solto já estava na linha 160. | baixa | → `.slice(0, LIMITE_NOME_MARCA)` nas linhas 103 e 160. | modulo-catalogo |
| RD-0595 | `modules/catalogo/domain/marcas.ts:100-112` (`planejarMarcasDoErp`) | código | `nomes` começa com os nomes de todas as `marcas`, mas o `marcas.find(nomeMarcaIgual)` da linha 105 já cobre esses nomes com a mesma chave. Por isso a semente nunca casa. Já o nome adotado não entra no conjunto. Assim, duas referências com o mesmo nome de uma marca sem código e com códigos diferentes geram **2 `adotar` para o mesmo `id`**. O 2º `update` não faz nada por causa do `external_id is null`, mas o plano fica repetido. | baixa | → `const nomes = new Set<string>()` (vazio). Pular quando `nomes.has(chave)`. Fazer `nomes.add(chave)` depois de **adotar ou criar**. Assim cada nome sai uma vez só no plano. | modulo-catalogo |
| RD-0596 | `modules/catalogo/domain/marcas.test.ts:171, 184, 190-194` | teste | Três asserções do novo `describe` repetem o `describe('resolverReferenciasDoErp')`. A l.171 (resolve pelo `external_id`) repete "resolve pelo external_id e pelo nome". A l.184 (`[{ codigo: 'A1' }]` sem marca) repete "referência sem marca entra só com o código". O `it` das l.190-194 (marca inativa pelo `external_id`, `marca_inativa`) repete "marca informada desconhecida ou inativa" (`marca_external_id: 'VE'`). | baixa | → apagar as l.171 e 184 e o `it` das l.190-194. O `describe` novo fica só com os testes de `planejarMarcasDoErp`. A ligação à marca criada já tem prova no `consumidores-erp.db.test.ts` (RN-CAT-13). | modulo-catalogo |

## 3. Conferido e sem achado
- **Consumidor** (`consumidores-erp.ts`): `linhas` é montado uma vez só e usado nas três funções, o que tirou o `entrada.map` repetido. O `lerMarcas` só roda de novo quando o plano muda alguma coisa.
- **Teste de banco novo** (RN-CAT-13): ele prova o SQL do insert e a idempotência, coisa que o teste de domínio não cobre. A referência `SEM 2` não repete o teste das linhas 287 e seguintes, porque lá o `SEM 9` é descartado como 4º e não prova "sem marca".
- **Teste Python** `test_marca_referencia_codigo_e_opcional...`: ele cobre outra coluna e outro limite (200, `EXTERNAL_ID_MAX`), por isso não repete o teste do `marca_codigo` do produto.
- **`contrato.json`, `criar-banco.sql` e `produto.csv`**: todos saem do `gerar.ts`, e não há texto escrito à mão duas vezes.
- **`hub-api.md`**: a frase cita `marca_external_id` uma vez e explica que ele é o código da marca no ERP. Não há um segundo nome para o mesmo campo.

## 4. Reteste (15/11/2026, Manaus)
**Veredito: LIMPO (liberado).** Os 7 achados estão corrigidos e não há achado novo. Os números RD-0597 a RD-0599 não foram usados.

Conferi depois de um `git fetch` novo. Na integração, `git diff b3a7d2b5 b5f3f16c` (head **b5f3f16c**). No catálogo, `git diff f1943395 f770c041` (head **f770c041**).

| ID | Evidência | Status |
|---|---|---|
| RD-0590 | `ROTEIRO.md:35`: "…levam até 3 códigos da concorrência; de cada um, o código da marca no ERP (…) e o nome (…), os dois opcionais." O verbo aparece uma vez só, e o texto é o da proposta. | corrigido |
| RD-0591 | `contracts/marca-codigo.test.ts`: o 1º `it` saiu e ficou só "não tem um segundo campo marca_codigo". O helper `ref` continua em uso. | corrigido |
| RD-0592 | `kit-thathyany.test.ts`: o `toContain('marca_nome')` saiu, e a asserção `r.marca_external_id, r.marca_nome, r.codigo` ficou. | corrigido |
| RD-0593 | `gerar.ts:105-107`: virou um `flatMap` só. O `contrato.json` foi gerado de novo e mudou só a ordem, que agora agrupa por número; continuam as 6 regras "requer", sem nenhuma repetida. | corrigido |
| RD-0594 | `marcas.ts`: `LIMITE_NOME_MARCA` nas duas funções (antes linhas 103 e 160). Não sobrou nenhum `120` solto. | corrigido |
| RD-0595 | `planejarMarcasDoErp`: `nomes` começa vazio e recebe o nome depois de adotar ou criar. O caminho ficou num `if` só. O teste novo "nome de marca sem código que aparece de novo com outro código é adotado uma vez só" (`marcas.test.ts`) prova o fim do `adotar` repetido e não repete o teste de "cria uma marca só", que trata do `criar`. | corrigido |
| RD-0596 | `marcas.test.ts`: saíram as asserções das linhas 171 e 184 e o `it` da marca inativa. O `describe` novo fica só com os testes de `planejarMarcasDoErp`. | corrigido |

Observação sem RD (não é repetição e não segura): o título do teste da view (`kit-thathyany.test.ts:285`) ainda diz `{marca_nome, codigo}`, mas o JSON agora leva também `marca_external_id`. O modulo-integracao pode acertar o título no lote seguinte.
