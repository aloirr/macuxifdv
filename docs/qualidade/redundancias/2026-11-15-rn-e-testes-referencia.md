# Parecer — RN-CAT-09 / RN-CORE-39 (doc 03) e testes de integração da referência sem marca — 15/11/2026

Corretor de redundâncias. Base: `origin/main` 40f91c1e2. Comparação de cada branch com `origin/main`.

| Item | Branch | SHA | Resultado |
|---|---|---|---|
| 1 | `nuvem/rn-filial-marca-gerente-projetos` | 52a9545b | **COM ACHADO** — RD-0551 a RD-0556 (seguram: texto de regra no doc 03) |
| 2 | `nuvem/referencia-sem-marca-testes` | c230cfa2 | **COM ACHADO** — RD-0557 e RD-0558 (seguram: asserção e código de teste, fora da exceção de comentário/título) |
| 2 | `nuvem/referencia-sem-marca-testes-depois` | 48ee98e5 | **COM ACHADO** — RD-0559 (só comentário, baixa: **não segura**, lote seguinte); herda RD-0557 e RD-0558 |

Fonte comparada: `docs/modulos/catalogo/regras.md` e os testes do domain (`modules/catalogo/domain/exportacao.test.ts`, `marcas.test.ts`) no branch `origin/nuvem/referencia-sem-marca-modulo-catalogo` (9edb3fd9).

## 1. Doc 03 — RN-CAT-09 e RN-CORE-39

`regras.md` §"Aplicação, busca pela aplicação e referência cruzada" traz o complemento técnico (`marca_id` nulo, `codigoCompacto`, 422, aviso `catalogo.referencia.marca_desconhecida@1`); não repete a RN no que importa. O doc 03 é a fonte da regra. As repetições estão **dentro do próprio doc 03**.

| ID | Onde | Tipo | O que se repete | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|
| RD-0551 | doc 03, RN-CAT-09 | doc | "marca opcional" 2× no mesmo parágrafo: "e, **opcionalmente**, a marca concorrente" e "**Marca opcional** (Alexandre, R-20261115-073000): basta o código, no BKO, no Hub, no kit e no Conector". "no BKO, no Hub, no kit e no Conector" repete a frase "O analista preenche no BKO; o ERP também pode mandar" | média | Tirar a frase "**Marca opcional** (Alexandre, R-20261115-073000): basta o código, no BKO, no Hub, no kit e no Conector." e pôr o R- na citação final: "*(Decisão do Alexandre, R-20261105-112117, R-20261105-191229 e R-20261115-073000; T-0085.)*" | gerente-projetos |
| RD-0552 | doc 03, RN-CAT-09 | doc | Origem das marcas dita 2× no parágrafo ("escolhida do cadastro de marcas do Catálogo, RN-CAT-13, que o Promotor também usa" e "As marcas vêm do cadastro de marcas concorrentes do Catálogo (`catalogo.marca_concorrente`, RN-CAT-13), que o Promotor lê por contrato (ADR 0034, que substitui …)") e uma 3ª na RN-CAT-13. Tabela, contrato e ADR são funcionamento por trás | média | Manter só "(do cadastro de marcas do Catálogo, RN-CAT-13)" e tirar a frase "As marcas vêm do cadastro … ADR 0027)." | gerente-projetos |
| RD-0553 | doc 03, RN-CAT-09 | doc | Exibição dita em 2 lugares: "Referência sem marca aparece só com o código" e, adiante, "mostra 'Equivale a: <marca> <código>'" | baixa | Juntar na busca: "… e mostra 'Equivale a: <marca> <código>' (sem marca, só o código) com o trecho destacado", e a frase anterior fica "Referência com marca inativa ou que não existe fica escondida em todas as superfícies (ficha, cartão, busca e exportação)." | gerente-projetos |
| RD-0554 | doc 03, RN-CORE-39 › Filial do usuário | doc | Histórico no cabeçalho: "substitui a premissa antiga de que o vendedor não tinha filial própria" (a premissa já saiu da lista; texto que não serve para agir) | baixa | "**Filial do usuário** (Alexandre, R-20261115-073000 e R-20261115-080000):" | gerente-projetos |
| RD-0555 | doc 03, RN-CORE-39 × RN-VEN-01 › Catálogo sem cliente | doc | O preço do Catálogo pela filial do vendedor está nas 2 RN ("Ela é a referência dele: preço e estoque no Catálogo…" × "o Catálogo aberto pelo menu mostra o preço da filial do vendedor"), e a RN-VEN-01 guarda a cláusula que a nova regra torna sem uso: "se o vendedor tem mais de uma filial, vale a filial padrão dele" | média | RN-VEN-01: tirar "se o vendedor tem mais de uma filial, vale a **filial padrão** dele;". RN-CORE-39: "**vendedor:** exatamente **uma** filial, obrigatória; é a filial que abre marcada no filtro (preço do Catálogo: RN-VEN-01);" | gerente-projetos |
| RD-0556 | doc 03, RN-CORE-39 › Filial do usuário | doc | Obrigatoriedade 3× ("uma filial, obrigatória"; "com o campo obrigatório para o vendedor"; "vendedor sem filial fica bloqueado") e quem informa 2× ("a carga do ERP também pode trazer" × "até a carga do ERP ou o admin no BKO informar") | baixa | "**cadastro:** no BKO (Usuários) ou pela carga do ERP;" e "**vendedor sem filial fica bloqueado** até ter a filial, inclusive quem já existe; não há filial padrão provisória." | gerente-projetos |

