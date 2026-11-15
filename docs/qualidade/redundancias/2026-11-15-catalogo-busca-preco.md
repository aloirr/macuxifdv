# Catálogo · busca sem cliente pela filial e código sem IA · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 4 achados de gravidade baixa, do RD-0492 ao RD-0495, todos do **modulo-catalogo**. Estão em código de produção, então **seguram** o PR.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o branch `nuvem/busca-preco-modulo-catalogo`, commit **e7dc7d8**, pelo diff contra o `origin/main`:
- `domain/preco-filial.ts` e `domain/codigo-busca.ts`;
- `api/rotas.ts`, `api/repositorio.ts` e `api/repositorio-postgres.ts`;
- `app/lib/local.ts` e `app/telas/catalogo.tsx`;
- `contracts/rotas.ts`;
- os testes.

## 1. O que foi pedido
| Ponto | Resultado |
|---|---|
| A regra de escolha da tabela está duplicada entre o domain, o SQL e o app? | A regra está num lugar só: `tabelaPorContagem` (domain). Ela é usada pelo app (`local.ts`, via `precosDaFilialSemCliente`), pela memória e pelo Postgres. O SQL só conta os itens. O caminho do Postgres, porém, escolhe a tabela 2 vezes, e a 2ª escolha usa uma tabela inventada (**RD-0493**). |
| Textos de erro repetidos | O texto do 422 `FILIAL_INEXISTENTE` está copiado (`rotas.ts:131` e `:158`), e a função que decide "escolhida ou padrão, do tenant" também foi copiada (**RD-0492**). |
| O app e a API têm 2 listas de "o que é código"? | **Não.** Há uma função só, `textoPareceCodigo` (`domain/codigo-busca.ts`), que o app (`catalogo.tsx:129`) e a API (`rotas.ts`) usam. O `codigoCompacto` (`ranking.ts:489`) faz outra coisa: normaliza o código para a busca exata e não decide se é código. Na API, porém, a condição "pula a IA" aparece 2 vezes (**RD-0495**). |
| Query `filial` aditiva | **Sem achado.** É opcional, só vale sem `customer_id` e é revalidada no tenant e na carteira. |

Ficou também a regra "a filial escolhida manda no estoque", repetida nos 2 repositórios (**RD-0494**).

## 2. Achados
### RD-0492 · baixa · código · texto · modulo-catalogo · segura
- **Onde:** `domain/preco-filial.ts`, `filialDaBuscaSemCliente`, as 2 primeiras linhas × `filialDaTelaDePreco`, no mesmo arquivo (`:74-77`). Em `api/rotas.ts`, o `ErroHttpModulo(422, 'FILIAL_INEXISTENTE', 'Essa filial não existe neste tenant. Escolha outra na lista de filiais.')` aparece em `filialDaTela` (`:131`) e em `filialDaBusca` (`:158`).
- **O que se repete:** a regra "sem filial escolhida vale a padrão, e a escolhida precisa ser do tenant" está escrita 2 vezes no domain, e o texto do erro dela está 2 vezes na rota. Se o texto mudar num lugar, o BKO e a busca passam a responder diferente para o mesmo erro.
- **Proposta:**
  - O `filialDaBuscaSemCliente` chama `filialDaTelaDePreco(e.escolhida, e.padrao, e.existentes)` e só acrescenta a conferência da carteira (`fora_da_carteira`).
  - Na rota, `filialDaBusca` reaproveita `filialDaTela(repo, pedida)`, que já lança o 422, e só lança o 403 da carteira.
  - Se preferir manter as 2 funções, a mensagem vira uma constante só (`MSG_FILIAL_INEXISTENTE`).

