# Hub de Integração — API `/integracao/v1`: desenho, contratos HTTP e domínio de ingestão

> Tarefa T-0025 (Sprint 2, frente nuvem) · módulo `integracao` · 2026-11-01 · status: **desenho entregue; revisão do engenheiro-software e do banco-dados pendente** (recados abertos na entrega).
> **T-0027 (2026-11-01, alinhamento Conector ↔ Hub)**: divergências D-1..D-7 da seção 16 **fechadas** no código (Conector 1.2.0 + domain); decisões P-1, P-2, P-5 e P-6 refletidas nos contracts/domain; `external_id` até 200 caracteres nos dois lados. P-3, P-4 e P-7 registradas na seção 18.2 (P-4 e P-3 ainda pedem ajuste fora desta tarefa).
> Escopo: especificação de cada endpoint, autenticação por chave de API do Conector, limites, ingestão em lote, pedidos, reconciliação, monitor e o que cada agente implementa. **Sem rotas, sem migração e sem telas nesta tarefa** — só este documento, `modules/integracao/contracts` (Zod), `modules/integracao/domain` (regras puras com testes) e o manifesto.
> Requisitos: RF-INT-01, 02, 04, 06. Regras: RN-INT-01..09 (`docs/produto/03`, seção 9) e as **propostas RN-INT-10..12** da seção 18. Complementa `desenho.md` (T-0009: entidades, estados, idempotência por registro) e `conector.md` (T-0013/T-0023: o cliente HTTP que já existe; a seção 9 dele listava o que o Hub precisava expor — é isto aqui).
> Código: contratos em `contracts/hub.ts` (rotas, cabeçalhos, erros), `contracts/bko.ts` (rotas do BKO), `contracts/lote.ts`/`pedido.ts`/`conector.ts` (corpos); regras em `domain/` (`lote-idempotencia`, `credencial`, `conector-versao`, `limites`, `linhas-invalidas`, `inativacao`, `aplicacao`, `pedido-fila`, `monitor`, mais os já existentes).

## 1. Visão e princípios

```
ERP ──SQL──► Conector (cliente) ──HTTPS 443, só saída──► Hub /integracao/v1 ──► staging ──► validação ──► aplicação ──► eventos ──► módulos
ERP ◄──SQL── Conector ◄──GET /pedidos/pendentes── Hub ◄── fila de pedidos aprovados ◄── evento do Vendedor
              Conector ──POST /pedidos/{uuid}/retorno──► Hub ──► integracao.pedido.retorno_erp@1 ──► Vendedor
BKO (navegador) ──JWT──► /v1/integracao/*  (cadastro de Conector, chave, monitor, reprocessar, confirmar inativação, mapeamento)
```

1. **A nuvem nunca acessa o banco do cliente.** O Conector empurra (delta) e busca pedidos; toda conexão é de saída.
2. **O `tenant_id` deriva da chave de API**, nunca do corpo, da query nem de cabeçalho. Depois de autenticar, todo acesso ao banco passa por `comTenant(tenant_da_chave)` com o papel `macuxi_app` e RLS; sem tenant resolvido, 0 linhas.
3. **Dois conjuntos de rotas, duas autenticações.** *Hub* (`/integracao/v1/*`, 7 rotas, para o Conector): chave de API por Conector. *BKO* (`/v1/integracao/*`): JWT do usuário, perfil por ação do manifesto, licença do módulo, como as demais rotas de módulo (ADR 0004/0006). A chave do Conector **só** abre `/integracao/v1` (escopo `integracao.v1`).
4. **Processamento assíncrono, resposta rápida**: `POST /lotes` valida o envelope, grava lote + staging e responde `202`; a aplicação roda em segundo plano (seção 8).
5. **Idempotência em duas camadas**: por **lote** (`Idempotency-Key`, seção 5) e por **registro** (`external_id` + hash, RN-INT-02, `desenho.md` §4).
6. **O Macuxi é dono do contrato** (RN-INT-09): campo novo opcional, valor novo de enum e rota nova são compatíveis com `v1`; o resto vira `/v2` com ADR. Tudo que esta tarefa acrescentou é desse tipo (seção 16).
7. **Sem dado pessoal em log.** Linhas, valores, CPF/CNPJ, e-mail, telefone e a chave de API nunca entram em log, em `detalhes` de erro nem em `mensagem`. O que aparece é `external_id` (chave interna do ERP, nunca CPF/CNPJ), nome de campo, código e contagens.

## 2. Transporte e convenções

| Item | Regra |
|---|---|
| Base | `https://<hub>/integracao/v1`. HTTPS obrigatório (HSTS); HTTP só em desenvolvimento (`localhost`). |
| Corpo | `application/json; charset=utf-8`. Sem compressão de requisição na v1. Datas-hora ISO 8601 UTC com `Z`; datas civis `AAAA-MM-DD`; dinheiro em centavos inteiros (RN-INT-09). |
| Cabeçalhos do Conector | `Authorization: Bearer <chave>` e `X-Macuxi-Conector-Id: <identificador>` em **toda** chamada. `X-Macuxi-Conector-Versao: <semver>` e `User-Agent: macuxi-conector/<versão>` informativos (a versão ausente ou ilegível nunca bloqueia). |
| Cabeçalho do lote | `Idempotency-Key` em `POST /lotes` (16–128 caracteres seguros; o Conector manda o SHA-256 hex). |
| Cabeçalhos da resposta | `X-Request-Id` (rastreio ponta a ponta, vai nos logs; também em `requisicao_id` no erro), `Retry-After` (segundos inteiros) em 429/503, `Idempotent-Replay: true` na repetição de lote. |
| Erro padrão | `{ "codigo": "...", "mensagem": "...", "detalhes"?: {...}, "requisicao_id"?: "..." }` — o mesmo formato `ErroApi` da plataforma (`ErroHub`, `contracts/hub.ts`). Recusa de lote e de retorno acrescentam `erros[]` (`RecusaLote`, `RecusaRetorno`) para o Conector v1.1 ler como já lê. Mensagens em português, com a ação seguinte. |
| Versão do contrato | `versao_contrato: "v1"` no corpo (lote, retorno, reconciliação, sinal) **e** no caminho. |

### 2.1 Códigos de erro e HTTP

| HTTP | `codigo` | Quando | O Conector faz |
|---|---|---|---|
| 400 | `requisicao_invalida` | cabeçalho/param/query/corpo fora do contrato (Zod) em rota que não é de lote; `pedido_uuid` do caminho ≠ do corpo; `data_referencia` fora da janela | recusa definitiva (não reenvia) |
| 400 | `envelope_invalido`, `chave_idempotencia_invalida` | corpo de lote ilegível/fora do envelope; `Idempotency-Key` ausente ou fora do formato | recusa definitiva; **bloqueia a entidade** até `retomar` |
| 401 | `credencial_invalida` | chave desconhecida, revogada, expirada, fora da convivência, ou identificador de outro Conector. **Mensagem genérica** (não revela qual) | pausa longa, `hub_credencial_recusada`; nada se perde |
| 403 | `acesso_negado` | escopo ≠ `integracao.v1`, Conector desativado, IP fora da lista, Conector sem `recebe_pedidos` pedindo pedidos | idem 401 |
| 403 | `modulo_inativo` | licença do módulo `integracao` desligada no tenant (RN-CORE-02) | idem 401 |
| 404 | `lote_nao_encontrado` | lote inexistente, de outro Conector ou de outro tenant (não distingue) | reenvia o lote (mesma chave) |
| 404 | `entidade_desconhecida` | `GET /cursores/{entidade}` com entidade fora das 8 | erro de configuração |
| 409 | `chave_idempotencia_reutilizada` | `Idempotency-Key` já usada com **conteúdo diferente** (seção 5) | recusa definitiva; bloqueia a entidade |
| 413 | `corpo_grande` | corpo acima do limite da rota (seção 4) | recusa definitiva |
| 422 | `versao_nao_suportada`, `entidade_desconhecida`, `lote_vazio`, `acima_do_limite`, `sessao_ausente`, `sessao_nao_se_aplica`, `entidade_de_outro_conector` (P-6) | recusa do envelope (RN-INT-01), **sem lote criado** | recusa definitiva (bloqueia a entidade até `retomar`) |
| 422 | `pedido_desconhecido`, `pedido_nao_entregue`, `transicao_invalida`, `numero_erp_divergente`, `itens_faturados_invalidos` | recusa do retorno (RN-INT-08) | recusa definitiva (`retorno_recusado_pelo_hub`) |
| 426 | `versao_conector_nao_suportada` | Conector **abaixo da versão mínima** em rota de dados (seção 12); `detalhes.versao_minima` com a mínima | **pausa** (T-0027): não bloqueia entidade nem descarta nada; guarda a mínima como política e segue só com o sinal até o Hub liberar |
| 429 | `limite_de_taxa` | balde do Conector vazio, ou excesso de falhas de autenticação por IP | espera `Retry-After` e repete |
| 503 | `servico_indisponivel` | banco/fila indisponível (falha fechada) | repete com backoff |

Regra do HTTP no envelope: qualquer `envelope_invalido` ⇒ **400**; só erros de regra (versão, entidade, vazio, limite, sessão) ⇒ **422**. Todos os problemas do envelope voltam juntos.

## 3. Autenticação: chave de API por Conector (RN-INT-10, proposta)

**Decisão do Alexandre (2026-10-31)**: uma chave por Conector (não por tenant), rotacionável no BKO, escopo só `/integracao/v1`. Aqui o desenho completo.

### 3.1 A chave
- Formato `mxk_<prefixo de 8>_<43 caracteres base64url>` (256 bits aleatórios do CSPRNG), 56 caracteres. O **prefixo** não é segredo: aparece no BKO e nos logs para identificar a chave. O Conector aceita 16–512 caracteres sem espaço (`trocar-chave`), então o formato pode evoluir sem quebrar.
- **Guardada só como hash**: `HMAC-SHA256(pepper, chave)` em hexadecimal, onde o pepper vem do `.env` do servidor (`MACUXI_HUB_CHAVE_PEPPER`, nunca no banco nem no repositório). A chave tem entropia alta: não precisa de hash lento, e o hash indexado dá a busca em p95 < 50 ms. Comparação final em tempo constante (`timingSafeEqual`).
- **Mostrada uma única vez** (`ChaveConectorCriada.chave`) na criação e na rotação. Perdeu? Rotaciona.
- O identificador do Conector (`conector_id`, letras/números/`.`/`-`/`_`, ≤ 100) **não é segredo**: vai em `X-Macuxi-Conector-Id` e no arquivo do Conector (`hub.conectorId`). A chave só vale com o identificador do Conector dono dela.

