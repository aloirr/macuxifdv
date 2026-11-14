# Guia da API do Hub de Integração (`/integracao/v1`)

O guia para o TI do cliente (primeira integração passo a passo, convenções, delta e carga completa, idempotência, limites, erros, as 7 rotas com todos os campos e os registros por entidade) está em PDF: [`guia-api-hub.pdf`](./guia-api-hub.pdf).

O contrato completo, para gerar clientes e coleções, está no OpenAPI 3.1: [`openapi-hub-v1.json`](./openapi-hub-v1.json).

Regerar o PDF depois de mudar um contrato, um exemplo ou um texto: `pnpm --filter @macuxi/integracao guia-pdf`.
