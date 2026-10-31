# Conector Macuxi (on-premise)

> Tarefa T-0013 · módulo `integracao` · pacote `@macuxi/conector` (`apps/conector`) · 2026-10-31
> Requisitos: RF-INT-02 (Conector), RF-INT-04 (monitor), RF-INT-06 (reconciliação). Regras: RN-INT-01..09 (`docs/produto/03`, seção 9). Fluxo e contrato: `docs/produto/06-integracao-erp.md` e `desenho.md` (mesma pasta).
> Estado: **lado do cliente pronto**; o Hub (`/integracao/v1`) ainda não tem rotas — o Conector foi escrito contra os contratos de `@macuxi/integracao/contracts` e a seção 9 lista o que o Hub precisa expor.

## 1. O que é

Um serviço Windows (Node 22 + TypeScript) instalado **dentro da rede do cliente**. Ele lê o banco do ERP por consultas SQL (views somente leitura), monta lotes no envelope do contrato e **empurra** os dados ao Hub do Macuxi por HTTPS. A nuvem nunca acessa o banco do cliente: o Conector só faz conexões de **saída**.

```
ERP (SQL Server / PostgreSQL) ──SQL──► Conector ──HTTPS 443 (saída)──► Hub /integracao/v1
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
| Erros por linha | lê o resultado do lote; recusa por regra **não** é reenviada; só falha transitória é |
| Pedidos | busca no Hub, grava no ERP por SQL/procedure configurável, confirma o número e acompanha faturamento/cancelamento |
| Reconciliação | contagem e soma de controle diárias por entidade (RN-INT-07) |
| Operação | CLI (`testar-conexao`, `status`, `rodar`…), sinal de vida a cada 1 min, logs com rotação e sem dado pessoal |

## 2. Requisitos

| Item | Requisito |
|---|---|
| Sistema | Windows Server 2016+ ou Windows 10/11 (64 bits). O código roda também em Linux/macOS (desenvolvimento e testes). |
| Node.js | **22.13 ou superior** (LTS). O armazenamento local usa `node:sqlite`, embutido no Node — sem módulo nativo para compilar. |
| Rede | **Somente saída**: HTTPS (TCP 443) para o endereço do Hub informado pelo Macuxi. Nada de porta de entrada, VPN ou NAT. Se houver proxy/firewall, liberar esse destino. |
| Banco do ERP | SQL Server (2012+) ou PostgreSQL (12+), acessível a partir do servidor do Conector (porta 1433 / 5432 **dentro** da rede do cliente). |
| Usuário do banco | **Somente leitura** nas views do Macuxi; escrita apenas na tabela/procedure de entrada de pedidos. Nunca `sa`/`postgres`. |
| Disco | ~200 MB livres (fila + 30 dias de log). A fila só guarda lotes que ainda não foram confirmados. |
| Hora | relógio do servidor sincronizado (NTP). |

## 3. Instalação passo a passo

Pasta sugerida: `C:\ProgramData\Macuxi\Conector\`.

1. **Instalar o Node.js 22 LTS** (instalador oficial, para todos os usuários). Conferir: `node -v` → `v22.x`.
2. **Obter o Conector**: o arquivo único `conector.mjs` da versão entregue pelo Macuxi (gerado por `pnpm --filter @macuxi/conector build`, em `apps/conector/dist/`). Copiar para `C:\ProgramData\Macuxi\Conector\conector.mjs`.
3. **Criar o usuário de leitura no ERP** e as views do Macuxi (modelo em `db/conector/views-modelo.sql`, entregue pelo `banco-dados`; o técnico do cliente adapta os `SELECT` ao ERP dele). Regras das views na seção 5.
4. **Criar o arquivo de configuração** `C:\ProgramData\Macuxi\Conector\conector.json` a partir de `apps/conector/exemplos/conector.exemplo.json` (SQL Server, 8 entidades e pedidos). Ajustar `hub.url`, `erp.*`, as consultas e o mapeamento de colunas. **Sem senha nem token no arquivo.** Conferir: `node conector.mjs validar-config --config conector.json`.
5. **Guardar os segredos** (senha do banco do ERP e token do Hub, este último entregue pelo Macuxi):
   - Gerenciador de Credenciais do Windows (recomendado), na conta que vai rodar o serviço:
     ```
     echo SENHA_DO_BANCO| node conector.mjs segredo definir erp_senha --config conector.json
     echo TOKEN_DO_HUB| node conector.mjs segredo definir hub_token --config conector.json
     ```
   - ou variáveis de ambiente do sistema `MACUXI_CONECTOR_ERP_SENHA` e `MACUXI_CONECTOR_HUB_TOKEN` (qualquer administrador local as lê; use só se o Gerenciador de Credenciais não for opção).
6. **Testar**: `node conector.mjs testar-conexao --config conector.json`. Confere segredos, abre o banco do ERP, roda a consulta de cada entidade com 5 linhas de amostra e mostra se o mapeamento bate com o contrato (sem imprimir valores), e testa o Hub com a credencial. Corrija tudo que vier `[ERRO]`.
7. **Primeira passada manual** (opcional): `node conector.mjs rodar --uma-vez --config conector.json` e depois `node conector.mjs status`.
8. **Instalar o serviço** (seção 7): baixar o `WinSW-x64.exe` da página de releases de https://github.com/winsw/winsw, conferir o SHA-256 publicado e rodar, em PowerShell **como administrador**:
   ```
   node conector.mjs instalar-servico --winsw C:\Downloads\WinSW-x64.exe --config conector.json
   ```
   Em seguida, em `services.msc`, abrir o serviço **Macuxi Conector** → aba *Fazer logon* → informar a conta que gravou os segredos (o Gerenciador de Credenciais é por usuário) → *Iniciar*.
9. **Conferir no BKO**: o Conector aparece com "último sinal" menor que 1 min e as entidades vão ganhando lotes no monitor (RF-INT-04). Se ficar mais de 15 min sem sinal o BKO alerta.

Desinstalar: `node conector.mjs desinstalar-servico --config conector.json`. Os dados em `dados\` (fila e logs) ficam; apague a pasta para recomeçar do zero (o Conector pede o cursor ao Hub e faz delta, ou refaz a carga completa se o Hub não tiver cursor).

## 4. Configuração

JSON ou YAML (pela extensão), validado por Zod ao iniciar; chave desconhecida é erro e a mensagem lista o que existe. Exemplo completo: `apps/conector/exemplos/conector.exemplo.json`.

| Chave | Padrão | Para quê |
|---|---|---|
| `dadosDir` | `./dados` | `fila.sqlite`, `logs/`, trava de instância única |
| `hub.url` | — | raiz do Hub; `/integracao/v1` é do contrato. **HTTPS obrigatório** (HTTP só para `localhost`, testes) |
| `hub.timeoutSegundos`, `hub.retry.{tentativas,baseMs,maxMs}` | 30; 4, 500, 30000 | cada chamada ao Hub repete com espera exponencial + jitter em falha de rede, 408/425/429/5xx (respeita `Retry-After`) |
| `erp.tipo` | — | `sqlserver` ou `postgres` |
| `erp.host/porta/banco/usuario` | — | conexão (a senha vem dos segredos) |
| `erp.criptografar`, `erp.confiarCertificado` | `true`, `false` | TLS com o banco (SQL Server `encrypt`; PostgreSQL `ssl`). Servidor sem TLS: `criptografar: false` |
| `segredos.provedor` | `auto` | `env`, `windows` ou `auto` (env primeiro; no Windows, depois o Gerenciador de Credenciais) |
| `lote.maxLinhas`, `lote.maxBytes` | 5000, 4 MiB | limites de cada lote |
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
- **`campos`**: `campo do contrato` → coluna | `{ coluna, transformar }` | `{ valor }`. Caminho com ponto monta objeto (`endereco.cidade`). Transformações: `texto`, `inteiro`, `numero`, `booleano` (S/N, 1/0, true/false), `data_hora_utc`, `data_civil`, `centavos_de_decimal` (reais → centavos), `json` (coluna com JSON: use `FOR JSON PATH` / `json_agg` para `contatos` do cliente e `paradas` da rota). Valores nulos viram campo ausente. Nomes de coluna não diferenciam maiúsculas.
- Os campos aceitos por entidade são os do contrato (`desenho.md` §8); campo inexistente é recusado ao carregar a configuração.
- **`linhasInvalidas`**: `enviar` (padrão) manda ao Hub a linha que não passou no schema local — o Hub é a autoridade e mostra o erro legível no BKO (RN-INT-03); `descartar` deixa só no log local.

### 4.2 Segredos

| Nome | Variável de ambiente | Gerenciador de Credenciais (alvo) |
|---|---|---|
| `erp_senha` | `MACUXI_CONECTOR_ERP_SENHA` | `Macuxi.Conector/erp_senha` |
| `hub_token` | `MACUXI_CONECTOR_HUB_TOKEN` | `Macuxi.Conector/hub_token` |

- Chave `senha`, `password`, `token`, `secret`… no arquivo de configuração é **recusada** com orientação.
- O segredo é relido a cada 60 s: **rotacionar o token do Hub não exige reiniciar o serviço**.
- O Gerenciador de Credenciais é lido/gravado por PowerShell (P/Invoke de `advapi32`: `CredRead`/`CredWrite`), sem módulo nativo do Node. O valor a gravar vai por entrada padrão, nunca em argumento de processo.
- Todo segredo lido é registrado numa lista de máscara: se aparecer em qualquer mensagem de log vira `***`.

## 5. Como o delta funciona e o que as views precisam respeitar

1. **Primeira execução de uma entidade** (sem estado local): o Conector pergunta `GET /cursores/{entidade}`.
   - Hub **sem** cursor → **carga inicial completa**: lê tudo em páginas, enfileira partes `1..n` da mesma sessão (UUID), a última com `ultimo: true`. Só quando o Hub conclui todas as partes ele inativa o que sumiu (RN-INT-06).
   - Hub **com** cursor (Conector reinstalado) → segue por delta a partir dele.
2. **Depois**: só delta (`modo: delta`), na periodicidade da entidade.
3. **Dois cursores por entidade**: *leitura* (até onde já foi lido e enfileirado) e *confirmado* (até onde o Hub **concluiu**). O confirmado só avança em ordem, quando o lote termina `concluido` ou `concluido_com_erros` (RN-INT-05). Reiniciar em qualquer ponto nunca perde nem duplica trabalho: o lote pendente continua na fila e é reenviado com a **mesma chave**, e o Hub devolve o mesmo `lote_id`.
4. **Fim da carga completa**: o delta recomeça `margemDeltaSegundos` antes do início da carga, para pegar o que mudou durante a carga (idempotente pelo hash no Hub).
5. **Carga completa sob demanda**: `conector carga-completa cliente` (ou `todas`) descarta a fila da entidade e abre nova sessão.

Regras das views (o técnico do cliente deve garantir):

- **`alterado_em` em UTC, com precisão de milissegundos** (`datetime2(3)`, `timestamp(3)`, ou `rowversion` convertido). Precisão maior que ms (microssegundos do PostgreSQL) faz o filtro do SQL devolver a mesma linha de novo; o Conector ignora a repetição (par ≤ cursor), mas use `date_trunc('milliseconds', ...)` também no `WHERE`/`ORDER BY` para o filtro ser exato.
- **`alterado_em` nunca nulo** (use `COALESCE`): linha com `alterado_em` nulo não satisfaz o filtro e fica de fora.
- **`external_id` é a chave interna do ERP** (código, id), único por entidade, **nunca CPF/CNPJ** — ele aparece em logs de erro. Para preço e estoque é uma chave composta por item (`TAB01:SKU123`).
- **Ordem por (`alterado_em`, `external_id`)** com colação binária/ordinal ou chave numérica, para a ordem do banco ser a mesma do filtro.
- **Desativar** é `ativo = 0/false` na view (o registro continua aparecendo com `ativo` falso), não apagar a linha: o delta só enxerga o que existe. A carga completa cobre exclusões físicas (inativa os ausentes — com a trava abaixo).
- **Trava de inativação em massa (RN-INT-06)**: se a carga completa fosse inativar mais de 30% dos ativos, o Hub **não inativa** e espera confirmação do operador no BKO. O Conector lê isso no resultado do último lote (`inativacao.situacao = aguardando_confirmacao`), mostra o aviso em `conector status` e no log e **não reenvia nem força nada**. (Premissa: campo `inativacao` no resultado — seção 9.)

## 6. Retorno de pedidos ao ERP (RN-INT-08)

Configuração `pedidos` (ver exemplo): SQL ou procedure por pedido, em transação.

| Parte | O que é | Parâmetros |
|---|---|---|
| `gravacao.cabecalho` | `INSERT`/`EXEC` do cabeçalho | `pedido_uuid`, `cliente_external_id`, `vendedor_external_id`, `condicao_pagamento_erp`, `criado_em`, `aprovado_em` (UTC), `observacao`, `desconto_total_cents`, `total_cents`, `tentativa` |
| `gravacao.itens` | executado uma vez por item (opcional) | `pedido_uuid`, `sequencia`, `produto_external_id`, `quantidade`, `preco_unitario_cents`, `desconto_cents`, `total_cents` |
| `gravacao.numeroErp` | devolve a coluna `numero_erp` do pedido gravado (lida **dentro** da transação) | `pedido_uuid` |
| `status.consulta` | situação do pedido no ERP; uma linha por fato (integração, cada nota, cancelamento) | `pedido_uuid`; colunas `status`, `numero_erp`, `motivo`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents`, `ocorrido_em` |
| `status.consultaItensNota` | itens faturados de uma nota (opcional) | `pedido_uuid`, `nota_numero`, `nota_serie`; colunas `sequencia`, `quantidade` |
| `status.mapaStatus` | código do ERP → `integrado`, `rejeitado_erp`, `faturado_parcial`, `faturado_total`, `cancelado` | — |

