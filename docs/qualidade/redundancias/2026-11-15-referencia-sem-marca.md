# Referência cruzada com marca opcional (RN-CAT-09) · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado).** São 6 achados, do RD-0510 ao RD-0515: 1 de gravidade média e 5 de gravidade baixa. Os 3 de código de produção seguram. Os 3 de código de teste também seguram, pelo precedente do RD-0233.

Corretor-redundancias, 15/11/2026, ~12h (Manaus). O pedido é do dono do produto (R-20261115-073000-alexandre, item 3: "marca opcional"). Conferi 3 branches contra o `origin/main` 4e404f33 (`git diff origin/main...`):
- `nuvem/referencia-sem-marca-modulo-catalogo` (**20c34987**): 23 arquivos em `modules/catalogo` e `docs/modulos/catalogo/regras.md`;
- `nuvem/referencia-sem-marca-modulo-vendedor` (**6deb18b0**): PDF do pedido (`pdf-pedido.ts`), `use-vendedor.ts` e `order-detail-screen.tsx`;
- `nuvem/referencia-sem-marca-banco-dados` (**e083b93e**): migração 0075 (up e down), `nuvem.ts`, `views-modelo.sql`, testes e `docs/banco`.

## 1. O que foi conferido
| Ponto | Resultado |
|---|---|
| Tela sem marca (ficha, cartão, busca, PDF e exportação) | **Sem achado de tela.** Quando não há marca, aparece só o código, sem espaço solto nem "—": "Equivale a CB 3401" (`grade.ts:69`), a ficha (`produto.tsx:180`), o PDF (`pdf-pedido.ts:364`) e a planilha (`layout.ts:82`). |
| BKO, cadastro do produto | **Sem achado.** O select ganhou a opção "Sem marca" (`catalogo-page.tsx:546`). O erro "escolha a marca" saiu, e o "Há uma marca sem código…" ficou porque segue valendo. |
| Uma regra, um lugar (unicidade do código no produto) | **Sem achado.** O domain confere (`cadastro-catalogo.ts:38`), a API revalida e o banco garante pelo `produto_referencia_produto_codigo_uk`. São 3 camadas da mesma regra, e é a revalidação exigida pelo `CLAUDE.md` (regra 2). |
| Aviso de marca desconhecida vinda do ERP | **Sem achado.** Há 1 linha no log por motivo (descartada × sem marca) e 1 aviso no Hub por lote e produto. Os 3 não se repetem. |
| Doc do banco: cabeçalho da 0075 × `docs/banco/catalogo.md` §0075 × `README.md` × JSDoc de `nuvem.ts` | `manter?`: é o padrão de todas as migrações (a 0069, por exemplo, tem 91 linhas de comentário). O `README` só resume e aponta para o `catalogo.md`. Não catalogo. Se o gerente quiser enxugar, a fonte é o `catalogo.md`. |
| Regra "referência visível" e texto "marca + código" | **RD-0510** e **RD-0511**. |
| Motivos do ERP | **RD-0512.** |
| Testes | **RD-0513** (catálogo) e **RD-0515** (banco). |
| Vendedor | **RD-0514.** |

## 2. Achados
### RD-0510 · média · código · modulo-catalogo
- **Onde:** são 4 cópias do mesmo bloco:
  - `modules/catalogo/api/consultas-texto.ts:47-49`;
  - `api/repositorio-postgres.ts:95-97`;
  - `app/lib/local.ts:194-196`;
  - `app/texto-consultas.ts:66-68`.
