# Kit do TI: exemplos para integrar com o Hub do Macuxi FDV

Material para a equipe de TI do cliente que vai integrar o ERP **direto pela API** (sem o Conector Macuxi). Tudo aqui é de exemplo: nenhuma chave real, nenhum dado real.

- Guia (convenções, idempotência, cursor, limites, erros, devolução de pedidos): [`../guia-api-hub.pdf`](../guia-api-hub.pdf)
- Contrato completo (OpenAPI 3.1, 7 rotas): [`../openapi-hub-v1.json`](../openapi-hub-v1.json)

## O que tem aqui

| Pasta | Para quê |
|---|---|
| [`colecao/`](./colecao/README.md) | Coleção **Postman** (v2.1) e export **Insomnia** (v4) com uma requisição por exemplo do OpenAPI, mais o ambiente do Postman. Gerados do OpenAPI por script. |
| [`simulador/`](./simulador/README.md) | **Hub simulado** local (Node puro): responde como o guia descreve (idempotência, erros por linha, cursor, pedidos). Serve para testar o seu cliente sem tocar na demonstração. |
| [`node/`](./node/README.md) | Cliente em **Node.js** (fetch, sem dependência). |
| [`csharp/`](./csharp/README.md) | Cliente em **C# / .NET 8** (HttpClient, sem pacote externo). |
| [`python/`](./python/README.md) | Cliente em **Python** (`requests`). |

Os três clientes fazem a mesma coisa: consultam o cursor; sem cursor, carga completa em partes (mesma `sessao`); com cursor, delta paginado; enviam com `Idempotency-Key` (SHA-256 do conteúdo) e repetem com a **mesma** chave em erro de rede, `429`, `500` e `503` (respeitando `Retry-After`); tratam a recusa de envelope sem repetir; separam os erros por linha em "reprocessáveis" e "corrigir no ERP"; e devolvem os pedidos aprovados com o `numero_erp`.

## Por onde começar

1. Leia as Seções 1 a 8 do [guia](../guia-api-hub.pdf).
2. Suba o simulador (`node simulador/hub-simulado.mjs`) e rode um dos clientes contra ele (veja o README de cada pasta). Com o simulador, os erros aparecem sem risco.
3. Importe a coleção no Postman ou no Insomnia e teste as rotas à mão contra a demonstração (`api-demo.macuxifdv.com.br`) com a chave que o administrador gerou no BKO.
4. Troque o "ERP fictício" do exemplo pelas consultas do seu ERP (a leitura precisa ser **ordenada** por `alterado_em`, `external_id` e filtrar pelo cursor).

## Regras que os exemplos seguem

- Chave de API só por variável de ambiente (`MACUXI_CHAVE`); nunca em código, log ou mensagem de erro.
- HTTPS obrigatório (o simulador local usa `http://127.0.0.1`, o único caso aceito).
- `X-Macuxi-Conector-Versao` é opcional: os exemplos só o enviam se você informar. Uma versão abaixo da mínima da empresa recebe `426`.
- Um lote tem até **5.000** registros; os exemplos usam partes pequenas só para a demonstração.

## Conferência

Os testes do pacote (`pnpm --filter @macuxi/integracao test`) mantêm este kit fiel ao contrato: a coleção é regenerada do OpenAPI e comparada, e os clientes rodam contra o simulador com cada corpo e cada resposta validados pelos schemas do OpenAPI.