Fluxo:

1. `GET /pedidos/pendentes` (a cada `consultaSegundos`, 60 s). O pedido é **gravado no armazenamento local antes** de qualquer outra coisa: se o Hub reentregar (timeout de 10 min sem confirmação), o `pedido_uuid` já conhecido não é gravado de novo no ERP. **Escreva o SQL de gravação também idempotente pelo `pedido_uuid`** (`ON CONFLICT DO NOTHING`, `IF NOT EXISTS`…), para a janela "gravou no ERP e caiu antes de anotar".
2. Grava cabeçalho + itens + lê o número, numa transação (qualquer falha desfaz tudo). Confirma `integrado` com `numero_erp`.
3. **Erro de conexão** com o ERP não conta tentativa (volta depois). **Erro do SQL/regra** conta; ao esgotar `maxTentativasGravacao` (3) o pedido volta ao Hub como `rejeitado_erp` com o motivo (texto do erro do banco, sem dado pessoal, até 300 caracteres).
4. A cada `statusSegundos` (120 s), para cada pedido aberto, roda `status.consulta` e informa: `faturado_parcial` (uma nota por vez, com `itens_faturados` quando `consultaItensNota` existir), `faturado_total` (só a **última** nota; se o ERP marcar o pedido inteiro como faturado em todas as linhas, as notas anteriores seguem como parciais), `cancelado` (com motivo). O Macuxi nunca escreve cancelamento no ERP. Situação do ERP sem equivalente (ex.: "em separação") é ignorada.
5. Cada retorno é validado com o contrato `RetornoErp` (faturado sem nota, rejeitado sem motivo… nem sai), guardado numa fila local e reenviado até o Hub aceitar; recusa por regra do Hub (422, ex.: transição inválida) não é repetida. O Hub é idempotente: repetir o mesmo retorno devolve `repetido: true`.
6. `itens_faturados` é **opcional e ainda não está em `contracts/pedido.ts`** (pedido do engenheiro, T-0011): o Conector já o envia quando a consulta de itens existe e seus valores são inteiros > 0.

