# Integração — desenho do Hub `/integracao/v1`

> Tarefa T-0009 · módulo `integracao` · 2026-10-31 · status: revisado pelo modulo-integracao (dono) em 2026-10-31; revisão do engenheiro-software pendente
> Escopo: núcleo do Hub em funções puras e contratos Zod. **Sem banco, sem rotas, sem Conector** nesta tarefa.
> Requisitos: RF-INT-01 (Hub REST), RF-INT-02 (Conector), RF-INT-03 (carga por arquivo), RF-INT-04 (monitor), RF-INT-06 (reconciliação). Regras: RN-INT-01..09 (`docs/produto/03`, seção 9). Fonte do fluxo: `docs/produto/06-integracao-erp.md`.
> Código: `modules/integracao/contracts` (formato) e `modules/integracao/domain` (decisões).

## 1. Visão

O Macuxi é **dono do contrato**. Os três caminhos de entrada (Conector, API nuvem-a-nuvem, arquivo — RF-INT-02/03/05) produzem o mesmo envelope de lote e passam pelas mesmas regras:

```
ERP ─► Conector ─POST /integracao/v1/lotes─► envelope ─validarEnvelope─► 202 {lote_id}
                                                         │ (recusa inteira se inválido)
                                       fila assíncrona ──┴─► staging ─► validarLinhas (hash, erro por linha)
                                         ─► verificarReferencias ─► classificarMudancas ─► grava + evento
                                         ─► calcularResultadoLote ─► avancarCursor ─► (sessão completa) inativar
```

A API (outra tarefa) só orquestra I/O; **toda decisão está no `domain`** como função pura, parametrizada por argumentos com padrão (`PARAMETROS_PADRAO`).

## 2. Entidades do Hub

Schema `integracao` (docs/produto/04). Toda tabela segue a regra comum: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id` quando fizer sentido, RLS ligado. Campos abaixo são os de negócio.

### 2.1 `conector` (RF-INT-02/04)
Instância do Conector (ou adaptador/arquivo) de um tenant.
| Campo | Observação |
|---|---|
| `nome`, `tipo` | `conector` \| `nuvem` \| `arquivo` |
| `ativo` | desativar revoga credenciais |
| `ultimo_sinal_em` | batimento a cada 1 min; alerta no BKO se > 15 min sem sinal (doc 06) |
| `versao` | versão do executável (atualização automática) |
| `ips_permitidos` | opcional |

`credencial` (separada): `conector_id`, `hash_segredo` (nunca o segredo), `escopos`, `expira_em`, `rotacionada_em`, `revogada_em`. Credencial rotacionável, escopo por tenant (doc 06 "Segurança").

### 2.2 `lote` (RN-INT-01/03/08)
| Campo | Observação |
|---|---|
| `conector_id`, `entidade`, `modo` | `modo` = `completo` \| `delta` |
| `versao_contrato` | `v1` (RN-INT-09) |
| `sessao_id`, `sessao_parte`, `sessao_ultimo` | só no modo completo (RN-INT-06) |
| `status` | `recebido` → `processando` → `concluido` \| `concluido_com_erros` \| `falhou` |
| `recebidas`, `duplicadas_no_lote`, `com_erro`, `novas`, `atualizadas`, `inalteradas`, `inativadas` | contagens do resultado |
| `cursor_declarado` | informado pelo Conector (informativo) |
| `recebido_em`, `iniciado_em`, `concluido_em` | UTC |

**Estados do lote** (`transicionarLote`, RN-INT-08):
```
recebido ─► processando ─► concluido                       (final)
   │            ├────────► concluido_com_erros ─► processando   (reprocessar linhas)
   └─► falhou ◄─┴────────► falhou ──────────────► processando   (reprocessar)
