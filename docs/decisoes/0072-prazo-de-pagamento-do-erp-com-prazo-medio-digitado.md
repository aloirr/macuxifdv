# ADR 0072 — Prazo de pagamento do ERP com prazo médio digitado (contrato `v2` do Hub)

- **Status**: aceita (decisão do dono do produto, R-20261124-111421-alexandre; prevalece sobre R-20261124-105811 e R-20261124-110006).
- **Data**: 2026-11-24 (Manaus)
- **Versão**: v1.0.34. Regras: RN-VEN-24 e RN-VEN-25 (revistas), RN-INT-09.
- **Autor**: engenheiro-software

## Contexto
Hoje (T-0089) o `prazo_pagamento` do Hub tem `descricao` e `prazo_medio_dias` opcionais: o Macuxi gera a descrição ("28/56 dias") e
CALCULA o prazo médio (média das parcelas, para cima); um valor informado diferente vira o aviso `prazo_medio_divergente`
(`domain/pagamento.ts`, chamado em `domain/idempotencia.ts`) e a linha é aplicada com o calculado. O consumidor do Vendedor
(`modules/vendedor/api/formas-erp.ts`) também recalcula. A RN-VEN-25 diz que "não há trava de prazo médio" (R-20261118-224720).

O dono do produto decidiu:
1. O ERP é a fonte única de formas e prazos; o FDV só consulta (o BKO não cria, não edita, não exclui). Uma forma tem 1 ou mais
   prazos (Cartão 1X/2X/3X são prazos da forma "Cartão de crédito").
2. Todo prazo vem com `codigo`, `forma_external_id`, `descricao`, `parcelas_dias` (lista de inteiros; à vista = `[0]`) e
   `prazo_medio_dias`, todos obrigatórios. O prazo médio é **digitado no ERP** e o FDV usa o recebido.
3. O cliente só usa prazos com `prazo_medio_dias` ≤ `prazo_medio_max_dias` do cliente (nulo = sem teto). Reverte a R-20261118-224720.

Tornar `descricao` e `prazo_medio_dias` obrigatórios é `campo_tornado_obrigatorio`, incompatível (`domain/versao.ts`, RN-INT-09).
Quem manda `prazo_pagamento` hoje com `versao_contrato: "v1"`: o Conector on-premise, o Conector `nuvem` (ADR 0066) e o kit CSV.

## Decisão
1. **Versão `v2` do contrato no envelope, mesma rota.** `POST /integracao/v1/lotes` (delta e sessões da carga completa; é a única
   rota que valida a versão, por `validarEnvelope`) passa a aceitar `versao_contrato: "v2"`; `versoesSuportadas` padrão =
   `['v1', 'v2']`. A `v2` é igual à `v1` em tudo, menos no `prazo_pagamento` (item 2). As saídas (`GET /integracao/v1/pedidos/pendentes`,
   `GET /integracao/v1/clientes/pendentes`) não mudaram e seguem com `versao_contrato: "v1"`: separar a constante de saída
   (`VERSAO_CONTRATO = 'v1'`) da lista de entrada aceita. O caminho `/integracao/v1` não muda (a RN-INT-09 diz "vira `/v2`";
   o doc 03 passa a dizer "nova `versao_contrato`").
2. **Regras do `prazo_pagamento` na `v2`** (schema novo `PrazoPagamentoPayloadV2` em `contracts/entidades.ts`, escolhido pela versão
   do envelope ao validar as linhas):
   - `codigo`: texto 1..20, obrigatório (como hoje);
   - `forma_external_id`: obrigatório (como hoje; forma ausente = `referencia_ausente`, reprocessável, RN-INT-04);
   - `descricao`: texto 1..60, obrigatório (aparado; vazio = ausente);
   - `parcelas_dias`: lista de 1..24 inteiros 0..365, sem decrescer (como hoje); texto `"28/56"` é `tipo_invalido`;
   - `prazo_medio_dias`: inteiro 0..365, obrigatório, entre a menor e a maior parcela (mesma regra do CHECK
     `vendedor.prazo_medio_coerente`, migração 0037, que assim nunca estoura no insert);
   - `percentual_ajuste`, `ordem`, `external_id`, `alterado_em`, `ativo`: como hoje.

   Recusa por linha, um erro por campo, com os códigos que já existem em `CODIGOS_ERRO_LINHA` (nenhum código novo):
   ausente/nulo/vazio = `campo_obrigatorio`; tipo errado = `tipo_invalido`; fora de 0..365, mais de 24 parcelas ou descrição com mais
   de 60 = `valor_fora_da_faixa`; parcelas decrescendo ou prazo médio fora da faixa das parcelas = `regra_invalida`. Todos com
   `reprocessavel: false` (o ERP corrige e reenvia).
