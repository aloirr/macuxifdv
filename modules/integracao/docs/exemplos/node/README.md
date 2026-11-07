# Cliente em Node.js

Arquivo único, [`cliente-hub.mjs`](./cliente-hub.mjs): `fetch` nativo, **sem dependência**. Requer Node 18 ou superior.

## Variáveis

| Variável | Padrão | Observação |
|---|---|---|
| `MACUXI_HUB_URL` | `https://api-demo.macuxifdv.com.br/integracao/v1` | HTTPS obrigatório (só `localhost`/`127.0.0.1` aceitam `http`) |
| `MACUXI_CHAVE` | (obrigatória) | formato `mxc_` + 43 caracteres; **nunca é impressa** |
| `MACUXI_CONECTOR` | `erp-matriz` | identificador do Conector cadastrado no BKO |
| `MACUXI_CONECTOR_VERSAO` | (vazio) | opcional; sem ele o cabeçalho `X-Macuxi-Conector-Versao` não é enviado |
| `MACUXI_INTERVALO_MS` | `5000` | intervalo entre as consultas de um lote |

## Rodar

Contra o simulador local (veja [`../simulador`](../simulador/README.md)):

```
node ../simulador/hub-simulado.mjs            # em um terminal: imprime a URL e a chave de teste
```
```
# PowerShell                                         # bash
$env:MACUXI_HUB_URL = "http://127.0.0.1:8787/integracao/v1"      export MACUXI_HUB_URL=http://127.0.0.1:8787/integracao/v1
$env:MACUXI_CHAVE = "<chave impressa pelo simulador>"            export MACUXI_CHAVE=<chave impressa pelo simulador>
$env:MACUXI_INTERVALO_MS = "200"                                 export MACUXI_INTERVALO_MS=200
node cliente-hub.mjs
```

Contra a demonstração: defina só `MACUXI_CHAVE` (e `MACUXI_CONECTOR`, se o seu não for `erp-matriz`) e rode `node cliente-hub.mjs`. A demonstração envia dados de exemplo ao seu Conector; use um Conector de testes.

## O que demonstra

1. **Cursor**: `GET /cursores/produto`. Nulo: carga completa em partes da mesma `sessao` (3 por parte na demonstração; na vida real, até 5.000). Com cursor: só o delta, paginado por cursor (keyset), um lote por página.
2. **Delta de preços com erros por linha**: o Hub devolve `referencia_ausente` (reprocessável: ele reprocessa sozinho quando o produto chegar) e o cliente já separa o preço negativo em `linhas_invalidas` (corrigir no ERP).
3. **Reenvio do mesmo lote**: mesma `Idempotency-Key` devolve o mesmo `lote_id` com `repetido: true`.
4. **Recusa de envelope** (lote vazio, `422 lote_vazio`): vira `RecusaLoteErro` e **não** é repetida.
5. **Pedidos**: busca até a lista vir vazia, grava no ERP (idempotente por `pedido_uuid`) e devolve o retorno `integrado` com o `numero_erp`; trata `repetido`, `itens_descartados` e `422` definitivo.

Rodar de novo contra o mesmo Hub mostra o delta: nada novo, nenhum lote reenviado.

## Usar a classe no seu código

```js
import { ClienteHub, lerConfig } from './cliente-hub.mjs';
const cliente = new ClienteHub(lerConfig());
const { cursor } = await cliente.consultarCursor('produto');
const lotes = await cliente.enviarDelta('produto', suaLeituraPaginada, { cursor });
```

`suaLeituraPaginada(cursor, limite)` lê do ERP **ordenado** por (`alterado_em`, `external_id`) só o que é maior que o cursor. Principais exportações: `ClienteHub` (`consultarCursor`, `enviarLote`, `aguardarLote`, `enviarDelta`, `enviarCompleto`, `buscarPendentes`, `devolverRetorno`, `processarPedidos`), `RecusaLoteErro`, `ErroHub`, `compararCursor`, `chaveIdempotencia`.

## Repetição

Erro de rede, `429`, `500` e `503` repetem (até 5 tentativas) esperando o `Retry-After` (ou espera crescente), **sempre com a mesma requisição e a mesma `Idempotency-Key`**. `400`, `409`, `413`, `422` e `426` em `/lotes` não repetem: corrija o envelope.