## 7. Operação

### 7.1 Comandos

`node conector.mjs <comando> [--config conector.json]` (ou `MACUXI_CONECTOR_CONFIG`):

| Comando | O que faz |
|---|---|
| `validar-config` | confere o arquivo (sem conectar a nada) |
| `testar-conexao` | segredos, banco do ERP (consulta e mapeamento por entidade), Hub (credencial). Código 1 se algo falhar |
| `status [--json]` | fila local por estado, por entidade: fase, último sucesso, cursor confirmado, **bloqueios**, avisos (trava de inativação), último erro, erros locais e do Hub, pedidos e retornos, erros recentes. Código 3 se houver entidade bloqueada |
| `rodar [--uma-vez]` | laço do serviço; `--uma-vez` faz uma passada completa e imprime o status |
| `carga-completa <entidade\|todas>` | nova sessão de carga completa |
| `retomar <entidade>` | libera entidade bloqueada e relê do cursor **confirmado** (delta) ou recomeça a sessão (carga completa) |
| `segredo definir <nome>` | grava no Gerenciador de Credenciais (valor pela entrada padrão) |
| `instalar-servico --winsw <exe> [--pasta] [--somente-gerar]` / `desinstalar-servico` | serviço Windows |

### 7.2 Serviço Windows: WinSW

