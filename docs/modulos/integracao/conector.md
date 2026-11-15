# Conector Macuxi (on-premise)

> Tarefas T-0013 (v1.0), T-0023 (v1.1: ajustes do Alexandre + Oracle) e T-0027 (v1.2: alinhamento com o Hub) · módulo `integracao` · pacote `@macuxi/conector` (`apps/conector`) · 2026-11-01
> Requisitos: RF-INT-02 (Conector), RF-INT-04 (monitor), RF-INT-06 (reconciliação). Regras: RN-INT-01..09 (`docs/produto/03`, seção 9). Fluxo e contrato: `docs/produto/06-integracao-erp.md` e `desenho.md` (mesma pasta).
> Estado: **lado do cliente pronto (v1.1.0)**; o Hub (`/integracao/v1`) ainda não tem rotas — o Conector foi escrito contra os contratos de `@macuxi/integracao/contracts` e a seção 9 lista o que o Hub precisa expor. Novidades da v1.1: linhas inválidas com motivo no lote (§4.1), política de versão mínima/recomendada (§7.4), chave de API por Conector com `trocar-chave` (§4.2, §7.5) e adaptador Oracle (§4.3).
> **Versão 1.3.0 (changelog)**: sobe de 1.2.1 por causa da T-0099. O `conector.json` com `"nulo": "limpa"` **só roda na 1.3.0 ou mais nova**: o Conector 1.2.x tem esquema estrito e recusa a chave ("Configuração inválida"). Antes de usar o opt-in, atualize o Conector (§7.4) e, se quiser impedir o retorno, peça ao Hub mínima 1.3.0. Sem o opt-in, o `conector.json` antigo segue valendo na 1.3.0 sem mudança. O piso 1.2.1 para receber pedidos (RN-INT-11) não muda.
> **Novidades da T-0099 (2026-11-07)**: `testar-conexao` **confere a ordem do `external_id`** no banco do ERP contra a ordem do Conector (binária) e avisa com exemplo concreto quando a colação não é binária ou a chave é numérica (§5.1); opt-in por campo **`"nulo": "limpa"`** no `conector.json` para o NULL da view limpar o campo no Macuxi (§4.1); sem o opt-in nada muda (nulo continua omitido).
> **Novidades da v1.2.1 (T-0048, correções da revisão final da T-0023)**: o ERP que fecha um pedido parcial **sem nota nova** não fatura a mesma nota duas vezes — o `faturado_total` vai com a nota já enviada e **sem** `itens_faturados` (§6, passo 4); os retornos saem **em ordem por pedido**, mesmo depois de queda do Hub (§6, passo 5); pedido guardado fora do contrato vira `rejeitado_erp` sem travar os demais (§6, passo 3); `Retry-After` maior que o teto do retry é respeitado por inteiro (§4); o reenvio das `falha_processamento` não repete as linhas inválidas (§9); `lote.maxLinhasInvalidas` vai até 500 (§4); o Oracle fecha o pool quebrado (§4.3); carga completa que termina numa página só de linhas repetidas passa ao delta (§5). Peça ao Hub versão mínima **1.2.1** para quem recebe pedidos.
> **Novidades da v1.2 (T-0027, alinhamento com o desenho do Hub em `hub-api.md` §16)**: na carga completa **toda** linha inválida vai ao Hub com o `external_id` — o Hub nunca inativa registro que veio inválido (§4.1); página só com linhas inválidas vira lote só com elas; `external_id` até 200 caracteres; HTTP 426 é **pausa**, não bloqueio (§7.4); o pacote leva o **próprio Node 24 LTS** (§2).

## 1. O que é

Um serviço Windows (TypeScript sobre o **Node 24 LTS portátil que vai dentro do pacote**) instalado **dentro da rede do cliente**. Ele lê o banco do ERP por consultas SQL (views somente leitura), monta lotes no envelope do contrato e **empurra** os dados ao Hub do Macuxi por HTTPS. A nuvem nunca acessa o banco do cliente: o Conector só faz conexões de **saída**.

```
ERP (SQL Server / PostgreSQL / Oracle) ──SQL──► Conector ──HTTPS 443 (saída)──► Hub /integracao/v1
                                          │  fila local em disco (SQLite), cursor por entidade, backoff
ERP ◄──SQL/procedure── Conector ◄──GET /pedidos/pendentes── Hub        (pedidos aprovados)
                       Conector ──POST /pedidos/{uuid}/retorno──► Hub  (nº do ERP, faturamento, cancelamento)
```

O que ele faz:

| Função | Como |
|---|---|
| Carga inicial completa | uma sessão por entidade, partes `1..n`, a última com `ultimo: true` (RN-INT-06) |
| Delta | `WHERE (alterado_em, external_id) > cursor`, ordenado pelo par; só o que mudou (RN-INT-05) |
| Lotes | uma entidade por lote, até 5.000 linhas **e** até 4 MiB (o que estourar primeiro divide) |
| Idempotência | chave SHA-256 do conteúdo canônico do lote no cabeçalho `Idempotency-Key`; mesmo conteúdo → mesma chave |
| Resiliência | fila em disco (`node:sqlite`), espera exponencial com jitter, sobrevive a queda de rede, reinício e queda de energia |
| Erros por linha | linha inválida na origem vai ao Hub **com o motivo** (`linhas_invalidas`, até 500 por lote; na carga completa **todas**, para o Hub nunca inativar o registro); lê o resultado do lote; recusa por regra **não** é reenviada; só falha transitória é |
| Pedidos | busca no Hub, grava no ERP por SQL/procedure configurável, confirma o número e acompanha faturamento/cancelamento |
| Reconciliação | contagem e soma de controle diárias por entidade (RN-INT-07) |
| Versão | informa a própria versão em todo lote/sinal/chamada; segue a política do Hub: abaixo da **recomendada** só avisa, abaixo da **mínima** para de enviar (§7.4) |
| Operação | CLI (`testar-conexao`, `status`, `rodar`, `trocar-chave`…), sinal de vida a cada 1 min, logs com rotação e sem dado pessoal |

## 2. Requisitos

| Item | Requisito |
|---|---|
| Sistema | Windows Server 2016+ ou Windows 10/11 (64 bits). O código roda também em Linux/macOS (desenvolvimento e testes). |
| Node.js | **Não precisa instalar.** O pacote do Conector leva o **próprio Node 24 LTS portátil** (`node.exe`, win-x64, versão **24.7 ou superior** — o mínimo único do projeto) junto do WinSW, e não usa nem depende do Node que porventura exista no servidor do cliente (decisão do Alexandre, R-20261031-233442 item 4). O `conector.mjs` é gerado com `target: node24` (`scripts/empacotar.mjs`) e o `package.json` declara `engines.node >= 24.7`. O armazenamento local usa `node:sqlite`, embutido no Node — sem módulo nativo para compilar; no Node 24 ele não emite mais aviso de recurso experimental (a supressão que existia para o Node 22 foi removida na v1.2). Em desenvolvimento e nos testes vale o Node da raiz (`.nvmrc`, 24). A montagem do `.zip` com o `node.exe` e o WinSW é o script `apps/conector/scripts/pacote.mjs` (§7.4). |
| Rede | **Somente saída**: HTTPS (TCP 443) para o endereço do Hub informado pelo Macuxi. Nada de porta de entrada, VPN ou NAT. Se houver proxy/firewall, liberar esse destino. |
| Banco do ERP | SQL Server (2012+), PostgreSQL (12+) ou Oracle (11g R2+; 12c+ recomendado), acessível a partir do servidor do Conector (porta 1433 / 5432 / 1521 **dentro** da rede do cliente). Oracle: driver JavaScript puro (modo *thin*), **sem Oracle Instant Client** (§4.3). |
| Usuário do banco | **Somente leitura** nas views do Macuxi; escrita apenas na tabela/procedure de entrada de pedidos. Nunca `sa`/`postgres`. |
| Disco | ~200 MB livres (fila + 30 dias de log). A fila só guarda lotes que ainda não foram confirmados. |
| Hora | relógio do servidor sincronizado (NTP). |

## 3. Instalação passo a passo