- **O que se repete:** a regra "a referência aparece?" escrita nos 4 lugares: `nomeMarcaDaReferencia(...)`, depois `if (nome === null && x.marca_id !== null) continue;`, depois `{ marca_id, marca_nome: nome, codigo }`. Esta entrega mudou a regra (a referência sem marca agora aparece) e teve de mudar as 4 cópias.
- **Impacto:** manutenção, e é regra de negócio fora do `domain`. Na próxima mudança, a cópia esquecida mostra no app o que a API esconde, ou o contrário.
- **Proposta:** uma função pura no `domain/marcas.ts`, ao lado de `nomeMarcaDaReferencia`, com teste citando RN-CAT-09. Os 4 lugares passam a chamar `const ref = referenciaVisivel(x, marcas); if (ref) …`.
  ```ts
  /** RN-CAT-09: referência como aparece na tela; null = esconder (marca informada inativa ou ausente). Sem marca = só o código. */
  export function referenciaVisivel(r: { marca_id: string | null; marca_nome: string | null | undefined; codigo: string }, marcas: MapaMarcas): Referencia | null {
    const nome = nomeMarcaDaReferencia(r.marca_id, r.marca_nome, marcas);
    return nome === null && r.marca_id !== null ? null : { marca_id: r.marca_id, marca_nome: nome, codigo: r.codigo };
  }
  ```

### RD-0511 · baixa · código · modulo-catalogo
- **Onde:**
  - `modules/catalogo/app/lib/apresentacao.ts:73` (`textoEquivaleA`);
  - `web/exportacao/layout.ts:82` (`m ? \`${m} ${r.codigo}\` : r.codigo`);
  - `domain/vitrine.ts:227`, onde o deslocamento `ini` depende do mesmo formato.
- **O que se repete:** o texto "marca + espaço + código, ou só o código" aparece em 2 implementações, e uma 3ª conta a posição do código supondo esse formato.
- **Impacto:** manutenção. Se o formato mudar num lugar, a marcação do código na busca sai deslocada.
- **Proposta:** `export function textoDaReferencia(marca: string | null | undefined, codigo: string): string` no `domain` (`marca?.trim() ? \`${marca.trim()} ${codigo}\` : codigo`).
  - `textoEquivaleA` passa a ser `textoDaReferencia(e.marca_nome, e.codigo)`.
  - O `layout.ts:82` passa a ser `textoDaReferencia(m, r.codigo)`.
  - Em `vitrine.ts`: `const ini = textoDaReferencia(ref.marca_nome, ref.codigo).length - ref.codigo.length;`.
  - A ficha (`produto.tsx:180`) segue com o JSX, porque põe o código em negrito.

### RD-0512 · baixa · código · modulo-catalogo
- **Onde:** `modules/catalogo/domain/marcas.ts:43` (`MotivoDescarte`), `:49` (`semMarca: { motivo: MotivoDescarte }[]`) e `:115` (parâmetro `descartadas` de `marcasDesconhecidasDaLinha`, que agora recebe o `semMarca`).
- **O que se repete:** `'marca_desconhecida' | 'marca_inativa'` continuam no tipo dos descartes, mas nenhum descarte usa esses valores (`:69-71` só põe `codigo_invalido`, `repetida` e `excede_limite`). Os 2 só aparecem no `semMarca`. Fica um tipo com 2 membros mortos, e o parâmetro chamado `descartadas` recebe referências que não foram descartadas.
- **Impacto:** leitura do código: quem lê o tipo acha que a referência com marca desconhecida é descartada, e ela não é mais.
- **Proposta:**
  - antes → `type MotivoDescarte = 'marca_desconhecida' | 'marca_inativa' | 'codigo_invalido' | 'repetida' | 'excede_limite'`;
  - depois → `type MotivoDescarte = 'codigo_invalido' | 'repetida' | 'excede_limite'` e `type MotivoSemMarca = 'marca_desconhecida' | 'marca_inativa'`;
  - o `semMarca` passa a ser `{ codigo: string; motivo: MotivoSemMarca }[]`;
  - o parâmetro em `:115` passa a se chamar `semMarca`.

### RD-0513 · baixa · teste · modulo-catalogo
- **Onde:** `modules/catalogo/domain/cadastro-catalogo.test.ts:44-48` ("código "CB 3401" e "cb-3401" é repetição", com a mesma marca M1).
- **O que se repete:** agora a chave é só o código compacto (`cadastro-catalogo.ts:38`), então a marca não entra na conta. O 1º `expect` de `:50-54` (M1 × M2, "CB 3401" × "cb-3401" → 1 erro) já cobre esse caso com a marca diferente.
- **Proposta:** apagar o it `:44-48`. Se quiser manter a conferência do `campo`, junte `expect(e[0]!.campo).toBe('referencias')` ao it `:50-54`.