### 3.2 Como a API autentica (ordem)
```
1. limite de falhas por IP        (20 falhas/min → 429; reaproveita o limitador em memória do apps/api, ADR 0006 item "limite")
2. Zod nos cabeçalhos             (CabecalhosConector → 400)
3. hash da chave → função SECURITY DEFINER integracao.autenticar_chave(hash)   (única consulta sem tenant; devolve a linha da credencial + tenant_id)
4. avaliarChaveConector(...)      (domain/credencial.ts) → 401 genérico | 403 | ok(ativa | em_convivencia)
5. IP na lista do Conector        (node:net BlockList; lista vazia = qualquer IP)
6. licença do módulo no tenant    (plataforma.tenant_modulo, RN-CORE-02 → 403 modulo_inativo)
7. balde de taxa do Conector      (classeDaRota + consumirToken → 429 + Retry-After)
8. política de versão             (avaliarVersaoConector → 426 nas rotas de dados, seção 12)
9. comTenant(tenant_da_chave) e a rota
```
O motivo exato da recusa (`MotivoRecusaChave`: `chave_desconhecida`, `conector_id_ausente`, `conector_divergente`, `revogada`, `expirada`, `fora_da_convivencia`, `escopo_invalido`, `conector_inativo`, `ip_nao_permitido`, `modulo_inativo`) vai **só** para o log (com `prefixo`, `conector_id`, IP e `requisicao_id`; nunca a chave) e para o monitor; a resposta é genérica. `ultimo_uso_em` da credencial é atualizado no máximo 1 vez/min (sem escrever a cada chamada).

### 3.3 Ciclo de vida (BKO, ação `conector.gerenciar`, só `admin`)
| Operação | Rota BKO | Efeito |
|---|---|---|
| Cadastrar | `POST /v1/integracao/conectores` | cria o Conector + a 1ª chave (`ConectorCriado`, chave em claro uma vez) |
| Rotacionar | `POST /v1/integracao/conectores/{id}/chave/rotacionar` `{ convivencia_min? }` | nova chave vira `atual`; a antiga vira `anterior` e **segue válida até `anterior_valida_ate` = agora + convivência** (padrão **24 h**, 0 = revoga na hora, máx. 7 dias; `rotacionarChaves`). A anterior que já existia (rotação dentro da convivência) é revogada: **no máximo duas chaves válidas** |
| Revogar | `POST /v1/integracao/conectores/{id}/chave/revogar` `{ alvo: atual \| anterior \| todas, motivo? }` | marca `revogada_em` (idempotente) |
| Desativar | `PATCH /v1/integracao/conectores/{id}` `{ ativo: false }` | revoga as duas e bloqueia (403) |

Rotação sem interrupção, ponta a ponta:
```
Operador (BKO)         Hub                                  Técnico do cliente / Conector
  rotacionar ───────►  gera k2; k1 → anterior (válida 24 h)
  ◄─ chave k2 (1 vez)                                       conector trocar-chave  (testa k2 no Hub e grava no Credential Manager)
                                                            serviço relê o segredo em ≤ 60 s e passa a usar k2
                       sinal/lotes chegam com k2; k1 deixa de aparecer (alerta "chave anterior em uso" some)
  revogar k1 ────────► k1.revogada_em = agora
```
Se o Conector ainda usa `k1` durante a convivência, cada chamada autentica com `situacao: em_convivencia` e o monitor mostra o alerta informativo `chave_em_convivencia`. Passada a janela, `k1` dá 401 e o Conector pausa (nada se perde) até receber a chave nova.

## 4. Limites (RN-INT-12, proposta; todos parâmetros do tenant com os padrões abaixo)

| Limite | Padrão | Onde está |
|---|---|---|
| Corpo de `POST /lotes` | **8 MiB** (o Conector envia ≤ 4 MiB) → `413` | `limiteCorpoLoteBytes`, `verificarTamanhoCorpo` |
| Corpo das demais rotas | 1 MiB → `413` | `limiteCorpoGeralBytes` |
| Registros por lote | 5.000 → `422 acima_do_limite` | `limiteRegistrosLote` (RN-INT-01) |
| Linhas inválidas detalhadas por lote | **500**; o excedente só entra na contagem | `limiteLinhasInvalidas` (RN-INT-03) |
| `external_id` | 1–**200** caracteres (registro, cursor e linha inválida do Conector; T-0027) | contrato (`EXTERNAL_ID_MAX`) |
| Taxa por Conector, `POST /lotes` | balde de **30** chamadas, repõe **20/min** | `taxaPorConector.lote` (`consumirToken`) |
| Taxa por Conector, demais rotas | balde de **300**, repõe **300/min** (5/s: o Conector consulta o resultado de cada lote aguardando a cada 5 s) | `taxaPorConector.geral` |
| Falhas de autenticação por IP | 20/min → `429` | limitador do `apps/api` |
| Pedidos por `GET /pedidos/pendentes` | 50 (máx. 100) | `pedidosPorConsulta` |
| Erros por `GET /lotes/{id}` | 1.000 (máx. 5.500), `falha_processamento` primeiro | `QueryConsultaLote` |
| Convivência da chave anterior | **24 h** (0–7 dias; P-5 aprovada) | `convivenciaChaveMin` |
| Sessão de carga completa sem fechar | 24 h | `ttlSessaoMin` (RN-INT-06) |
| Confirmação da inativação em massa | 7 dias | `ttlConfirmacaoInativacaoDias` |
| Trava de inativação em massa | 30 % dos ativos | `limiteInativacaoPct` (RN-INT-06) |
| Reenvio de pedido `enviado` sem retorno | 10 min | `timeoutEnvioMin` (RN-INT-08) |
| Espera de um lote pela dependência | 30 min | `esperaMaxDependenciaMin` (RN-INT-04) |
| Sinal de vida | a cada 1 min; `atrasado` ≥ 3 min; **alerta ≥ 15 min** | `sinalAtrasadoMin`, `sinalAlertaMin` (doc 06) |

O balde é por (Conector, classe da rota): `POST /lotes` tem balde próprio e mais apertado; o resto compartilha o geral. Estado em memória do processo (uma instância) com a mesma interface para virar contador compartilhado ao escalar — igual ao limitador de login (ADR 0006). A resposta 429 traz `Retry-After` em segundos inteiros (o Conector respeita segundos ou data HTTP). Custo maior que a capacidade nunca passa (`retryAfterSeg` 0 = erro de programação, 500).

## 5. Idempotência do lote (`Idempotency-Key`, RN-INT-12)

O Conector calcula `Idempotency-Key` = SHA-256 do conteúdo canônico do lote e reenvia **a mesma chave** depois de queda, reinício ou resposta perdida. O Hub:

1. Valida o formato (`validarChaveIdempotencia`): ausente ou fora de `[A-Za-z0-9._:-]{16,128}` ⇒ 400 `chave_idempotencia_invalida`.
2. Calcula `hash_conteudo` = SHA-256 de `conteudoCanonicoLote(corpo)`: versão, entidade, modo, sessão, `registros`, `linhas_invalidas` e `linhas_invalidas_omitidas`, em JSON canônico. **Ficam de fora** `enviado_em`, `cursor` declarado, `conector_id` e `versao_conector`: remontar o mesmo lote depois de `retomar` ou de atualizar o Conector muda esses campos e não pode virar conflito. A chave do Conector não precisa ser igual ao `hash_conteudo` (ela inclui a "geração" local, que não viaja no corpo): o Hub só **guarda** a chave e compara o **conteúdo**.
3. Busca o lote por (`tenant_id`, `conector_id`, chave) — o escopo é do Conector — e decide (`decidirIdempotenciaLote`):

| Situação | Resposta |
|---|---|
| chave nova | processa: cria o lote e responde `202` |
| mesma chave, **mesmo conteúdo** (qualquer status do lote) | **repete** `202` com o **mesmo** `lote_id`, `repetido: true` e `Idempotent-Replay: true`; não reprocessa, não duplica staging, não publica evento (reprocessar é no BKO) |
| mesma chave, **conteúdo diferente** | `409 chave_idempotencia_reutilizada` |

A decisão e a criação do lote ocorrem na **mesma transação**, com `unique (tenant_id, conector_id, chave_idempotencia)` como guarda final (duas requisições simultâneas com a mesma chave: a perdedora relê e responde como repetição). Lotes e chaves ficam 12 meses.

## 6. Endpoints do Hub (Conector → Hub)

Todas exigem os cabeçalhos da seção 2, autenticação (seção 3), taxa (seção 4) e, em rotas de dados, a versão mínima (seção 12). Schemas: `ROTAS_HUB` em `contracts/hub.ts` (cabeçalhos, params, query, corpo, sucesso, erros) — a fonte para o OpenAPI.

### 6.1 `POST /integracao/v1/lotes` — envia um lote
- **Cabeçalhos**: comuns + `Idempotency-Key` (`CabecalhosEnvioLote`). **Corpo**: `LoteEnvelope` (`versao_contrato`, `entidade`, `modo` `completo|delta`, `sessao?`, `cursor?`, `enviado_em?`, `conector_id?`, `versao_conector?`, `linhas_invalidas?[≤500]`, `linhas_invalidas_omitidas?`, `registros[]`).
- **Sucesso**: `202` `LoteAceito` `{ lote_id, status: "recebido", entidade, modo, recebidos, repetido?, consulta }`. `recebidos` = `registros` + `linhas_invalidas` + omitidas (linhas lidas pelo Conector; sempre ≥ 1).
- **Erros**: 400 `envelope_invalido`/`chave_idempotencia_invalida` · 409 · 413 · 422 (códigos de envelope) · 426 · 429. Corpo de erro = `RecusaLote`.
- **Passos**: auth/taxa/tamanho/versão → `Idempotency-Key` → `validarEnvelope` (recusa inteira, sem lote) → idempotência (seção 5) → transação única: grava `lote` (`recebido`), `lote_staging.corpo` e **publica `integracao.lote.recebido@1`** (a fila de segundo plano, seção 8) → `202`.
- **Exceção da RN-INT-01** (aprovada, P-1): `registros` vazio **é aceito** quando o lote traz `linhas_invalidas` ou `linhas_invalidas_omitidas > 0` — os erros precisam chegar ao BKO (seção 9) e, na carga completa, o `external_id` delas protege o registro da inativação. Sem nenhuma das duas, continua `lote_vazio`. A carga completa continua exigindo `sessao`. O Conector 1.2.0 manda esses lotes (D-2).
- **Um Conector por entidade** (P-6, RN-INT-13): `validarEnvelope(corpo, { entidadesDoConector })` recusa com `entidade_de_outro_conector` (422) o lote de entidade que não está no cadastro do Conector.
- **Sessão (carga completa)**: `sessao.id` (UUID do Conector) é único por (Conector, entidade). Parte repetida (reenvio com outra chave) substitui o estado da parte anterior; parte para sessão já fechada ou de outra entidade ⇒ `envelope_invalido` (campo `sessao`). `conector_id`/`versao_conector` do corpo são informativos: **vale a credencial** (divergência só é logada).

