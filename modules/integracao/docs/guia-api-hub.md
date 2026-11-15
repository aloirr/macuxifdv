# Guia da API do Hub de Integração (`/integracao/v1`) para o TI do cliente

Este guia mostra como enviar os dados do seu ERP ao Macuxi FDV **direto pela API** e como devolver os pedidos ao ERP.
O contrato completo (todos os campos, limites e respostas) está no OpenAPI 3.1: [`openapi-hub-v1.json`](./openapi-hub-v1.json). Os trechos JSON abaixo saem dos mesmos exemplos testados desse arquivo.

- [1. Antes de começar: Conector ou API?](#1-antes-de-começar-conector-ou-api)
- [2. Autenticação](#2-autenticação)
- [3. Convenções](#3-convenções)
- [4. Ordem de carga](#4-ordem-de-carga)
- [5. Delta × completo, sessão e cursor](#5-delta--completo-sessão-e-cursor)
- [6. Idempotência](#6-idempotência)
- [7. Limites](#7-limites)
- [8. Erros e reprocessamento](#8-erros-e-reprocessamento)
- [9. Devolução de pedidos ao ERP](#9-devolução-de-pedidos-ao-erp)
- [10. Exemplos curl de ponta a ponta](#10-exemplos-curl-de-ponta-a-ponta)
- [11. Sinal de vida e reconciliação](#11-sinal-de-vida-e-reconciliação)

## 1. Antes de começar: Conector ou API?

| Situação | Use |
|---|---|
| ERP instalado na sua rede (on-premise), sem API pronta, e sua equipe não quer programar | **Conector Macuxi** (serviço Windows). Lê o ERP por SQL (SQL Server, PostgreSQL ou Oracle) com views-modelo prontas, guarda a fila em disco, repete com espera crescente (backoff), manda sinal de vida a cada minuto e aparece no monitor do BKO. Só faz conexão de saída (HTTPS 443). |
| ERP em nuvem com API própria, ou uma equipe de integração que já tem o seu processo | **API direta** (este guia). Você monta os lotes, trata a fila e as repetições. |
| Quer a API, mas sem reinventar fila, espera e idempotência | Use o Conector: ele já faz tudo isto. |

A API é a mesma nos dois casos: o Conector é só um cliente dela. Tudo o que está aqui vale para quem programa a integração; quem usa o Conector não precisa deste guia, só da instalação.

## 2. Autenticação

A credencial é **uma chave de API por Conector**. Quem emite é o **administrador da empresa no BKO** (módulo Integração, tela de Conectores): ele cadastra o Conector (um identificador, por exemplo `erp-matriz`), define quais entidades ele envia e se ele recebe pedidos, e o BKO mostra a chave **uma única vez**. Se perder, o administrador gira a chave.

Em **toda** chamada:

| Cabeçalho | Valor |
|---|---|
| `Authorization` | `Bearer <chave de API>` (formato `mxc_` seguido de 43 caracteres base64url; trate como senha) |
| `X-Macuxi-Conector-Id` | o identificador do Conector cadastrado no BKO (letras, números, `.`, `-`, `_`; até 100) |
| `X-Macuxi-Conector-Versao` | opcional e informativo: versão do seu software (semver, ex.: `1.2.1`) |
| `Content-Type` | `application/json` nos `POST` |

Pontos que importam:

- **A empresa (tenant) vem da chave.** Nunca mande `tenant_id` no corpo, na query ou em cabeçalho: é ignorado. A chave só abre `/integracao/v1`; ela não acessa mais nada do Macuxi.
- A chave só vale junto com o identificador do Conector dono dela.
- **Rotação sem parar a integração**: ao girar, a chave anterior continua valendo por uma janela de convivência (padrão 24 h, de 0 a 7 dias). Grave a nova chave e troque no seu sistema dentro da janela; depois da janela a antiga dá `401`.
- `401 credencial_invalida` tem mensagem genérica de propósito (chave desconhecida, revogada, expirada ou de outro Conector). Confira a chave e o identificador. `403` indica Conector desativado, IP fora da lista permitida, rota que o seu Conector não pode usar ou módulo Integração desligado na empresa.
- Mais de 20 falhas de autenticação por minuto do mesmo IP levam a `429`.
- Só HTTPS. Guarde a chave em cofre de segredos; nunca em log nem no código.
- **Política de versão**: se você enviar `X-Macuxi-Conector-Versao` com uma versão legível abaixo da mínima da empresa (para quem recebe pedidos, o padrão é `1.2.1`), as rotas de dados respondem `426`. Integrador próprio: ou não envie esse cabeçalho (ele é opcional) ou envie um valor igual ou superior à mínima.

## 3. Convenções

- Base: `https://<servidor>/integracao/v1` (demonstração: `api-demo.macuxifdv.com.br`; a produção será informada na contratação).
- Corpo JSON em UTF-8. **Dinheiro em centavos inteiros** (`_cents`). **Datas-hora em UTC com `Z`** (`2026-11-05T13:45:10Z`; deslocamento como `-03:00` é recusado). Datas civis `AAAA-MM-DD`.
- **Todo registro tem `external_id`** (a chave do registro no seu ERP, até 200 caracteres; chaves compostas como `TAB01:P000045` valem) e `alterado_em` (instante da última alteração no ERP). `ativo: false` inativa o registro no Macuxi (nunca apaga).
- Campos desconhecidos são **ignorados** (compatibilidade para frente). Campo novo opcional é compatível com `v1`; qualquer outra mudança vira `/v2`.
- Toda resposta traz `X-Request-Id`; erros trazem o mesmo valor em `requisicao_id`. Informe-o ao suporte.
- Sem dado pessoal em log: mensagens de erro citam `external_id`, campo e código, nunca o valor.

## 4. Ordem de carga

Um registro que aponta para outro (por exemplo, um cliente que cita o vendedor) só entra se o alvo já existir. Se não existir, a linha vira o erro `referencia_ausente` (reprocessável). A ordem real de dependência é:

| Entidade | Depende de |
|---|---|
| `catalogo_no`, `transportadora`, `forma_pagamento`, `filial` | nada |
| `vendedor` | `filial` (o vendedor tem exatamente uma filial, obrigatória: `filial_external_id` ausente ou `null` carrega o vendedor com o aviso `vendedor_sem_filial`, e ele fica bloqueado até a filial ser informada) |
| `produto` | `catalogo_no` (referência **fraca**: nó ausente só gera aviso `referencia_fraca_ausente` e o produto entra sem o vínculo) |
| `prazo_pagamento` | `forma_pagamento` (pelo `forma_external_id`) |
| `cliente` | `vendedor`, `forma_pagamento` e `filial` (as `formas_pagamento` do cliente vão pelo **código** da forma; forma ainda não carregada não recusa a linha, mas carregue as formas antes; `filial_external_id` ausente ou `null` = filial padrão da empresa) |
| `rota` | `vendedor` e `cliente` (inclusive o cliente de cada parada) |
| `titulo` | `cliente` |
| `nota` | `cliente` e `vendedor` |
| `cliente_endereco` | `cliente` |
| `produto_unidade` | `produto` |
| `preco`, `estoque` | `produto` e `filial` (`filial_external_id` ausente ou `null` = filial padrão; no estoque, é a filial do depósito) |
| `tabela_escalonada` | `produto`, `preco` e `filial` (`filial_external_id` ausente = vale para todas as filiais) |

Sequência segura para a primeira carga: **filial, vendedor, catalogo_no, transportadora, forma_pagamento → cliente, produto, prazo_pagamento → rota, titulo, nota, cliente_endereco, produto_unidade → preco, estoque → tabela_escalonada.** (RN-INT-04: vendedor → cliente → rota/título/nota; produto → preço/estoque.)

O Hub também ajuda: um lote espera por lotes ainda em aberto das entidades de que depende (até 30 minutos); passado esse tempo ele é aplicado e as linhas sem alvo viram `referencia_ausente`. Quando o lote da dependência termina, o Hub reprocessa essas linhas sozinho.

Cada Conector envia só as entidades que o administrador cadastrou para ele. Enviar outra entidade dá `422 entidade_de_outro_conector`.

## 5. Delta × completo, sessão e cursor

**Delta** (`modo: "delta"`): só o que mudou desde o último envio. Sem `sessao`.

**Completo** (`modo: "completo"`): a foto inteira da entidade, em **partes** de uma mesma **sessão**. Exige `sessao: { id, parte, ultimo }`: `id` é um UUID que você gera e repete em todas as partes; `parte` vai de 1 em diante; `ultimo: true` na última parte fecha a sessão. A sessão tem 24 horas para fechar.

**Cursor**: o Hub guarda, por Conector e entidade, o maior par (`alterado_em`, `external_id`) já aceito. Consulte antes de enviar delta:

`GET /cursores/{entidade}` devolve o cursor.

- **Cursor nulo** = o Hub nunca recebeu essa entidade deste Conector: faça a **carga inicial completa**.
- Com cursor: envie o delta com tudo o que tem `alterado_em` maior que o do cursor (ou igual e `external_id` maior, em ordem ordinal/bytes, não por idioma).
- O cursor **só avança quando o lote termina** (`concluido` ou `concluido_com_erros`), nunca em `recebido`, `processando` ou `falhou`. Recalcular a partir dele depois de uma falha é seguro.

<!-- exemplo:cursor:sem_cursor -->
```json
{
  "entidade": "cliente",
  "cursor": null,
  "atualizado_em": null
}
```
<!-- /exemplo -->

**Trava de inativação (30 %)**: ao fechar uma sessão completa, os registros ativos do Conector que **não vieram** na carga seriam inativados (nunca apagados). Se isso atingir mais de 30 % dos ativos, o Hub **não inativa**: o lote termina normalmente, mas o resultado traz `inativacao.situacao = "aguardando_confirmacao"` e um administrador ou analista decide no BKO (a pendência vale 7 dias). Regras de proteção:

- um registro que veio na carga, **mesmo inválido**, nunca é inativado;
- linha inválida sem `external_id` legível, ou linhas inválidas omitidas, **impedem** a inativação da sessão;
- só entram na conta os registros que o Hub já tinha antes de a sessão começar (o que nasceu no ERP durante a carga chega pelo delta).

<!-- exemplo:resultado:inativacao_aguardando -->
```json
{
  "lote_id": "5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1",
  "entidade": "cliente",
  "modo": "completo",
  "status": "concluido",
  "contagens": {
    "recebidas": 600,
    "duplicadas_no_lote": 0,
    "com_erro": 0,
    "novas": 0,
    "atualizadas": 12,
    "inalteradas": 588,
    "obsoletas": 0
  },
  "erros": [],
  "avisos": [],
  "cursor": {
    "alterado_em": "2026-11-05T13:45:10Z",
    "external_id": "C000899"
  },
  "inativacao": {
    "situacao": "aguardando_confirmacao",
    "motivo": "excede_limite_inativacao",
    "candidatos": 412,
    "percentual": 40.7
  },
  "inativadas": 0,
  "recebido_em": "2026-11-05T13:46:01Z",
  "concluido_em": "2026-11-05T13:47:30Z"
}
```
<!-- /exemplo -->

Carga completa em partes (parte 1, sessão aberta, e a última parte, que fecha):

<!-- exemplo:lote:carga_completa_parte_1 -->
```json
{
  "versao_contrato": "v1",
  "entidade": "vendedor",
  "modo": "completo",
  "sessao": {
    "id": "c0a8e3d2-5b71-4a96-b4f0-7d19e8a2c635",
    "parte": 1,
    "ultimo": false
  },
  "enviado_em": "2026-11-05T13:46:00Z",
  "conector_id": "erp-matriz",
  "versao_conector": "1.2.1",
  "registros": [
    {
      "external_id": "V001",
      "alterado_em": "2026-11-05T13:45:10Z",
      "ativo": true,
      "nome": "Vendedor Exemplo",
      "email": "vendedor@example.com",
      "telefone": "+55 95 3000-0001"
    }
  ]
}
```
<!-- /exemplo -->

<!-- exemplo:lote:carga_completa_ultima_parte -->
```json
{
  "versao_contrato": "v1",
  "entidade": "vendedor",
  "modo": "completo",
  "sessao": {
    "id": "c0a8e3d2-5b71-4a96-b4f0-7d19e8a2c635",
    "parte": 2,
    "ultimo": true
  },
  "enviado_em": "2026-11-05T13:47:00Z",
  "conector_id": "erp-matriz",
  "versao_conector": "1.2.1",
  "registros": [
    {
      "external_id": "V002",
      "alterado_em": "2026-11-05T13:45:10Z",
      "ativo": true,
      "nome": "Outro Vendedor Exemplo",
      "email": null,
      "telefone": null
    }
  ]
}
```
<!-- /exemplo -->

## 6. Idempotência

**Por lote** (`Idempotency-Key`, obrigatório em `POST /lotes`): de 16 a 128 caracteres entre letras, números, `.`, `-`, `_` e `:`. O Conector usa o SHA-256 hexadecimal do conteúdo do lote.

| Situação | Resposta |
|---|---|
| chave nova | `202` e o lote é criado |
| mesma chave, **mesmo conteúdo** | `202` repetido: o **mesmo** `lote_id`, `repetido: true` e o cabeçalho `Idempotent-Replay: true`. Nada é reprocessado nem duplicado |
| mesma chave, **conteúdo diferente** | `409 chave_idempotencia_reutilizada` |

Use isto a seu favor: se a resposta se perder (queda, timeout), **reenvie o mesmo lote com a mesma chave**. O conteúdo que conta é versão, entidade, modo, sessão, `registros` e linhas inválidas; `enviado_em`, `cursor`, `conector_id` e `versao_conector` ficam de fora, então remontar o lote depois não gera conflito.

<!-- exemplo:aceito:repetido -->
```json
{
  "lote_id": "5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1",
  "status": "recebido",
  "entidade": "produto",
  "modo": "delta",
  "recebidos": 1,
  "repetido": true,
  "consulta": "/integracao/v1/lotes/5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1"
}
```
<!-- /exemplo -->

**Por registro**: o Hub compara cada linha com o último registro aceito usando `external_id` + um hash do conteúdo e `alterado_em`:

- `alterado_em` **menor** que o do registro atual: a linha é `obsoleta` (reenvio antigo); não troca nada e não é erro;
- conteúdo idêntico: `inalterada` (nada é gravado nem publicado);
- conteúdo diferente: `atualizada` (e `nova` se o `external_id` não existia). Em empate de `alterado_em` com conteúdo diferente, vale a última a chegar;
- o mesmo `external_id` duas vezes no mesmo lote vale a última ocorrência (as anteriores viram o aviso `duplicado_no_lote`).

Portanto reenviar dados é sempre seguro, mas **`alterado_em` precisa ser monotônico**: nunca envie uma versão mais antiga de propósito achando que vai sobrescrever.

## 7. Limites

| Limite | Valor |
|---|---|
| Registros por lote | 5.000 (`422 acima_do_limite`). Na carga completa, divida em partes |
| Corpo de `POST /lotes` | 8 MiB (`413 corpo_grande`). Recomendado: até ~4 MiB por lote |
| Corpo das demais rotas | 1 MiB |
| Linhas inválidas detalhadas por lote | 500; o que passar só entra na contagem (`linhas_invalidas_omitidas`) |
| `external_id` | 1 a 200 caracteres |
| Taxa de `POST /lotes` | balde de 30 chamadas, repõe 20 por minuto, por Conector |
| Taxa das demais rotas | balde de 300, repõe 300 por minuto (5 por segundo), por Conector |
| Falhas de autenticação | 20 por minuto por IP |
| Erros devolvidos em `GET /lotes/{id}` | 1.000 (padrão), até 5.500, com `?limite_erros=` |
| Pedidos por `GET /pedidos/pendentes` | 50 (padrão), até 100, com `?limite=` |

Ao receber `429` ou `503`, espere os segundos do cabeçalho `Retry-After` e repita (com espera crescente se persistir).

## 8. Erros e reprocessamento

Corpo de erro padrão: `{ "codigo", "mensagem", "detalhes"?, "requisicao_id" }`. As recusas de lote e de retorno acrescentam `erros[]` (`codigo`, `campo`, `mensagem`). As mensagens estão em português e dizem o que fazer.

| HTTP | `codigo` | Quando | O que fazer |
|---|---|---|---|
| 400 | `requisicao_invalida` | cabeçalho, parâmetro, query ou corpo fora do contrato; `pedido_uuid` do caminho diferente do corpo; `data_referencia` fora de D-7..D+1 | Corrigir (`detalhes.problemas[]` aponta o campo). Repetir igual dá o mesmo erro |
| 400 | `envelope_invalido`, `chave_idempotencia_invalida` | corpo do lote fora do envelope; `Idempotency-Key` ausente ou fora do formato | Corrigir; todos os problemas voltam juntos |
| 401 | `credencial_invalida` | chave desconhecida, revogada, expirada ou de outro Conector | Conferir chave e identificador; pedir nova chave ao administrador |
| 403 | `acesso_negado` | Conector desativado, IP fora da lista, rota não permitida ao Conector (ex.: pedidos em Conector sem `recebe_pedidos`) | Falar com o administrador da empresa |
| 403 | `modulo_inativo` | módulo Integração desligado na empresa | Falar com o administrador / comercial |
| 404 | `lote_nao_encontrado` | lote inexistente, de outro Conector ou de outra empresa | Reenviar o lote com a **mesma** `Idempotency-Key` |
| 404 | `entidade_desconhecida` | entidade fora da lista em `/cursores/{entidade}` | Usar uma das 15 entidades |
| 409 | `chave_idempotencia_reutilizada` | mesma `Idempotency-Key` com conteúdo diferente | Gerar chave nova para o conteúdo novo |
| 413 | `corpo_grande` | corpo acima do limite da rota | Dividir em lotes menores |
| 422 | `versao_nao_suportada`, `entidade_desconhecida`, `lote_vazio`, `acima_do_limite`, `sessao_ausente`, `sessao_nao_se_aplica`, `entidade_de_outro_conector` | recusa do envelope por regra; **nenhum lote é criado** | Corrigir o envelope e enviar de novo |
| 422 | `pedido_desconhecido`, `pedido_nao_entregue`, `transicao_invalida`, `numero_erp_divergente` | retorno de pedido recusado | Ver a seção 9; não reenviar igual |
| 426 | `versao_conector_nao_suportada` | versão informada abaixo da mínima; `detalhes.versao_minima` | Atualizar, ou não informar a versão (seção 2). Só `POST /sinal` continua liberado |
| 429 | `limite_de_taxa` | muitas chamadas do Conector ou falhas de autenticação do IP | Esperar `Retry-After` e repetir |
| 500 | `erro_interno` | erro inesperado | Repetir com espera; se persistir, informar o `requisicao_id` |
| 503 | `servico_indisponivel` | Hub ou banco indisponível | Esperar `Retry-After` e repetir |

Exemplo de recusa de envelope (carga completa sem `sessao`):

<!-- exemplo:erro:enviar_lote:422:sessao_ausente -->
```json
{
  "codigo": "sessao_ausente",
  "mensagem": "A carga completa exige \"sessao\" (id, parte e ultimo).",
  "erros": [
    {
      "codigo": "sessao_ausente",
      "campo": "sessao",
      "mensagem": "A carga completa exige \"sessao\" (id, parte e ultimo)."
    }
  ],
  "requisicao_id": "req-7f3a9c2e41d8"
}
```
<!-- /exemplo -->

### Erros por linha

Um lote aceito (`202`) pode ter linhas com erro. Elas **não travam o lote**: as válidas são aplicadas e o lote termina `concluido_com_erros`. `GET /lotes/{id}` lista cada erro com `indice`, `external_id`, `codigo`, `campo`, `mensagem`, `reprocessavel` e `origem` (`hub` ou `conector`). As linhas `falha_processamento` vêm primeiro.

| `codigo` da linha | Significado | Reprocessável? |
|---|---|---|
| `referencia_ausente` | cita um `external_id` que o Hub ainda não tem (ex.: produto de um preço) | **sim**: envie o alvo; o Hub reprocessa sozinho quando o lote dele termina, ou use o BKO |
| `falha_processamento` | falha de infraestrutura ao aplicar a linha | **sim** |
| `campo_obrigatorio`, `tipo_invalido`, `formato_invalido`, `valor_fora_da_faixa`, `valor_nao_permitido`, `regra_invalida`, `registro_invalido`, `external_id_invalido`, `campo_desconhecido` | dado fora do contrato | **não**: corrija na origem e reenvie o registro (com `alterado_em` atualizado) |

**Reprocessar pelo BKO**: administrador ou analista abre o lote, filtra por código e usa **Reprocessar**; só as linhas `referencia_ausente` e `falha_processamento` entram (o Hub guarda a linha original por 30 dias; depois disso o BKO pede para reenviar pelo seu sistema).

<!-- exemplo:resultado:concluido_com_erros -->
```json
{
  "lote_id": "5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1",
  "entidade": "preco",
  "modo": "delta",
  "status": "concluido_com_erros",
  "contagens": {
    "recebidas": 5,
    "duplicadas_no_lote": 0,
    "com_erro": 2,
    "novas": 1,
    "atualizadas": 2,
    "inalteradas": 0,
    "obsoletas": 0
  },
  "erros": [
    {
      "indice": 3,
      "external_id": "TAB01:P000044",
      "codigo": "referencia_ausente",
      "campo": "produto_external_id",
      "mensagem": "O campo \"produto_external_id\" aponta para um produto que ainda não foi carregado. Envie o produto; o Hub reprocessa a linha.",
      "reprocessavel": true,
      "origem": "hub"
    },
    {
      "indice": 4,
      "external_id": "TAB01:P000046",
      "codigo": "valor_fora_da_faixa",
      "campo": "preco_cents",
      "mensagem": "O campo \"preco_cents\" não pode ser negativo. Corrija no ERP; o registro volta no próximo delta.",
      "reprocessavel": false,
      "origem": "hub"
    }
  ],
  "avisos": [
    {
      "indice": 1,
      "external_id": "TAB01:P000045",
      "codigo": "duplicado_no_lote",
      "mensagem": "O external_id aparece mais de uma vez no lote; valeu a última ocorrência."
    }
  ],
  "cursor": {
    "alterado_em": "2026-11-05T13:45:10Z",
    "external_id": "TAB01:P000045"
  },
  "erros_total": 2,
  "erros_omitidos": 0,
  "inativadas": 0,
  "recebido_em": "2026-11-05T13:46:01Z",
  "concluido_em": "2026-11-05T13:46:06Z"
}
```
<!-- /exemplo -->

Linhas que **você** recusou antes de enviar (dado inválido no ERP) vão em `linhas_invalidas`, com o `external_id` e o motivo, **sem o valor**. Elas aparecem no BKO com `origem: "conector"` e, na carga completa, protegem aquele registro da inativação. Um lote pode ter só `linhas_invalidas` (com `registros: []`):

<!-- exemplo:lote:so_linhas_invalidas -->
```json
{
  "versao_contrato": "v1",
  "entidade": "cliente",
  "modo": "delta",
  "enviado_em": "2026-11-05T13:46:00Z",
  "conector_id": "erp-matriz",
  "versao_conector": "1.2.1",
  "registros": [],
  "linhas_invalidas": [
    {
      "external_id": "C000999",
      "codigo": "campo_obrigatorio",
      "campo": "razao_social",
      "mensagem": "razao_social está vazio no ERP."
    },
    {
      "external_id": null,
      "codigo": "registro_invalido",
      "mensagem": "Linha sem código do cliente; não foi possível identificá-la."
    }
  ],
  "linhas_invalidas_omitidas": 0
}
```
<!-- /exemplo -->

## 9. Devolução de pedidos ao ERP

Fluxo: o vendedor aprova o pedido no Macuxi, o Hub o coloca na fila, o seu sistema **busca** (poll), grava no ERP e **devolve o retorno**. Só o Conector com permissão de receber pedidos usa estas rotas (um por empresa); outro recebe `403`.

**1. Buscar**: `GET /pedidos/pendentes?limite=50`. O Hub devolve os pedidos `pendente` por ordem de aprovação e já os marca como `enviado` (mesma transação), com `tentativa + 1`. Lista vazia é normal; consulte a cada poucos segundos ou minutos.

<!-- exemplo:pendentes:com_pedido -->
```json
{
  "pedidos": [
    {
      "versao_contrato": "v1",
      "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
      "cliente_external_id": "C000123",
      "vendedor_external_id": "V001",
      "condicao_pagamento_erp": "30DD",
      "criado_em": "2026-11-05T13:10:00Z",
      "aprovado_em": "2026-11-05T13:40:00Z",
      "observacao": "Entregar pela manhã.",
      "itens": [
        {
          "sequencia": 1,
          "produto_external_id": "P000045",
          "quantidade": 24,
          "preco_unitario_cents": 250,
          "desconto_cents": 0,
          "total_cents": 6000,
          "unidade": "CX",
          "fator": 6,
          "quantidade_venda": 4
        },
        {
          "sequencia": 2,
          "produto_external_id": "P000051",
          "quantidade": 10,
          "preco_unitario_cents": 1990,
          "desconto_cents": 900,
          "total_cents": 19000
        }
      ],
      "desconto_total_cents": 900,
      "total_cents": 25000,
      "tentativa": 1,
      "frete": {
        "modalidade": "FOB",
        "transportadora": {
          "tipo": "cadastrada",
          "id": "8d3c5e7a-1b2f-4c6d-a9e0-4f5a6b7c8d9e",
          "external_id": "T001",
          "nome": "Transportadora Exemplo",
          "cnpj": "11222333000181"
        }
      },
      "endereco_entrega": {
        "logradouro": "Avenida das Flores",
        "numero": "250",
        "bairro": "Industrial",
        "cidade": "Boa Vista",
        "uf": "RR",
        "cep": "69313000",
        "principal": false,
        "origem": "editado"
      }
    }
  ]
}
```
<!-- /exemplo -->

- **Idempotência pelo `pedido_uuid`**: grave no ERP de forma que o mesmo `pedido_uuid` nunca gere dois pedidos (guarde o UUID na tabela do ERP).
- **Endereço de entrega editado no pedido** (RN-VEN-17): `endereco_entrega.origem` é `"editado"` quando o vendedor digitou o endereço só para aquele pedido; nesse caso `external_id` vem **nulo** e `principal` é `false`. **Regra do SQL de gravação no ERP: `endereco_entrega.external_id` nulo = use os campos de texto** (logradouro, número, complemento, bairro, cidade, UF e CEP); com `external_id` preenchido, use o endereço do ERP. Baseie-se no `external_id`, não em `origem`: o Conector 1.3.x já instalado não conhece `origem`, mas recebe os textos e o `external_id` nulo. Um SQL que só usa o `external_id` levaria a entrega ao endereço principal sem avisar; confira isso no roteiro de implantação. O endereço não principal exige Conector 1.3.0 ou superior.
- **Timeout de 10 minutos**: pedido `enviado` sem retorno por 10 min volta a `pendente` e sai de novo em `pendentes` com `tentativa` maior. Se você já gravou, apenas devolva o retorno de novo.
- `quantidade` está **sempre na unidade base**. Quando a venda foi por embalagem, `unidade`, `fator` e `quantidade_venda` mostram a medida vendida (`quantidade = quantidade_venda × fator`).
- `condicao_pagamento_erp` já vem traduzida pelo mapeamento de-para da empresa. Pedido sem de-para fica retido no Hub (não sai) até o administrador cadastrar.

**2. Devolver o retorno**: `POST /pedidos/{pedido_uuid}/retorno`. O `pedido_uuid` do corpo tem de ser o do caminho.

| `status` | Quando | Obrigatório |
|---|---|---|
| `integrado` | o ERP gravou o pedido | `numero_erp` |
| `rejeitado_erp` | o ERP recusou (final) | `motivo` |
| `faturado_parcial` | saiu nota de parte do pedido | `numero_erp`, `nota`; `itens_faturados` recomendado |
| `faturado_total` | saiu a última nota | `numero_erp`, `nota`; `itens_faturados` recomendado |
| `cancelado` | **o ERP** cancelou (final) | `motivo` opcional |

O Macuxi **nunca escreve cancelamento no ERP**. Pedido cancelado no Macuxi antes da primeira entrega simplesmente sai da fila; depois da entrega, quem avisa o cancelamento é o ERP, com o retorno `cancelado`.

<!-- exemplo:retorno:integrado -->
```json
{
  "versao_contrato": "v1",
  "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
  "status": "integrado",
  "numero_erp": "PV-004512",
  "ocorrido_em": "2026-11-05T14:02:00Z"
}
```
<!-- /exemplo -->

Faturamento: informe a **nota** e os **itens faturados nesta nota** (`sequencia` do pedido, `produto_external_id`, `quantidade` inteira e `valor_cents`). O que foi faturado antes não se repete; o Hub soma os retornos. Cada nota (número + série) conta uma vez.

<!-- exemplo:retorno:faturado_parcial -->
```json
{
  "versao_contrato": "v1",
  "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
  "status": "faturado_parcial",
  "numero_erp": "PV-004512",
  "nota": {
    "numero": "8841",
    "serie": "1",
    "emitida_em": "2026-11-05T16:30:00Z",
    "total_cents": 6000
  },
  "itens_faturados": [
    {
      "sequencia": 1,
      "produto_external_id": "P000045",
      "quantidade": 24,
      "valor_cents": 6000
    }
  ],
  "ocorrido_em": "2026-11-05T16:31:00Z"
}
```
<!-- /exemplo -->

Regras do retorno:

- **Idempotente**: o mesmo retorno de novo devolve `200` com `repetido: true`, sem publicar nem regravar. Duas notas parciais diferentes são dois fatos.
- **Item faturado inválido não derruba o retorno**: item com sequência inexistente, produto diferente do enviado, quantidade acima do saldo, ou sequência repetida no próprio retorno é **descartado**; o retorno é aceito (`200`) e o item volta em `itens_descartados` (e aparece no monitor do BKO). Corrija pelo ERP/BKO.

<!-- exemplo:retorno-aceito:itens_descartados -->
```json
{
  "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
  "status": "faturado_parcial",
  "repetido": false,
  "itens_descartados": [
    {
      "indice": 1,
      "sequencia": 9,
      "produto_external_id": "P000099",
      "quantidade": 3,
      "codigo": "sequencia_inexistente",
      "codigos": [
        "sequencia_inexistente"
      ],
      "campo": "itens_faturados[1].sequencia",
      "motivo": "O pedido enviado não tem o item de sequência 9. O item foi ignorado; o status do retorno valeu."
    }
  ]
}
```
<!-- /exemplo -->

- **`422` é definitivo** (não reenvie igual): `pedido_desconhecido` (o Hub não conhece o pedido), `pedido_nao_entregue` (ele nunca saiu em `pendentes`), `transicao_invalida` (estado impossível a partir do atual; a mensagem diz o que é possível), `numero_erp_divergente` (o mesmo pedido não pode ter dois números; provável gravação duplicada no ERP).

<!-- exemplo:erro:retorno_pedido:422:transicao_invalida -->
```json
{
  "codigo": "transicao_invalida",
  "mensagem": "Transição inválida do pedido: rejeitado_erp → faturado_total. rejeitado_erp é um estado final.",
  "erros": [
    {
      "codigo": "transicao_invalida",
      "campo": "status",
      "mensagem": "Transição inválida do pedido: rejeitado_erp → faturado_total. rejeitado_erp é um estado final."
    }
  ],
  "requisicao_id": "req-7f3a9c2e41d8"
}
```
<!-- /exemplo -->

## 10. Exemplos curl de ponta a ponta

Variáveis usadas (bash; o `jq` é opcional). A chave é a que o administrador gerou no BKO:

```bash
export HUB="https://api-demo.macuxifdv.com.br/integracao/v1"
export MACUXI_CHAVE="<chave de API do Conector>"
export MACUXI_CONECTOR="erp-matriz"
H_AUTH=(-H "Authorization: Bearer $MACUXI_CHAVE" -H "X-Macuxi-Conector-Id: $MACUXI_CONECTOR" -H "X-Macuxi-Conector-Versao: 1.2.1")
```

**a) Onde continuar? (cursor)**

```bash
curl -sS "$HUB/cursores/produto" "${H_AUTH[@]}"
```

Cursor `null` significa carga inicial completa (seção 5). Com cursor, envie só o que mudou depois dele.

**b) Enviar produtos.** Grave o corpo em `lote-produtos.json`:

<!-- exemplo:lote:produto -->
```json
{
  "versao_contrato": "v1",
  "entidade": "produto",
  "modo": "delta",
  "cursor": {
    "alterado_em": "2026-11-05T13:45:10Z",
    "external_id": "P000045"
  },
  "enviado_em": "2026-11-05T13:46:00Z",
  "conector_id": "erp-matriz",
  "versao_conector": "1.2.1",
  "registros": [
    {
      "external_id": "P000045",
      "alterado_em": "2026-11-05T13:45:10Z",
      "ativo": true,
      "sku": "REF-0045",
      "ean": "7891234567895",
      "nome": "Refrigerante Cola 2 L",
      "marca": "Marca Exemplo",
      "categoria": "Bebidas",
      "unidade": "UN",
      "embalagem_medida": "CX",
      "embalagem_quantidade": 6,
      "catalogo_no_external_id": "N010",
      "custo_cents": 450,
      "preco_venda_cents": 790,
      "desconto_maximo_pct": 5
    }
  ]
}
```
<!-- /exemplo -->

E envie, usando o SHA-256 do arquivo como `Idempotency-Key` (reenviar o mesmo arquivo repete a mesma chave):

```bash
CHAVE_IDEM=$(sha256sum lote-produtos.json | cut -d' ' -f1)   # PowerShell: (Get-FileHash lote-produtos.json -Algorithm SHA256).Hash.ToLower()
curl -sS -i -X POST "$HUB/lotes" "${H_AUTH[@]}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $CHAVE_IDEM" \
  --data-binary @lote-produtos.json
```

Resposta `202`:

<!-- exemplo:aceito:aceito -->
```json
{
  "lote_id": "5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1",
  "status": "recebido",
  "entidade": "produto",
  "modo": "delta",
  "recebidos": 1,
  "consulta": "/integracao/v1/lotes/5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1"
}
```
<!-- /exemplo -->

**c) Consultar o lote até o status final** (a cada 5 segundos; `recebido` e `processando` ainda não terminaram):

```bash
LOTE="5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1"   # lote_id da resposta anterior
while true; do
  R=$(curl -sS "$HUB/lotes/$LOTE?limite_erros=1000" "${H_AUTH[@]}")
  S=$(echo "$R" | jq -r .status)
  echo "status: $S"
  case "$S" in concluido|concluido_com_erros|falhou) break ;; esac
  sleep 5
done
echo "$R" | jq '{status, contagens, erros, cursor}'
```

Resposta final sem erros:

<!-- exemplo:resultado:concluido -->
```json
{
  "lote_id": "5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1",
  "entidade": "produto",
  "modo": "delta",
  "status": "concluido",
  "contagens": {
    "recebidas": 1,
    "duplicadas_no_lote": 0,
    "com_erro": 0,
    "novas": 1,
    "atualizadas": 0,
    "inalteradas": 0,
    "obsoletas": 0
  },
  "erros": [],
  "avisos": [],
  "cursor": {
    "alterado_em": "2026-11-05T13:45:10Z",
    "external_id": "P000045"
  },
  "erros_total": 0,
  "erros_omitidos": 0,
  "inativadas": 0,
  "recebido_em": "2026-11-05T13:46:01Z",
  "concluido_em": "2026-11-05T13:46:04Z"
}
```
<!-- /exemplo -->

**d) Conferir o cursor** depois do lote final:

```bash
curl -sS "$HUB/cursores/produto" "${H_AUTH[@]}"
```

<!-- exemplo:cursor:com_cursor -->
```json
{
  "entidade": "produto",
  "cursor": {
    "alterado_em": "2026-11-05T13:45:10Z",
    "external_id": "P000045"
  },
  "atualizado_em": "2026-11-05T13:46:04Z"
}
```
<!-- /exemplo -->

**e) Buscar os pedidos aprovados**

```bash
curl -sS "$HUB/pedidos/pendentes?limite=50" "${H_AUTH[@]}"
```

(Resposta: seção 9.) Grave cada pedido no ERP pelo `pedido_uuid`.

**f) Mandar o retorno.** Grave em `retorno.json` e envie:

<!-- exemplo:retorno:integrado -->
```json
{
  "versao_contrato": "v1",
  "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
  "status": "integrado",
  "numero_erp": "PV-004512",
  "ocorrido_em": "2026-11-05T14:02:00Z"
}
```
<!-- /exemplo -->

```bash
PEDIDO="3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c"
curl -sS -X POST "$HUB/pedidos/$PEDIDO/retorno" "${H_AUTH[@]}" \
  -H "Content-Type: application/json" \
  --data-binary @retorno.json
```

<!-- exemplo:retorno-aceito:integrado -->
```json
{
  "pedido_uuid": "3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c",
  "status": "integrado",
  "repetido": false
}
```
<!-- /exemplo -->

## 11. Sinal de vida e reconciliação

**Sinal de vida** (`POST /sinal`, a cada minuto): opcional para a API direta, mas recomendado. O BKO mostra o Conector como `ok`, `atrasado` (3 min sem sinal) ou `sem sinal` (alerta com 15 min), e a resposta traz a política de versão da empresa. Não leva dado pessoal.

<!-- exemplo:sinal:sinal -->
```json
{
  "conector_id": "erp-matriz",
  "versao_conector": "1.2.1",
  "versao_contrato": "v1",
  "em": "2026-11-05T14:00:00Z",
  "fila": [
    {
      "estado": "pendente",
      "lotes": 1,
      "linhas": 320,
      "maisAntigo": "2026-11-05T13:59:10Z"
    }
  ],
  "entidades": [
    {
      "entidade": "produto",
      "fase": "delta",
      "ultimo_sucesso": "2026-11-05T13:58:00Z",
      "bloqueada": false,
      "lotes_na_fila": 1
    }
  ],
  "parado_por_versao": false
}
```
<!-- /exemplo -->

**Reconciliação** (`POST /reconciliacoes`, uma vez por dia e por entidade): você informa a contagem de ativos no ERP e, onde existir, uma soma de controle (preço: `preco_cents`; estoque: `saldo`; título: `saldo_cents`; nota: `total_cents`; as demais, só contagem). O Hub compara com o que tem e avisa divergência no BKO. Reenviar o mesmo dia substitui o anterior; `data_referencia` aceita de D-7 a D+1.

<!-- exemplo:reconciliacao:estoque -->
```json
{
  "versao_contrato": "v1",
  "entidade": "estoque",
  "data_referencia": "2026-11-05",
  "contagem": 1250,
  "soma": 48230500
}
```
<!-- /exemplo -->

---

*Gerado junto com o OpenAPI: os blocos JSON entre `exemplo` são reescritos por `pnpm --filter @macuxi/integracao openapi` e conferidos por teste. Não edite esses blocos à mão.*