### RD-0514 · baixa · código · modulo-vendedor
- **Onde:**
  - o tipo `{ brand: string | null; code: string }` escrito à mão 4 vezes: `modules/vendedor/app/screens/order-detail-screen.tsx:375` e `:437`, e `app/state/use-vendedor.ts:846` e `:847`, além do original em `domain/pdf-pedido.ts:54` (`OrderPdfItem['references']`);
  - o `x.marca_nome ?? null` em `use-vendedor.ts:852`.
- **O que se repete:** o mesmo tipo em 5 lugares, e os 4 de fora do domain tiveram de mudar juntos nesta entrega. O `?? null` não muda nada, porque o `Referencia.marca_nome` do contrato já é `string | null` (e, no `main`, `string`).
- **Proposta:**
  - no `domain/pdf-pedido.ts`, `export type ReferenciaPdf = NonNullable<OrderPdfItem['references']>[number];`, usado nos 4 lugares (`Map<string, ReferenciaPdf[]>`);
  - antes → `brand: x.marca_nome ?? null`; depois → `brand: x.marca_nome`.

### RD-0515 · baixa · teste · banco-dados
- **Onde:** `db/testes/aplicacao-referencia.test.ts:113-115` e `:265-266`, e `db/testes/referencia-marca-opcional.db.test.ts:70-75` e `:107`.
- **O que se repete:**
  - O espelho Drizzle da `produto_referencia` é conferido 2 vezes: `marca_id` nulo e `produto_id`/`codigo`/`codigo_compacto`/`ordem` obrigatórios estão no estático do `aplicacao-referencia` (`:113-115`) e no it "espelho Drizzle" do teste da 0075 (`:70-75`).
  - A recusa de "outra marca com o mesmo código no produto" (`MARCAS_FIXTURE.A.inativa`, "CB 3401", ordem 3 → 23505) também aparece 2 vezes: `aplicacao-referencia.test.ts:265-266` e `referencia-marca-opcional.db.test.ts:107`.
- **Proposta:** a regra nova da 0075 fica no teste da 0075.
  - No `aplicacao-referencia.test.ts`, sai a linha `:114-115` (comentário e `marca_id.notNull`). O loop `:113` fica para a 0033.
  - Saem também as linhas `:265-266`.
  - O `uuid` de `marca_id` (`:72`) continua só no teste da 0075.

## 3. Encaminhamento ao testes (sem RD)
`modules/catalogo/domain/marcas.ts:12-13` (`MSG_SEM_MARCAS`): "Não há marcas concorrentes ativas. Cadastre a marca em Catálogo → Marcas concorrentes ou salve o produto sem referência cruzada." Com a marca opcional, a ação certa passa a ser "deixe a marca em 'Sem marca'". O texto manda tirar a referência inteira, e isso não é mais preciso. É texto que diverge da regra nova, não redundância. Fica para o testes conferir.

## 4. Recados
Um recado `pedido` por dono, com cópia ao gerente-projetos: modulo-catalogo (RD-0510 a 0513), modulo-vendedor (RD-0514) e banco-dados (RD-0515). Um aviso ao testes, com o §3.

## 5. Reteste (15/11/2026, ~08h Manaus)
**Veredito: COM ACHADO (não liberado).** Dos 6 achados, 5 estão corrigidos: RD-0510 a RD-0513 e RD-0515. O RD-0514 foi reaberto, porque ainda sobra uma cópia do tipo. Há 2 achados novos no catálogo, o RD-0540 (doc, média) e o RD-0541 (código, baixa). Os 3 seguram o lote.

Conferi os commits:
- **ddb8c283** em `origin/nuvem/referencia-sem-marca-modulo-catalogo`;
- **80aa6015** em `origin/nuvem/referencia-sem-marca-modulo-vendedor`;
- **09d25c32** em `origin/nuvem/referencia-sem-marca-banco-dados`.

