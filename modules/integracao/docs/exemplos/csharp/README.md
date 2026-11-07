# Cliente em C# (.NET 8)

[`ClienteHub.cs`](./ClienteHub.cs) (cliente) e [`Program.cs`](./Program.cs) (demonstração), projeto [`MacuxiHub.Exemplos.csproj`](./MacuxiHub.Exemplos.csproj). Usa só `HttpClient` e `System.Text.Json` do .NET 8, **sem pacote externo**, com `Nullable` habilitado.

> Observação: estes arquivos foram escritos e revisados sem compilador disponível no ambiente de entrega. Se `dotnet build` apontar algo, o ajuste é local (o desenho segue os outros clientes, que foram executados contra o simulador).

## Pré-requisito

[.NET SDK 8](https://dotnet.microsoft.com/download/dotnet/8.0).

## Variáveis

`MACUXI_HUB_URL` (padrão a demonstração; HTTPS obrigatório, salvo `localhost`/`127.0.0.1`), `MACUXI_CHAVE` (obrigatória, `mxc_` + 43 caracteres, nunca impressa), `MACUXI_CONECTOR` (padrão `erp-matriz`), `MACUXI_CONECTOR_VERSAO` (opcional; sem ele o cabeçalho não é enviado), `MACUXI_INTERVALO_MS` (padrão 5000).

## Rodar

Contra o simulador local (`node ../simulador/hub-simulado.mjs` imprime a URL e a chave de teste):

```
# PowerShell
$env:MACUXI_HUB_URL = "http://127.0.0.1:8787/integracao/v1"
$env:MACUXI_CHAVE = "<chave impressa pelo simulador>"
$env:MACUXI_INTERVALO_MS = "200"
dotnet run
```
```
# bash
MACUXI_HUB_URL=http://127.0.0.1:8787/integracao/v1 MACUXI_CHAVE=<chave impressa pelo simulador> MACUXI_INTERVALO_MS=200 dotnet run
```

Código de saída 0 em sucesso. Rodar de novo contra o mesmo Hub mostra o delta (nada novo, nenhum lote reenviado).

## O que demonstra

Os mesmos cenários dos outros clientes (veja o [README do Node](../node/README.md)): cursor (nulo = carga completa em partes da mesma `sessao`; com cursor = delta paginado por cursor), `Idempotency-Key` = SHA-256 do conteúdo, repetição com a mesma chave em rede/`429`/`500`/`503` respeitando `Retry-After`, `RecusaLoteException` sem repetição, erros por linha (reprocessáveis × corrigir no ERP), reenvio do mesmo lote (`repetido`) e devolução de pedidos com `numero_erp` (idempotente por `pedido_uuid`).

Para usar no seu projeto, copie `ClienteHub.cs`, implemente `IErp` (grave o pedido uma vez por `pedido_uuid`) e passe a leitura paginada do seu ERP (`Func<Cursor?, int, Task<List<JsonNode>>>`, **ordenada** por `alterado_em`, `external_id` e filtrada pelo cursor).