### 6.2 `GET /integracao/v1/lotes/{id}` — resultado do lote
- **Query**: `limite_erros` (0–5.500, padrão 1.000). **Sucesso**: `200` `LoteResultado` — `status` (`recebido`/`processando` até o final), `contagens`, `erros[]` (`indice`, `external_id`, `codigo`, `campo`, `mensagem`, `reprocessavel`, `origem` `hub|conector`), `avisos[]` (`duplicado_no_lote`), `cursor` (da entidade, depois do lote), `invalidas_omitidas`, `erros_total`, `erros_omitidos`, `inativacao`, `inativadas`, `recebido_em`, `concluido_em`.
- `erros[]` vem com as `falha_processamento` primeiro (o Conector reenvia só elas), depois por `indice`; para `origem: conector`, `indice` é a posição em `linhas_invalidas`. Mensagens **sem o valor** da linha.
- `inativacao` (RN-INT-06) aparece no resultado do **último lote da sessão** completa: `{ situacao: aplicada | aguardando_confirmacao | nao_aplicavel, motivo?, candidatos?, percentual? }` (seção 10).
- **404** para lote inexistente, de outro Conector ou de outro tenant. Só o estado final avança o cursor do Conector.

### 6.3 `GET /integracao/v1/cursores/{entidade}` — de onde continuar
- **Sucesso**: `200` `CursorEntidade` `{ entidade, cursor: { alterado_em, external_id } | null, atualizado_em | null }`. `cursor: null` = nunca recebeu ⇒ o Conector faz **carga inicial completa**. O cursor é por (tenant, **Conector**, entidade) e só avança em lote final (RN-INT-05, `avancarCursor`).
- **Erro**: 404 `entidade_desconhecida`.
- Persistência: `cursor_alterado_em timestamptz(3)` e `cursor_external_id text COLLATE "C"` (ordem ordinal, igual à do Conector e de `compararCursor`; a collation padrão do Postgres reordenaria e quebraria o delta).

### 6.4 `POST /integracao/v1/reconciliacoes` — contagem e soma do dia (RN-INT-07)
- **Corpo**: `ReconciliacaoEnvio` `{ versao_contrato, entidade, data_referencia, contagem, soma | null }`. **Sucesso**: `200` `RespostaReconciliacao` (o Conector só olha o status).
- A chave é (tenant, **Conector**, entidade, `data_referencia`); reenviar o dia **substitui** o anterior. O lado Macuxi é calculado sobre os registros ativos **daquele Conector** (a coluna `conector_id` do `registro_atual`); soma de controle por `CAMPO_SOMA_CONTROLE` (estoque em milésimos, `desenho.md` §13).
- Compara com `reconciliar` (tolerância contagem 0, soma 0,5 %). `divergente` ⇒ grava e publica `integracao.reconciliacao.divergente@1` **uma vez** por (Conector, entidade, dia) — reenviar o mesmo resultado não republica — e entra como alerta no monitor.
- **Lote em aberto da entidade** (`recebido`/`processando`): a resposta sai `situacao: "pendente"` (provisória) e a comparação definitiva é feita quando o último lote termina. `data_referencia` aceita de D-7 a D+1 (data civil do Conector); fora disso 400.

### 6.5 `GET /integracao/v1/pedidos/pendentes` — pedidos aprovados para o ERP (RN-INT-08)
- **Query**: `limite` (1–100, padrão 50). **Sucesso**: `200` `PedidosPendentes { pedidos: PedidoParaErp[] }` (lista vazia é normal).
- A seleção e a marcação `pendente → enviado` ocorrem **na mesma transação** (`for update skip locked`; `selecionarPendentes`): por ordem de `aprovado_em`, `tentativa = tentativas + 1`. `enviado` há ≥ 10 min sem retorno volta a `pendente` e sai de novo com `tentativa + 1` (o Conector é idempotente pelo `pedido_uuid`).
- Só Conector com `recebe_pedidos = true` (um por empresa na v1); outro ⇒ 403 `acesso_negado`. Pedido retido por falta de mapeamento (seção 11) **não** sai.

### 6.6 `POST /integracao/v1/pedidos/{pedido_uuid}/retorno` — retorno do ERP (RN-INT-08)
- **Corpo**: `RetornoErp` (`status` `integrado|rejeitado_erp|faturado_parcial|faturado_total|cancelado`, `numero_erp`, `motivo`, `nota`, `itens_faturados?`, `ocorrido_em`). O `pedido_uuid` do corpo deve ser o do caminho (senão 400).
- **Sucesso**: `200` `RetornoAceito { pedido_uuid, status, repetido }`. **Idempotente**: o mesmo estado (e, no parcial, a mesma nota número+série) devolve `repetido: true` sem publicar nem regravar.
- **Erros** (`422`, `RecusaRetorno`): `pedido_desconhecido`, `pedido_nao_entregue` (nunca saiu em `pendentes`), `transicao_invalida` (mensagem em português com o que é possível), `numero_erp_divergente` (o mesmo pedido não tem dois números), `itens_faturados_invalidos` (`erros[]` com `sequencia_inexistente`, `produto_divergente`, `quantidade_acima_do_saldo` e o campo `itens_faturados[i].…`).
- Detalhes na seção 11. Cada retorno aceito e **não repetido** publica `integracao.pedido.retorno_erp@1` na mesma transação.

### 6.7 `POST /integracao/v1/sinal` — sinal de vida (1 min)
- **Corpo**: `SinalConector` (`conector_id`, `versao_conector`, `versao_contrato`, `em`, `fila[]`, `entidades[]`, `parado_por_versao?`; sem dado pessoal). **Sucesso**: `200` `RespostaSinal { politica_versao?, conector_id?, recebido_em? }`.
- Grava `ultimo_sinal_em` (relógio do servidor), `versao_conector`, `parado_por_versao`, o resumo da fila/entidades (só o último) e `deriva_relogio_s` = recebido − `em` (o monitor destaca > 5 min: o NTP do servidor do cliente está errado). Responde com a política de versão do tenant (seção 12). **Única rota liberada abaixo da versão mínima.** Resposta 4xx/5xx faz o Conector repetir no ciclo seguinte — nunca o derruba.

## 7. Ingestão: do envelope ao evento

```
Conector          API (POST /lotes)                    Fila (outbox)         Aplicação (consumidor integracao.lote.recebido@1)
   │  lote + Idempotency-Key ─►│ auth, taxa, tamanho, versão                       │
   │                           │ validarEnvelope  ──(recusa inteira: 400/422)──►   │
   │                           │ idempotência do lote (repetir | 409)              │
   │                           │ [tx] lote(recebido) + lote_staging + tx.publicar(lote.recebido) ───►│
   │◄── 202 {lote_id} ─────────│                                                   │ ordenarFilaAplicacao (dependência, 1 lote/entidade)
   │                           │                                                   │ lote → processando
   │  GET /lotes/{id} (5 s) ──►│ recebido/processando …                            │ tratarLinhasInvalidasConector → erros origem=conector
   │                           │                                                   │ validarLinhas (hash, duplicados, erro por linha)
   │                           │                                                   │ verificarReferencias (RN-INT-04)
   │                           │                                                   │ classificarMudancas (hash vs registro_atual)
   │                           │                                                   │ [tx] upsert registro_atual + lote_linha_erro + tx.publicar(<entidade>.atualizado) por registro que mudou
   │                           │                                                   │ calcularResultadoLote → status; avancarCursor
   │                           │                                                   │ sessão completa? → inativação (seção 10)
   │◄── LoteResultado (final) ─│                                                   │ tx.publicar(lote.concluido)
```

