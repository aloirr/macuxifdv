# Outbox parada na AM2808: 2 nós e 34 produtos do catálogo

> Para o Alexandre. modulo-integracao, com leitura do código do modulo-catalogo, 20/11/2026 (Manaus).
> Decisão R-20261120-174155-alexandre ("b"). A investigação foi feita só pelo código e pelo `git log`, sem chamar a produção.
> **Nada foi corrigido nem reprocessado, e nada se faz antes da sua decisão.**

## 1. Resumo
- **Causa mais provável (certeza alta):** o ERP da AM2808 tem 2 nós da árvore (grupo, subgrupo…) com um `codigo` que outro nó
  já usa. Na nuvem o código do nó é único por empresa (`catalogo_no_codigo_uk`). No ERP e no contrato do Hub esse código não é
  único. O nó não entra, falha com `23505` nas 10 tentativas e para.
- **Os 34 produtos dependem dos 2 nós (certeza alta).** Cada produto aponta para um desses nós, que nunca foi criado. O
  Catálogo recusa o produto com "nó ainda não chegou" (`ReferenciaAusenteErp`). O diagnóstico mostra esse erro como
  "catalogo: outro".
- **Não é regressão.** O consumidor e o índice são de 02/11 e não mudaram desde então. O que mudou em 15/11 foi a carga real da
  AM2808, a primeira com dados desse ERP.
- **O que ainda falta saber:** qual dos 2 índices únicos deu o erro, quais são os 2 nós e quais são os 34 produtos. Essa
  informação está no banco, e o §6 traz a consulta que a mostra.

## 2. Quem publica e quem consome
- **Publica:** o Hub, ao aplicar o lote do Conector. Cada registro vira um `integracao.<entidade>.atualizado@1` na outbox, com
  `external_id`, `acao`, `registro` e `lote_id` (`modules/integracao/contracts/eventos.ts:22`). Os nós saem antes dos produtos
  (`ORDEM_CARGA_ENTIDADES`, `modules/integracao/contracts/entidades.ts:33`).
- **Consomem, nesta ordem** (`apps/api/src/modulos.ts:35-46`): primeiro o Core e depois o Catálogo.
  - `integracao.catalogo_no.atualizado@1`: só o Catálogo, em `criarConsumidorCatalogoNoDoErp`
    (`modules/catalogo/api/consumidores-erp.ts:223-247`).
  - `integracao.produto.atualizado@1`: o Core grava o cadastro do produto. Depois o Catálogo grava o conteúdo e o vínculo do
    produto com o nó, em `criarConsumidorProdutoNoDoErp` (`consumidores-erp.ts:317-339`).
- O motivo vai para `plataforma.evento.ultimo_erro` no formato `<módulo>: <mensagem segura>`, e as falhas se juntam com " | "
  (`apps/api/src/despachante.ts:246` e `:337`).
  - O diagnóstico lê só a **1ª falha** (`.github/workflows/producao-diagnostico-outbox.yml:96`). Nos 36 eventos ela é do
    Catálogo.

## 3. O 23505 dos 2 nós
O consumidor do nó (`consumidores-erp.ts:234-244`) faz, nesta ordem:
1. acha o pai pelo `external_id` (linha 235). Se o pai faltasse, o erro seria `ReferenciaAusenteErp`, e não `23505`;
2. adota um nó de **mesmo código e sem `external_id`** (linha 236-237);
3. faz `insert … on conflict (tenant_id, external_id) … do update set … codigo = excluded.codigo` (linha 238-243).

A tabela tem dois índices únicos (`db/migrations/0013_catalogo_vendedor_prevenda.up.sql`):
- `catalogo_no_codigo_uk`: `(tenant_id, codigo)` dos nós vivos (linha 252);
- `catalogo_no_external_uk`: `(tenant_id, external_id)` dos nós vivos com `external_id` (linha 255).

O `on conflict` cobre só o 2º. Portanto o 23505 vem de um destes caminhos:

