# Hub simulado

Servidor local (Node 18+, sem dependência) que imita o Hub `/integracao/v1` para você testar o seu cliente sem tocar na demonstração. É uma **simulação**: nada é gravado em disco, e a chave é fictícia.

```
node hub-simulado.mjs [porta]      # porta padrão 8787
```

Ele imprime a URL, a chave de teste (formato `mxc_` + 43 caracteres, válida só nesse processo) e o identificador do Conector (`erp-matriz`). Use esses valores nas variáveis do cliente:

```
MACUXI_HUB_URL=http://127.0.0.1:8787/integracao/v1
MACUXI_CHAVE=<a chave impressa>
MACUXI_CONECTOR=erp-matriz
```

## O que ele reproduz (segundo o guia)

- `401 credencial_invalida` (chave ou Conector errado); `X-Request-Id` em toda resposta.
- `Idempotency-Key`: formato inválido `400`; mesma chave e mesmo conteúdo `202` com `repetido: true` e `Idempotent-Replay: true`; mesma chave com outro conteúdo `409`.
- Recusas de envelope (`RecusaLote`): `sessao_ausente`, `sessao_nao_se_aplica`, `lote_vazio`, `acima_do_limite` (mais de 5.000), `entidade_desconhecida`, `versao_nao_suportada`.
- O lote passa por `recebido` → `processando` → `concluido` / `concluido_com_erros` (a cada `GET /lotes/{id}`), com erros por linha (`referencia_ausente` reprocessável; `valor_fora_da_faixa` para `*_cents` negativo; `linhas_invalidas` com `origem: conector`).
- Cursor por entidade (maior par `alterado_em`, `external_id`), que só avança quando o lote termina; `null` antes da primeira carga.
- Fila de pedidos com o pedido de exemplo do OpenAPI; retorno com `pedido_desconhecido`, `pedido_nao_entregue`, `numero_erp_divergente`, `transicao_invalida`, repetição (`repetido: true`) e `itens_descartados`.
- Falhas transitórias: como módulo, `criarHubSimulado({ falhasTransitorias: N })` (ou `hub.definirFalhasTransitorias(N)`) responde `503` com `Retry-After: 1` nas próximas N chamadas.

## Usar como módulo (testes automatizados em Node)

```js
import { criarHubSimulado } from './hub-simulado.mjs';
const hub = criarHubSimulado({ conectorId: 'erp-matriz' });
const url = await hub.iniciar();        // porta livre; devolve http://127.0.0.1:<porta>/integracao/v1
// ... rode o seu cliente com hub.chave ...
console.log(hub.estado.requisicoes);    // tudo o que o cliente enviou (a chave é omitida)
await hub.parar();
```