```
Transição fora da tabela é rejeitada (`transicao_invalida`). Envelope recusado (seção 7) **não cria lote**.

### 2.3 `lote_linha_erro` (RN-INT-03, RF-INT-04)
| Campo | Observação |
|---|---|
| `lote_id`, `indice` | posição da linha, base 0 |
| `external_id` | chave do registro no ERP (ver nota de privacidade abaixo); pode ser nulo |
| `codigo`, `campo`, `mensagem` | mensagem legível em português, **sem o valor recebido** |
| `reprocessavel` | derivado do código |
| `payload` | linha original no staging, para reprocessar sem novo envio (acesso restrito, expurgo em 30 dias) |
| `resolvido_em` | preenchido quando um reprocessamento ou reenvio corrige |

`lote_aviso` (ou coluna no lote): avisos `duplicado_no_lote` — não são erro.

### 2.4 `mapeamento` — de-para (doc 06 "Mapeamento"; tela em RF-INT-04)
Traduz códigos do ERP para o Macuxi (e o inverso no pedido): `tipo` (`condicao_pagamento` \| `deposito` \| `status`…), `codigo_erp`, `codigo_macuxi`, `descricao`, `ativo`. Único por (`tenant_id`, `tipo`, `codigo_erp`). Usado, por exemplo, em `PedidoParaErp.condicao_pagamento_erp`.

### 2.5 `cursor_entidade` (RN-INT-05)
Um por (`tenant_id`, `conector_id`, `entidade`): `cursor_alterado_em`, `cursor_external_id`, `atualizado_em`. Monotônico (só `avancarCursor` escreve).

### 2.6 `sessao_carga` — sessão de carga completa (RN-INT-06)
`id` (UUID do Conector), `conector_id`, `entidade`, `iniciada_em`, `ultima_parte` (nula até chegar o lote `ultimo`), `status` derivado (`aberta` \| `completa` \| `expirada`), `fechada_em`, `inativadas`. Estado de cada parte = `lote.status` das partes com o mesmo `sessao_id`. Para a inativação, a API precisa do conjunto de `external_id` recebidos na sessão (inclusive linhas com erro) — guardado em `staging`/tabela auxiliar até o fechamento.

### 2.7 `reconciliacao` (RN-INT-07, RF-INT-06)
Por (`tenant_id`, `entidade`, `data_referencia`): `contagem_erp`, `soma_erp`, `contagem_macuxi`, `soma_macuxi`, `diferenca_contagem`, `diferenca_soma`, `diferenca_pct`, `divergente`, `motivos[]`, `calculada_em`. Soma de controle por entidade (`CAMPO_SOMA_CONTROLE`): preço → `preco_cents`; estoque → `saldo`; título → `saldo_cents`; nota → `total_cents`; vendedor, cliente, produto, rota → só contagem.

### 2.8 `pedido_fila_erp` — fila de pedido ao ERP (RN-INT-08)
`pedido_uuid` (único por tenant; idempotência), `estado` (`pendente` \| `enviado` \| `integrado` \| `rejeitado_erp` \| `faturado_parcial` \| `faturado_total`), `payload` (`PedidoParaErp`), `enviado_em`, `tentativas`, `numero_erp`, `motivo`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents`, `ultimo_retorno_em`. Alimentada pelo evento consumido `vendedor.pedido.status_alterado@1` quando o novo status é `aprovado` (`podeEntrarNaFila`).

**Estados do pedido no ERP** (`transicionarPedidoErp`):
```
pendente ─► enviado ─► integrado ─► faturado_parcial ─► faturado_total
              │  │         └──────────────────────────────► faturado_total   (nota única)
              │  └──► rejeitado_erp (final)
              └──► pendente  (sem confirmação em [10 min]: aplicarTimeoutEnvio)
```
Repetir o mesmo estado é idempotente (`repetida: true`): o Conector pode reenviar o retorno sem erro. `pendente`/`enviado` são do Hub; o ERP informa só `integrado`, `rejeitado_erp`, `faturado_parcial`, `faturado_total`.

## 3. Ciclo carga inicial → delta → reconciliação (RF-INT-01/06, RN-INT-05/06/07)