| Hipótese | Como acontece | Certeza |
|---|---|---|
| **H1. Código repetido entre nós do ERP** | O nó B do ERP chega com o código X, que o nó A (outro `external_id`) já usa. A adoção do passo 2 procura só nó **sem** `external_id`, por isso não acha o A. O insert bate em `catalogo_no_codigo_uk`. O mesmo acontece se o ERP troca o código de um nó para um código já usado (o `do update` bate no mesmo índice). | **alta** |
| H2. Adoção bate no `external_id` | Um nó sem `external_id` tem o código X, e o `external_id` que chega já está vivo em outro nó. O `update` do passo 2 bate em `catalogo_no_external_uk`. | baixa |

A prova da H1:
- **Na nuvem o código é único; no ERP, não.**
  - O staging do kit só tem `external_id` como chave (`modules/integracao/kit-thathyany/sql/criar-banco.sql:54-64`).
  - O contrato `CatalogoNoPayload` não exige código único (`modules/integracao/contracts/entidades.ts:287-294`).
  - O Hub não confere código repetido de nó em nenhum ponto (`modules/integracao/domain/`).
  - É comum o ERP numerar o subgrupo dentro do grupo (01, 02… em cada grupo). Nesse caso o código se repete em grupos
    diferentes.
- **Nenhum teste cobre o caso.** O teste do consumidor usa sempre `codigo = external_id`
  (`modules/catalogo/api/consumidores-erp.db.test.ts:95`), então dois nós com o mesmo código nunca foram testados.
- **O mesmo defeito já foi corrigido em outra tabela.** Na tabela escalonada, o 23505 em loop com outro `external_id` na mesma
  chave foi resolvido (`consumidores-erp.ts` em `criarConsumidorTabelaEscalonadaDoErp` e `consumidores-erp.db.test.ts:190`).
  O nó ficou sem essa correção.
- **A H2 é quase impossível.** O único lugar que grava `catalogo.catalogo_no` é este consumidor, e ele sempre grava o
  `external_id`. Não há tela do BKO nem seed que crie nó sem `external_id`.
- **O erro não se resolve sozinho.** O nó que já tem o código continua vivo, então as 10 tentativas (cerca de 36 min) dão o
  mesmo erro.

## 4. O "catalogo: outro" dos 34 produtos
- No produto, o Catálogo roda em **uma transação** (`consumidores-erp.ts:319-337`):
  1. grava o conteúdo vindo do ERP: aplicação, etiquetas, "oferece junto" e referências cruzadas (linha 321);
  2. procura o nó pelo `external_id` (linha 328). Se o nó não existe, lança
     `ReferenciaAusenteErp('catalogo_no')` (linha 217-221);
  3. grava o vínculo produto → nó (linha 330-336).
- A mensagem gravada é `catalogo: ReferenciaAusenteErp: referencia_ausente: 1 registro(s) de catalogo_no ainda não chegaram…`
  (`apps/api/src/log-seguro.ts:77`).
- O diagnóstico só classifica o nome do erro quando ele começa com `Erro` ou termina com `Error`
  (`producao-diagnostico-outbox.yml:104-105`). `ReferenciaAusenteErp` não cabe em nenhum dos dois e por isso aparece como **"outro"**.
- Os produtos chegaram 11 min depois dos nós (00:58 contra 00:47), e só os 34 ligados aos 2 nós falharam.
- **Hipótese menor (certeza baixa):** um produto do "oferece junto" que ainda não chegou também dá `ReferenciaAusenteErp`
  (`consumidores-erp.ts:300-301`), com o texto "de produto" no lugar de "de catalogo_no". A consulta do §6 separa os dois casos.

## 5. O que ficou desatualizado no app
| O quê | Quantos | Estado |
|---|---|---|
| Grupos (nós da árvore) | 2 | Não existem na nuvem. O vendedor não os vê na árvore do Catálogo (`modules/catalogo/app/lib/local.ts:534-559`). |
| Produtos: cadastro (nome, SKU, unidade) | 34 eventos (até 34 produtos; pode haver produto repetido em 2 lotes) | Em dia, porque o Core consumiu antes do Catálogo. |
| Produtos: grupo | os mesmos | Produto novo fica fora de qualquer grupo. Produto antigo que mudou de grupo continua no grupo antigo (o vínculo velho segue vivo). |
| Produtos: aplicação, etiquetas, "oferece junto", referências cruzadas | os mesmos | Não gravados (a falha desfaz tudo): ficaram como antes de 15/11; em produto novo, vazios. |
| Preço e estoque | – | Não dependem do nó (consumidores à parte) e não estão entre os parados. |