3. **Na `v2` o Macuxi usa o recebido:** nem descrição gerada, nem média calculada.
4. **A `v1` segue aceita na janela da RN-INT-09** ([6 meses] a partir do deploy da v1.0.34, `janelaVersaoAnteriorMeses`), com o
   comportamento de hoje (Contexto), todo dentro do Hub. O Hub entrega ao Vendedor o registro já completo nas duas versões, e o consumidor só grava o que recebeu.
5. **`prazo_medio_divergente` fica em `CODIGOS_AVISO_LINHA`** (tirar é `valor_enum_removido`, incompatível) e só é emitido na `v1`.
   Sai do enum quando a `v1` for encerrada.
6. **Sem migração.** As colunas já existem (`descricao`, `parcelas_dias int[]`, `prazo_medio_dias int not null`) e o CHECK continua
   valendo. `prazo_medio_max_dias` do cliente já está no `ClientePayload`, no `core.cliente` (0037) e no sync do Core.
7. **RN-VEN-25 nova:** o vendedor só vê e só usa os prazos com `prazo_medio_dias` ≤ `prazo_medio_max_dias` do cliente. O app filtra
   (offline) e a API revalida pela mesma função pura no domain do Vendedor (422 com o código RN). Teto nulo = todos os prazos.
8. **BKO só consulta formas e prazos.**

## Alternativas
- **Caminho `/integracao/v2`**: duplicaria todas as rotas, a chave do Conector e a documentação por uma regra de uma entidade.
  O envelope já carrega a versão e o Hub já recusa versão fora da lista (`versao_nao_suportada`).
- **Obrigatório já na `v1`, ou `v1` recusando `prazo_pagamento`** (como a ADR 0067): três produtores mandam `v1` sem prazo médio; a carga deles quebraria.
- **`v1` usando o informado quando presente**: muda o sentido da `v1` sem o produtor saber; a `v1` fica igual até encerrar.
- **Versão por entidade**: um eixo novo de versão só para um caso; a `versao_contrato` do envelope resolve.
- **Migração para afrouxar o CHECK**: prazo médio fora das parcelas é erro de cadastro; recusar com o campo é melhor que gravar.

## Consequências
- O APK no ar (v1.0.32) não quebra: lê o prazo pelo sync do Vendedor, que já traz `prazo_medio_dias` e `descricao`.
- Prazos já gravados ficam com o valor calculado até o ERP reenviar em `v2`. Prazos criados no BKO antes ficam só para consulta.
- **modulo-integracao**: `PrazoPagamentoPayloadV2`, validação das linhas pela versão do envelope, `versoesSuportadas` e constante de
  saída, aviso só na `v1`; OpenAPI, exemplos, guia (e o PDF) com a `v2`; kit CSV e `modelos-csv.ts` mandando `v2` com `descricao` e
  `prazo_medio_dias` obrigatórios (texto do prazo médio deixa de dizer "informativo"); testes do domain citando RN-VEN-24 e RN-INT-09.
- **modulo-vendedor**: `formas-erp.ts` grava `descricao` e `prazo_medio_dias` recebidos (sem recalcular); função pura do domain para a
  RN-VEN-25 nova, usada pelo app (filtro da lista de prazos do pedido) e pela API do pedido (revalidação); BKO de formas e prazos
  só consulta.
- **Conector** (on-premise e `nuvem`) e ERP: passam a mandar `v2` quando tiverem os cinco campos; até lá a `v1` segue.
- **banco-dados**: nada.
- **gerente-projetos**: doc 03 (RN-VEN-24, RN-VEN-25, RN-INT-09), doc 06 (linha de formas e prazos: tirar "O BKO também cadastra"; prazo médio digitado no ERP e obrigatório na `v2`) e quadro.