Escolha: **WinSW** (executável único .NET que lê um XML) em vez de `node-windows`. Motivos: o Conector só **gera** o XML e chama `install`/`start` — nenhuma dependência nativa no pacote Node nem recompilação a cada versão do Node; o XML é auditável e editável pelo técnico do cliente (conta de execução, política de reinício, rotação do log do serviço são configuração, não código); `node-windows` embute uma cópia do WinSW e gera arquivos em `daemon/` com menos controle. O XML gerado: início automático (atrasado), reinício após falha (10 s, 30 s, 60 s), parada com 30 s de tolerância, log do serviço com rotação por tamanho (5 × 10 MB), sem segredos. Parada do serviço é segura: a fila é SQLite em WAL com `synchronous = FULL`.

A conta do serviço deve ser a que gravou os segredos no Gerenciador de Credenciais (aba *Fazer logon* do serviço), ou use variáveis de ambiente do sistema.

### 7.3 Logs

JSON por linha em `dados\logs\conector-AAAA-MM-DD.log`; ao passar de `maxMegabytes` vira `.1`, `.2`… (até 5 por dia); apaga o que passa de `retencaoDias` (30). **Sem dado pessoal**: valores de linhas nunca são logados (só contagens, entidades, códigos de erro, nomes de campo); chaves sensíveis (`senha`, `token`, `cpf`, `cnpj`, `documento`, `email`, `telefone`, `nome`, `razao_social`, `endereco`…) viram `***`; em qualquer texto, CPF/CNPJ, e-mail, telefone, `Bearer …`, `Password=…` e URL com credencial são mascarados. A tabela de erros por linha do `status` guarda `external_id` e o nome do campo, nunca o valor.