1. **Carga inicial completa**, por entidade, na ordem da seção 6. Cada entidade abre uma **sessão** (UUID) e envia partes `1..n` (cada lote ≤ 5.000), a última com `ultimo: true`. Linhas com erro não impedem o fechamento; **parte `falhou` mantém a sessão aberta** até ser reenviada/reprocessada.
2. **Fechamento da sessão** (todas as partes `concluido`/`concluido_com_erros`): `calcularInativacao` devolve os `external_id` ativos ausentes da carga → o Hub marca `deleted_at` (nunca apaga) e publica `integracao.<entidade>.atualizado@1` com `acao: inativado`. Sem inativação se: sessão incompleta/expirada (TTL 24 h), linha sem `external_id` legível na sessão, ou carga vazia.
3. **Delta contínuo**: o Conector consulta `GET /cursores/{entidade}`, lê do ERP `WHERE (alterado_em, external_id) > cursor` ordenado pelo par e envia lotes `modo: delta`. Cursor avança só quando o lote termina (`concluido`/`concluido_com_erros`) e **nunca retrocede**; reenvio antigo é aceito sem voltar o cursor. Registros desativados no ERP chegam com `ativo: false` (no delta, a inativação é explícita).
   - Linha com erro **não segura o cursor**: ele vale o maior par das linhas **aceitas**. A linha com erro fica no staging para reprocessar (referência ausente) ou aguarda reenvio corrigido; o Conector não precisa reler.
4. **Reconciliação diária** (`POST /reconciliacoes`): para cada entidade o Conector envia contagem de ativos e soma de controle; o Hub compara com o Macuxi (`reconciliar`). Fora da tolerância [contagem 0; soma 0,5%] → `divergente`, evento `integracao.reconciliacao.divergente@1` e alerta no monitor. Divergência recorrente é sinal para nova carga completa (decisão do operador, RF-INT-04).

Frequências sugeridas por entidade: doc 06 (preço 15 min, estoque 5–15 min, cliente/produto/título 1 h, nota 15 min…).

## 4. Idempotência (RF-INT-01, RN-INT-02)

- Chave do registro: **(`tenant_id`, `entidade`, `external_id`)** + **hash do conteúdo canônico**.
- `hashRegistro`: FNV-1a de 2 × 32 bits (16 hex) sobre `jsonCanonico` — chaves em ordem alfabética, `null`/`undefined` equivalem a campo ausente (campo novo opcional não muda o hash — RN-INT-09), `-0` = `0`, `NaN`/`Infinity` recusados. Calculado sobre o **registro já normalizado pelo schema** (padrões aplicados, textos aparados). **`alterado_em` fica fora do hash**: um `rowversion` que mudou sem mudar conteúdo não gera evento (mas o cursor avança). Puro, sem `node:crypto` (roda no app e no Conector); detecta mudança, não é segurança.
- Resultado por linha (`classificarMudancas`): sem hash gravado → **nova**; hash igual → **inalterada** (não grava, **não publica evento**); hash diferente → **atualizada** (grava e publica `integracao.<entidade>.atualizado@1`).
- Registro **inativado** pela carga completa tem o hash esquecido, para que a volta dele conte como nova (reativa).
- `external_id` repetido no mesmo lote: **vale a última ocorrência**; as anteriores viram aviso `duplicado_no_lote` e **não contam como erro nem como linha efetiva**. Se a última ocorrência for inválida, a anterior válida também não vale (a última é a verdade do ERP).
- Pedido: idempotência pelo `pedido_uuid`; reenviar o mesmo UUID à fila não duplica.
- Nota de privacidade: `external_id` deve ser a **chave interna do ERP** (código, id), nunca CPF/CNPJ — ele aparece em `lote_linha_erro` e em logs de erro. A orientação entra no guia do Conector e das views-modelo.

## 5. Erro por linha (RF-INT-04, RN-INT-03)

Linha inválida **não trava o lote**. Cada problema vira uma `LinhaErro` (`indice`, `external_id`, `codigo`, `campo`, `mensagem`, `reprocessavel`); no máximo uma por campo. Mensagens são montadas pelo schema (nome do campo, tipo esperado, valores aceitos) e **nunca carregam o valor recebido** (pode ser dado pessoal).

