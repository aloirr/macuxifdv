# Cliente em Python

[`cliente_hub.py`](./cliente_hub.py): Python 3.9+ com `requests`. Faz os mesmos cenários dos outros clientes (veja o [README do Node](../node/README.md) para o passo a passo da demonstração).

## Pré-requisitos

```
pip install -r requirements.txt
```

## Variáveis

`MACUXI_HUB_URL` (padrão a demonstração; HTTPS obrigatório, salvo `localhost`/`127.0.0.1`), `MACUXI_CHAVE` (obrigatória, `mxc_` + 43 caracteres, nunca impressa), `MACUXI_CONECTOR` (padrão `erp-matriz`), `MACUXI_CONECTOR_VERSAO` (opcional; sem ele o cabeçalho não é enviado), `MACUXI_INTERVALO_MS` (padrão 5000).

## Rodar

Contra o simulador local (`node ../simulador/hub-simulado.mjs` imprime a URL e a chave de teste):

```
# bash
export MACUXI_HUB_URL=http://127.0.0.1:8787/integracao/v1
export MACUXI_CHAVE=<chave impressa pelo simulador>
export MACUXI_INTERVALO_MS=200
python cliente_hub.py
```
```
# PowerShell
$env:MACUXI_HUB_URL = "http://127.0.0.1:8787/integracao/v1"
$env:MACUXI_CHAVE = "<chave impressa pelo simulador>"
$env:MACUXI_INTERVALO_MS = "200"
python cliente_hub.py
```

Saída 0 em sucesso. Rodar de novo contra o mesmo Hub mostra o delta (nada novo, nenhum lote reenviado).

## O que demonstra

Cursor (nulo = carga completa em partes da mesma `sessao`; com cursor = delta paginado por cursor), `Idempotency-Key` = SHA-256 do conteúdo, repetição com a mesma chave em rede/`429`/`500`/`503` (`Retry-After`), `RecusaLoteErro` sem repetição, erros por linha separados em reprocessáveis × corrigir no ERP, reenvio do mesmo lote (`repetido`), e devolução de pedidos com `numero_erp` (idempotente por `pedido_uuid`, trata `itens_descartados` e `422` definitivo).

Classe `ClienteHub` com `consultar_cursor`, `enviar_lote`, `aguardar_lote`, `enviar_delta`, `enviar_completo`, `buscar_pendentes`, `devolver_retorno` e `processar_pedidos`.