## 8. Segurança e privacidade

- Só conexões de saída; HTTPS obrigatório (TLS verificado; sem opção de ignorar certificado do Hub).
- Credencial própria do Conector (token Bearer), escopo do tenant, **rotacionável sem reiniciar** (relida a cada 60 s); em 401/403 o Conector pausa com espera longa, não descarta nada e registra `hub_credencial_recusada`.
- Usuário do banco somente leitura nas views; escrita só na entrada de pedidos.
- Segredos fora do arquivo e fora do log. O arquivo de configuração pode ser versionado/auditado.
- A fila local guarda os lotes **só até o Hub concluí-los**; o conteúdo é apagado ao concluir (ficam só contagens e a chave). Proteja `dados\` com permissão NTFS restrita à conta do serviço e aos administradores.
- Uma instância por pasta de dados (trava `conector.lock` com PID): dois Conectores gravando a mesma fila corromperiam o cursor.
- `external_id` = chave interna do ERP, nunca CPF/CNPJ (aparece em logs de erro do Hub).

## 9. O que o Hub precisa expor para o Conector

Todas as rotas sob `https://<hub>/integracao/v1`, com `Authorization: Bearer <token do Conector>` (chave de API rotacionável por Conector, escopo do tenant, licença do módulo; 401/403 em credencial inválida/revogada). Cabeçalhos informativos: `User-Agent: macuxi-conector/<versão>`, `X-Macuxi-Conector-Versao`.