1. **Envelope** (`validarEnvelope`): uma entidade por lote, versão, limite de linhas, sessão. Recusa inteira, sem lote (RN-INT-01). Exceção do lote só de linhas inválidas (seção 6.1).
2. **Staging**: o corpo do lote é gravado em `lote_staging` na mesma transação do `202` (a API não perde o que aceitou). O staging é por lote; o **espelho do último registro aceito** é o `registro_atual` (hash, payload, `alterado_em`, `visto_em`, `conector_id`, `sessao_id`).
3. **Ordem de dependência** (RN-INT-04, `ordenarFilaAplicacao`): vendedor → cliente → (rota, título, nota); produto → (preço, estoque). Um lote espera por lotes `recebido`/`processando` das entidades de que depende (no máximo **30 min**: depois disso é aplicado e a linha vira `referencia_ausente`, reprocessável). **Um lote por vez por (Conector, entidade)**, na ordem de chegada; Conectores diferentes aplicam em paralelo. Lote de dependência `falhou` não segura ninguém. O consumidor, ao ser chamado para o lote X, aplica o próximo lote pronto do tenant; se X ainda espera, lança erro e a outbox o repete (5 s, 10 s, 20 s… até 15 min; ADR 0007).
4. **Validação por linha** (`validarLinhas`): `external_id` repetido no lote vale a última ocorrência (as anteriores viram aviso `duplicado_no_lote`); cada linha é validada com `SCHEMA_REGISTRO[entidade]`; erro vira `LinhaErro` (`origem: hub`) **sem o valor**; linha inválida não trava o lote (RN-INT-03).
5. **Referências** (`verificarReferencias`): `vendedor_external_id`, `cliente_external_id`, `produto_external_id`, `paradas[].cliente_external_id` inexistentes ⇒ `referencia_ausente` (reprocessável), nunca registro órfão.
6. **Mudança** (`classificarMudancas`, guarda monotônica RN-INT-06): primeiro compara `alterado_em` da linha com o do `registro_atual`. **Menor ⇒ `obsoleta`** (reenvio antigo ou reprocessamento de `lote_linha_erro.payload` velho): não troca o registro, **não publica** `integracao.<entidade>.atualizado@1`, conta no resumo do lote (`contagens.obsoletas`) e aparece no monitor; vale mesmo com hash diferente ou igual. Igual ou maior: hash igual ⇒ `inalterada` (não grava, não publica); hash novo ⇒ `atualizada`; ausente ⇒ `nova`. **Empate** (`alterado_em` igual): hash diferente ⇒ `atualizada` (a última chegada vence; o ERP pode mudar conteúdo sem avançar o relógio); hash igual ⇒ `inalterada`. A comparação é por instante (ms), não por texto. No banco o upsert repete a guarda (`WHERE excluded.alterado_em >= registro_atual.alterado_em`), como defesa contra corrida; `visto_em`/`sessao_id` sempre são atualizados (o registro existe no ERP e não pode ser inativado). Uma linha de erro reprocessada que resulta `obsoleta` fica `resolvido_em`, com `resolvido_no_lote_id` = o lote que trouxe a versão nova. Cada registro que mudou publica `integracao.<entidade>.atualizado@1` (`criado|atualizado`) na mesma transação da gravação. Registro inativado e que volta conta como `nova`.
7. **Resultado** (`calcularResultadoLote`): `concluido` / `concluido_com_erros` / `falhou`; a conta fecha: `recebidas = novas + atualizadas + inalteradas + obsoletas + duplicadas + com_erro`. `obsoletas` não é erro (não muda o status do lote).
8. **Cursor** (RN-INT-05): candidato = maior par (`alterado_em`, `external_id`) das linhas **aceitas**; avança só em `concluido`/`concluido_com_erros`, nunca retrocede.
9. **Reprocessar** (BKO, `lote.reprocessar`): reaplica do `payload` guardado em `lote_linha_erro` (30 dias; depois a linha deixa de ser reprocessável e o BKO mostra "reenvie pelo Conector"; lote `falhou` por infraestrutura só se reprocessa com o `corpo` inteiro do staging, mantido 30 dias; vale esta regra, não o comentário antigo de `ReprocessarLoteEntrada`) as linhas `referencia_ausente`/`falha_processamento`; também dispara sozinho quando um lote de dependência conclui (`dependentesDe`). Lote `concluido_com_erros`/`falhou` ⇒ `processando` ⇒ final (`transicionarLote`).
10. **Falha de infraestrutura** no meio: a aplicação roda em blocos de ~500 linhas, cada um numa transação que grava também o **checkpoint** do lote (`aplicado_ate_indice` + contagens acumuladas, na mesma transação do bloco). A falha desfaz só o bloco corrente; o lote volta a `recebido` (retentativa da outbox) e **continua do checkpoint** (as linhas já aplicadas não são recontadas como `inalteradas`). Esgotadas as tentativas, vira `falhou` com `ultimo_erro` sem dado pessoal.

## 8. Execução em segundo plano

**Recomendação**: reaproveitar a outbox como fila (ADR 0007 "Implementação (T-0022)": sem pg-boss). O `POST /lotes` publica o evento **interno** `integracao.lote.recebido@1` (`LoteRecebidoEvento`: ids e contagens, **sem linhas**) na transação do lote; o módulo o consome (`consumidores` em `moduloApi`; já no `publica`/`consome` do manifesto). Vantagens: nenhuma dependência nova, retentativa e idempotência (`evento_consumo`) prontas, `comTenant` automático. Limites a conferir pelo engenheiro: ordem não garantida (a ordem é nossa, `ordenarFilaAplicacao`) e o consumidor pode demorar (lote de 5.000 linhas: processar em transações de ~500 linhas, com o lote em `processando`). Alternativas (a decidir em ADR): varredura periódica de `lote.status = 'recebido'` por um processo próprio, ou pg-boss.

## 9. Linhas inválidas do Conector e a exceção da RN-INT-01

- O Conector manda `linhas_invalidas[]` (até 500 por lote; `external_id?`, `codigo`, `campo?`, `mensagem`) e `linhas_invalidas_omitidas`. **Não** vão em `registros`. O Hub (`tratarLinhasInvalidasConector`):
  - grava cada uma em `lote_linha_erro` com `origem = 'conector'`, `indice` = posição na lista, **nunca reprocessável** (exige correção no ERP; o `alterado_em` novo a traz de volta pelo delta);
  - **confere de novo** a mensagem e mascara CPF, CNPJ, e-mail e telefone (`mascararDadoPessoal`) — defesa em profundidade; trunca em 300 caracteres;
  - aplica o **limite do Hub** (500 por lote, parâmetro do tenant): o que passar vira contagem (`invalidas_omitidas`), somada às que o Conector já omitiu;
  - conta tudo em `recebidas` e `com_erro`.
- **Lote só com linhas inválidas** (0 registros válidos): é aceito e termina **`concluido_com_erros`** (não `falhou`), porque o Conector bloqueia a entidade diante de `falhou` sem erro do Hub e os erros já foram entregues. `falhou` fica para "todas as linhas do Hub com erro" e falha de processamento (`calcularResultadoLote`, `invalidas_conector`).
- **Efeito na carga completa (RN-INT-06; 🔴 da T-0027)**: **registro que veio como inválido nunca é inativado**. A cada parte da sessão a API chama `idsDaSessaoNoLote({ aceitas, errosHub, invalidasConector })`, grava os `invalidos` em `sessao_carga_recebido` e soma `semIdentificacao`; ao fechar, `calcularInativacao` recebe `recebidosNaSessao`, **`invalidosNaSessao`** e `linhasSemExternalId` e exclui os inválidos dos candidatos — inclusive depois da confirmação do operador. Vale para as linhas inválidas do Conector **e** para as linhas com erro no Hub (validação, referência ausente, falha). Linha inválida **sem** `external_id` legível, ou linhas omitidas pelo Conector, **impedem a inativação** da sessão (`linhas_sem_external_id` / `linhas_invalidas_omitidas`). O Conector 1.2.0, na carga completa, **nunca omite**: manda todas as inválidas com o id, em fatias de até 500 por parte.
- Esses erros aparecem no monitor ao lado dos erros do Hub, com o filtro `origem`.

## 10. Carga completa e trava de inativação em massa (RN-INT-06)

```
Conector                Hub
  parte 1..n (mesma sessao.id, a última ultimo:true) ──► cada parte é um lote (sessao_parte)
                          situacaoSessao: completa quando 1..n estão concluido/concluido_com_erros (parte falhou mantém aberta; TTL 24 h)
                          ao concluir a ÚLTIMA parte pendente:
                            ativos elegíveis = ativos do Conector NÃO vistos depois do início da sessão (filtrarAtivosElegiveis)
                            calcularInativacao(sessão, ativos elegíveis, recebidos da sessão, linhas inválidas, limite 30 %)
                              ├─ permitido ........................ marca deleted_at (nunca apaga), publica <entidade>.atualizado acao=inativado
                              │                                     resultado do lote: inativacao = aplicada
                              ├─ excede_limite_inativacao ......... NÃO inativa; cria pendencia_inativacao (aguardando, 7 dias)
                              │                                     resultado do lote: inativacao = aguardando_confirmacao (candidatos, percentual)
                              └─ sessão incompleta / carga vazia /
                                 linhas sem id / omitidas ........ não inativa; inativacao = nao_aplicavel (motivo)
Operador (BKO, só admin)
  vê a pendência: entidade, Conector, % e quantidade, amostra de 50 external_id, CSV da lista completa
  confirmar ───────────► decidirPendencia → reavalia com confirmado:true sobre os ativos de AGORA → inativa só o que ainda está ausente
  recusar ─────────────► encerra sem inativar
  (passou de 7 dias) ──► expirada: pedir nova carga completa (conector carga-completa <entidade>)
```
- **Por que "ativos elegíveis"**: um registro criado no ERP durante a carga chega pelo delta, está ativo e não está na sessão; inativá-lo seria erro. Só entra na conta o ativo cujo `visto_em` é **anterior ao início da sessão**.
- O **lote termina normalmente** (`concluido`, o cursor avança): o que fica "parado" é só a etapa de inativação (**P-2 aprovada**: lote aplicado, inativações aguardando confirmação; teste em `domain/inativacao.test.ts`). O Conector lê `inativacao.situacao = aguardando_confirmacao` no resultado do último lote, mostra o aviso ("a carga completa foi aplicada…") e **não reenvia nada**.
- Confirmar e recusar são idempotentes e auditados (`decidida_por`, `decidida_em`, motivo); decidir duas vezes ⇒ `pendencia_ja_decidida`; depois da validade ⇒ `pendencia_expirada` (422 no BKO).

## 11. Retorno de pedidos ao ERP (RN-INT-08)

### 11.1 Da aprovação à fila
```
Vendedor (aprova)         Hub (consumidor)                        Conector                       ERP
  publica evento ───────► decidirEntradaNaFila                      
  com o pedido pronto     ├─ aprovado, novo ......... criar (pendente), idempotente pelo pedido_uuid
  (ver 11.4)              ├─ aprovado, sem de-para .. reter (mensagem diz o que cadastrar)
                          ├─ editado e reaprovado antes da 1ª entrega ... atualizar_payload
                          ├─ cancelado/devolvido antes da 1ª entrega .... remover_da_fila
                          └─ depois da entrega ....... ignorar (o ERP é quem avisa: retorno `cancelado`)
                                                                   GET /pedidos/pendentes ──────►
                          selecionarPendentes: pendente → enviado (tentativa+1)  ◄── PedidosPendentes
                                                                   grava no ERP (idempotente pelo UUID) ──►
                                                                   POST /pedidos/{uuid}/retorno integrado(nº) ──► aplicarRetornoPedido
                                                                   … faturado_parcial (nota 1, itens) …
                                                                   … faturado_total (última nota) / cancelado (ERP) …
                          publica integracao.pedido.retorno_erp@1 ──► Vendedor (status + vendedor.pedido.faturado@1)
```
- **De-para** (`montarPedidoParaErp`): `condicao_pagamento_codigo` do Macuxi → `condicao_pagamento_erp` pelo mapeamento ativo (`tipo = condicao_pagamento`). Sem correspondente (ou mais de um ativo) o pedido fica **retido** com mensagem em português ("cadastre em Integração ERP > Mapeamento"); ao cadastrar, a API reprocessa os retidos. Sequências repetidas nos itens são recusadas. O monitor mostra os retidos (`pedido_retido_sem_mapeamento`).
- **Idempotência**: a chave é o `pedido_uuid` (único por tenant); o mesmo evento duas vezes não duplica (`ja_na_fila`); edição **depois** da entrega vira aviso (`alterado_apos_envio`) — o que o ERP recebeu não muda.
- **Cancelamento** (decisão do Alexandre, R-20261031-100601, opção b): o Macuxi **nunca** escreve cancelamento no ERP. Cancelado no Vendedor antes da 1ª entrega ⇒ sai da fila (soft delete); depois ⇒ nada a fazer, o ERP reporta.