| Achado | Resultado |
|---|---|
| RD-0510 | **Corrigido.** `referenciaVisivel` está no `domain/marcas.ts`, com teste RN-CAT-09, e as 4 cópias passaram a chamar a função. |
| RD-0511 | **Corrigido.** `textoDaReferencia` está no domain. `textoEquivaleA`, `layout.ts:83` e o `ini` de `vitrine.ts:228` usam a função. |
| RD-0512 | **Corrigido.** Agora há 2 tipos: `MotivoDescarte`, com os 3 motivos de descarte, e `MotivoSemMarca`. O parâmetro passou a se chamar `semMarca`. |
| RD-0513 | **Corrigido.** O it repetido saiu de `cadastro-catalogo.test.ts`. |
| `MSG_SEM_MARCAS` (§3, testes) | **Corrigido.** O texto agora termina em "ou escolha "Sem marca"." e tem teste em `marcas.test.ts:36-39`. O valor contra a regra continua com o testes. |
| RD-0514 | **Reaberto.** As 4 cópias de fora do domain passaram a usar `ReferenciaPdf`, e o `?? null` saiu. Mas o `ReferenciaPdf` foi escrito como tipo novo (`pdf-pedido.ts:35`), em vez de vir de `OrderPdfItem['references']`. O mesmo formato continua escrito à mão em `pdf-pedido.ts:57` (`references?: ReadonlyArray<{ brand?: string \| null; code: string }>`). São 2 definições no mesmo arquivo, e elas já divergem (`brand` opcional numa, obrigatório na outra). |
| RD-0515 | **Corrigido.** Saíram de `aplicacao-referencia.test.ts` o `marca_id.notNull` e a recusa de outra marca com o mesmo código. A regra da 0075 fica só no teste da 0075. |
| Linha CB-3400 (`aplicacao-referencia.test.ts:263`) | **Pouco clara (sem RD).** O commit tirou o comentário "o compacto da apagada (cb3400) volta a valer", e a linha ficou sem explicação, logo abaixo do comentário sobre "cb-3401". Quem lê não sabe que o `cb3400` é a referência apagada da fixture, nem por que o `toBeNull` importa. Sugiro ao banco-dados recolocar só a parte que vale: `// a apagada (cb3400) não conta: o mesmo código volta a valer`. É comentário de teste e não segura. |

### RD-0514 (reaberto) · baixa · código · modulo-vendedor
- **Onde:** `modules/vendedor/domain/pdf-pedido.ts:35` (`export type ReferenciaPdf = { brand: string | null; code: string }`) × `:57` (`references?: ReadonlyArray<{ brand?: string | null; code: string }>`).
- **Proposta:** antes → `references?: ReadonlyArray<{ brand?: string | null; code: string }>`; depois → `references?: ReadonlyArray<ReferenciaPdf>`. Os testes de `pdf-pedido.test.ts` já mandam o `brand` em toda referência. Se o opcional for preciso, ele vai para o `ReferenciaPdf`.

### RD-0540 · média · doc · modulo-catalogo
- **Onde:** `docs/modulos/catalogo/regras.md:170` × `:160`.
- **O que se repete:** a mesma regra (a referência do ERP com marca desconhecida) aparece em 2 parágrafos do mesmo doc, e os 2 agora se contradizem.
  - A linha 160, que foi atualizada, diz: "vinda do ERP, a referência entra só com o código (aviso `catalogo.referencia.marca_desconhecida@1` no Hub)".
  - A linha 170, que não mudou, diz: "`resolverReferenciasDoErp` casa a marca, descarta a desconhecida/inativa/inválida com aviso no log".
- **Impacto:** leitura e decisão. Quem lê o §170 acha que a referência é descartada, e ela não é mais. É o mesmo engano que o RD-0512 tirou do código.
- **Proposta:** a fonte da regra fica na linha 160.
  - antes → "`resolverReferenciasDoErp` casa a marca, descarta a desconhecida/inativa/inválida com aviso no log e, sem o Promotor, ignora o bloco sem apagar o atual."
  - depois → "`resolverReferenciasDoErp` casa a marca (desconhecida ou inativa: ver acima) e, sem o Promotor, ignora o bloco sem apagar o atual."

