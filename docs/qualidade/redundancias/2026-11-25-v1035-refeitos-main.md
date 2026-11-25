# Corretor de redundâncias · v1.0.35 · branches refeitos a partir do main (25/11/2026)

Escopo: os três branches do web refeitos a partir do `main` (b20ffcbed) com um commit só do dono, comparados ao SHA já liberado.
Comando: `for f in $(git show --name-only --format= <novo>); do git diff <liberado> <novo> -- $f; done`.

| Branch | Liberado antes | Head conferido | Diferença | Parecer |
|---|---|---|---|---|
| `nuvem/v1035-web-engenheiro-apps-2` | 442aae1 | 3edfd6a46a6e49cd9b2bf678fef9439c18ce6d62 | só `apps/web/lib/cabecalho-app.test.ts:51`: `'/api-proxy/:path*'` → `` `${PROXY_BASE}/:path*` `` (sugestão do corretor; `PROXY_BASE` já importado na linha 9) | LIBERADO |
| `nuvem/v1035-web-engenheiro-apps-dados-2` | 46fd1b2 | b06ce89b1ec9e25d4f14cad3ba816c9d8f999850 | só `apps/web/lib/portal-telas.test.ts`: imports e teste do código da empresa vindos do `main` (#791; `sugerirCodigo` saiu do `main`); o commit do dono só acrescenta `abasDaSessao` e a aba Dados, como antes | LIBERADO |
| `nuvem/v1035-web-testes-2` | 844eee6 | 2d89b3f1ebcad4d89c7d85a374c15ee810a18a5d | nenhuma (`tests/integracao/api/pagamento-web-v1035.test.ts` idêntico) | LIBERADO |

Achados novos: nenhum (faixa RD-3574 a RD-3599 não usada). Catálogo sem alteração.