| Rota | O que o Conector envia / espera |
|---|---|
| `POST /lotes` | corpo `LoteEnvelope`; cabeçalho **`Idempotency-Key`** (SHA-256 hex, 64): mesma chave → o Hub devolve o **mesmo** `LoteAceito` (mesmo `lote_id`, sem reprocessar). `202` aceito; `400/413/422` com `RecusaEnvelope` (`{erros:[{codigo,campo,mensagem}]}`) = recusa **definitiva** (não é reenviada; bloqueia a entidade); `408/425/429/5xx` = transitório (retry; `Retry-After` respeitado). Aceitar corpo de pelo menos 8 MiB (o Conector envia até 4 MiB) |
| `GET /lotes/{id}` | `LoteResultado` (`status` `recebido`/`processando` → final; `erros[]` por linha com `indice`, `external_id`, `codigo`, `campo`, `mensagem`, `reprocessavel`). Só o estado final avança o cursor. `404` = Hub não conhece o lote → o Conector reenvia (mesma chave). **Premissa nova (campo opcional, compatível com `v1`)**: `inativacao: { situacao: "aplicada" \| "aguardando_confirmacao" \| "nao_aplicavel", motivo?, candidatos? }` no resultado do último lote da sessão completa, para a trava de RN-INT-06 |
| `GET /cursores/{entidade}` | `CursorEntidade` (cursor `null` = nunca recebeu: carga completa). Observação: `external_id` do cursor tem `min(1)` no contrato |
| `GET /pedidos/pendentes` | `PedidosPendentes`; ao entregar, o Hub marca `enviado` e reentrega (`tentativa + 1`) após o timeout de 10 min sem retorno (RN-INT-08) |
| `POST /pedidos/{pedido_uuid}/retorno` | `RetornoErp` (+ `itens_faturados?: [{sequencia, quantidade}]`, pedido T-0011). `200` com `RetornoAceito` (`repetido: true` se já aplicado); `422` com `{erros:[{codigo,mensagem}]}` para transição inválida/pedido desconhecido (definitivo) |
| `POST /sinal` | batimento a cada 60 s: `{ versao_conector, versao_contrato, em, fila[{estado,lotes,linhas,maisAntigo}], entidades[{entidade,fase,ultimo_sucesso,bloqueada,lotes_na_fila}] }` (sem dado pessoal). Premissa: o Hub define o schema final; qualquer `2xx` serve |
| `POST /reconciliacoes` | `ReconciliacaoEnvio`; qualquer `2xx` |