Pasta sugerida: `C:\ProgramData\Macuxi\Conector\`.

> Nos comandos abaixo, `node` é o **`node.exe` do pacote** (Node 24 LTS portátil): abra o PowerShell na pasta do Conector e use `.\node.exe conector.mjs …` (ou o caminho completo). O serviço Windows usa o mesmo `node.exe` (o XML do WinSW aponta para o executável que rodou `instalar-servico`).

1. **Obter o Conector**: o pacote assinado da versão entregue pelo Macuxi (`conector-<versão>.zip`, com `node.exe` — Node 24 LTS portátil —, `conector.mjs`, `WinSW-x64.exe` e `exemplos/`). **Antes de descompactar, confira o SHA-256 e a assinatura** (§7.4). Descompactar em `C:\ProgramData\Macuxi\Conector\`.
2. **Conferir o Node do pacote**: `.\node.exe -v` → `v24.x` (24.7 ou mais). Não é preciso instalar Node no servidor (até a v1.1 era preciso instalar o Node 22; não é mais).
3. **Criar o usuário de leitura no ERP** e as views do Macuxi (modelo em `db/conector/views-modelo.sql`, entregue pelo `banco-dados`; o técnico do cliente adapta os `SELECT` ao ERP dele). Regras das views na seção 5.
4. **Criar o arquivo de configuração** `C:\ProgramData\Macuxi\Conector\conector.json` a partir de `apps/conector/exemplos/conector.exemplo.json` (SQL Server, 8 entidades e pedidos). Ajustar `hub.conectorId` (o identificador cadastrado no BKO para este Conector), `hub.url`, `erp.*`, as consultas e o mapeamento de colunas. Para Oracle parta de `conector.oracle.exemplo.json`. **Sem senha nem chave no arquivo.** Conferir: `node conector.mjs validar-config --config conector.json`.
5. **Guardar os segredos** (senha do banco do ERP e **chave de API deste Conector**, entregue uma vez pelo BKO junto com o identificador):
   - Gerenciador de Credenciais do Windows (recomendado), na conta que vai rodar o serviço:
     ```
     echo SENHA_DO_BANCO| node conector.mjs segredo definir erp_senha --config conector.json
     echo CHAVE_DO_HUB| node conector.mjs segredo definir hub_chave --config conector.json
     ```
   - ou variáveis de ambiente do sistema `MACUXI_CONECTOR_ERP_SENHA` e `MACUXI_CONECTOR_HUB_CHAVE` (qualquer administrador local as lê; use só se o Gerenciador de Credenciais não for opção).
6. **Testar**: `node conector.mjs testar-conexao --config conector.json`. Confere segredos, abre o banco do ERP, roda a consulta de cada entidade com 5 linhas de amostra e mostra se o mapeamento bate com o contrato (sem imprimir valores), **confere a ordem do `external_id`** da consulta contra a do Conector (§5.1) e testa o Hub com o identificador e a chave. Corrija tudo que vier `[ERRO]` e trate os `[aviso]` de ordem antes de ligar o serviço.
7. **Primeira passada manual** (opcional): `node conector.mjs rodar --uma-vez --config conector.json` e depois `node conector.mjs status`.
8. **Instalar o serviço** (seção 7): o `WinSW-x64.exe` vem no pacote (se precisar baixar à parte, use a página de releases de https://github.com/winsw/winsw e confira o SHA-256 publicado). Em PowerShell **como administrador**, na pasta do Conector:
   ```
   .\node.exe conector.mjs instalar-servico --winsw .\WinSW-x64.exe --config conector.json
   ```
   Em seguida, em `services.msc`, abrir o serviço **Macuxi Conector** → aba *Fazer logon* → informar a conta que gravou os segredos (o Gerenciador de Credenciais é por usuário) → *Iniciar*.
9. **Conferir no BKO**: o Conector aparece com "último sinal" menor que 1 min e as entidades vão ganhando lotes no monitor (RF-INT-04). Se ficar mais de 15 min sem sinal o BKO alerta.

Desinstalar: `node conector.mjs desinstalar-servico --config conector.json`. Os dados em `dados\` (fila e logs) ficam; apague a pasta para recomeçar do zero (o Conector pede o cursor ao Hub e faz delta, ou refaz a carga completa se o Hub não tiver cursor).

## 4. Configuração

JSON ou YAML (pela extensão), validado por Zod ao iniciar; chave desconhecida é erro e a mensagem lista o que existe. Exemplo completo: `apps/conector/exemplos/conector.exemplo.json`.

| Chave | Padrão | Para quê |
|---|---|---|
| `dadosDir` | `./dados` | `fila.sqlite`, `logs/`, trava de instância única |
| `hub.conectorId` | — | identificador deste Conector no Hub (letras, números, `.`, `-`, `_`). Vai no cabeçalho `X-Macuxi-Conector-Id`, no lote e no sinal. Não é segredo; a **chave** fica fora do arquivo (§4.2) |
| `hub.url` | — | raiz do Hub; `/integracao/v1` é do contrato. **HTTPS obrigatório** (HTTP só para `localhost`, testes) |
| `hub.timeoutSegundos`, `hub.retry.{tentativas,baseMs,maxMs}` | 30; 4, 500, 30000 | cada chamada ao Hub repete com espera exponencial + jitter em falha de rede, 408/425/429/5xx (respeita `Retry-After`, em segundos **ou** em data HTTP; valor ausente, inválido ou no passado usa o backoff normal; o teto é `hub.retry.maxMs`). **`Retry-After` maior que o teto** (T-0048, RN-INT-12): o Conector não tenta de novo na hora nem encurta a espera — nenhuma chamada sai até o prazo pedido (exceto depois de reiniciar o serviço) e o lote/retorno fica na fila com a próxima tentativa em `max(backoff, agora + Retry-After)` |
| `erp.tipo` | — | `sqlserver`, `postgres` ou `oracle` |
| `erp.host/porta/banco/usuario` | — | conexão (a senha vem dos segredos). Oracle: `banco` é o **nome do serviço** (service name), porta padrão 1521 |
| `erp.criptografar`, `erp.confiarCertificado` | `true`, `false` | TLS com o banco (SQL Server `encrypt`; PostgreSQL `ssl`; Oracle `tcps://`). Servidor sem TLS: `criptografar: false` (Oracle on-premise comum). **Aviso:** com `criptografar: false` e `erp.host` fora de localhost/LAN (IP público, nome com domínio da internet), `testar-conexao` imprime `[aviso]` e o serviço registra `erp_sem_criptografia` no log, sugerindo `criptografar: true` ou uma rede privada/VPN, porque a senha do ERP trafegaria em claro (localhost, 10.x, 172.16-31.x, 192.168.x, link-local, IPv6 ULA, nome curto e `.local/.lan/.intranet` não avisam). É só um aviso: não muda o padrão (`true`) nem impede a conexão |
| `erp.paginacao`, `erp.carteira` | `offset`, — | **só Oracle** (§4.3): `offset` (12c+) ou `rownum` (11g); pasta do wallet PEM para TLS com certificado próprio |
| `segredos.provedor` | `auto` | `env`, `windows` ou `auto` (env primeiro; no Windows, depois o Gerenciador de Credenciais) |
| `lote.maxLinhas`, `lote.maxBytes` | 5000, 4 MiB | limites de cada lote |
| `lote.maxLinhasInvalidas` | 500 (0 a 500) | **delta**: quantas linhas inválidas (com o motivo) vão ao Hub por página; as que passarem disso entram só na contagem (`linhas_invalidas_omitidas`); `0` = só a contagem. **Carga completa**: nenhuma é omitida — vão todas, em fatias de até `min(maxLinhasInvalidas, 500)` por parte (`0` vale 500), porque o `external_id` é o que impede o Hub de inativar o registro (RN-INT-06) |
| `fila.*` | ver exemplo | `maxLotesPendentesPorEntidade` (contrapressão), backoff persistido, retenção, reenvios por falha transitória |
| `logs.{nivel,retencaoDias,maxMegabytes}` | info, 30, 10 | rotação diária + por tamanho |
| `sinalSegundos` | 60 | batimento (`POST /sinal`) |
| `margemDeltaSegundos` | 120 | folga ao voltar da carga completa para o delta |
| `reconciliacaoHora` | `02:00` | hora local a partir da qual a reconciliação do dia é enviada |
| `entidades.<nome>` | — | `cliente`, `produto`, `preco`, `estoque`, `titulo`, `nota`, `vendedor`, `rota` (nomes do contrato) |
| `pedidos` | — | retorno de pedidos ao ERP (seção 6) |

### 4.1 Uma entidade

```json
"cliente": {
  "ativa": true,
  "periodicidadeSegundos": 3600,
  "consulta": "SELECT TOP (:limite) codigo AS external_id, alterado_em, ativo, razao_social, ... FROM dbo.vw_macuxi_cliente WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND codigo > :cursor_external_id) ORDER BY alterado_em, codigo",
  "campos": {
    "external_id": "external_id",
    "alterado_em": "alterado_em",
    "razao_social": "razao_social",
    "bloqueado": { "coluna": "bloqueado", "transformar": "booleano" },
    "limite_credito_cents": { "coluna": "limite_credito", "transformar": "centavos_de_decimal" },
    "endereco.cidade": "cidade",
    "contatos": { "coluna": "contatos_json", "transformar": "json" }
  },
  "linhasInvalidas": "enviar",
  "reconciliacao": { "consulta": "SELECT COUNT(*) AS contagem, NULL AS soma FROM dbo.vw_macuxi_cliente WHERE ativo = 1" }
}
```

- **Parâmetros da consulta** (nomeados com `:`; o Conector converte para `@nome` no SQL Server e `$n` no PostgreSQL; `::cast`, literais e comentários são respeitados):
  `:cursor_alterado_em` (data-hora UTC), `:cursor_alterado_em_ms` (número, para colunas em milissegundos), `:cursor_external_id` (texto) e `:limite`. A validação da configuração exige `:cursor_alterado_em`, `:cursor_external_id` e `:limite`.
- **Paginação**: a consulta é chamada com `:limite = lote + 1`; a linha a mais diz se há outra página (e portanto qual parte é a última da carga completa), sem lote vazio.
- **`campos`**: `campo do contrato` → coluna | `{ coluna, transformar, nulo }` | `{ valor }`. Caminho com ponto monta objeto (`endereco.cidade`). Transformações: `texto`, `inteiro`, `numero`, `booleano` (S/N, 1/0, true/false), `data_hora_utc`, `data_civil`, `centavos_de_decimal` (reais → centavos; valor em texto decimal, como o `NUMBER` do Oracle, converte sem ponto flutuante), `json` (coluna com JSON: use `FOR JSON PATH` / `json_agg` para `contatos` do cliente e `paradas` da rota). Valores nulos viram campo ausente (padrão; veja `nulo` abaixo). Nomes de coluna não diferenciam maiúsculas.
- **`nulo`** (T-0099, opcional, só na forma `{ coluna, … }`): o que fazer quando a coluna vem **NULL** da view.
  | Valor | O que vai ao Hub | Efeito no Macuxi |
  |---|---|---|
  | `omite` (padrão; igual a não informar) | o campo **some** do registro | campo ausente **não altera** o que o Macuxi já tem (comportamento da v1, sem mudança) |
  | `limpa` | o campo vai com **`null`** | o Hub **limpa** o campo (igual ao `null` do arquivo do portal e da API direta) |

  ```json
  "prazo_medio_max_dias": { "coluna": "prazo_medio_max_dias", "transformar": "inteiro", "nulo": "limpa" },
  "formas_pagamento":     { "coluna": "formas_pagamento", "transformar": "json", "nulo": "limpa" }
  ```
  Regras: `limpa` só vale para campo que o **contrato aceita nulo** (`limite_credito_cents`, `vendedor_external_id`, `endereco.cidade`, `prazo_medio_max_dias`, `formas_pagamento`…); em campo obrigatório (`razao_social`, `external_id`, `alterado_em`…) a configuração é **recusada** ao carregar, com o caminho (`entidades.cliente.campos.razao_social.nulo`), porque o `null` tornaria a linha inválida. Valor presente segue a transformação normal. Coluna que **não veio** na linha (nome errado) continua omitida — não é um NULL da view. Os exemplos `conector*.exemplo.json` já trazem `"nulo": "limpa"` em `prazo_medio_max_dias` e `formas_pagamento` do cliente.