| Código | Quando | Reprocessável |
|---|---|---|
| `registro_invalido` | a linha não é um objeto JSON | não |
| `external_id_invalido` | `external_id` ausente, vazio ou > 100 caracteres | não |
| `campo_obrigatorio` | campo ausente, nulo ou texto vazio | não |
| `tipo_invalido` | tipo errado (inclui centavos não inteiros) | não |
| `formato_invalido` | data fora de ISO 8601 UTC, EAN, UUID… | não |
| `valor_fora_da_faixa` | negativo onde não cabe, acima do máximo | não |
| `valor_nao_permitido` | enum fora da lista | não |
| `campo_desconhecido` | chave que o contrato não conhece (hoje campos extras são ignorados — compatibilidade RN-INT-09; o código existe para schemas estritos) | não |
| `regra_invalida` | regra entre campos (ex.: fim de vigência antes do início) | não |
| `referencia_ausente` | cita `external_id` de outra entidade que ainda não existe (RN-INT-04) | **sim** |
| `falha_processamento` | falha transitória ao gravar a linha | **sim** |

- **Reprocessável**: basta tentar de novo (a dependência chegou / a falha passou); o BKO oferece "Reprocessar" usando o payload do staging. **Não reprocessável**: exige correção no ERP e reenvio.
- **Resultado do lote** (`calcularResultadoLote`): `concluido` (nenhuma linha com erro), `concluido_com_erros` (parte), `falhou` (todas as linhas efetivas com erro **ou** falha do lote). Várias issues na mesma linha contam uma linha com erro; duplicadas no lote não entram na conta.

## 6. Ordem de dependência (RN-INT-04)

```
vendedor ─► cliente ─► rota, título, nota
produto  ─► preço, estoque
```
`DEPENDENCIAS` (direto): cliente→vendedor · rota→vendedor, cliente · título→cliente · nota→cliente, vendedor · preço→produto · estoque→produto. `ordenarCarga` faz ordenação topológica estável e devolve o caminho em caso de ciclo; dependência fora da seleção é ignorada (já carregada). `verificarReferencias` confere `vendedor_external_id`, `cliente_external_id`, `produto_external_id` e `paradas[].cliente_external_id`: referência inexistente gera `referencia_ausente` (reprocessável) e a linha **não grava** — nunca há registro órfão. Sem conjunto de existentes informado, tudo é ausente.

Dono dos dados (ADR-0005): produto → `core.produto`; cliente/vendedor/rota/título/nota → `core`; preço e estoque → `catalogo`. O Hub só publica o evento; cada dono grava no próprio schema.

## 7. Limites e parâmetros (RN-INT-01)

| Parâmetro | Padrão | Onde |
|---|---|---|
| Registros por lote | 5.000 | `limiteRegistrosLote`; recusa `acima_do_limite` |
| `external_id` | 1–100 caracteres | contrato |
| Paradas por rota | 500 | contrato |
| Contatos por cliente | 20 | contrato |
| Versões aceitas | `v1` | `versoesSuportadas` |
| Tolerância de contagem | 0 | `toleranciaContagem` (RN-INT-07) |
| Tolerância de soma | 0,5 % | `toleranciaSomaPct` |
| Reenvio de pedido `enviado` | 10 min | `timeoutEnvioMin` |
| Convivência da versão anterior | 6 meses | `janelaVersaoAnteriorMeses` |
| TTL da sessão de carga completa | 24 h | `ttlSessaoMin` |
| Inativação em massa sem confirmação | 30 % dos ativos | `limiteInativacaoPct` (RN-INT-06) |

Todos entram nas funções como argumento opcional com padrão em `PARAMETROS_PADRAO`; a API lê os valores do tenant (`plataforma.parametro`). Recusa do envelope (`validarEnvelope`, HTTP 4xx, **sem lote criado**): `envelope_invalido`, `versao_nao_suportada`, `entidade_desconhecida`, `lote_vazio`, `acima_do_limite`, `sessao_ausente` (completo sem sessão), `sessao_nao_se_aplica` (delta com sessão). Todos os problemas do envelope voltam juntos.

## 8. Contrato canônico por entidade (RF-INT-01, RN-INT-09)

Regras comuns: dinheiro em **centavos inteiros** (sufixo `_cents`, como no Core); datas-hora **ISO 8601 UTC com `Z`**, datas civis `AAAA-MM-DD`; `external_id` obrigatório; `alterado_em` obrigatório (alimenta o cursor); `ativo` (padrão `true`); campos desconhecidos são ignorados (compatibilidade para frente).