Premissas de comportamento do Hub: partes da sessão podem ser processadas em qualquer ordem, mas a sessão só fecha com todas as partes `1..ultimo` concluídas; reenvio com a mesma chave é inofensivo; `falhou` com erros por linha não reprocessáveis = o Conector considera o lote tratado (as linhas corrigidas voltam pelo delta); só `falha_processamento` é reenviada pelo Conector (em lote delta só com essas linhas, até 3 vezes).

## 10. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `testar-conexao`: *Segredo … não encontrado* | variável ou credencial inexistente, ou serviço rodando com outra conta | `conector segredo definir …` com a conta do serviço, ou variável de ambiente do sistema |
| *Configuração inválida* / *Segredo no arquivo* | JSON/YAML com campo inexistente, consulta sem `:cursor_*`/`:limite`, `senha`/`token` no arquivo | seguir a mensagem (ela diz o caminho do campo) |
| *Hub recusou a credencial* (401/403) | token rotacionado, revogado ou IP não permitido | pedir novo token ao Macuxi; gravar com `segredo definir hub_token` (vale em ≤ 60 s). A fila espera, nada se perde |
| *Sem conexão com o Hub* | firewall/proxy bloqueando HTTPS de saída | liberar o endereço do Hub na 443; o Conector continua tentando com espera exponencial (até 15 min) |
| Entidade **BLOQUEADA** em `status`: *Hub recusou o lote (…)* | recusa definitiva do envelope (versão, limite, sessão) | corrigir a causa (ex.: atualizar o Conector) e rodar `conector retomar <entidade>` |
| BLOQUEADA: *nenhuma linha lida tem external_id e alterado_em legíveis* | mapeamento/consulta errados | conferir `campos.external_id`/`campos.alterado_em` e a view; `testar-conexao`; `retomar` |
| BLOQUEADA: *a leitura não avança* | muitas linhas com o mesmo `alterado_em` e `external_id` repetido, ou `alterado_em` de precisão menor que o do filtro | `external_id` único; `alterado_em` em ms |
| Nada novo chega ao Hub | `alterado_em` não muda quando o registro muda; nulo; fuso errado | a view deve atualizar `alterado_em` em toda alteração, em UTC |
| Datas/horários deslocados em horas | view devolve hora local | converter para UTC na view (`AT TIME ZONE 'UTC'`) |
| Erros por linha no BKO | dado fora do contrato | corrigir no ERP; o `alterado_em` novo faz a linha voltar no delta seguinte. `conector status` lista os recentes (campo + mensagem, sem valores) |
| *Trava de inativação em massa* em `status` | a carga completa inativaria > 30% dos ativos | conferir se a view não perdeu linhas; confirmar (ou não) no BKO |
| Pedido fica `recebido` e não grava | ERP fora do ar ou SQL falhando | `status` mostra o estado; a conexão volta sozinha; erro de SQL repete 3 vezes e rejeita com o motivo |
| *Já existe um Conector rodando* | outra instância ou sobra de queda | pare o serviço; se nada rodar, apague `dados\conector.lock` |
| Quer refazer tudo de uma entidade | — | `conector carga-completa <entidade>` |

## 11. Limites desta versão e pendências

- **Drivers**: SQL Server e PostgreSQL. Oracle, MySQL e Firebird do doc 06 ficam para depois (interface `ConexaoErp` em `src/erp/driver.ts`).
- **Atualização automática**: não implementada (o Conector envia a própria versão no sinal; a distribuição do executável depende de decisão — ver recado de entrega).
- **Tela local simples** do doc 06: não incluída (CLI + BKO cobrem a operação).
- **Empacotamento em executável único** (`.exe` sem Node): hoje é um `conector.mjs` empacotado com esbuild que roda em Node 22 instalado.
- **Teste com SQL Server real**: o driver tem testes de unidade com dublê do `mssql`; a validação contra uma instância real fica para o ambiente de homologação.
- `itens_faturados` e `inativacao` dependem de acréscimo opcional no contrato (seção 9).
- Views-modelo (`db/conector/views-modelo.sql`) são do `banco-dados`.