- Os campos aceitos por entidade são os do contrato (`desenho.md` §8); campo inexistente é recusado ao carregar a configuração.
- **`linhasInvalidas`** (decisão do Alexandre, T-0023): `enviar` (padrão) informa ao Hub a linha que não passou no schema local **com o motivo** — no campo opcional `linhas_invalidas` do lote, com `external_id`, `codigo` (`campo_obrigatorio`, `tipo_invalido`, `formato_invalido`…), `campo` e `mensagem` — **sem o valor da linha** (nem dado pessoal). O BKO as mostra no monitor ao lado dos erros do Hub (RN-INT-03). A linha **não** vai em `registros`. Uma linha com vários campos ruins vira **uma** entrada (campo e código do primeiro; a mensagem resume todos). `descartar` deixa só no log/erros locais (`conector status`) — **só no delta** (abaixo).
- **Carga completa (T-0027 🔴, RN-INT-06)**: toda linha inválida vai ao Hub **com o `external_id`**, mesmo com `linhasInvalidas: descartar` e sem nenhuma omitida (fatias de até 500 por parte; o que sobra vira parte só de inválidas). Motivo: o Hub inativa no fim da carga o que **não veio**; uma linha que o Conector descartasse sumiria da sessão e o registro, que continua no ERP, seria inativado. Com o `external_id` o Hub sabe que o registro existe e **nunca o inativa** (nem depois da confirmação do operador). Linha cujo mapeamento quebra (JSON inválido em outra coluna, por exemplo) leva o `external_id` lido direto da coluna; sem `external_id` legível (ou acima de 200 caracteres, que nunca é cortado) a linha vai sem id e o Hub **não inativa nada** naquela sessão — o lado seguro.
- **Página só com linhas inválidas** (v1.2): vira um lote com `registros: []` e as inválidas (exceção da RN-INT-01 aprovada, P-1); no delta o cursor segue normalmente e, na carga completa, a última página fecha a sessão (`ultimo: true`). O aviso `linhas_invalidas_sem_lote` da v1.1 deixou de existir.
- **`external_id`** aceita até **200 caracteres** (igual no Hub, `EXTERNAL_ID_MAX`).
- **Resultado do Hub**: as linhas informadas voltam em `erros[]` com `origem: "conector"` (o Conector não as conta de novo) e o lote termina `concluido_com_erros`.

### 4.2 Segredos

| Nome | Variável de ambiente | Gerenciador de Credenciais (alvo) |
|---|---|---|
| `erp_senha` | `MACUXI_CONECTOR_ERP_SENHA` | `Macuxi.Conector/erp_senha` |
| `hub_chave` | `MACUXI_CONECTOR_HUB_CHAVE` | `Macuxi.Conector/hub_chave` |

- **Uma chave de API por Conector** (T-0023): identificador (`hub.conectorId`) + chave. A chave vale **só para `/integracao/v1`** (escopo `integracao.v1`) e só para este Conector; revogar um Conector não afeta os outros. Vai em `Authorization: Bearer <chave>`.
- Chave `senha`, `password`, `token`, `chave`, `secret`… no arquivo de configuração é **recusada** com orientação.
- O segredo é relido a cada 60 s: **rotacionar a chave do Hub não exige reiniciar o serviço** nem reinstalar (§7.5).
- O Gerenciador de Credenciais é lido/gravado por PowerShell (P/Invoke de `advapi32`: `CredRead`/`CredWrite`), sem módulo nativo do Node. O valor a gravar vai por entrada padrão, nunca em argumento de processo.
- Todo segredo lido (e a chave nova aceita por `trocar-chave`) é registrado numa lista de máscara: se aparecer em qualquer mensagem de log vira `***`. Além disso, texto do tipo `chave=…`, `hub_chave=…`, `x-api-key: …`, `Authorization: Bearer …` é mascarado por nome, e campos de log chamados `chave`, `hub_chave`, `api_key`, `authorization`… têm o valor trocado por `***` (teste em `test/chave.test.ts`).

### 4.3 Oracle

Adaptador `src/erp/oracle.ts` (T-0023), driver `oracledb` em **modo thin**: JavaScript puro, **sem Oracle Instant Client**, sem módulo nativo (o código nunca inicializa o cliente nativo). Oracle **11g R2 ou superior** (12c+ recomendado).

```json
"erp": { "tipo": "oracle", "host": "erp-ora01", "porta": 1521, "banco": "ERPPRD", "usuario": "MACUXI_LEITURA",
         "criptografar": false, "paginacao": "offset" }
```
Exemplo completo (cliente, produto e pedidos): `apps/conector/exemplos/conector.oracle.exemplo.json`.

- **Conexão**: Easy Connect `host:porta/serviço` (`banco` é o *service name*, não o SID). Pool pequeno (até 3 conexões), timeouts pelo `erp.timeoutSegundos`. `criptografar: true` usa `tcps://` (porta 2484 se não informar); `confiarCertificado: true` desliga a conferência do DN do certificado; para certificado próprio aponte `erp.carteira` para a pasta com `ewallet.pem`. Sem `criptografar` é TCP simples (o caso comum em rede interna).
- **Consultas parametrizadas**: `:nome` é bind nativo do Oracle; o Conector só passa os binds que aparecem no SQL e **nunca concatena valor**. Datas vão como `TIMESTAMP WITH TIME ZONE` (instante exato em UTC, sem depender do fuso do servidor do Conector). Nomes de coluna voltam em minúsculas.
- **Paginação** — escolha uma:
  1. **Sem `:limite` na consulta** (recomendado): o Conector aplica o limite conforme `erp.paginacao`:
     - `offset` (padrão, **Oracle 12c+**): acrescenta `OFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY` ao fim do seu `SELECT … ORDER BY`. A leitura é por cursor (keyset), então o deslocamento é sempre 0.
     - `rownum` (**fallback para 11g**): envolve a consulta: `SELECT * FROM ( <sua consulta ordenada> ) WHERE ROWNUM <= :limite`. É o padrão *top-N* clássico e respeita o `ORDER BY` interno.
     Se um Oracle anterior à 12c falhar com `ORA-00933` no modo `offset`, o erro já vem com a dica de trocar para `rownum`.
  2. **Com `:limite` na consulta**: o Conector não reescreve nada e executa como está (por exemplo `… ORDER BY alterado_em, codigo FETCH FIRST :limite ROWS ONLY`).
  Em qualquer caso a consulta **precisa** do `ORDER BY alterado_em, <chave>` e dos parâmetros `:cursor_alterado_em` e `:cursor_external_id`.
- **Tipos → contrato** (a sessão é fixada em `TIME_ZONE = '+00:00'` e formatos ISO a cada conexão):
  | Coluna Oracle | O que o Conector entrega | Observação |
  |---|---|---|
  | `DATE`, `TIMESTAMP`, `TIMESTAMP WITH LOCAL TIME ZONE` | `Date` em **UTC** (ISO no contrato) | o banco guarda sem fuso: a view deve devolver UTC (`SYS_EXTRACT_UTC(coluna)` ou `FROM_TZ(coluna,'America/Boa_Vista') AT TIME ZONE 'UTC'`) |
  | `TIMESTAMP WITH TIME ZONE` | `Date` do **instante exato** | o deslocamento do valor é respeitado |
  | `NUMBER` | número se for **inteiro seguro**; senão **texto decimal exato** (`"19.99"`) | nunca passa por ponto flutuante; dinheiro: use `transformar: "centavos_de_decimal"` (converte o texto em centavos inteiros por aritmética de texto, meio centavo sobe) |
  | `CLOB`/`NCLOB` | texto | colunas JSON: `transformar: "json"` |
  | `VARCHAR2`, `CHAR`, `RAW`… | padrão do driver | |
  Quantidade/saldo **fracionário** (`NUMBER(14,3)`) chega como texto: use `transformar: "numero"`. Flags `NUMBER(1)`/`CHAR(1)`: `transformar: "booleano"` (`S/N`, `1/0`).
- **Pedidos**: `gravacao.cabecalho`/`itens` com `INSERT … SELECT … FROM DUAL WHERE NOT EXISTS (…)` (idempotente pelo `pedido_uuid`) **sem ponto e vírgula final**; bloco PL/SQL (`BEGIN pkg.grava(:pedido_uuid, …); END;`) **com** ponto e vírgula. A gravação roda numa transação (`COMMIT` ao fim, `ROLLBACK` em qualquer erro).
- **Erros**: `NJS-500/503/510` e `ORA-12541/12170/03113/03114/01033/01034…` são de **conexão** (transitórios: o Conector tenta depois e não conta tentativa de pedido; o pool quebrado é **fechado** na hora e o próximo uso abre outro, T-0048); `ORA-00942`, `ORA-01017` etc. são de SQL/credencial (definitivos, aparecem no `status`/`testar-conexao`).
- **Teste com Oracle real**: `test/oracle.test.ts` tem testes de unidade com dublê do driver (SQL gerado, binds, paginação nos dois modos, conversão de tipos) e um teste de integração que só roda com `MACUXI_ORACLE_URL=usuario/senha@host:1521/servico` (usa só `DUAL`, somente leitura). Sem a variável ele é **pulado** com aviso.

## 5. Como o delta funciona e o que as views precisam respeitar

1. **Primeira execução de uma entidade** (sem estado local): o Conector pergunta `GET /cursores/{entidade}`.
   - Hub **sem** cursor → **carga inicial completa**: lê tudo em páginas, enfileira partes `1..n` da mesma sessão (UUID), a última com `ultimo: true`. Só quando o Hub conclui todas as partes ele inativa o que sumiu (RN-INT-06).
   - Hub **com** cursor (Conector reinstalado) → segue por delta a partir dele.
2. **Depois**: só delta (`modo: delta`), na periodicidade da entidade.
3. **Dois cursores por entidade**: *leitura* (até onde já foi lido e enfileirado) e *confirmado* (até onde o Hub **concluiu**). O confirmado só avança em ordem, quando o lote termina `concluido` ou `concluido_com_erros` (RN-INT-05). Reiniciar em qualquer ponto nunca perde nem duplica trabalho: o lote pendente continua na fila e é reenviado com a **mesma chave**, e o Hub devolve o mesmo `lote_id`.
4. **Fim da carga completa**: o delta recomeça `margemDeltaSegundos` antes do início da carga, para pegar o que mudou durante a carga (idempotente pelo hash no Hub).
5. **Carga completa sob demanda**: `conector carga-completa cliente` (ou `todas`) descarta a fila da entidade e abre nova sessão.