### RD-0541 · baixa · código · modulo-catalogo
- **Onde:** `modules/catalogo/domain/marcas.ts`, no retorno de `referenciaVisivel` (`{ marca_id: string | null; marca_nome: string | null; codigo: string } | null`) e em `ResolucaoReferenciasErp.referencias` (`:47`).
- **O que se repete:** o formato do `Referencia` do contrato (`contracts/busca.ts:128-129`) está escrito à mão 2 vezes no domain. Os 4 chamadores gravam o retorno em `Map<string, Referencia[]>`. O domain já importa tipos de `../contracts` (`cadastro-catalogo.ts:6`, `vitrine.ts`).
- **Impacto:** manutenção. Se um campo mudar no contrato, as cópias à mão não acompanham, e o erro só aparece nos chamadores.
- **Proposta:** `import type { Referencia } from '../contracts';`
  - antes → `): { marca_id: string | null; marca_nome: string | null; codigo: string } | null`; depois → `): Referencia | null`;
  - antes → `referencias: { marca_id: string | null; marca_nome: string | null; codigo: string }[]`; depois → `referencias: Referencia[]`.

### Recados
Os recados não foram gravados: a CLI recebeu 403 na escrita, como na rodada anterior. A lista foi entregue ao gerente-projetos, por dono:
- modulo-catalogo: RD-0540 e RD-0541;
- modulo-vendedor: RD-0514, reaberto;
- banco-dados: a sugestão do comentário do CB-3400, sem RD e sem segurar o lote.

## 6. Segundo reteste (15/11/2026, ~08h Manaus)
**Veredito: COM ACHADO (não liberado).** RD-0514, RD-0540 e RD-0541 estão corrigidos, e o comentário do CB-3400 voltou. Ainda no domain da exportação, há 2 achados novos de gravidade baixa, o RD-0542 e o RD-0543. Os 2 estão em código de produção e seguram o lote. Há também 1 encaminhamento ao testes, sem RD.

Conferi os commits:
- **178d0486** em `origin/nuvem/referencia-sem-marca-modulo-vendedor`;
- **ba67ddf2** em `origin/nuvem/referencia-sem-marca-modulo-catalogo`;
- **01c437d9** em `origin/nuvem/referencia-sem-marca-banco-dados`.

| Ponto | Resultado |
|---|---|
| RD-0514 | **Corrigido.** `OrderPdfItem.references` agora é `ReadonlyArray<ReferenciaPdf>`. O formato aparece uma vez só no módulo (`pdf-pedido.ts:35`), e os testes do PDF já mandam o `brand` em toda referência. |
| RD-0540 | **Corrigido.** A `regras.md:170` diz "casa a marca (desconhecida ou inativa: ver acima)". A regra fica só na `:160`. |
| RD-0541 | **Corrigido.** `ResolucaoReferenciasErp.referencias` e o retorno de `referenciaVisivel` usam o `Referencia` do contrato. |
| CB-3400 (`aplicacao-referencia.test.ts:263`) | **Claro.** O comentário "a apagada (cb3400) não conta: o mesmo código volta a valer" explica a linha. |
| Redundância nova nos 3 commits | **Nenhuma.** As correções não criaram redundância. Ao procurar se o formato do `Referencia` ainda estava escrito à mão em outro lugar do módulo, achei o RD-0542 e o RD-0543, abaixo. |

### RD-0542 · baixa · código · modulo-catalogo
- **Onde:** `modules/catalogo/domain/exportacao.ts:22` (`referencias: { marca_id: string | null; marca_nome: string | null; codigo: string }[]`).
- **O que se repete:** é a 3ª cópia à mão do `Referencia` do contrato no domain, a mesma do RD-0541. Este lote mexeu nessa linha (o `marca_id` passou a aceitar nulo), e o arquivo já importa `Referencia` (`:6`).
- **Proposta:** antes → `referencias: { marca_id: string | null; marca_nome: string | null; codigo: string }[];`; depois → `referencias: Referencia[];`.