### 11.2 Confirmação (retorno) e estados
Estados e transições: `desenho.md` §2.8 e `domain/estados.ts`. `aplicarRetornoPedido` acrescenta:
- **Confirmação tardia vale**: pedido que voltou a `pendente` por timeout, mas já tinha sido entregue (`tentativas > 0`), aceita o retorno como se estivesse `enviado`. Pedido nunca entregue ⇒ `pedido_nao_entregue`.
- **`numero_erp`** não muda: outro número para o mesmo pedido ⇒ `numero_erp_divergente` (provável gravação duplicada no ERP).
- **`cancelado` do ERP** (RN-INT-08): vale a partir de `enviado`, `integrado`, `faturado_parcial` e `faturado_total`; é final; `motivo` opcional é guardado; repetir é idempotente; vindo de `rejeitado_erp` ou de pedido nunca entregue é recusado. Publica `integracao.pedido.retorno_erp@1` com `status: cancelado`.
- **`rejeitado_erp`** é final e exige `motivo`.

### 11.3 Faturamento: nota e `itens_faturados`
- A idempotência do faturamento é por **(pedido, status, nota número+série)**: duas notas parciais diferentes são **dois fatos** (ambos publicam); a mesma nota repetida devolve `repetido: true` e **não revalida nem reacumula** os itens. A nota é guardada em `notas_aplicadas`.
- `itens_faturados` (opcional; só em `faturado_*`; `produto_external_id` e `valor_cents` obrigatórios no item, decisão do Alexandre): para cada item o Hub confere (1) a **`sequencia` existe** no pedido enviado, (2) o **`produto_external_id` é o enviado** naquela sequência, (3) **faturado acumulado (retornos anteriores + este) ≤ quantidade enviada**. Todos os problemas voltam juntos em `erros[]`; qualquer um recusa o retorno inteiro (422 `itens_faturados_invalidos`, definitivo para o Conector — pergunta P-4). Aceito, acumula por sequência (`quantidade`, `valor_cents`) em `itens_faturados_acumulados` e vai no evento. Retorno `faturado_parcial` sem itens continua aceito (o Vendedor não publica o faturado sem itens; T-0011).

### 11.4 O que falta no Vendedor (dependência — recado ao `modulo-vendedor`)
O evento `vendedor.pedido.status_alterado@1` **não carrega o pedido** (`pedido_id`, `vendedor_id`, `de`, `para`, `alterado_em`, `autor_id`, `motivo`), e o Hub não pode ler tabela do Vendedor (fronteiras). Para montar o `PedidoParaErp` o Hub precisa de um evento com o **pedido pronto para o ERP**: proposta `vendedor.pedido.aprovado@1` com o payload `PedidoAprovadoParaFila` (`contracts/pedido.ts`: `pedido_uuid`, `cliente_external_id`, `vendedor_external_id`, `condicao_pagamento_codigo`, `criado_em`, `aprovado_em`, `observacao`, `itens[{sequencia, produto_external_id, quantidade, preco_unitario_cents, desconto_cents, total_cents}]`, `desconto_total_cents`, `total_cents`) — o Vendedor preenche os `*_external_id` a partir do `external_id` de Core. O Hub consome esse evento (criar/atualizar) e continua consumindo `status_alterado@1` (remover da fila). Até existir, o domain já recebe o snapshot (`decidirEntradaNaFila`) e o manifesto **não** declara o evento novo no `consome` (declarar quando o Vendedor publicar).

## 12. Sinal de vida e política de versão do Conector (RN-INT-11, proposta)

- **Política por tenant** (`PoliticaVersaoConector`: `versao_minima`, `versao_recomendada`, `mensagem?`, `pacote?`), definida no BKO (`conector.gerenciar`; `validarPoliticaVersao`: mínima ≤ recomendada, versões legíveis, pacote não abaixo da recomendada). Vem na resposta de `POST /sinal`.
- **Versão informada** (`versaoInformada`): o cabeçalho `X-Macuxi-Conector-Versao` se for semver legível; senão `versao_conector` do corpo; senão nenhuma.
- **Avaliação** (`avaliarVersaoConector`, semver 2.0): `em_dia` (≥ recomendada) · `desatualizado` (mínima ≤ v < recomendada: **só avisa**, o Conector segue) · `abaixo_da_minima` (**bloqueia**) · `sem_politica`/`versao_ilegivel` (**nunca bloqueia**: um erro de cadastro não pode parar o cliente). Política inconsistente (mínima > recomendada): a mínima manda.
- **Abaixo da mínima**: o Conector v1.1 já **para sozinho** de enviar (lotes, retornos, pedidos, reconciliação) e segue mandando só o sinal (`parado_por_versao: true`). Por defesa, o Hub responde **426 `versao_conector_nao_suportada`** (com `mensagem` e a versão mínima em `detalhes`) em toda rota de dados — `rotaBloqueadaPorVersao`; **só `POST /sinal` passa**, para o Hub ver o Conector parado e poder liberá-lo baixando a mínima. O monitor mostra `parado_por_versao` e o alerta crítico.
- **Atualização** é manual na v1 (pacote assinado; `conector.md` §7.4); automática na v2.

## 13. Monitor do BKO (RF-INT-04, RF-INT-06)

O que o monitor mostra (`MonitorResumo`, `GET /v1/integracao/monitor`) e de onde vem:

| Bloco | Conteúdo | Regra |
|---|---|---|
| **Conectores** | identificador, nome, tipo, versão, situação de versão, último sinal, **saúde** (`ok` < 3 min · `atrasado` 3–15 min · `sem_sinal` ≥ 15 min · `parado_por_versao` · `nunca_conectou` · `desativado`), chave (prefixo, criada em, anterior em convivência) | `avaliarSaudeConector`; doc 06 (alerta com 15 min sem sinal) |
| **Alertas** | críticos primeiro: sem sinal, parado por versão, reconciliação divergente; atenção: nunca conectou, desatualizado, lotes que falharam nas últimas 24 h, inativação aguardando confirmação, pedido preso (≥ 5 entregas sem retorno), pedido retido sem mapeamento; info: chave anterior em uso. Cada um com causa e a ação seguinte, em português | `montarAlertasMonitor` |
| **Carga por entidade** | as 8 entidades na ordem de dependência, com estado (`sem_lotes`, `pendente`, `em_andamento`, `concluida`, `concluida_com_erros`, `falhou`), lotes, erros e o que está esperando | `resumirCargaPorEntidade` |
| **Lotes recentes** | tabela densa: Conector, entidade, modo, status, recebidas/novas/atualizadas/inalteradas/erros/inativadas, recebido/concluído em; filtros (Conector, entidade, status, período, só com erro) **na URL**; exportar CSV | `LoteListagemQuery` |
| **Detalhe do lote** | contagens, avisos, **erros por linha** (`external_id`, campo, mensagem legível, reprocessável, origem), filtro por código, CSV, botão "Reprocessar" | `ErrosLoteQuery`, `ReprocessarLoteEntrada` |
| **Inativação em massa** | pendências: entidade, Conector, % e quantidade, amostra, CSV, confirmar/recusar (só admin), validade | seção 10 |
| **Reconciliação** | últimos 30 dias por entidade (contagens e somas, diferença, divergente, motivos) | RN-INT-07 |
| **Pedidos no ERP** | contagem por estado, presos, retidos; lista com número do ERP, motivo, nota, última tentativa | RN-INT-08 |
| **Mapeamento** | de-para de condição de pagamento, depósito e status | doc 06 |

Permissões na UI espelham as ações do manifesto (a proteção real é na API): `monitor.ver` e `lote.reprocessar` e `mapeamento.editar` (admin, analista); `conector.gerenciar` e `inativacao.decidir` (só admin).

## 14. Multi-tenant, segurança e privacidade

- **Tenant só da chave.** A função `integracao.autenticar_chave(hash)` (SECURITY DEFINER, concedida ao `macuxi_app`) é a única leitura sem tenant e devolve só a credencial correspondente; daí em diante `comTenant(tenant_da_chave)`. Corpo/query/cabeçalhos com `tenant_id` são ignorados.
- **RLS** em toda tabela do schema `integracao` (`tenant_id = tenant_atual()`), com teste automático de vazamento entre tenants (dois tenants, mesmas chaves de lote/`external_id`/`pedido_uuid`: nunca se enxergam; `GET /lotes/{id}` de outro tenant = 404).
- **Escopo por Conector**: lote, cursor, reconciliação e sinal são por (tenant, Conector); um Conector não lê o lote de outro (404).
- **Segredos**: pepper da chave só no `.env`; a chave em claro nunca é gravada nem logada (`Authorization` é redigido nos logs do Fastify/pino).
- **Log**: `tenant_id`, `modulo`, `request_id`, `conector_id`, `lote_id`, `entidade`, contagens, códigos e `external_id` de erro. Nunca valores de linha, `registros`, `payload`, mensagens do ERP com texto livre sem máscara, IP completo em nível info (só no motivo de recusa de credencial).
- **Retenção**: lote e chaves 12 meses; `lote_linha_erro.payload` (linha original, acesso restrito) expurgado em 30 dias; `lote_staging.corpo` anulado 7 dias depois de `concluido`/`concluido_com_erros` e mantido 30 dias em `falhou`. `registro_atual.payload` (pode ter CPF/CNPJ, e-mail, telefone) fica guardado para o comparador e para republicar a módulo recém-licenciado; o `payload` de inativados é anulado após 30 dias, o registro entra no fluxo de anonimização LGPD do Core (evento) e nunca é logado.
- **TLS** sempre; o Conector não tem opção de ignorar certificado.