Regras das views (o técnico do cliente deve garantir):

- **`alterado_em` em UTC, com precisão de milissegundos** (`datetime2(3)`, `timestamp(3)`, ou `rowversion` convertido). Precisão maior que ms (microssegundos do PostgreSQL) faz o filtro do SQL devolver a mesma linha de novo; o Conector ignora a repetição (par ≤ cursor; se a **última** página da carga completa só tiver linhas repetidas, a carga termina e a entidade passa ao delta — log `sessao_nao_fechada`, sem inativação, T-0048), mas use `date_trunc('milliseconds', ...)` também no `WHERE`/`ORDER BY` para o filtro ser exato.
- **`alterado_em` nunca nulo** (use `COALESCE`): linha com `alterado_em` nulo não satisfaz o filtro e fica de fora.
- **`external_id` é a chave interna do ERP** (código, id), único por entidade, **nunca CPF/CNPJ** — ele aparece em logs de erro. Para preço e estoque é uma chave composta por item (`TAB01:SKU123`).
- **Ordem por (`alterado_em`, `external_id`)** com colação **binária/ordinal**, para a ordem do banco ser a mesma do Conector. **Sem isso o Conector perde linhas sem avisar**: com SQL Server em colação `CI_AS`, o banco e o Conector ordenam o `external_id` de formas diferentes e, num UPDATE em massa no mesmo milissegundo que cruza a página, a linha é descartada como "repetida". **Chave numérica também diverge** (correção da T-0099): o Conector compara o `external_id` como **texto** (`"10"` < `"9"`), o banco compara a coluna `int` como número (9 < 10); devolva a chave como texto (`CAST`/`TO_CHAR`) e filtre/ordene esse texto em binário. O `testar-conexao` confere isso (§5.1). Copie nas consultas (os exemplos já vêm assim):
  - SQL Server: `... OR (alterado_em = :cursor_alterado_em AND external_id COLLATE Latin1_General_BIN2 > :cursor_external_id) ORDER BY alterado_em, external_id COLLATE Latin1_General_BIN2`
  - Oracle: `... OR (alterado_em = :cursor_alterado_em AND NLSSORT(external_id, 'NLS_SORT=BINARY') > NLSSORT(:cursor_external_id, 'NLS_SORT=BINARY')) ORDER BY alterado_em, NLSSORT(external_id, 'NLS_SORT=BINARY')`
  - PostgreSQL: `external_id COLLATE "C"` nos mesmos dois pontos.
- **Desativar** é `ativo = 0/false` na view (o registro continua aparecendo com `ativo` falso), não apagar a linha: o delta só enxerga o que existe. A carga completa cobre exclusões físicas (inativa os ausentes — com a trava abaixo).
- **Trava de inativação em massa (RN-INT-06)**: se a carga completa fosse inativar mais de 30% dos ativos, o Hub **não inativa** e espera confirmação do operador no BKO. O lote é **aplicado** normalmente e o cursor avança — só as inativações esperam (P-2). O Conector lê isso no resultado do último lote (`inativacao.situacao = aguardando_confirmacao`, com `candidatos` e `percentual`; campo do contrato `LoteResultado`), mostra o aviso em `conector status` e no log e **não reenvia nem força nada**.
- **Um Conector por entidade** (P-6, RN-INT-13): na v1 cada entidade de uma empresa vem de **um único** Conector (o cadastro no BKO diz quais). Se este Conector mandar uma entidade que é de outro, o Hub recusa o lote com `entidade_de_outro_conector` e a entidade fica **BLOQUEADA** com a causa; ajuste o cadastro no BKO ou desative a entidade no arquivo e rode `conector retomar <entidade>`. Filial com ERP próprio é outra empresa (outro tenant, outra chave).

### 5.1 Conferência da ordem no `testar-conexao` (T-0099)

Para cada entidade, depois da amostra, o `testar-conexao` confere se a consulta **do arquivo** (com os `COLLATE`/`NLSSORT` que ela tiver) ordena e filtra o `external_id` como o Conector (ordem binária/ordinal, a de `compararCursor`). Só lê, com `:limite` de até 5 linhas:

1. **ORDER BY**: na amostra, duas linhas com o mesmo `alterado_em` fora da ordem binária já são divergência.
2. **Controle**: com o cursor na própria primeira linha (T, x), ela não pode voltar. Se voltar (`alterado_em` com precisão maior que milissegundos, consulta que não filtra pelo cursor), a conferência é **inconclusiva** e nada é afirmado.
3. **Sondas no filtro**: cursores (T, y) em que a ordem binária e as colações comuns discordam — caixa trocada (`abc` → `ABC`), letra vizinha da outra caixa (`C10` → `b10`), número mais longo com dígito menor (`123` → `1229`). A ordem binária diz se a linha x deve voltar; se o banco discordar, a ordem diverge.

Saída:

| Linha | Quando | O que fazer |
|---|---|---|
| `[ok] cliente: ordem do external_id igual à do Conector (binária; n sonda(s)).` | o banco concordou em tudo | nada |
| `[aviso] cliente: a ordem do external_id no banco do ERP diverge da ordem do Conector (binária/ordinal). Exemplo: com o cursor em external_id "b10" o banco considerou "C10" maior, mas na ordem do Conector "C10" é menor. …` | colação não binária (SQL Server `CI_AS`/`CS_AS`, Oracle `NLS_SORT` linguístico, PostgreSQL `en_US`/ICU) ou chave numérica (`… (o banco comparou como número)`) | corrigir a consulta como na lista acima: SQL Server `COLLATE Latin1_General_BIN2`, Oracle `NLSSORT(…, 'NLS_SORT=BINARY')`, PostgreSQL `COLLATE "C"`, **no filtro e no ORDER BY**; a mensagem traz a orientação do `erp.tipo` configurado |
| `cliente: ordem do external_id não conferida (…)` | consulta vazia, primeira linha sem chave/data, controle falhou ou consulta com erro | conferir o motivo; sem linhas no ERP, repetir quando houver |

O aviso **não conta como falha** (o código de saída continua o dos `[ERRO]`), mas deve ser tratado antes de ligar o serviço. O exemplo mostra `external_id` (a chave interna do ERP, nunca CPF/CNPJ — §5), mascarado e cortado em 40 caracteres; nenhum outro valor da linha é impresso. Limite: chave só com `A`/`z` ou sem letras e dígitos não tem sonda útil, e a conferência olha a primeira linha da consulta — `[ok]` não prova a ordem para todos os valores; a regra continua sendo usar a colação binária.

## 6. Retorno de pedidos ao ERP (RN-INT-08)

Configuração `pedidos` (ver exemplo): SQL ou procedure por pedido, em transação.

| Parte | O que é | Parâmetros |
|---|---|---|
| `gravacao.cabecalho` | `INSERT`/`EXEC` do cabeçalho | `pedido_uuid`, `cliente_external_id`, `vendedor_external_id`, `condicao_pagamento_erp`, `criado_em`, `aprovado_em` (UTC), `observacao`, `desconto_total_cents`, `total_cents`, `tentativa` |
| `gravacao.itens` | executado uma vez por item (opcional) | `pedido_uuid`, `sequencia`, `produto_external_id`, `quantidade`, `preco_unitario_cents`, `desconto_cents`, `total_cents` |
| `gravacao.numeroErp` | devolve a coluna `numero_erp` do pedido gravado (lida **dentro** da transação) | `pedido_uuid` |
| `status.consulta` | situação do pedido no ERP; uma linha por fato (integração, cada nota, cancelamento) | `pedido_uuid`; colunas `status`, `numero_erp`, `motivo`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents`, `ocorrido_em` |
| `status.consultaItensNota` | itens faturados de uma nota (opcional) | `pedido_uuid`, `nota_numero`, `nota_serie`; colunas obrigatórias `sequencia` (a do `PedidoParaErp.itens`), `quantidade` (inteiro > 0, faturado NESTA nota), `valor_cents` (centavos inteiros >= 0) e `produto_external_id` (código do produto no ERP) |
| `status.mapaStatus` | código do ERP → `integrado`, `rejeitado_erp`, `faturado_parcial`, `faturado_total`, `cancelado` | — |

Fluxo:

1. `GET /pedidos/pendentes` (a cada `consultaSegundos`, 60 s). O pedido é **gravado no armazenamento local antes** de qualquer outra coisa: se o Hub reentregar (timeout de 10 min sem confirmação), o `pedido_uuid` já conhecido não é gravado de novo no ERP. **Escreva o SQL de gravação também idempotente pelo `pedido_uuid`** (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`…), para a janela "gravou no ERP e caiu antes de anotar". Defesa extra do Conector (T-0013, revisão do engenheiro): se o pedido já teve tentativa de gravação ou o último erro foi de conexão (a janela "o ERP aplicou o COMMIT e a resposta se perdeu"), a consulta `gravacao.numeroErp` roda **antes** de gravar; se já devolver número, o Conector só anota `gravado`, enfileira `integrado` e **não grava de novo** (log `pedido_ja_existia_no_erp`). Por isso `numeroErp` deve funcionar fora da transação de gravação e devolver vazio enquanto o pedido não existe. Limite conhecido: a queda do PROCESSO do Conector exatamente entre o COMMIT e a anotação local não deixa rastro de tentativa e só a idempotência do SQL do cliente cobre essa janela.
2. Grava cabeçalho + itens + lê o número, numa transação (qualquer falha desfaz tudo). Confirma `integrado` com `numero_erp`.
3. **Pedido guardado fora do contrato** (`PedidoParaErp`, ex.: gravado por versão anterior) não interrompe a gravação dos seguintes (T-0048): volta ao Hub como `rejeitado_erp` com o motivo "pedido fora do contrato" e só os **nomes** dos campos (nunca os valores); log `pedido_fora_do_contrato`.
   **Erro de conexão** com o ERP não conta tentativa (volta depois). **Erro do SQL/regra** conta; ao esgotar `maxTentativasGravacao` (3) o pedido volta ao Hub como `rejeitado_erp` com o motivo (texto do erro do banco, sem dado pessoal, até 300 caracteres).