Encaminhado ao `testes` (não catalogado): RN-CAT-13 diz "Marca em uso não se apaga: inativa-se, e o histórico e o `marca_nome` das referências continuam mostrando o nome", e a RN-CAT-09 nova diz que a referência de marca inativa fica escondida em todas as superfícies (o domain `referenciaVisivel` esconde).

## 2. Testes de integração (exportação sem `marcas`; X-1 a X-5)

Camada nova coberta, sem repetir o domain: X-1..X-5 rodam a API real × Postgres (RLS, `marca_id` nulo da 0075, mapa de marcas lido do cadastro pelo repositório); o domain (`exportacao.test.ts:36`, `marcas.test.ts:145-158`) cobre a mesma decisão em função pura. A sobreposição é a esperada entre camadas, e a separação X-1..X-3 / X-4..X-5 é necessária pelo teto de 3 por produto no banco. D-6 (demo) e E-1b estão limpos.

| ID | Onde | Tipo | O que se repete | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|
| RD-0557 | `tests/integracao/api/catalogo-aplicacao-t0084.test.ts` E-1 (`:554-556` no 48ee98e5) | teste | Laço `for (… inativa, apagada, B.ativa) expect(marcasNasRefs).not.toContain(id)`: as referências da fixture apontam todas para a marca ativa (`dois-tenants.ts:48`), então a verificação não pode falhar; a linha de cima já fixa as referências do ALFA-001, e o X-1..X-3 (arquivo novo) e o R-1d cobrem inativa e apagada com dado próprio | baixa | Tirar o comentário `// T-0113: só marcas ativas…` e as 2 linhas (`marcasNasRefs` e o `for`) | testes |
| RD-0558 | mesmo arquivo, H-2 (`:15-16`, `:233-250`) | teste | Duas expectativas para o mesmo caso: `refs1.length === 1 ? [] : [['ZZ 0001', null]]` e o mesmo ternário na ficha, mais o histórico no cabeçalho e no comentário ("descartada até a marca opcional…; as duas formas passam"). Depois do merge do Catálogo a forma "descartada" não existe mais; o título ainda diz "marca desconhecida descarta só ela" | baixa | No commit "depois": `toEqual([['ZZ 0001', null]])` e `toEqual([{ marca_id: null, marca_nome: null, codigo: 'ZZ 0001' }])`; cabeçalho "marca desconhecida entra só com o código (`marca_id` nulo)"; título "…; marca desconhecida entra só com o código; 4 referências = 3 + aviso"; tirar o comentário de histórico | testes |
| RD-0559 | `tests/integracao/api/catalogo-exportacao-marca-opcional.test.ts:6-8` | comentário | "SÓ ENTRA DEPOIS do merge … No main de 15/11/2026 a referência sem marca não grava (NOT NULL) e a de marca inativa sai com `marca_nome` nulo em vez de sumir." — instrução de lote que vira texto morto quando o arquivo entra | baixa (**não segura**: só comentário) | Tirar as 3 linhas; a ordem de merge fica na descrição do PR | testes |

Encaminhado ao `testes` (não catalogado): o título do X-4/X-5 diz que a inativa "não ocupa vaga" no teto de 3, mas com 3 linhas gravadas o teto nunca é atingido; o caso não demonstra o que o título promete.

## Resultado
Item 1 e item 2 **não liberados**: RD-0551 a RD-0558 seguram; RD-0559 vai no lote seguinte.