### RD-0493 · baixa · código · modulo-catalogo · segura
- **Onde:** `api/repositorio-postgres.ts:465-494`, no `precos` sem cliente:
  - o SQL de contagem já filtra `t.ativo` (`:471`), e o `tabelaPorContagem` (`:476`) filtra `ativo` de novo;
  - depois de escolher a tabela, a função chama `precosDaFilialSemCliente([{ id: tabelaId, codigo: '', ativo: true }], …)` (`:489`), que conta e escolhe outra vez entre uma tabela só, inventada.
- **O que se repete:** a mesma escolha roda 2 vezes no mesmo pedido. A 2ª chamada serve só para converter os campos (`price_table_id: null`, `price_cents`…), e o `{ codigo: '', ativo: true }` é um dado falso para cumprir a assinatura.
- **Proposta:** dividir a função do domain em 2 passos, escolher e converter.
  - `export function precosDaTabelaSemCliente(tabelaId: string | null, itens: readonly ItemDaFilialSemCliente[]): ItemTabelaPreco[]` só filtra e converte.
  - O `precosDaFilialSemCliente(tabelas, itens)` passa a ser `precosDaTabelaSemCliente(tabelaDaFilialSemCliente(tabelas, itens), itens)`. O app e a memória continuam iguais.
  - O Postgres chama `tabelaPorContagem` e depois `precosDaTabelaSemCliente(tabelaId, linhas)`, sem a tabela inventada.
  - O `t.ativo` do SQL pode ficar, porque reduz o que o banco devolve, mas aí o `ativo` vem sempre `true` e só a regra do domain decide.

### RD-0494 · baixa · código · modulo-catalogo · segura
- **Onde:** `if (!clienteId && filialEscolhida) return [filialEscolhida];` em `api/repositorio-postgres.ts:544` e em `api/repositorio.ts:227` (memória), com o parâmetro novo `filialEscolhida` na interface `filiaisDoUsuario`.
- **O que se repete:** a regra "sem cliente, a filial escolhida (já validada na rota) é a do estoque" está copiada nas 2 implementações do repositório. Quem escrever um 3º repositório precisa lembrar de copiá-la de novo. Ela também não é leitura de banco.
- **Proposta:** a regra fica na rota, num lugar só. Em `contextoVitrine`: `const filiais = filial?.escolhida ? [filial.escolhida] : await repo.filiaisDoUsuario(clienteId);`, nas 2 chamadas. O parâmetro `filialEscolhida` sai da interface e dos 2 repositórios.

### RD-0495 · baixa · código · modulo-catalogo · segura
- **Onde:** `api/rotas.ts`: `q.mode === 'basica' || textoPareceCodigo(q.q)` na leitura do uso de IA (`:259`) e de novo em `interpretar` (`:194`).
- **O que se repete:** a mesma decisão ("esta busca não usa IA") está escrita 2 vezes no mesmo pedido. Se uma das condições mudar, a rota pode gastar a leitura da cota e não chamar a IA, ou chamar a IA sem ter lido a cota.
- **Proposta:** decidir uma vez só, `const semIa = q.mode === 'basica' || textoPareceCodigo(q.q);`, e passar `semIa` para a leitura (`uso: semIa ? null : …`) e para `interpretar`, que troca o teste por `if (semIa)`.

## 3. Conferido sem achado
- **`precosDaFilialSemCliente`:** é uma função pura e única. O app (`local.ts`) e a memória a usam. O `tabelaDaFilialSemCliente` agora delega para `tabelaPorContagem`, sem cópia.
- **Contrato:** `filial` aparece uma vez em `ConsultaBuscaQuery`, e a documentação dela não repete a da rota.
- **Testes** (`codigo-busca.test.ts`, `preco-filial.test.ts`, `rotas.test.ts`): cada um cobre uma camada, e nenhum caso se repete com outro nome.
- **Observação sem RD:** a frase "pf 0503", com espaço, não é código para `textoPareceCodigo` e vai para a IA. A busca exata (`codigoCompacto`) tira o espaço e acharia o produto mesmo assim. Não é redundância; é uma escolha de comportamento, que deixo para o modulo-catalogo e o testes decidirem.