4. A cada `statusSegundos` (120 s), para cada pedido aberto, roda `status.consulta` e informa: `faturado_parcial` (uma nota por vez, com `itens_faturados` quando `consultaItensNota` existir), `faturado_total` (só a **última** nota; se o ERP marcar o pedido inteiro como faturado em todas as linhas, as notas anteriores seguem como parciais), `cancelado` (com motivo). O Macuxi só escreve cancelamento no ERP no caso do passo 5-A (T-0114). Situação do ERP sem equivalente (ex.: "em separação") é ignorada.
   **Fechamento sem nota nova** (T-0048, RN-INT-08): o status do ERP é do **pedido**. Se o ERP fecha um pedido parcial cortando o saldo, sem emitir nota, a última nota (já enviada como `faturado_parcial`) aparece como `faturado_total`. Esse fechamento vai com a **mesma nota** (número e série, para o Hub reconhecer a repetição) e **sem `itens_faturados`**: os itens de uma nota saem uma única vez (log `fechamento_sem_nota_nova`). Fechamento **com** nota nova leva os itens da nota nova normalmente.
5. Cada retorno é validado com o contrato `RetornoErp` (faturado sem nota, rejeitado sem motivo… nem sai), guardado numa fila local e reenviado até o Hub aceitar; **em ordem por pedido** — enquanto um retorno espera o backoff (Hub fora), os seguintes do mesmo pedido também esperam, para o `faturado_total` nunca chegar antes da nota parcial (T-0048); recusa por regra do Hub (422, ex.: transição inválida) não é repetida. O Hub é idempotente: repetir o mesmo retorno devolve `repetido: true`.
5-A. **Cancelamento feito no Macuxi (T-0114; exceção da RN-INT-08/RN-VEN-31).** Só para o Conector cadastrado no BKO com `aceita_cancelamento` (padrão desligado; `PATCH /conectores/{id}`): o Hub passa a entregar, no mesmo `GET /pedidos/pendentes`, a lista aditiva `cancelamentos` (`{ pedido_uuid, numero_erp, motivo, cancelado_em, tentativa }`). O Conector guarda o cancelamento no armazenamento local **antes** de executar (tabela `cancelamento`; reentrega do Hub não executa duas vezes), roda `pedidos.cancelamento.executar` (view/procedure do cliente, numa transação; parâmetros `pedido_uuid`, `numero_erp` (nulo se ainda não gravado), `motivo`, `cancelado_em`) e confirma com o retorno `cancelado` de sempre; é essa confirmação que muda o status no Hub e no Vendedor. Pedido que o Conector ainda não gravou no ERP não chama o ERP: só é encerrado e confirmado. Erro de conexão não conta tentativa; erro do SQL conta e, ao esgotar `maxTentativasGravacao`, o cancelamento fica `falhou` (log `cancelamento_falhou_no_erp`; o pedido segue ativo no ERP) e o Conector envia o retorno `cancelamento_recusado` com o motivo do ERP (mascarado, até 300 caracteres) para o monitor do BKO alertar (T-0114). Sem `pedidos.cancelamento` no arquivo, nada é escrito no ERP (log `cancelamento_sem_configuracao`). Exemplo: `"cancelamento": { "executar": "EXEC dbo.cancelar_pedido_macuxi @pedido_uuid = :pedido_uuid, @motivo = :motivo" }`. O Conector antigo ignora o campo `cancelamentos` (aditivo na v1).
6. **`itens_faturados`** (T-0023; já em `contracts/pedido.ts`, campo `itens_faturados` opcional no retorno, continua `v1`; **dentro do item, `produto_external_id` e `valor_cents` são obrigatórios** — decisão do Alexandre): cada retorno `faturado_parcial`/`faturado_total` leva os itens **desta nota** — `{ sequencia, produto_external_id, quantidade, valor_cents }`. O `produto_external_id` é o "produto_id" da decisão, na chave do ERP; o Hub resolve o `produto_id` interno pela `sequencia` do pedido enviado e confere pelo `external_id`. Linhas da mesma sequência somam (e devem ter o mesmo produto). O Conector nunca inventa valor nem produto: linha sem produto, sem valor, com `valor_cents` fracionário, quantidade fracionária ou sequência inválida torna os itens da nota inválidos; o retorno segue sem `itens_faturados` e o aviso `itens_faturados_omitidos` registra a linha e o motivo (corrija a `consultaItensNota`). **Duas notas parciais são dois retornos**: a idempotência do faturamento é por (pedido, status, número+série da nota), não só pelo status (RN-INT-08; `transicionarRetornoPedidoErp` no domain).

## 7. Operação

### 7.1 Comandos

`node conector.mjs <comando> [--config conector.json]` (ou `MACUXI_CONECTOR_CONFIG`):

| Comando | O que faz |
|---|---|
| `validar-config` | confere o arquivo (sem conectar a nada) |
| `testar-conexao` | segredos, banco do ERP (consulta, mapeamento e **ordem do `external_id`** por entidade, §5.1), Hub (credencial); `[aviso]` se o ERP está fora da LAN sem criptografia ou se a ordem do `external_id` diverge da do Conector. Código 1 se algo falhar (aviso não é falha) |
| `status [--json]` | **versão** (`em dia`, `DESATUALIZADO` ou `VERSÃO ABAIXO DA MÍNIMA`, com a política do Hub), fila local por estado, por entidade: fase, último sucesso, cursor confirmado, **bloqueios**, avisos (trava de inativação), último erro, erros locais e do Hub, pedidos e retornos, erros recentes. Código 3 se houver entidade bloqueada **ou versão abaixo da mínima** |
| `rodar [--uma-vez]` | laço do serviço; `--uma-vez` faz uma passada completa e imprime o status |
| `carga-completa <entidade\|todas>` | nova sessão de carga completa |
| `retomar <entidade>` | libera entidade bloqueada e relê do cursor **confirmado** (delta) ou recomeça a sessão (carga completa) |
| `segredo definir <nome>` | grava no Gerenciador de Credenciais (valor pela entrada padrão); nomes `erp_senha`, `hub_chave` |
| `trocar-chave [--sem-testar]` | troca a chave de API do Hub **sem reinstalar** (§7.5) |
| `instalar-servico --winsw <exe> [--pasta] [--somente-gerar]` / `desinstalar-servico` | serviço Windows |

### 7.2 Serviço Windows: WinSW

Escolha: **WinSW** (executável único .NET que lê um XML) em vez de `node-windows`. Motivos: o Conector só **gera** o XML e chama `install`/`start` — nenhuma dependência nativa no pacote Node nem recompilação a cada versão do Node; o XML é auditável e editável pelo técnico do cliente (conta de execução, política de reinício, rotação do log do serviço são configuração, não código); `node-windows` embute uma cópia do WinSW e gera arquivos em `daemon/` com menos controle. O XML gerado: início automático (atrasado), reinício após falha (10 s, 30 s, 60 s), parada com 30 s de tolerância, log do serviço com rotação por tamanho (5 × 10 MB), sem segredos. Parada do serviço é segura: a fila é SQLite em WAL com `synchronous = FULL`.

A conta do serviço deve ser a que gravou os segredos no Gerenciador de Credenciais (aba *Fazer logon* do serviço), ou use variáveis de ambiente do sistema.

### 7.3 Logs

JSON por linha em `dados\logs\conector-AAAA-MM-DD.log`; ao passar de `maxMegabytes` vira `.1`, `.2`… (até 5 por dia); apaga o que passa de `retencaoDias` (30). **Sem dado pessoal**: valores de linhas nunca são logados (só contagens, entidades, códigos de erro, nomes de campo); chaves sensíveis (`senha`, `token`, `cpf`, `cnpj`, `documento`, `email`, `telefone`, `nome`, `razao_social`, `endereco`, `latitude`, `longitude`…) viram `***` **qualquer que seja o tipo do valor** (texto ou número: CPF e coordenadas guardados como número no ERP também são mascarados; só booleano passa); em qualquer texto, CPF/CNPJ, e-mail, telefone, `Bearer …`, `Password=…` e URL com credencial são mascarados. A tabela de erros por linha do `status` guarda `external_id` e o nome do campo, nunca o valor.

### 7.4 Versão, pacote assinado e atualização

**Política de versão (v1.1).** O Conector informa a própria versão (semver, `src/versao.ts`) em **todo** lote (`versao_conector`), no sinal de vida e no cabeçalho `X-Macuxi-Conector-Versao`. O Hub responde ao sinal (a cada 1 min) com a política do tenant (`RespostaSinal.politica_versao`, contrato em `contracts/conector.ts`): `versao_minima`, `versao_recomendada`, `mensagem` e, opcionalmente, o `pacote` (versão, URL, SHA-256, assinatura). O Conector guarda a última política na fila local e a reavalia sozinho (assim `status` funciona sem rede e instalar uma versão nova libera o envio na hora):

| Situação | Quando | O que acontece |
|---|---|---|
| em dia | versão ≥ recomendada | nada |
| **desatualizado** | mínima ≤ versão < recomendada | segue funcionando; `conector status` mostra `[DESATUALIZADO]`; log `versao_desatualizada` (de hora em hora) |
| **versão abaixo da mínima** | versão < mínima | **para de enviar ao Hub**: lotes, retornos de pedido, busca de pedidos pendentes e reconciliação (a leitura do ERP também espera). Nada se perde: os lotes já montados continuam na fila local. O **sinal de vida segue** (com `parado_por_versao: true`) para o Hub ver o Conector parado e poder liberar. `conector status` mostra `[VERSÃO ABAIXO DA MÍNIMA]` com o motivo e sai com código 3; o log registra `versao_abaixo_da_minima` (nível erro). Libera sozinho quando o Hub baixa a mínima ou quando o Conector é atualizado |
| sem política | Hub ainda não respondeu / Hub antigo | nenhuma restrição |
| **Hub respondeu 426** (v1.2) | o Hub recusou dados desta versão (`versao_conector_nao_suportada`) antes de o sinal trazer a política | **pausa**, nunca bloqueio: o lote (ou retorno, busca de pedidos, cursor, reconciliação) espera na fila com backoff, nenhuma entidade é bloqueada e nada é descartado; se o 426 trouxer `detalhes.versao_minima`, ela vira a política local e o Conector passa a "abaixo da mínima" (acima). Log `hub_recusou_versao` |

A comparação é semver 2.0 em função pura com teste (`1.10.0 > 1.9.0`; `1.2.0-rc.1 < 1.2.0`). Política ilegível ou inconsistente (mínima > recomendada) nunca para o Conector por engano: a ilegível é ignorada; na inconsistente a mínima manda.