| Entidade | Registro = | Principais campos (além de `external_id`, `alterado_em`, `ativo`) | Referências |
|---|---|---|---|
| `vendedor` | vendedor | `nome`, `email?`, `telefone?` | — |
| `cliente` | cliente | `razao_social`, `nome_fantasia?`, `documento?`, `endereco?`, `latitude?/longitude?`, `telefone?`, `email?`, `limite_credito_cents?`, `bloqueado`, `contatos[]` | `vendedor_external_id?` (carteira) |
| `produto` | cadastro base do Core (ADR-0005) | `sku`, `ean?`, `nome`, `marca?`, `categoria?`, `unidade` | — |
| `preco` | **item** de tabela de preço | `tabela_external_id`, `tabela_nome`, `vigencia_inicio`, `vigencia_fim?`, `preco_cents` | `produto_external_id` |
| `estoque` | saldo de um produto num depósito | `deposito_external_id`, `deposito_nome?`, `saldo` (reservas são do Macuxi) | `produto_external_id` |
| `titulo` | título financeiro | `numero`, `parcela?`, `emissao?`, `vencimento`, `valor_cents`, `saldo_cents`, `situacao` (aberto/baixado/cancelado), `baixado_em?` | `cliente_external_id` |
| `nota` | nota de faturamento ou devolução | `tipo`, `numero`, `serie?`, `emitida_em`, `total_cents`, `quantidade_itens?`, `pedido_uuid?`, `cancelada` | `cliente_external_id`, `vendedor_external_id?` |
| `rota` | rota com paradas | `nome`, `dia_semana?` (0–6), `paradas[] {ordem, cliente_external_id}` | `vendedor_external_id`, `cliente_external_id` |

Decisão: **preço e estoque são um registro por item/saldo** (com o cabeçalho da tabela/depósito repetido), e não "tabela com lista de itens". Motivo: tabelas grandes estouram o lote de 5.000, o delta e a idempotência ficam por item, e o `external_id` do item (ex.: `TAB01:SKU123`) é a chave. Fora desta tarefa: condições de pagamento, financeiro do cliente (limite/saldo além de `limite_credito_cents`) e categorias/marcas como entidades próprias (hoje são texto em `produto`).

Pedido ao ERP e retorno (RN-INT-08):
- `PedidoParaErp` — `pedido_uuid`, `cliente_external_id`, `vendedor_external_id`, `condicao_pagamento_erp?`, `criado_em`, `aprovado_em`, `itens[] {sequencia, produto_external_id, quantidade, preco_unitario_cents, desconto_cents, total_cents}`, `desconto_total_cents`, `total_cents`, `tentativa`.
- `RetornoErp` — `pedido_uuid`, `status` (`integrado` \| `rejeitado_erp` \| `faturado_parcial` \| `faturado_total`), `numero_erp` (obrigatório ao integrar/faturar), `motivo` (obrigatório ao rejeitar), `nota` (obrigatória ao faturar), `ocorrido_em`. Cada retorno aceito publica `integracao.pedido.retorno_erp@1`.

## 9. Versionamento do `/integracao/v1` (RN-INT-09)

- Versão no caminho (`/integracao/v1/...`) **e** no envelope (`versao_contrato: "v1"`). Versão fora de `versoesSuportadas` → `versao_nao_suportada` (recusa inteira, mensagem lista as aceitas).
- **Compatível** (continua `v1`): campo novo opcional, valor novo de enum, endpoint novo. **Incompatível** (`/v2` + ADR): campo obrigatório novo, campo tornado obrigatório, remoção, renomeação, mudança de tipo, valor de enum removido, limite reduzido (`classificarMudancaContrato`).
- `/v2` e `/v1` convivem **6 meses** após a substituição (`situacaoVersao`: `ativa` → `em_descontinuacao` → `encerrada`); o BKO alerta o tenant cujo Conector ainda usa a versão em descontinuação.
- OpenAPI publicado é gerado dos schemas Zod de `modules/integracao/contracts` (tarefa da API).
- **Rotas previstas (não implementadas nesta tarefa)** — todas exigem credencial do Conector, escopo do tenant e licença do módulo `integracao`:

| Rota | Quem chama | Função |
|---|---|---|
| `POST /integracao/v1/lotes` | Conector / arquivo | envia lote (`LoteEnvelope`); 202 `LoteAceito` ou 4xx `RecusaEnvelope` |
| `GET /integracao/v1/lotes/{id}` | Conector / BKO | `LoteResultado` com erros por linha |
| `POST /integracao/v1/lotes/{id}/reprocessar` | BKO | reprocessa linhas reprocessáveis (RF-INT-04) |
| `GET /integracao/v1/cursores/{entidade}` | Conector | `CursorEntidade` — de onde continuar o delta |
| `POST /integracao/v1/reconciliacoes` | Conector | `ReconciliacaoEnvio`; devolve `ResultadoReconciliacao` |
| `GET /integracao/v1/pedidos/pendentes` | Conector | `PedidosPendentes`; marca como `enviado` (poll 1–2 min) |
| `POST /integracao/v1/pedidos/{pedido_uuid}/retorno` | Conector | `RetornoErp` → `RetornoAceito` (idempotente) |
| `POST /integracao/v1/sinal` | Conector | batimento (1 min), versão do Conector |

Carga por arquivo (RF-INT-03): o BKO converte Excel/CSV em `LoteEnvelope` com o mesmo contrato; as colunas do modelo de planilha espelham os campos da seção 8.

## 10. Eventos

Publicados pelo manifesto (`modules/integracao/manifest.ts`), schemas em `contracts/eventos.ts`:

| Evento | Quando | Consumidores |
|---|---|---|
| `integracao.vendedor.atualizado@1` | registro novo, alterado (hash novo) ou inativado | core |
| `integracao.cliente.atualizado@1` | idem | core, catalogo, vendedor |
| `integracao.produto.atualizado@1` | idem | core, catalogo, vendedor |
| `integracao.preco.atualizado@1` | idem | catalogo, vendedor |
| `integracao.estoque.atualizado@1` | idem | catalogo, vendedor |
| `integracao.titulo.atualizado@1` | idem | core, vendedor |
| `integracao.nota.atualizado@1` | idem | core (metas), vendedor (status) |
| `integracao.rota.atualizado@1` | idem | core |
| `integracao.pedido.retorno_erp@1` | cada retorno aceito do ERP | vendedor |
| `integracao.lote.concluido@1` **(novo)** | lote chegou a `concluido`, `concluido_com_erros` ou `falhou` | monitor / notificações |
| `integracao.reconciliacao.divergente@1` **(novo)** | divergência acima da tolerância | monitor / notificações |

Payload de `*.atualizado@1`: `lote_id`, `entidade`, `external_id`, `acao` (`criado` \| `atualizado` \| `inativado`), `hash`, `registro?` (omitido em `inativado`), `ocorrido_em`. Um evento por registro que mudou; reenvio com hash igual **não** publica.

Consumido: `vendedor.pedido.status_alterado@1` — quando o novo status é `aprovado`, enfileira o pedido (`pedido_fila_erp`, idempotente pelo UUID). O schema do payload é do Vendedor; o Hub lê só o `pedido_uuid` e o `status`.

Os 4 eventos `*.atualizado@1` de vendedor/título/nota/rota e os 2 eventos novos entram no registro `.coord/contratos/eventos.md` por recado ao engenheiro-software (a linha curinga `integracao.<entidade>.atualizado@1` já os cobre).

## 11. Para o banco-dados