### RD-0543 · baixa · código · modulo-catalogo
- **Onde:** `modules/catalogo/web/exportacao/layout.ts:60` e `:81-83`.
- **O que se repete:** o nome da marca é decidido 2 vezes no caminho da exportação.
  - O domain já decide (`domain/exportacao.ts:59`, `nomeMarcaDaReferencia` com o cadastro de marcas que a rota passa, `rotas.ts:584-585`).
  - O BKO decide de novo, com o `dados.marcas` do mesmo payload: `(r.marca_id ? marcas.get(r.marca_id) : undefined) ?? r.marca_nome?.trim()`.
  - O resultado é o mesmo, então são 2 lugares para manter a mesma regra. Este lote mexeu nessas linhas (`:82-83`).
- **Proposta:** antes → `const m = (r.marca_id ? marcas.get(r.marca_id) : undefined) ?? r.marca_nome?.trim(); return textoDaReferencia(m, r.codigo);`; depois → `equivale_a: p.referencias.slice(0, MAX_REFERENCIAS).map((r) => textoDaReferencia(r.marca_nome, r.codigo))`.
  - Saem a linha `:60` (`const marcas = new Map(...)`) e o comentário `:81`.
  - Se o `dados.marcas` não tiver outro uso no BKO, cabe a uma tarefa à parte tirá-lo do contrato da exportação (`formato.ts`). Isso não segura o lote.

### Encaminhamento ao testes (sem RD)
`domain/exportacao.ts:59` não esconde a referência quando a marca informada está inativa ou não existe. Ela sai na exportação só com o código, enquanto a ficha, o cartão e a busca a escondem (`referenciaVisivel`). O cabeçalho do arquivo (`:3`) diz "marca ativa". É comportamento que diverge da RN-CAT-09, não redundância. Fica para o testes conferir. Se o testes confirmar, a correção natural é usar `referenciaVisivel` aqui também.

### Recados
A CLI segue com 403 na escrita, então os recados não foram gravados. A lista foi entregue ao gerente-projetos:
- modulo-catalogo: RD-0542 e RD-0543;
- testes: o encaminhamento acima.

## 7. Terceiro reteste (15/11/2026, ~08h Manaus)
**Veredito: COM ACHADO (não liberado).** O RD-0542 e o RD-0543 estão corrigidos, e a exportação passou a seguir a ficha. A correção deixou sem leitor o campo `marcas` da resposta da exportação: é o RD-0544, de gravidade baixa, em código de produção. Ele segura o lote.

Conferi o commit **71b4c16e** em `origin/nuvem/referencia-sem-marca-modulo-catalogo`, que vem sobre o ba67ddf2.

| Ponto | Resultado |
|---|---|
| RD-0542 | **Corrigido.** `ProdutoDaExportacao.referencias` passou a ser `Referencia[]`. O formato fica só no contrato. |
| RD-0543 | **Corrigido.** O layout faz `textoDaReferencia(r.marca_nome, r.codigo)`, e o mapa `marcas` e o comentário saíram. O nome da marca é decidido num lugar só, o domain. |
| Exportação × ficha (encaminhamento do §6) | **Resolvido.** `montarExportacao` usa `referenciaVisivel`: a referência de marca inativa, ausente ou sem retrato fica escondida, como na ficha. O corte em 3 vem depois do filtro, então uma referência escondida não toma o lugar de uma visível. O cabeçalho do arquivo foi atualizado. A conferência do comportamento contra a RN-CAT-09 continua com o testes. |
| Testes | **Sem achado.** O teste novo de `exportacao.test.ts` confere que `montarExportacao` liga a regra à exportação, coisa que o teste de `referenciaVisivel` não cobre. O de `rotas.test.ts` e o do layout foram ajustados ao comportamento novo, sem repetir caso. |
| Campo `marcas` da resposta | **RD-0544.** |