**Atualização automática fica para a v2** (não implementada). Na v1 a atualização é manual, com pacote assinado:

*Publicar (quem faz o release no Macuxi):*
1. `pnpm --filter @macuxi/conector build` gera `apps/conector/dist/conector.mjs` com `target: node24` (a versão vem de `src/versao.ts`; mantenha igual a `package.json`).
2. Monte `conector-<versão>.zip` com o **`node.exe` do Node 24 LTS portátil** (win-x64, 24.7+, baixado de nodejs.org com o SHA-256 conferido contra o `SHASUMS256.txt` assinado), `conector.mjs`, `WinSW-x64.exe` (SHA-256 conferido), `exemplos/` e o resumo das mudanças. **A montagem é automática:** `pnpm --filter @macuxi/conector build && node apps/conector/scripts/pacote.mjs [--saida <dir>] [--cache <dir>]` baixa o Node (versão fixa 24.21.0) e o WinSW (2.12.0) com **SHA-256 fixos no próprio script** (falha fechada se diferir), monta o `.zip` reprodutível (com `LEIA-ME.txt`), grava o `.sha256` e, havendo chave (`MACUXI_ASSINATURA_CHAVE_PEM` em secret do CI, ou `--chave`; nunca impressa), o `.sig` RSA 3072 + SHA-256. A publicação no bucket é o workflow manual `.github/workflows/conector-publicar.yml` (`workflow_dispatch`, chave no secret), que chama `pnpm --filter api publicar-pacote conector <zip> --versao X`. Os passos 3 a 5 abaixo descrevem a mesma assinatura feita à mão.
3. Hash: `sha256sum conector-1.1.0.zip > conector-1.1.0.zip.sha256`.
4. Assinatura **RSA 3072 + SHA-256** (PKCS#1 v1.5) com a chave de assinatura do Macuxi (guardada offline, fora do repositório): `openssl dgst -sha256 -sign assinatura.key -out conector-1.1.0.zip.sig conector-1.1.0.zip`. Certificado público (só a chave pública, `.cer`): `openssl req -new -x509 -key assinatura.key -sha256 -days 1825 -subj "/O=Macuxi/CN=Macuxi Conector - assinatura de pacotes" -outform DER -out macuxi-conector-assinatura.cer`.
5. Publique `.zip`, `.sha256`, `.sig` e o `.cer`, e cadastre no BKO a versão, o SHA-256 e a assinatura (base64) do pacote para a política (`pacote` na resposta do sinal). A **impressão digital (SHA-256) do certificado** é entregue ao cliente por canal separado (contrato/e-mail do responsável): `openssl x509 -inform DER -in macuxi-conector-assinatura.cer -noout -fingerprint -sha256`.

*Verificar (técnico do cliente, antes de instalar; PowerShell nativo, sem instalar nada):*
```powershell
$pacote = 'conector-1.1.0.zip'
# 1) hash SHA-256: o valor do .sha256 (e o mostrado no BKO) precisa ser igual
$esperado = ((Get-Content "$pacote.sha256") -split '\s+')[0].ToLower()
$real     = (Get-FileHash $pacote -Algorithm SHA256).Hash.ToLower()
if ($real -ne $esperado) { throw 'SHA-256 DIFERENTE: não instale este pacote.' }
# 2) assinatura: confira antes a impressão digital do .cer com a que o Macuxi entregou
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 'macuxi-conector-assinatura.cer'
(Get-FileHash 'macuxi-conector-assinatura.cer' -Algorithm SHA256).Hash   # = impressão digital entregue em separado
$rsa  = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert)
$ok   = $rsa.VerifyData([IO.File]::ReadAllBytes($pacote), [IO.File]::ReadAllBytes("$pacote.sig"),
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
if (-not $ok) { throw 'ASSINATURA INVÁLIDA: não instale este pacote.' }
'Pacote íntegro e assinado pelo Macuxi.'
```
(Em Linux/macOS: `sha256sum -c conector-1.1.0.zip.sha256` e `openssl dgst -sha256 -verify <(openssl x509 -inform DER -in macuxi-conector-assinatura.cer -pubkey -noout) -signature conector-1.1.0.zip.sig conector-1.1.0.zip`. O par `sign`/`verify` do OpenSSL foi exercitado na T-0023; o script PowerShell **não foi executado em Windows nesta tarefa** — validar no primeiro release.)

*Atualizar:* pare o serviço (`Stop-Service "Macuxi Conector"`), copie o novo `conector.mjs` **e o `node.exe` do pacote** por cima (guarde os anteriores como `.anterior`), rode `.\node.exe conector.mjs validar-config` e `.\node.exe conector.mjs versao`, inicie o serviço e confira `conector status` (`em dia`) e o BKO. Em caso de problema, volte o arquivo anterior. A fila e o cursor ficam em `dados\` e sobrevivem à troca.

### 7.5 Rotação da chave de API (`trocar-chave`)

1. No BKO (Integração > Conectores) gere a chave nova do Conector; o Hub mantém a antiga válida por **24 h** (`anterior_valida_ate`; parâmetro do tenant, de 0 a 7 dias — decisão P-5), para a troca ser sem interrupção.
2. No servidor do Conector, **na conta do serviço**: `echo CHAVE_NOVA| node conector.mjs trocar-chave --config conector.json`.
   - A chave vem **só pela entrada padrão** (nunca como argumento, que apareceria na lista de processos).
   - O comando confere o formato (16 a 512 caracteres ASCII, sem espaço), **testa a chave no Hub** com o `hub.conectorId` e só então grava no Gerenciador de Credenciais. Se o Hub recusar, **nada é gravado** e a chave atual continua valendo. Se o Hub responder 426 (versão abaixo da mínima), a chave **foi aceita** (o 426 vem depois da autenticação): ela é gravada e o comando avisa para atualizar o Conector. `--sem-testar` grava sem consultar o Hub (use só se o Hub estiver fora do ar de propósito).
   - O serviço relê o segredo a cada 60 s: passa a usar a chave nova em até 1 minuto, **sem reiniciar nem reinstalar**.
3. Confirme no BKO que o sinal de vida continua chegando e **revogue a chave antiga**.
- Fora do Windows (ou `segredos.provedor: "env"`) não há onde gravar: o comando valida a chave, mostra o nome da variável (`MACUXI_CONECTOR_HUB_CHAVE`), não grava e sai com código **4**; defina a variável de ambiente do sistema e reinicie o serviço. Se a variável de ambiente já existir ela tem **prioridade** sobre o Gerenciador de Credenciais: o comando avisa que ela continua com a chave antiga.
- A chave nunca aparece em saída, argumento de processo nem log (máscara + teste).

## 8. Segurança e privacidade

- Só conexões de saída; HTTPS obrigatório (TLS verificado; sem opção de ignorar certificado do Hub).
- Credencial própria do Conector: **uma chave de API por Conector** (identificador + chave, `Authorization: Bearer`), escopo do tenant e **só `/integracao/v1`**, **rotacionável sem reiniciar** (`trocar-chave`; relida a cada 60 s; a anterior convive 24 h); em 401/403 (e em 426, versão) o Conector pausa com espera longa, não descarta nada e registra `hub_credencial_recusada` (ou `hub_recusou_versao`).
- Pacote do Conector com SHA-256 e assinatura verificáveis antes de instalar (§7.4); versão abaixo da mínima do Hub para o envio.
- Usuário do banco somente leitura nas views; escrita só na entrada de pedidos.
- Segredos fora do arquivo e fora do log. O arquivo de configuração pode ser versionado/auditado.
- A fila local guarda os lotes **só até o Hub concluí-los**; o conteúdo é apagado ao concluir (ficam só contagens e a chave). Proteja `dados\` com permissão NTFS restrita à conta do serviço e aos administradores.
- Uma instância por pasta de dados (trava `conector.lock` com PID): dois Conectores gravando a mesma fila corromperiam o cursor.
- `external_id` = chave interna do ERP, nunca CPF/CNPJ (aparece em logs de erro do Hub).

## 9. O que o Hub precisa expor para o Conector

Todas as rotas sob `https://<hub>/integracao/v1`, com `Authorization: Bearer <chave de API do Conector>` **e** `X-Macuxi-Conector-Id: <hub.conectorId>`. A chave é **uma por Conector**, rotacionável, de escopo **só `integracao.v1`** (não abre nenhuma outra rota da API), do tenant do Conector e sujeita à licença do módulo; o Hub confere que o identificador é o da chave (401/403 se não for, se a chave for inválida, expirada ou revogada; contrato `ChaveConectorCriada` em `contracts/conector.ts`). Cabeçalhos informativos em toda chamada: `User-Agent: macuxi-conector/<versão>` e `X-Macuxi-Conector-Versao: <semver>` (`CABECALHO_CONECTOR_ID`/`CABECALHO_CONECTOR_VERSAO` em `contracts/conector.ts`). Para o BKO/Hub, além das rotas abaixo: **cadastro de Conector com geração de chave** (mostrada uma vez; só o hash fica guardado), **rotação** (a chave antiga segue válida por uma janela curta, `anterior_valida_ate`) e **revogação**; política de versão por tenant (§7.4).

| Rota | O que o Conector envia / espera |
|---|---|
| `POST /lotes` | corpo `LoteEnvelope` (com os campos opcionais `conector_id`, `versao_conector`, `linhas_invalidas[]` — até 500, `{external_id? (≤ 200), codigo, campo?, mensagem}` sem valor de dado — e `linhas_invalidas_omitidas`; o Hub as grava como erros de linha com `origem: "conector"` e conta em `com_erro`, o lote termina `concluido_com_erros`; **`registros` pode vir vazio quando há linhas inválidas** — exceção da RN-INT-01, P-1, v1.2); cabeçalho **`Idempotency-Key`** (SHA-256 hex, 64): mesma chave → o Hub devolve o **mesmo** `LoteAceito` (mesmo `lote_id`, sem reprocessar). `202` aceito; `400/413/422` com `RecusaEnvelope` (`{erros:[{codigo,campo,mensagem}]}`) = recusa **definitiva** (não é reenviada; bloqueia a entidade); `408/425/429/5xx` = transitório (retry; `Retry-After` respeitado). Aceitar corpo de pelo menos 8 MiB (o Conector envia até 4 MiB) |
| `GET /lotes/{id}?limite_erros=5500` | `LoteResultado` (`status` `recebido`/`processando` → final; `erros[]` por linha com `indice`, `external_id`, `codigo`, `campo`, `mensagem`, `reprocessavel` e, novo e opcional, `origem` = `hub` \| `conector`; para `conector`, `indice` é a posição em `linhas_invalidas`; `invalidas_omitidas` opcional). Só o estado final avança o cursor. `404` = Hub não conhece o lote → o Conector reenvia (mesma chave). **Premissa nova (campo opcional, compatível com `v1`)**: `inativacao: { situacao: "aplicada" \| "aguardando_confirmacao" \| "nao_aplicavel", motivo?, candidatos? }` no resultado do último lote da sessão completa, para a trava de RN-INT-06 |
| `GET /cursores/{entidade}` | `CursorEntidade` (cursor `null` = nunca recebeu: carga completa). Observação: `external_id` do cursor tem `min(1)` no contrato |
| `GET /pedidos/pendentes` | `PedidosPendentes`; ao entregar, o Hub marca `enviado` e reentrega (`tentativa + 1`) após o timeout de 10 min sem retorno (RN-INT-08) |
| `POST /pedidos/{pedido_uuid}/retorno` | `RetornoErp` com `itens_faturados?: [{sequencia, produto_external_id, quantidade, valor_cents}]` (produto e valor obrigatórios no item) (agora em `contracts/pedido.ts`, só em `faturado_parcial`/`faturado_total`). `200` com `RetornoAceito` (`repetido: true` se já aplicado — **a repetição de `faturado_parcial` é por (status, nota número+série)**: outra nota é fato novo); `422` com `{erros:[{codigo,mensagem}]}` para transição inválida/pedido desconhecido (definitivo) |
| `POST /sinal` | batimento a cada 60 s: corpo `SinalConector` (`conector_id`, `versao_conector`, `versao_contrato`, `em`, `fila[]`, `entidades[]`, `parado_por_versao?`; sem dado pessoal). **Resposta `200` com `RespostaSinal`**: `{ politica_versao?: { versao_minima, versao_recomendada, mensagem?, pacote? } }` — escolha de desenho: a política viaja na resposta do sinal (já existe, é por Conector e chega a cada minuto), sem rota nova; resposta fora do formato é ignorada |
| `POST /reconciliacoes` | `ReconciliacaoEnvio`; qualquer `2xx` |

> **T-0025 (2026-11-01)**: o desenho completo do Hub para estas rotas (erros, limites, idempotência, 426, trava de inativação, retorno de pedidos, entregas por agente) está em [`hub-api.md`](hub-api.md); a verificação campo a campo contra `apps/conector/src/hub` e as divergências ficam na seção 16 dele.

Pendências do Hub (para o engenheiro-software, fora do escopo deste pacote): rotas `/integracao/v1` ainda não existem; gravar `linhas_invalidas` como erro de linha; aceitar `itens_faturados` no retorno e validar a `sequencia`/soma por item (T-0011); aplicar `transicionarRetornoPedidoErp` (2ª nota parcial); responder o sinal com `politica_versao`; cadastro/rotação/revogação de chave por Conector com escopo `integracao.v1`; recusar com **426** (ou 400 `versao_conector_nao_suportada`) quem insistir em enviar abaixo da mínima.

Premissas de comportamento do Hub: partes da sessão podem ser processadas em qualquer ordem, mas a sessão só fecha com todas as partes `1..ultimo` concluídas; reenvio com a mesma chave é inofensivo; `falhou` com erros por linha não reprocessáveis = o Conector considera o lote tratado (as linhas corrigidas voltam pelo delta); só `falha_processamento` é reenviada pelo Conector (em lote delta só com essas linhas, até 3 vezes; o lote de reenvio leva só `registros` — as `linhas_invalidas` do lote original já foram informadas e não se repetem, T-0048).

## 10. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `testar-conexao`: *Segredo … não encontrado* | variável ou credencial inexistente, ou serviço rodando com outra conta | `conector segredo definir …` com a conta do serviço, ou variável de ambiente do sistema |
| *Configuração inválida* / *Segredo no arquivo* | JSON/YAML com campo inexistente, consulta sem `:cursor_*`/`:limite`, `senha`/`token` no arquivo | seguir a mensagem (ela diz o caminho do campo) |
| *Hub recusou a credencial* (401/403) | chave rotacionada/revogada, `hub.conectorId` diferente do cadastrado ou IP não permitido | pedir a chave nova no BKO e gravar com `conector trocar-chave` (vale em ≤ 60 s, sem reiniciar). A fila espera, nada se perde |
| `status`: **VERSÃO ABAIXO DA MÍNIMA** | o Hub subiu a versão mínima exigida | instalar o pacote recomendado (§7.4); o envio volta sozinho. Enquanto isso a fila local guarda tudo |
| `status`: **DESATUALIZADO** | há versão recomendada mais nova | planejar a atualização (§7.4); não para nada |
| `trocar-chave` sai com 4 | provedor `env` ou fora do Windows | definir a variável `MACUXI_CONECTOR_HUB_CHAVE` do sistema e reiniciar o serviço |
| Oracle: `ORA-00933` na leitura | Oracle anterior à 12c com `paginacao: offset` | `"erp.paginacao": "rownum"` (§4.3) |
| Oracle: datas deslocadas em horas | a view devolve hora local em `DATE`/`TIMESTAMP` | converter para UTC na view (`SYS_EXTRACT_UTC`, `AT TIME ZONE 'UTC'`) |
| Oracle: campo numérico "tipo inválido" | `NUMBER` decimal chega como texto exato | `transformar: "numero"` (ou `centavos_de_decimal` para dinheiro) |
| Linhas inválidas sumiram do lote | passam a ir em `linhas_invalidas` (não em `registros`) | ver o monitor do BKO ou `conector status`; corrigir no ERP |
| Lote com `registros: []` no monitor | página só com linhas inválidas (v1.2) | corrigir as linhas no ERP; o `alterado_em` novo as traz de volta |
| Log `hub_recusou_versao` (HTTP 426) | o Hub exige versão mais nova | instalar o pacote recomendado; nada se perdeu e nenhuma entidade foi bloqueada |
| BLOQUEADA: *entidade_de_outro_conector* | a entidade é de outro Conector da empresa (P-6) | ajustar no BKO (Integração ERP > Conectores) ou desativar a entidade no arquivo; `conector retomar <entidade>` |
| *Sem conexão com o Hub* | firewall/proxy bloqueando HTTPS de saída | liberar o endereço do Hub na 443; o Conector continua tentando com espera exponencial (até 15 min) |
| Entidade **BLOQUEADA** em `status`: *Hub recusou o lote (…)* | recusa definitiva do envelope (versão, limite, sessão) | corrigir a causa (ex.: atualizar o Conector) e rodar `conector retomar <entidade>` |
| BLOQUEADA: *nenhuma linha lida tem external_id e alterado_em legíveis* | mapeamento/consulta errados | conferir `campos.external_id`/`campos.alterado_em` e a view; `testar-conexao`; `retomar` |
| BLOQUEADA: *a leitura não avança* | muitas linhas com o mesmo `alterado_em` e `external_id` repetido, ou `alterado_em` de precisão menor que o do filtro (inclusive quando uma página inteira, com mais páginas depois dela, só repete o cursor já lido: a entidade bloqueia com `log.erro entidade_bloqueada` em vez de reler a mesma página para sempre) | `external_id` único; `alterado_em` em ms; depois `conector retomar <entidade>` |
| `testar-conexao`: `[aviso] … a ordem do external_id no banco do ERP diverge …` | colação não binária no filtro/ORDER BY, ou `external_id` numérico (T-0099) | `COLLATE Latin1_General_BIN2` (SQL Server), `NLSSORT(…, 'NLS_SORT=BINARY')` (Oracle), `COLLATE "C"` (PostgreSQL) nos dois pontos; chave numérica como texto (§5, §5.1) |
| Campo apagado no ERP continua preenchido no Macuxi | NULL da view é **omitido** por padrão (campo ausente não altera) | `"nulo": "limpa"` no campo (§4.1), se o contrato aceita nulo |
| *Configuração inválida*: `…campos.<campo>.nulo` | `"nulo": "limpa"` em campo obrigatório do contrato | tirar o `nulo` (ou `"omite"`); a view deve devolver valor |
| Nada novo chega ao Hub | `alterado_em` não muda quando o registro muda; nulo; fuso errado | a view deve atualizar `alterado_em` em toda alteração, em UTC |
| Datas/horários deslocados em horas | view devolve hora local | converter para UTC na view (`AT TIME ZONE 'UTC'`) |
| Erros por linha no BKO | dado fora do contrato | corrigir no ERP; o `alterado_em` novo faz a linha voltar no delta seguinte. `conector status` lista os recentes (campo + mensagem, sem valores) |
| *Trava de inativação em massa* em `status` | a carga completa inativaria > 30% dos ativos | conferir se a view não perdeu linhas; confirmar (ou não) no BKO |
| Pedido fica `recebido` e não grava | ERP fora do ar ou SQL falhando | `status` mostra o estado; a conexão volta sozinha; erro de SQL repete 3 vezes e rejeita com o motivo |
| *Já existe um Conector rodando* | outra instância ou sobra de queda | pare o serviço; se nada rodar, apague `dados\conector.lock` |
| Quer refazer tudo de uma entidade | — | `conector carga-completa <entidade>` |

## 11. Limites desta versão e pendências

- **Drivers**: SQL Server, PostgreSQL e Oracle (T-0023). MySQL e Firebird do doc 06 ficam para depois (interface `ConexaoErp` em `src/erp/driver.ts`).
- **Atualização automática**: fica para a **v2** (decisão do Alexandre); a v1.1 só informa a versão, segue a política mínima/recomendada do Hub e tem o processo de pacote assinado (§7.4).
- **Oracle real**: o adaptador é testado com dublê do driver; o teste contra um Oracle real roda quando `MACUXI_ORACLE_URL` existe (não houve instância na T-0023). A leitura de `DATE` por texto e o bind `TIMESTAMP WITH TIME ZONE` foram escolhidos a partir do código-fonte do `oracledb` 26 (o modo thin lê `DATE`/`TIMESTAMP` no fuso local do processo), mas só se confirmam no primeiro Oracle de homologação.
- ~~Linhas inválidas de uma página sem nenhuma linha válida não têm lote~~ — resolvido na v1.2 (lote só de inválidas, exceção da RN-INT-01 aprovada). **Compatibilidade**: um Hub sem a exceção recusaria esse lote com `lote_vazio` e bloquearia a entidade; o Hub `/integracao/v1` nasce com ela (`validarEnvelope`).
- **Tela local simples** do doc 06: não incluída (CLI + BKO cobrem a operação).
- **Empacotamento**: um `conector.mjs` empacotado com esbuild (`target: node24`) que roda no **Node 24 LTS portátil levado no próprio pacote** — o cliente não instala Node. A montagem do `.zip` (com `node.exe` e WinSW, SHA-256 fixos, `.sha256` e `.sig`) é o `apps/conector/scripts/pacote.mjs` (§7.4); a publicação é por workflow manual. Um executável único (SEA) segue fora do escopo.
- **Teste com SQL Server real**: o driver tem testes de unidade com dublê do `mssql`; a validação contra uma instância real fica para o ambiente de homologação.
- `inativacao` (resultado do último lote da sessão) está no contrato (`LoteResultado.inativacao`, T-0025); o Conector usa o schema do contrato direto desde a v1.2. `itens_faturados` está em `contracts/pedido.ts`.
- Views-modelo (`db/conector/views-modelo.sql`) são do `banco-dados`.
- **Pendências da revisão final da T-0023 (T-0048)**: `@types/node` 24 no `package.json` (casando com `engines.node >=24.7`) muda o `pnpm-lock.yaml` do workspace inteiro — fica para o `engenheiro-software` (dono do lock). `fila[].maisAntigo` → `mais_antigo` no `SinalConector` é do contrato do Hub: quando o contrato mudar, o `executor.ts` acompanha (o tipo do contrato quebra o typecheck do Conector até lá). A pausa do `Retry-After` longo fica na memória do processo (reiniciar o serviço a esquece; os lotes e retornos guardam a própria espera).

## Aplicação do item no pedido (T-0084, RN-VEN-19)
`itens[].aplicacao` (texto até 1.000, nulo ou ausente quando não há) vem em `GET /integracao/v1/pedidos/pendentes`, aditivo na v1. O Conector 1.2.x não o lê e ignora o campo; o mapeamento para a coluna do ERP é do SQL do cliente (a view-modelo de pedidos, do `banco-dados`, pode expô-lo como "descrição 2" do item). Nenhuma mudança no Conector é necessária.

## Formas de pagamento, prazos e tabela escalonada (T-0089)
O Hub ganhou, aditivas na v1, as entidades `forma_pagamento`, `prazo_pagamento` e `tabela_escalonada`, e o cliente ganhou `prazo_medio_max_dias` e `formas_pagamento` (códigos). **O Conector 1.2.x não precisa de mudança de código**: ele só ativa as entidades que o tenant liga em `entidades` e lê o que a view devolve.
- **Como ligar:** acrescente as entidades à lista do Conector no BKO e crie as views-modelo (`db/conector/views-modelo.sql`, do `banco-dados`; `vw_macuxi_<entidade>`, colunas com o nome dos campos do contrato). Os exemplos `apps/conector/exemplos/conector*.exemplo.json` já leem essas views, com os campos 1 para 1 e as transformações (`booleano`, `inteiro`, `json`, `data_civil`). A ordem de carga é a do Hub: forma antes de prazo, produto antes da faixa escalonada, formas antes do cliente (a ordem da lista `ORDEM_CARGA` do Conector já a segue).
- **Prazo:** `parcelas_dias` é a lista de dias de cada parcela, sem decrescer (`[28, 56]`, `[0]` = à vista). `prazo_medio_dias` é informativo: o Macuxi calcula (média das parcelas, arredondada para cima) e, se o ERP mandar valor diferente, o lote é aplicado com o aviso `prazo_medio_divergente` no monitor.
- **Faixa escalonada:** `preco_unidade_cents` é sempre o preço da unidade base; `medida` ausente = unidade base; `tabela_external_id` ausente = vale para todas as tabelas.
- **Cliente (premissa da v1):** o Conector omite coluna nula (o campo some do registro), e campo ausente não altera o que o Macuxi já tem. Portanto, no Conector, `NULL` **não limpa** — a menos do opt-in **`"nulo": "limpa"`** no campo (T-0099, §4.1), que envia `null` e limpa. Os exemplos já o trazem em `prazo_medio_max_dias` e `formas_pagamento`: com ele, a view pode devolver `NULL` para "sem teto"/"todas as formas". A view-modelo que devolve `'[]'` (todas as formas ativas) e **365** ("sem teto") continua funcionando igual, com ou sem o opt-in. Pelo arquivo do portal e pela API direta, `null` limpa (contrato).
- **Pedido ao ERP:** `GET /pedidos/pendentes` traz, no pedido novo, o bloco `pagamento` (`forma_codigo`, `forma_external_id`, `prazo_codigo`, `prazo_external_id`, `parcelas_dias`, `prazo_medio_dias`); nulo ou ausente nos pedidos antigos. O `condicao_pagamento_erp` sai nesta ordem: 1) `pagamento.prazo_external_id` (a chave do prazo no ERP); 2) o de-para `condicao_pagamento` pelo código do prazo; 3) sem nenhum dos dois, o pedido fica retido em Mapeamento, como hoje. O Conector 1.2.x continua gravando só a condição; o SQL do cliente pode ler o bloco `pagamento` para a forma, as parcelas e o prazo médio.