## 15. OpenAPI

O OpenAPI do `/integracao/v1` é gerado dos schemas Zod de `contracts/hub.ts` (`ROTAS_HUB`: método, caminho, cabeçalhos, params, query, corpo, sucesso e erros, com `ErroHub`/`RecusaLote`/`RecusaRetorno`), publicado em `GET /integracao/v1/openapi.json` (sem autenticação, sem dado de tenant) e usado nos testes de contrato do Conector. A ferramenta (`zod-to-openapi` ou equivalente) é escolha do engenheiro-software. O teste `contracts/hub.test.ts` garante que este documento cita as mesmas 7 rotas de `ROTAS_HUB`.

## 16. Compatibilidade com o Conector (`apps/conector/src/hub`)

Conferido campo a campo contra `cliente.ts` e `tipos.ts` na T-0025 (Conector v1.1); na **T-0027** as divergências abaixo foram fechadas no Conector **1.2.0** e no domain.

| Chamada do Conector | O que o Hub faz | Compatível |
|---|---|---|
| `POST /lotes` com `Idempotency-Key`, `X-Macuxi-Conector-Id`/`-Versao`, corpo string JSON; aceita 200/201/202; lê `LoteAceito` (`recebidos` > 0) | 202 `LoteAceito`; `recebidos` soma `registros` + inválidas + omitidas; `repetido` é campo novo opcional | sim |
| recusa 400/413/422 lida como `RecusaEnvelope` (`erros[{codigo,campo,mensagem}]`) | `RecusaLote` tem `erros[]` + `codigo`/`mensagem` no topo. Códigos novos no enum (`chave_idempotencia_*`, `corpo_grande`, `versao_conector_nao_suportada`, `entidade_de_outro_conector`) são valor novo de enum (compatível, RN-INT-09); o 1.2.0 já os conhece | sim |
| `GET /lotes/{id}?limite_erros=5500`: `LoteResultado` (com `inativacao`); 404 ⇒ reenvia | `LoteResultado` com `inativacao`, `erros_total`, `erros_omitidos` opcionais; o Conector 1.2.0 usa o schema do contrato direto (sem `extend`) | sim |
| `GET /cursores/{entidade}`: `CursorEntidade`, `cursor.external_id` 1–200 | idem; `cursor: null` ⇒ carga completa | sim |
| `POST /reconciliacoes`: ≥ 400 ⇒ erro; corpo ignorado; 426 ⇒ pausa | `200` com `RespostaReconciliacao`; 422 `entidade_de_outro_conector` (P-6) | sim |
| `GET /pedidos/pendentes`: `PedidosPendentes` | idem (+ `limite`) | sim |
| `POST /pedidos/{uuid}/retorno`: 200/201/202 ⇒ `RetornoAceito`; recusa lê `erros[0]` ou `codigo`/`mensagem` do topo; 426 ⇒ o retorno espera na fila | 200 `RetornoAceito`; 422 `RecusaRetorno` com os dois formatos | sim |
| `POST /sinal`: ≥ 400 ⇒ transitório; lê `RespostaSinal` (ignora o que não casar) | 200 `RespostaSinal` | sim |
| qualquer rota de dados: **426** ⇒ `ErroHubVersao` (pausa) | 426 `versao_conector_nao_suportada` com `detalhes.versao_minima` | sim |
| `Retry-After` em segundos ou data HTTP | segundos inteiros | sim |

### Divergências e riscos — todas resolvidas na T-0027
- **D-1 — Linhas descartadas pelo Conector** (🔴) — ✅ **resolvida**. Na **carga completa** o Conector manda **toda** linha inválida em `linhas_invalidas` com o `external_id`, **qualquer que seja** `linhasInvalidas` (o `descartar` só vale no delta), sem omitir nenhuma (fatias de até 500 por parte; o que sobra vira parte só de inválidas); linha cujo mapeamento quebra leva o `external_id` lido da coluna; `external_id` acima de 200 vai como `null` (o Hub então não inativa nada na sessão, o lado seguro). No Hub, `calcularInativacao` ganhou `invalidosNaSessao` e `idsDaSessaoNoLote`: **registro que veio inválido nunca é inativado**, nem depois da confirmação do operador. Testes: `domain/sessao.test.ts` (bloco "T-0027 🔴") e `apps/conector/test/alinhamento-hub.test.ts` (carga completa com 1 linha inválida, página do meio só com inválidas, 520 inválidas, `descartar`).
- **D-2 — Página só com linhas inválidas** — ✅ **resolvida**. O Conector monta um lote com `registros: []` e as inválidas (delta e carga completa; a última página fecha a sessão com `ultimo: true`); o Hub aceita (exceção da RN-INT-01, P-1) e termina `concluido_com_erros`. O aviso `linhas_invalidas_sem_lote` deixou de existir.
- **D-3 — `external_id` de linha inválida (200) × registro (100)** — ✅ **resolvida**: `EXTERNAL_ID_MAX = 200` em `contracts/base.ts`, usado no registro, no cursor e em `LinhaInvalidaConector` (subir o máximo é compatível com `v1`). Igual à coluna `lote_linha_erro.external_id` (≤ 200).
- **D-4 — 426 e 409 bloqueavam a entidade** — ✅ **resolvida para o 426**: o Conector trata 426 como **pausa** (`ErroHubVersao`, igual a 401/403): o lote fica na fila com espera, nenhuma entidade é bloqueada, a `detalhes.versao_minima` vira a política local (para de enviar e o sinal segue com `parado_por_versao: true`) e libera sozinho quando o sinal traz política que o aceite. Vale em lotes, cursor, pedidos, retornos e reconciliação; `trocar-chave` grava a chave com aviso (o 426 vem depois da autenticação). **409 `chave_idempotencia_reutilizada` continua bloqueando a entidade de propósito**: mesma chave com conteúdo diferente é defeito, não condição transitória — a mensagem diz o código e o `retomar`.
- **D-5 — `GET /lotes/{id}` truncado** — ✅ **resolvida**: o Conector pede `limite_erros=5500` (o máximo do contrato = 5.000 registros + 500 inválidas), então todas as `falha_processamento` chegam para o reenvio; `erros_omitidos` vai para o log.
- **D-6 — `data_referencia` da reconciliação** — ✅ **fechada como comportamento definido**: é a data **local do servidor do Conector** (`conector.md` §5); o Hub grava como veio (janela D-7..D+1) e não converte fuso.
- **D-7 — `conector_id` do corpo × cabeçalho** — ✅ **fechada**: o Conector tira os dois do mesmo `hub.conectorId` (teste em `alinhamento-hub.test.ts`); no Hub continua valendo a credencial e divergência só é logada.

## 17. Entregas para implementação

### (a) Rotas — `engenheiro-software` (`apps/api` + `modules/integracao/api`)

**Ponto de montagem**: `modules/integracao/api/index.ts` (hoje `export {}`) deve exportar `moduloApi = definirModuloApi({ manifesto, rotas, consumidores })` (BKO, JWT, em `/v1/integracao`) **e** as rotas do Hub (`/integracao/v1`), que **não cabem** em `RotaModulo` (autenticam por chave de API, não por JWT; prefixo diferente). Pedido: **ADR 0011** estendendo a ADR 0006 com "rotas de conector": `ModuloApi.rotasConector` (declarativas, como `RotaModulo`, mas com `ContextoConector { tenant_id, conector { id, conector_id, tipo, recebe_pedidos }, versao, requestId, agora, comTenant, log }` e a sequência da seção 3.2), montadas por `createApp` em `/integracao/v1`. As 7 rotas vêm de `ROTAS_HUB` (`contracts/hub.ts`).

| # | Entrega | Detalhe |
|---|---|---|
| A1 | Pipeline do Hub | cabeçalhos Zod, `avaliarChaveConector`, limitador de falhas por IP, lista de IPs (`net.BlockList`), licença, `consumirToken`/`classeDaRota`, `verificarTamanhoCorpo` (limite de corpo do Fastify por rota: 8 MiB em `POST /lotes`, 1 MiB nas outras), `avaliarVersaoConector`/`rotaBloqueadaPorVersao`, `X-Request-Id`, `Retry-After`; erro padrão `ErroHub`/`RecusaLote`/`RecusaRetorno` e o mapeamento HTTP de `STATUS_HTTP_ERRO_HUB`; redigir `Authorization` nos logs |
| A2 | `POST /lotes` | seção 6.1 e 5: SHA-256 de `conteudoCanonicoLote`, `decidirIdempotenciaLote`, `validarEnvelope` (com `entidadesDoConector` da credencial — P-6, T-0027), transação única (lote + `lote_staging` + `tx.publicar(integracao.lote.recebido@1)`), `202`/replay/`409` |
| A3 | `GET /lotes/{id}`, `GET /cursores/{entidade}` | 6.2 e 6.3 (inclui `inativacao`, `erros_total`, ordem dos erros) |
| A4 | `POST /reconciliacoes` | 6.4: `reconciliar`, `integracao.reconciliacao.divergente@1` uma vez, `situacao: pendente` com lote em aberto |
| A5 | `GET /pedidos/pendentes`, `POST /pedidos/{uuid}/retorno` | 6.5, 6.6 e 11: `selecionarPendentes`/`aplicarRetornoPedido`, `for update skip locked`, `tx.publicar(integracao.pedido.retorno_erp@1)`, histórico em `pedido_retorno` |
| A6 | `POST /sinal` | 6.7 e 12: grava sinal/versão/deriva do relógio; devolve `politica_versao` |
| A7 | Consumidor `integracao.lote.recebido@1` | seção 7/8: `ordenarFilaAplicacao`, `validarLinhas`, `verificarReferencias`, `classificarMudancas`, `tratarLinhasInvalidasConector`, `calcularResultadoLote`, `avancarCursor`, sessão/inativação (seção 10; **T-0027**: `idsDaSessaoNoLote` por parte → `sessao_carga_recebido` e `calcularInativacao({ …, invalidosNaSessao })`), `tx.publicar(<entidade>.atualizado)` e `lote.concluido`; reprocessamento de dependentes (`dependentesDe`); retentativa/`falhou` |
| A8 | Consumidores do Vendedor | `vendedor.pedido.status_alterado@1` (remover da fila) e o novo evento do pedido aprovado (11.4): `decidirEntradaNaFila`; reprocessar retidos ao cadastrar mapeamento |
| A9 | Rotas do BKO (`definirModuloApi`, ações do manifesto) | `GET /monitor`; `GET/POST /conectores`, `PATCH /conectores/:id` (com `entidades`; `verificarTopologiaConectores` → 409 `topologia_conflitante`, P-6/P-7), `POST /conectores/:id/chave/rotacionar`, `POST /conectores/:id/chave/revogar` (`conector.gerenciar`); `GET/PUT /politica-versao` (`conector.gerenciar`, `validarPoliticaVersao`); `GET /lotes`, `GET /lotes/:id`, `GET /lotes/:id/erros` (+ CSV), `POST /lotes/:id/reprocessar` (`lote.reprocessar`); `GET /inativacoes`, `POST /inativacoes/:id/decidir` (`inativacao.decidir`; reavalia com `confirmado: true`); `GET/PUT/DELETE /mapeamentos` (`mapeamento.editar`); `GET /pedidos`, `POST /pedidos/reprocessar-retidos`; `GET /reconciliacoes`. Schemas em `contracts/bko.ts`. Escopo de carteira: `nao_se_aplica` (não há dado de cliente-carteira) |
| A10 | OpenAPI | `GET /integracao/v1/openapi.json` gerado de `ROTAS_HUB` |
| A11 | Registro | `.coord/contratos/eventos.md`: `integracao.lote.recebido@1` (interno) e, quando existir, o evento do pedido aprovado do Vendedor |
| A12 | Pepper e parâmetros | `MACUXI_HUB_CHAVE_PEPPER` no `.env`; parâmetros do tenant (`plataforma.parametro`): os da seção 4, repassados às funções do domain |