## 6. Fase 2: consulta extra só de leitura (precisa da sua frase, porque mexe em `.github/`)
**Por que:** a mensagem salva já contém o nome do índice (`SQLSTATE 23505, catalogo_no_codigo_uk`, `log-seguro.ts:75`). O
workflow corta essa parte ao montar a `classe_erro`. Com a consulta abaixo, a H1 se confirma ou cai, e saem os nomes dos 2 nós e
dos 34 produtos.

**O que mudar:** um bloco a mais no `producao-diagnostico-outbox.yml`, no mesmo papel `macuxi_leitura`, numa transação só de
leitura e terminando em `rollback`. Ele sai só quando há evento parado de `catalogo_no` ou de `produto`.

| Saída | Colunas (sem dado pessoal; o resto do payload não sai) |
|---|---|
| Nós parados | `ocorrido_em` (Manaus), `tentativas`, índice tirado do `ultimo_erro` (`substring(… from 'SQLSTATE 23505, ([a-z_]+)')`), `payload->>'external_id'`, `registro->>'codigo'`, `registro->>'nome'`, `registro->>'nivel'`, `registro->>'pai_external_id'` |
| Nó vivo que já tem a chave | para cada nó parado: `external_id`, `codigo`, `nome`, `nivel`, código do pai e `created_at` do nó de `catalogo.catalogo_no` com o mesmo `codigo` ou o mesmo `external_id` |
| Produtos parados | `ocorrido_em`, a entidade que faltou (`substring(ultimo_erro from 'registro\(s\) de ([a-z_]+)')`), `payload->>'external_id'`, `registro->>'sku'`, `registro->>'nome'`, `registro->>'catalogo_no_external_id'`, e se o produto já tinha grupo vivo (`exists` em `catalogo.produto_no`) |

- **Duração:** a consulta leva menos de 1 s (são 36 eventos). O workflow inteiro leva de 3 a 5 min, mais o tempo da aprovação do
  environment `PRODUCAO`.
- O texto da mudança fica com o engenheiro-software (dono do workflow). **O PR só se abre depois da sua frase.**

## 7. Opções para a sua decisão
Em todas, o reprocessamento só acontece com o seu "sim" (OUTBOX_PARADA), e os eventos voltam do mais antigo para o mais novo:
**primeiro os 2 nós, depois os 34 produtos**.

| # | Opção | Tempo | Risco | O que o vendedor vê |
|---|---|---|---|---|
| A | **Corrigir no ERP da AM2808**: dar código único aos 2 nós (o §6 diz quais são) e mandar a carga de novo. Depois, voltar os 36 eventos a zero tentativas. | ~30 min do lado da nuvem, mais o tempo do cliente no ERP | Baixo, sem código novo. O defeito continua para a próxima empresa ou o próximo código repetido. | Os 2 grupos e os 34 produtos aparecem certos no próximo sync. |
| B | **Corrigir no código (modulo-catalogo)**: nó do ERP com código repetido não trava a fila. Duas saídas: o nó do ERP ganha um código interno (ex.: código do pai + código) ou o índice passa a ser por pai (precisa do banco-dados e de uma migração). Teste do caso que faltava (§3), versão nova e reprocessamento dos 36. | 1 a 2 dias (código, teste, corretor, versão e deploy) | Médio, porque mexe na regra do código do nó (RF-CAT-04) e, na 2ª saída, no índice. É a opção que acaba com o defeito. | O mesmo de A, depois do deploy. Enquanto isso, fica como hoje. |
| C | **A agora e B na próxima versão** | A hoje; B no lote seguinte | O menor dos três: o cliente fica em dia logo, e o defeito sai depois. | Em dia logo depois de A. |
| D | **Não mexer agora**: os eventos ficam parados e o alerta continua aceso. | 0 | O alerta OUTBOX_PARADA fica aceso e esconde falhas novas. Os 34 produtos seguem incompletos. | Como hoje (§5). |

**Recomendação:** rodar a consulta do §6 (5 min), para ter os nomes, e depois seguir pela **C**.