## Ordem divergente em operação e atualização automática ligada ao executor (T-0099, T-0116)

- **Aviso `ordem_divergente` no log e no `status`.** Além da conferência do `testar-conexao` (§5.1), o sincronizador avisa em operação: se a consulta devolve, no mesmo `alterado_em` do cursor, um `external_id` **menor** que o do cursor na ordem binária, o banco ordena/filtra com outra colação. O Conector grava `ordem_divergente` no log (`dica` com o exemplo) e o texto no `AVISO:` da entidade no `conector status`. Linhas podem estar sendo perdidas até a consulta usar a colação binária (§5). O aviso fica até a próxima carga completa da entidade.
- **Atualização automática (T-0116), DESLIGADA por padrão.** No `conector.json`: `"atualizacao": { "ativa": true, "pasta": "C:\Macuxi\Conector", "verificarMinutos": 60, "limiteSaudeSegundos": 60 }`. Com `ativa: true`, o executor agenda a tarefa `atualizacao` (1ª passada 1 min depois da partida, para já ter a política do Hub): se a política oferece `pacote` mais novo, chama `atualizarConector` (SHA-256 + assinatura, troca com backup, volta à anterior se a nova não responde à saúde). O **download do bucket privado (T-0098), o extrator, o controle do serviço e a saúde são injetados** (`Contexto.atualizacao`); sem eles, ligada ou não, nada é baixado e o log traz `atualizacao_sem_dependencias`. O último resultado relevante (`atualizado`, `mantido` por falha, `revertido`) aparece em "ATUALIZAÇÃO AUTOMÁTICA" no `conector status`; "sem pacote" e "já atualizado" são rotina e não gravam nada. Pendência: levar o resultado ao monitor do BKO pelo sinal de vida exige campo novo no `SinalConector` (contrato aditivo, a combinar com o engenheiro-software).

