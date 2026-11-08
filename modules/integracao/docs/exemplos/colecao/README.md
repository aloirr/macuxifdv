# Coleção Postman e Insomnia

Arquivos **gerados** do [`openapi-hub-v1.json`](../../openapi-hub-v1.json) por [`gerar-colecao.mjs`](./gerar-colecao.mjs). Não edite à mão.

| Arquivo | Uso |
|---|---|
| `macuxi-hub-v1.postman_collection.json` | Coleção Postman v2.1 |
| `macuxi-hub-v1.postman_environment.json` | Ambiente Postman (servidor, chave, Conector) |
| `macuxi-hub-v1.insomnia.json` | Export Insomnia v4 (já traz o ambiente "Demonstração") |

Pastas por tag (Lotes, Pedidos, Conector); uma requisição por exemplo de corpo do OpenAPI (os 15 lotes por entidade, carga completa em partes, lote só com linhas inválidas, reconciliações, os 5 retornos de pedido, sinal). As respostas de exemplo (`202`, erros `4xx`...) ficam anexadas à primeira requisição de cada rota.

## Importar

**Postman**: *Import* e escolha os dois arquivos (`...postman_collection.json` e `...postman_environment.json`). Selecione o ambiente no canto superior direito.

**Insomnia**: *Import* e escolha `macuxi-hub-v1.insomnia.json`; use o ambiente "Demonstração".

## Preencher as variáveis

| Variável | Valor |
|---|---|
| `servidor` | `api-demo.macuxifdv.com.br` (demonstração). Para o simulador local, veja abaixo. |
| `chave_conector` | a chave que o administrador gerou no BKO (`mxc_` + 43 caracteres, mostrada uma só vez). Trate como senha; no Postman o campo é do tipo *secret*. O arquivo traz só um marcador. |
| `conector_id` | o identificador do Conector cadastrado no BKO (ex.: `erp-matriz`) |
| `conector_versao` | opcional. O cabeçalho `X-Macuxi-Conector-Versao` vem **desligado**; ligue-o só com versão igual ou superior à mínima da empresa. |

Variáveis da coleção: `base_url` (`https://{{servidor}}/integracao/v1`), `lote_id`, `entidade` e `pedido_uuid`. O Postman guarda o `lote_id` do `202` e o `pedido_uuid` de `pendentes` sozinho (script de teste).

**Idempotency-Key**: em `POST /lotes` é o SHA-256 do corpo. No Postman o script de pré-requisição recalcula a cada envio (corpo igual, chave igual: o Hub devolve `repetido: true`; corpo alterado, chave nova). No Insomnia a chave vem fixa para o corpo gerado: se mudar o corpo, troque a chave (por exemplo `sha256sum corpo.json`).

**Simulador local**: o simulador usa `http://`, e a base da coleção usa `https://`. Para testar nele, ajuste a variável `base_url` da coleção para a URL que o simulador imprime (algo como `http://127.0.0.1:8787/integracao/v1`) e use a chave que ele imprime.

## Regerar

```
node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs             # regrava os 3 arquivos
node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs --verificar # só confere (saída 1 se divergir)
```

Quando o OpenAPI muda (`pnpm --filter @macuxi/integracao openapi`), regere a coleção; o teste `colecao.test.ts` falha enquanto os arquivos estiverem desatualizados.