### (b) Tabelas, índices e RLS — `banco-dados` (schema `integracao`)

Regras comuns a **todas**: `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `deleted_at`, `external_id text` (onde não houver chave do ERP, fica nulo), **RLS ligado e forçado** com política `tenant_id = tenant_atual()` para `macuxi_app`, e teste de vazamento entre tenants. Datas `timestamptz` UTC. Sem FK para outro schema.

| Tabela | Campos de negócio | Índices / observações |
|---|---|---|
| `conector` | `external_id` = identificador (`conector_id`, slug), `nome`, `tipo`, `ativo`, `recebe_pedidos`, **`entidades text[]`** (P-6: as que este Conector alimenta; padrão as 8), `ips_permitidos text[]`, `versao_conector`, `versao_contrato`, `ultimo_sinal_em`, `parado_por_versao`, `sinal_resumo jsonb`, `deriva_relogio_s int` | `unique (tenant_id, external_id) where deleted_at is null`; leitura do monitor e do sinal |
| `credencial` (chave) | `conector_id fk`, `prefixo`, `hash_chave text` (HMAC-SHA256 hex), `escopo` (padrão `integracao.v1`), `papel` (`atual\|anterior`), `expira_em`, `anterior_valida_ate`, `revogada_em`, `revogada_por uuid`, `motivo_revogacao`, `ultimo_uso_em` | **`unique (hash_chave)` global** (a busca de autenticação não tem tenant; p95 < 50 ms); no máximo 1 `atual` e 1 `anterior` não revogadas por Conector (índice parcial); rotação **nunca sobrescreve** (nova linha). **Função `integracao.autenticar_chave(hash text)`** SECURITY DEFINER, `search_path` fixo, concedida a `macuxi_app`, devolve a linha + `tenant_id` + dados do Conector (`ativo`, `external_id`, `ips_permitidos`, `recebe_pedidos`) e nada mais |
| `politica_versao` | `versao_minima`, `versao_recomendada`, `mensagem`, `pacote jsonb` (versão, URL, sha256, assinatura, chave pública) | `unique (tenant_id)` |
| `lote` | `conector_id fk`, `entidade`, `modo`, `versao_contrato`, `sessao_id uuid`, `sessao_parte`, `sessao_ultimo`, `chave_idempotencia text`, `hash_conteudo text(64)`, `status`, contagens (`recebidas`, `duplicadas_no_lote`, `com_erro`, `novas`, `atualizadas`, `inalteradas`, `inativadas`, `invalidas_omitidas`), `cursor_declarado jsonb`, `cursor_resultante jsonb`, `versao_conector`, `bytes`, `avisos jsonb` (até 500 + contagem), `tentativas`, `ultimo_erro` (sem dado pessoal), `recebido_em`, `iniciado_em`, `concluido_em` | **`unique (tenant_id, conector_id, chave_idempotencia)`**; `(tenant_id, conector_id, recebido_em desc)`; `(tenant_id, entidade, status)`; `(sessao_id)`; fila de aplicação: `(tenant_id, status, recebido_em) where status in ('recebido','processando')`; retenção 12 meses |
| `lote_staging` | `lote_id` (1:1), `corpo jsonb` (`registros` + `linhas_invalidas`) | corpo anulado 7 dias após `concluido`/`concluido_com_erros` e 30 dias em `falhou`; tamanho de até 8 MiB por linha (TOAST) |
| `lote_linha_erro` | `lote_id`, `indice`, `origem` (`hub\|conector`), `external_id` (aqui é o do ERP, ≤ 200 — o mesmo limite do registro desde a T-0027), `codigo`, `campo`, `mensagem`, `reprocessavel`, `payload jsonb` (só `origem=hub`; expurgo 30 dias), `resolvido_em`, `resolvido_no_lote_id` | `unique (lote_id, origem, indice)`; `(tenant_id, codigo, resolvido_em)`; consulta por lote e por código; até 5.500 por lote |
| `registro_atual` (espelho do último registro aceito; **tabela única, SEM particionar na v1** — decisão do banco: partição exigiria PK com a chave de partição, RLS por partição e impede FK; reavaliar acima de 50 milhões de linhas ou p95 > 300 ms) | `entidade`, `external_id` (chave do ERP), `conector_id`, `hash`, `payload jsonb`, `alterado_em`, `ativo`, `valor_controle bigint` (soma de controle, preenchida no upsert), `lote_id` (último), `sessao_id` (informativa), `visto_em`, `aplicado_em`; **`deleted_at` = inativado pela carga completa**, hash esquecido ao inativar. **Upsert monotônico**: só troca `hash`/`payload`/`alterado_em`/`valor_controle` se `excluded.alterado_em >= registro_atual.alterado_em` (RN-INT-06) | `unique (tenant_id, entidade, external_id) include (hash, alterado_em)`; `(tenant_id, entidade, conector_id, visto_em) where ativo and deleted_at is null include (valor_controle)` (candidatos, contagem e reconciliação). **"Ativo" = `ativo and deleted_at is null`** na reconciliação (`contagem_macuxi`) e no denominador dos 30 % (`total_ativos`). Comparador de hash: só as chaves do lote (`external_id = any($3)`, até 500 por transação), sem `Map` de todos os ativos |
| `sessao_carga` | `id` = UUID do Conector, `conector_id`, `entidade`, `iniciada_em`, `ultima_parte`, `fechada_em`, `situacao` (`aberta\|completa\|expirada`), `inativadas`, `linhas_sem_identificacao int`, `invalidas_omitidas int` | `(tenant_id, entidade, situacao)`; estado das partes = `lote.status` das partes com o mesmo `sessao_id` |
| `sessao_carga_recebido` | `sessao_id`, `external_id` | só dos ids **não aplicados** — `idsDaSessaoNoLote(...).invalidos` (erros do Hub e linhas inválidas do Conector com id), para **nunca** serem inativados (T-0027 🔴); `unique (sessao_id, external_id)`; apagada ao fechar a sessão (7 dias) |
| `pendencia_inativacao` | `sessao_id`, `entidade`, `conector_id`, `lote_id`, `estado` (`aguardando\|confirmada\|recusada\|expirada`), `candidatos`, `total_ativos`, `percentual numeric(5,2)`, `limite_pct`, `amostra jsonb` (≤ 50), `expira_em`, `decidida_em`, `decidida_por uuid`, `motivo_decisao` | `unique (sessao_id)`; `(tenant_id, estado, entidade)`; a lista completa para o CSV é recalculada na hora (ativos elegíveis − recebidos) |
| `cursor_entidade` | `conector_id`, `entidade`, `cursor_alterado_em timestamptz(3)`, `cursor_external_id text COLLATE "C"`, `atualizado_em` | `unique (tenant_id, conector_id, entidade)`; escrita **monotônica**: `UPDATE … WHERE (cursor_alterado_em, cursor_external_id) < (novo)` |
| `reconciliacao` | `conector_id`, `entidade`, `data_referencia date`, `contagem_erp`, `soma_erp`, `contagem_macuxi`, `soma_macuxi`, `diferenca_contagem`, `diferenca_soma`, `diferenca_pct`, `divergente`, `motivos text[]`, `situacao` (`comparada\|pendente`), `evento_publicado`, `calculada_em` | `unique (tenant_id, conector_id, entidade, data_referencia)`; últimos 30 dias e divergentes |
| `mapeamento` | `tipo` (`condicao_pagamento\|deposito\|status`), `codigo_erp`, `codigo_macuxi`, `descricao`, `ativo` | `unique (tenant_id, tipo, codigo_erp) where deleted_at is null`; **`unique (tenant_id, tipo, codigo_macuxi) where tipo = 'condicao_pagamento' and ativo and deleted_at is null`** (um correspondente ativo por código do Macuxi só para `condicao_pagamento`, que vai Macuxi → ERP; `status` e `deposito` são ERP → Macuxi e vários códigos do ERP podem cair no mesmo); leitura a cada montagem de pedido |
| `pedido_fila_erp` | `pedido_uuid`, `estado`, `payload jsonb` (`PedidoParaErp`; nulo se retido), `payload_origem jsonb` (`PedidoAprovadoParaFila`), `retencao_codigo`, `retencao_mensagem`, `conector_id` (quem retirou), `enviado_em`, `tentativas`, `numero_erp`, `motivo`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents`, `notas_aplicadas jsonb`, `itens_faturados_acumulados jsonb`, `ultimo_retorno_em`, `aprovado_em` (a seleção do poll é por ele); remoção só por `deleted_at` | `unique (tenant_id, pedido_uuid)` total (a linha removida continua garantindo a idempotência); `(tenant_id, aprovado_em) where estado = 'pendente' and retencao_codigo is null and deleted_at is null` (poll de 1–2 min) e `(tenant_id, enviado_em) where estado = 'enviado'` (timeout). `aplicarRetornoPedido` faz `select … for update` na linha antes de validar o saldo de `itens_faturados_acumulados`; retidos: `(tenant_id) where retencao_codigo is not null`; milhares/dia |
| `pedido_retorno` | `pedido_uuid`, `status`, `numero_erp`, `motivo`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents`, `itens_faturados jsonb`, `ocorrido_em`, `conector_id` | trilha de cada retorno **aceito e não repetido**; `unique (tenant_id, pedido_uuid, status, nota_numero, nota_serie)` como segunda guarda da idempotência (nota nula tratada como `''`) |

Pedidos já listados no `desenho.md` §11 que seguem valendo: views-modelo do Conector (`db/conector/views-modelo.sql`, com as colunas da seção 8 do `desenho.md`, `alterado_em` UTC em ms, `external_id` = chave interna do ERP), política de expurgo, e teste de vazamento entre tenants para o schema `integracao`. Perfil de carga: `registro_atual` e `lote_linha_erro` dominam; `POST /lotes` de 5.000 linhas deve gravar `lote` + `lote_staging` em uma transação curta (a aplicação por linha roda depois).

#### Respostas à revisão do banco-dados (R-20261101-013248, T-0025)

- **V1 (🔴) aceito**: guarda monotônica por registro. Domain: `classificarMudancas` devolve `obsoletas` (alterado_em menor); empate com hash diferente = `atualizada`. `calcularResultadoLote`, `ContagensLote` e `LoteListagemItem` ganham `obsoletas` (padrão 0, compatível com `v1`, RN-INT-09). Banco: `WHERE excluded.alterado_em >= registro_atual.alterado_em` no `ON CONFLICT DO UPDATE`. Testes: `domain/idempotencia.test.ts` e `domain/erros.test.ts` (RN-INT-06).
- **2 aceito** ("ativo" = `ativo and deleted_at is null`); **6 aceito** (checkpoint `aplicado_ate_indice` + contagens na mesma transação do bloco; seção 7.10); **9 aceito** (unicidade por `codigo_macuxi` só em `condicao_pagamento`; `deposito` e `status` são ERP → Macuxi); **10 aceito** (staging 7/30 dias; reprocessamento de linha pelo `payload` de `lote_linha_erro`, 30 dias; seções 7.9 e 14); **11 aceito** (`aprovado_em`, só `deleted_at`, `for update`); **12 aceito** (manter, anular `payload` de inativados em 30 dias, anonimização LGPD via evento do Core, dicionário em `docs/banco/integracao.md`).
- **Do banco/engenheiro, só registrados e de acordo**: 1 (sem partição; o gerente corrige o doc 04), 3 (`valor_controle bigint`), 4 (comparador por chaves do lote), 5 (índice de candidatos), 7 (índice único parcial `status = 'processando'` por Conector+entidade; quem perde a corrida leva 23505 e a outbox repete), 8 (`sessao_carga.id` gerado no Hub, `sessao_uuid` do Conector com `unique (tenant_id, conector_id, sessao_uuid)`; `tenant_id` na frente de toda unicidade vinda de dado externo), 13 (expurgo da outbox é do banco; vazão do despacho com 5.000 eventos por lote é do engenheiro), 14 (`integracao.expurgar_retencao`, SECURITY DEFINER, só `macuxi_worker`; agendamento do engenheiro). As observações 🟢 também entram como estão.

### (c) Telas do monitor no BKO — `modules/integracao/web` (`modulo-integracao`, tarefa seguinte)

Menu **Integração ERP** (já no manifesto). Tabelas densas, filtros na URL, exportar CSV, ações escondidas conforme o perfil (a API revalida).
1. **Monitor** (`/integracao`): cards de saúde por Conector, lista de alertas (causa + ação), carga por entidade, lotes recentes, pendências de inativação, reconciliação, pedidos no ERP.
2. **Lotes** (`/integracao/lotes`) e **detalhe** (`/integracao/lotes/:id`): filtros (Conector, entidade, status, período, só com erro), erros por linha com filtro por código/origem, CSV, **Reprocessar**.
3. **Conectores** (`/integracao/conectores`): cadastro, chave exibida **uma vez** (copiar, aviso "guarde agora"), rotacionar com convivência, revogar, ativar/desativar, IPs, política de versão e pacote.
4. **Inativação em massa** (`/integracao/inativacoes`): pendências, amostra, CSV, confirmar/recusar com confirmação reforçada (digitar o nome da entidade).
5. **Mapeamento** (`/integracao/mapeamento`): de-para com validação de duplicidade e aviso dos pedidos retidos.
6. **Pedidos no ERP** (`/integracao/pedidos`): fila por estado, retidos, presos, retorno (número, motivo, notas e itens faturados).
7. **Reconciliação** (`/integracao/reconciliacao`): últimos 30 dias, divergências em destaque.
8. Fora desta entrega: **carga por arquivo** (RF-INT-03) — o BKO converte Excel/CSV em `LoteEnvelope` e usa o mesmo pipeline; desenho em tarefa própria.

## 18. Regras propostas, decisões e perguntas

### 18.1 Regras novas propostas para o doc 03 (seção 9; dono: gerente-projetos)

- **Emenda à RN-INT-02/05 (guarda monotônica)**: linha com `alterado_em` menor que o do registro atual é `obsoleta` (não troca o registro, não publica `atualizado@1`, conta no resumo e no monitor); empate com hash diferente é `atualizada`. Vale para reenvio antigo e reprocessamento. *(`domain/idempotencia.test.ts`)*
- **RN-INT-10 Credencial do Conector**: uma chave de API por Conector, escopo só `integracao.v1`, guardada só como hash, mostrada uma vez; rotação com convivência da anterior (padrão 24 h, máx. 7 dias, no máximo duas chaves válidas); revogação e desativação no BKO; recusa genérica (401) sem revelar o motivo. *(testes: `domain/credencial.test.ts`)*
- **RN-INT-11 Política de versão do Conector**: abaixo da mínima o Hub recusa dados (426) e o Conector para; abaixo da recomendada só avisa; sinal de vida sempre liberado; versão ausente/ilegível ou sem política nunca bloqueia. *(`domain/conector-versao.test.ts`)*
- **RN-INT-12 Limites e idempotência do lote**: `Idempotency-Key` obrigatória em `POST /lotes` (mesma chave+mesmo conteúdo repete a resposta; conteúdo diferente = 409); corpo ≤ 8 MiB; taxa por Conector. *(`domain/lote-idempotencia.test.ts`, `domain/limites.test.ts`)*
- **Emenda à RN-INT-01**: lote sem registros mas com linhas inválidas do Conector é aceito e termina `concluido_com_erros`.
- **Emenda à RN-INT-03**: linhas inválidas do Conector contam em `recebidas`/`com_erro`, não são reprocessáveis e o Hub aplica o limite de 500 por lote.
- **Emenda à RN-INT-06**: linha inválida com `external_id` conta como recebida; sem id ou omitida impede a inativação; só ativos não vistos depois do início da sessão são candidatos; confirmação expira em 7 dias.
- **Emenda à RN-INT-08**: confirmação tardia vale; `numero_erp` imutável; itens faturados conferidos por sequência, produto e saldo; idempotência do faturamento por (pedido, status, nota).
- Parâmetros novos do tenant (tabela do doc 03 §parâmetros): corpo 8 MiB/1 MiB, taxa por Conector, convivência da chave 24 h, validade da confirmação 7 dias, espera por dependência 30 min, alerta de pedido preso 5 tentativas.

### 18.2 Decisões de produto (Alexandre, R-20261101-014652) e onde estão no código
- **P-1 ✅** Lote só com linhas inválidas termina **`concluido_com_erros`**. `calcularResultadoLote` (`invalidas_conector`), `validarEnvelope` (exceção) e o Conector 1.2.0 (manda o lote). T-0027.
- **P-2 ✅** "Lote parado" = lote **aplicado**, só as inativações aguardam confirmação (o cursor avança). `resultadoInativacaoDoLote` + teste "P-2" em `domain/inativacao.test.ts`; aviso do Conector diz que a carga foi aplicada. T-0027.
- **P-3 ✅ (pendente fora desta tarefa)** Gestão de chaves **só admin**; confirmação da inativação em massa **admin ou analista**, com auditoria. O manifesto (`inativacao.decidir`) ainda diz só admin: ajuste do `modulo-integracao` em tarefa local (o `manifest.ts` não estava na trava da T-0027).
- **P-4 ✅ (pendente fora desta tarefa)** Retorno com item faturado inválido é **aceito** (o status vale) **sem os itens inválidos**, com erro no monitor. O domain (`aplicarRetornoPedido`, seção 11.3) ainda recusa com 422 — mudança a fazer junto com as rotas do Hub (A5). O Conector já manda o retorno sem `itens_faturados` quando a consulta de itens é inválida.
- **P-5 ✅** Convivência da chave anterior **24 h** (parâmetro `convivenciaChaveMin`, máx. 7 dias). `rotacionarChaves` + teste "P-5" em `domain/credencial.test.ts`. T-0027.
- **P-6 ✅** **Um Conector por entidade por empresa**; filial com ERP próprio vira outra empresa; o Hub recusa configuração conflitante. `ConectorCriar/Atualizar/Resumo.entidades`, `verificarTopologiaConectores` (409 `topologia_conflitante` no BKO) e `validarEnvelope({ entidadesDoConector })` (422 `entidade_de_outro_conector`). T-0027.
- **P-7 ✅** Um ERP de destino de pedidos por empresa: `verificarTopologiaConectores` recusa o segundo Conector com `recebe_pedidos` (`pedidos_em_outro_conector`). Mais de um ERP: backlog.

### 18.3 Premissas assumidas
- A fila de segundo plano usa a outbox (ADR 0007) com o evento interno `integracao.lote.recebido@1` (seção 8); o engenheiro pode preferir outra.
- `vendedor.pedido.aprovado@1` (11.4) será publicado pelo Vendedor com os `*_external_id` já resolvidos.
- Reconciliação compara com os registros ativos do **mesmo Conector**.
- `tenant_modulo` é a fonte da licença do módulo para a rota de conector (como `/v1/me/modulos`).
- Os números de limite (seção 4) são padrões razoáveis para a Fase 1 e vivem em parâmetros do tenant; revisar com métricas reais.