## Filial (T-0149, RN-CORE-39) e Conector 1.4.0
- **O 1.3.x não quebra com a entidade nova.** A lista de entidades vem só do `conector.json` local (o Hub nunca a empurra ao Conector) e o Hub aceita `filial` de qualquer Conector; o 1.3.x apenas não a envia. Quem não usa filial não muda nada.
- **Carga (entrada):** nova entidade `filial` (view `vw_macuxi_filial`: `external_id`, `codigo`, `nome`, `cidade`, `uf`, `ativo`, `alterado_em`) e a coluna `filial_external_id` em `vw_macuxi_cliente` (NULL = não altera), `vw_macuxi_preco` (NULL = padrão), `vw_macuxi_estoque` (filial do depósito) e `vw_macuxi_tabela_escalonada` (NULL = todas). Os exemplos `apps/conector/exemplos/conector*.exemplo.json` já leem essas colunas; as views-modelo são do `banco-dados`. A ordem de carga é a `ORDEM_CARGA_ENTIDADES` do contrato.
- **Pedido (devolução):** o `cabecalho` da gravação recebe dois parâmetros novos, `:filial_codigo` e `:filial_external_id` (nulos = filial padrão do ERP: pedido da filial padrão sem chave ou pedido antigo). A tabela/procedure de entrada do ERP ganha as colunas `filial_codigo` e `filial_external_id` (modelo do `banco-dados`). SQL de cliente que não usa os parâmetros continua funcionando.
- **Pedido (frete, entrega e pagamento; 1.4.0):** o `cabecalho` recebe também, sempre presentes e `null` quando o pedido não os traz (pedido antigo): `frete_modalidade` (`CIF`|`FOB`), `frete_transportadora_tipo` (`cadastrada`|`digitada`), `frete_transportadora_id`, `_external_id` (só da cadastrada), `_nome`, `_cnpj`, `_telefone` (RN-VEN-16); `entrega_origem` (`erp`|`editado`), `entrega_external_id`, `entrega_logradouro`, `_numero`, `_complemento`, `_bairro`, `_cidade`, `_uf`, `_cep`, `entrega_principal` (RN-VEN-17: **`entrega_external_id` nulo = o SQL usa os campos de texto**, pela mesma razão do 1.3.x); `pagamento_forma_codigo`, `_forma_external_id`, `_prazo_codigo`, `_prazo_external_id`, `pagamento_parcelas_dias` (texto `30,60,90`) e `pagamento_prazo_medio_dias` (RN-VEN-24). A lista fica em `parametrosCabecalho` (`src/pedidos.ts`). Os exemplos SQL Server (`EXEC ... @nome = :nome`) e Oracle (colunas de `macuxi.ped_entrada`) já os usam; o modelo `db/conector/entrada-pedido-modelo.sql` (banco-dados) ganha as colunas/parâmetros com os mesmos nomes. SQL de cliente que não cita os parâmetros continua igual.
- **Versão:** pedido de filial **não padrão** só é entregue ao Conector **1.4.0** ou mais novo (o 1.3.x gravaria na filial padrão do ERP sem avisar). Espera na fila até o Conector ser atualizado (atualização automática ou manual).
