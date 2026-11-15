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