### RD-0544 · baixa · código · modulo-catalogo
- **O que se repete:** com o RD-0543 corrigido, o BKO não lê mais `dados.marcas`. Só os fixtures de teste citam o campo (`web/exportacao/exportacao.test.ts:11,39`). Mesmo assim, a API ainda monta e envia a lista de marcas ativas em toda exportação, e o contrato e o doc ainda a descrevem. É dado que ninguém usa, e a mesma lista já sai pelo `GET marcas-concorrentes`.
- **Onde:**
  - `modules/catalogo/api/rotas.ts:586-587` (`const lista = …`, `marcas: lista`);
  - `modules/catalogo/contracts/rotas.ts:252` (`marcas: z.array(…)` em `RespostaExportacao`);
  - os asserts e fixtures `api/rotas.test.ts:648,661,675` e `web/exportacao/exportacao.test.ts:11,39` (e o `DADOS_EXEMPLO.marcas` de `web/exportacao/exemplo.ts`);
  - `docs/modulos/catalogo/regras.md:165` e `:167`.
- **Impacto:** desempenho (uma lista a mais por exportação) e manutenção (um campo de contrato sem leitor).
- **Proposta:**
  - contrato: tirar a linha `marcas` de `RespostaExportacao`;
  - rota: antes → `const lista = …; return { produtos: r.produtos, marcas: lista, truncado: r.truncado };`; depois → `return { produtos: r.produtos, truncado: r.truncado };`. O `marcas` do `Promise.all` fica, porque alimenta o `montarExportacao`;
  - testes e exemplo: tirar `marcas` dos fixtures e os 3 asserts de `corpo.marcas`. O que eles queriam garantir (sem o Promotor, sem marca) já está no `toEqual([])` das referências;
  - doc `:165`: antes → "`{ produtos, marcas, truncado }`"; depois → "`{ produtos, truncado }`";
  - doc `:167`: antes → "sem o Promotor para o tenant ou o usuário, `marcas` vem vazia e as referências não aparecem, como na ficha"; depois → "sem o Promotor para o tenant ou o usuário, vale o retrato `marca_nome`; referência com marca e sem retrato não aparece, como na ficha".

### Recado
A CLI segue com 403 na escrita. A lista foi entregue ao gerente-projetos para repassar ao modulo-catalogo (RD-0544) e ao testes (conferir a exportação escondendo a referência).

## 8. Quarto reteste (15/11/2026, ~08h Manaus)
**Veredito: LIMPO no modulo-catalogo.** O RD-0544 foi corrigido e não há achado novo. Não há nenhum RD aberto neste tema. Resta uma pendência que não é redundância e fica com o testes: os testes de `tests/integracao` que ainda leem `e.marcas`.

Conferi o commit **9edb3fd9** em `origin/nuvem/referencia-sem-marca-modulo-catalogo`. São 6 arquivos, com 5 linhas a mais e 17 a menos.

| Ponto | Resultado |
|---|---|
| RD-0544 | **Corrigido.** O campo `marcas` saiu do `RespostaExportacao` (`contracts/rotas.ts`). A rota agora devolve `{ produtos, truncado }`, e o `marcas` do `Promise.all` continua, porque alimenta o `montarExportacao`. Saíram também os 3 asserts de `rotas.test.ts`, o `MARCAS_EXEMPLO` e os fixtures de `exportacao.test.ts`. No doc, `regras.md:165` diz `{ produtos, truncado }`, e a `:167` traz o texto proposto. |
| Sobra no módulo | **Nenhuma.** `git grep` não acha mais `MARCAS_EXEMPLO`, `DADOS_EXEMPLO.marcas` nem `corpo.marcas` da exportação em `modules` e `apps`. Os `e.marcas` que sobram em `domain/exportacao.ts:59`, `api/ia` e `modules/integracao` são outros dados: a entrada do domain, o vocabulário da IA e o evento de marca desconhecida. |
| Redundância nova | **Nenhuma.** A correção só tirou código. Os 2 testes do layout, "equivale a usa a marca ou só o código" e "usa o marca_nome que o domain já resolveu", cobrem casos diferentes. |
| `tests/integracao` | **Fora do escopo do corretor.** `api/catalogo-aplicacao-t0084.test.ts:541,543` e `demo/catalogo-cadastro-demo-t0084.test.ts:154` ainda conferem `e.marcas`, que não existe mais. O testes vai ajustar num branch à parte, como o gerente informou. Não é RD. |