Tabelas sugeridas do schema `integracao` (só texto; o desenho final e as migrações são do `banco-dados`). Todas com `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, RLS por `tenant_id`.

| Tabela | Chave / índices | Volume e consultas |
|---|---|---|
| `conector` | único (`tenant_id`, `nome`) | dezenas por tenant; leitura do monitor e do batimento |
| `credencial` | `conector_id`; índice por `hash_segredo` (consulta de autenticação, p95 < 50 ms) | rotação gera nova linha, nunca sobrescreve |
| `lote` | (`tenant_id`, `conector_id`, `recebido_em desc`), (`tenant_id`, `entidade`, `status`), (`sessao_id`) | centenas/dia por tenant; monitor lista os últimos lotes com filtros por entidade/status/período; retenção 12 meses |
| `lote_linha_erro` | (`lote_id`, `indice`), (`tenant_id`, `codigo`, `resolvido_em`) | até 5.000 por lote; consulta por lote e por código; `payload` jsonb com expurgo em 30 dias |
| `lote_aviso` | (`lote_id`, `indice`) | avisos `duplicado_no_lote`; pode ser coluna jsonb no `lote` |
| `staging_<entidade>` (uma por entidade, 8) | único (`tenant_id`, `external_id`); colunas: `hash`, `payload jsonb`, `alterado_em`, `lote_id`, `ativo`, `aplicado_em` | espelho do último registro aceito; base do comparador de hash (`Map external_id → hash` dos ativos) e do reprocessamento; milhões de linhas (preço/estoque); hash esquecido (nulo) ao inativar |
| `sessao_carga` | PK = id da sessão; (`tenant_id`, `entidade`, `status`) | uma por carga completa; guarda `ultima_parte`; conjunto de `external_id` recebidos (tabela auxiliar `sessao_carga_recebido` ou derivado do staging por `lote_id`) até o fechamento |
| `mapeamento` | único (`tenant_id`, `tipo`, `codigo_erp`) | centenas; leitura a cada montagem de pedido; tela no BKO |
| `cursor_entidade` | único (`tenant_id`, `conector_id`, `entidade`) | 8 linhas por conector; escrita monotônica (`UPDATE ... WHERE novo > atual` ou comparação em transação) |
| `reconciliacao` | único (`tenant_id`, `entidade`, `data_referencia`) | 8/dia por tenant; consulta dos últimos 30 dias e das divergentes |
| `pedido_fila_erp` | único (`tenant_id`, `pedido_uuid`); (`tenant_id`, `estado`, `enviado_em`) | milhares/dia; consulta quente `estado = 'pendente'` (poll 1–2 min) e varredura de `enviado` vencido (timeout) |

Pedidos ao `banco-dados` ainda a fazer em tarefa própria: views-modelo do Conector (`db/conector/views-modelo.sql`) com as colunas da seção 8; política de expurgo; RLS e teste de vazamento entre tenants para o schema `integracao`.

## 12. Fora desta tarefa
Rotas Fastify, persistência, fila (pg-boss), telas do monitor/mapeamento/upload (BKO), Conector (`apps/conector`), adaptadores nuvem-a-nuvem (RF-INT-05) e geração do OpenAPI.

## 13. Decisões e perguntas em aberto
- **Decididas (gerente, T-0009)**: última ocorrência vence no lote; cursor `(alterado_em, external_id)`; tolerância 0 / 0,5 %; reenvio ao ERP após 10 min.
- **Assumidas aqui** (revisar): `alterado_em` fora do hash; `null` = ausente no hash; `integrado → faturado_total` direto aceito; `rejeitado_erp` final (reenfileirar um pedido rejeitado exigiria nova aprovação gerando novo ciclo — a regra não prevê); unidade de preço/estoque por item; `external_id` ≤ 100 caracteres; sessão expira em 24 h; carga completa vazia nunca inativa.
- **Decididas na revisão do dono (2026-10-31)**:
  - (2) **Trava de inativação em massa**: `calcularInativacao` não inativa se a carga completa fosse inativar mais de `limiteInativacaoPct` (padrão 30 %) dos ativos; devolve `motivo: excede_limite_inativacao` e `candidatos`; o operador confirma no BKO (`confirmado: true`). Implementado e testado.
  - (3) **Quantidade/saldo fracionário**: mantém `number` no contrato (o ERP define a precisão). A soma de controle de estoque é comparada com a tolerância de 0,5 %, que absorve ruído de ponto flutuante; a API deve somar em milésimos (`Math.round(x*1000)`) antes de enviar ao `reconciliar`. Sem mudança de contrato.
  - Revisão: precisão do cursor — `Date.parse` trunca a milissegundos; o Conector deve enviar `alterado_em` em ms (ex.: `datetime2(3)` ou `rowversion` convertido). Entra no guia do Conector e nas views-modelo.
- **Abertas, de produto/outro dono (não decididas aqui)**: (1) pedido cancelado no Vendedor depois de `enviado` — o ERP deve ser avisado? Exige regra no doc 03 (RN do Vendedor/Integração) e possivelmente estado `cancelado` em RN-INT-08 e evento consumido novo; decisão do Alexandre com o `modulo-vendedor`.
