# Desenho — Conector 1.5.0: % do prazo de pagamento (v1.0.14)

Origem: proposta aprovada `docs/modulos/vendedor/prazo-desconto-acrescimo.md` (branch `nuvem/prazo-ajuste-modulo-vendedor`, 454ee68), §6, RN-INT-15 e pergunta 4; aprovação do gerente por delegação (R-20261115-123000).

## Donos
- `apps/conector/**` é do **modulo-integracao** (`.coord/donos.json`: a regra `apps/conector/**` vem antes de `apps/**`). O código e os exemplos abaixo são dele.
- `engenheiro-software`: este desenho e a decisão sobre o `.strict()` do pull.

## Dependências
- Contrato: `PercentualAjuste` em `contracts/base.ts`, `PrazoPagamentoPayload.percentual_ajuste` e `PagamentoErp.percentual_ajuste` (branch `nuvem/prazo-ajuste-modulo-integracao`). A validação do arquivo de configuração do Conector recusa campo fora do contrato (`config/esquema.ts`), e o teste 1 para 1 dos exemplos (`test/exemplos-views-modelo.test.ts`) também. Por isso o mapeamento nos exemplos **depende do merge do PR do modulo-integracao**.
- Banco: `db/conector/entrada-pedido-modelo.sql` e `views-modelo.sql` (branch `nuvem/prazo-ajuste-banco-dados`, 0ffa290, migração 0081).

## 1. Leitura do prazo (ERP → Hub)
- **Não há mudança no mapeador.** `mapearLinha` já omite o campo quando a coluna não vem na linha, e também quando vem NULL (modo `omite`). O Hub trata ausente como 0 (RN-INT-15).
- **Exemplos** (`conector.exemplo.json` e `conector.oracle.exemplo.json`), entidade `prazo_pagamento`:
  - campo `"percentual_ajuste": { "coluna": "percentual_ajuste", "transformar": "numero" }`. Não existe a transformação `decimal` citada no comentário da view-modelo: o certo é `numero`. Ela aceita o número do mssql e o texto do pg e do Oracle (`"-1.71"`; vírgula também). A faixa e as 2 casas são conferidas pelo contrato, e o erro vira erro de linha;
  - consulta com `SELECT TOP (:limite) * FROM dbo.vw_macuxi_prazo_pagamento ...` (no Oracle, `SELECT * FROM macuxi.vw_macuxi_prazo_pagamento ...`). Assim a coluna só é lida **quando existe**: a view-modelo deixa `percentual_ajuste` comentada até o contrato, e um ERP sem a coluna não pode quebrar a consulta. Com a lista explícita, a consulta falharia num ERP sem a coluna. O `WHERE` e o `ORDER BY` com colação binária ficam como estão.
- Testes (antes, citando RN-INT-15), em `test/`:
  1. com a coluna `-1.71`, ou `"-1.71"` em texto, o registro leva `percentual_ajuste: -1.71`;
  2. sem a coluna na linha, o registro não tem a chave;
  3. com a coluna NULL, o registro não tem a chave;
  4. com `100.5` ou `1.234`, a linha é inválida (`valor_fora_da_faixa`, `regra_invalida`) e o valor não aparece na mensagem;
  5. nos exemplos, o mapeamento 1 para 1 continua batendo com `camposDoContrato('prazo_pagamento')`.

## 2. Devolução do pedido (Hub → ERP)
- `src/pedidos.ts`, `parametrosCabecalho`: acrescentar `pagamento_percentual_ajuste: pg?.percentual_ajuste ?? null`, que é **só informativo**. Preço e total dos itens e do pedido seguem como vêm do Hub, já ajustados, e o Conector **não recalcula nada**. Atualizar o comentário da função (grupo pagamento) e o de `config/esquema.ts` (lista de parâmetros, "desde o 1.5.0").
- Exemplos:
  - SQL Server: no `EXEC dbo.sp_macuxi_pedido_inserir`, acrescentar `@pagamento_percentual_ajuste = :pagamento_percentual_ajuste`;
  - Oracle: acrescentar a coluna `pagamento_percentual_ajuste` no INSERT ... SELECT do cabeçalho, igual ao modelo do banco-dados.
- Compatibilidade: um SQL antigo que não cita o parâmetro segue igual (os parâmetros a mais já são tolerados, como no 1.4.0). Um pedido sem o campo grava NULL.
- Testes (RN-INT-15):
  1. `pagamento.percentual_ajuste: -1.71` vira `pagamento_percentual_ajuste: -1.71`;
  2. sem o campo, ou sem `pagamento`, o parâmetro vai `null`;
  3. `preco_unitario_cents` e `total_cents` dos itens e o `total_cents` do pedido chegam ao SQL iguais aos do payload;
  4. o EXEC do exemplo cita `:pagamento_percentual_ajuste`.

## 3. Versão
- `apps/conector/package.json` e `src/versao.ts` (`VERSAO_CONECTOR`) passam a `1.5.0`. É do modulo-integracao, e os nomes de `pacote.test.ts` podem continuar como estão.
- Publicação: o `conector-publicar.yml` publica o 1.5.0 digitando `1.5.0` no input `versao`.
- **Recomendada, não mínima.** Não muda o `exigeConector`/`VERSAO_CONECTOR_FILIAL` (`modules/integracao/domain/pedido-versao.ts`): o pedido com `percentual_ajuste` vai a qualquer Conector, porque o 1.4.x grava o total certo e só não leva o informativo. Quem sobe a versão recomendada é a política do portal, por tenant (`versao_recomendada`, BKO Integração), depois que o pacote 1.5.0 for publicado.

## 4. `.strict()` do pull (`PrazoPagamentoSyncSchema`, `modules/vendedor/contracts/sync.ts`)
Decisão: **manter `.strict()`** e acrescentar o campo `percentual_ajuste` (número de -99,99 a 99,99, obrigatório porque o banco grava `not null default 0`), no mesmo PR do modulo-vendedor que passa a enviar o campo no pull. Não precisa de ADR, porque a mudança é aditiva.
- Motivo: o app não revalida a linha do pull com o schema. O `motor-sync` só valida o payload do push em `enfileirar`. Um app antigo recebe a chave a mais e a ignora. O `.strict()` continua barrando, no servidor e nos testes, campo digitado errado.
- Também não precisa de `.passthrough()` nem de esperar o app novo para liberar o campo.

## Riscos
- **Dupla aplicação no ERP:** a procedure grava as linhas como vêm. A conferência no ensaio é total no ERP = total no app.
- **Ordem dos PRs:** banco-dados (0081) → engenheiro-software (este desenho) → modulo-vendedor → modulo-integracao (contrato e Conector 1.5.0) → testes.
