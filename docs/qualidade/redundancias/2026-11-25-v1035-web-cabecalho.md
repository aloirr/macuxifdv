# Parecer de redundâncias — v1.0.35, shell web com `x-macuxi-app` e teste de pagamento no web

Data: 25/11/2026 (Manaus). Rodada única, por SHA. Recados não enviados (repositório de recados com 403); achados relatados ao gerente-projetos.

## A) `nuvem/v1035-web-engenheiro-apps` @ e5a5c4a (sobre 144160c) — NÃO LIBERADO

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3555 | média | `apps/web/lib/portal-api.ts:16,97` (`comCabecalhoApp`) × `apps/web/proxy.ts:28` (`cabecalhosParaApi`) | A mesma regra (pôr `x-macuxi-app: web/<VERSAO_WEB>` e trocar o do chamador) em dois pontos. O portal só chama `/api-proxy${caminho}` (`portal-api.ts:95`), e o 2º matcher do `proxy.ts` (`/api-proxy/:path*`) já troca o cabeçalho de toda chamada a esse prefixo; o próprio teste do SDK (`cabecalho-app.test.ts:82-97`) prova que basta o proxy | Ponto único no proxy: tirar `comCabecalhoApp` (`cabecalho-app.ts:17-23`), o import e o uso em `portal-api.ts` (volta `headers: cabecalhos`); no teste, tirar o `it` de `comCabecalhoApp` (`:37-40`) e trocar o do portal (`:99-106`) pelo mesmo formato do teste do SDK (a URL do `chamarPortal` passa pelo `proxy` e sai com `web/<VERSAO_WEB>`); no comentário de `cabecalho-app.ts:4-5` e `cabecalho-app.test.ts:2-4`, tirar "o cliente do portal também o manda" | engenheiro-apps |
| RD-3556 | baixa | `apps/web/lib/cabecalho-app.ts:10` (`PREFIXO_PROXY_API`) × `apps/web/lib/portal-api.ts:95` e `apps/web/lib/portal.ts:53` | Constante nova para `/api-proxy`, mas o literal continua na chamada do portal e na lista `CAMINHOS_DE_FORA` (o mesmo prefixo com duas fontes) | `fetch(\`${PREFIXO_PROXY_API}${caminho}\`, ...)` e `CAMINHOS_DE_FORA = ['/_next', PREFIXO_PROXY_API, ROTA_DO_PORTAL]` | engenheiro-apps |
| RD-3557 | baixa (só teste, não segura) | `apps/web/lib/cabecalho-app.test.ts:32-35` × `packages/platform-sdk/src/app-versao.test.ts:187-188` | `valorCabecalhoWeb() = web/<VERSAO_WEB>` e o nome `x-macuxi-app` já conferidos no teste do SDK | Tirar o `it` "o valor é web/<VERSAO_WEB>..." | engenheiro-apps |

Sem duplicação com o app mobile: o mobile monta o cabeçalho no cliente (`apps/mobile/src/lib/versao-app.ts:35`) e o web no proxy, os dois pelo `valorCabecalhoApp` do SDK. O "manter?" do parecer anterior (exports `VERSAO_WEB`/`valorCabecalhoWeb` sem uso) fecha: o shell web passa a usá-los.

## B) `nuvem/v1035-web-testes` @ 3ed4022 (sobre b59f3e6) — LIBERADO no SHA 3ed4022

Achados só em teste e comentário de teste, baixos (não seguram; lote seguinte):

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3558 | baixa (só teste) | `tests/integracao/api/pagamento-web-v1035.test.ts:102-107` (W0) × `packages/platform-sdk/src/app-versao.test.ts:197-200` | Formato `web/X.Y.Z` e `VERSAO_WEB >= 1.0.34`, a mesma checagem que o RD-3554 tirou do teste da API | Tirar o W0 | testes |
| RD-3559 | baixa (só teste) | `pagamento-web-v1035.test.ts:166-179` (W4) e `:31,78-83` × `apps/api/test/app-versao.test.ts:360-380` | "Web nunca recebe 426 com o APK vencido" (inclusive `web/0.0.1`) e o 426 do campo/gestão antigos já provados com `createApp` real; o bloqueio não depende do banco | Tirar o W4, o `PUBLICADA_EM` e o `versoesApp` do `subirApi` (o critério 3 fica no teste da API) | testes |
| RD-3560 | baixa (só teste) | `pagamento-web-v1035.test.ts:181-186` (W5) × `tests/integracao/api/pagamento-t0089.test.ts:266-269` (R1d) | Push sem cabeçalho com BOLETO 30/60/90 aceito e teto 45 inalterado: mesmas linhas do R1d | Tirar o W5 (o critério 4 também está na parte "sem cabeçalho" do W3) | testes |
| RD-3561 | baixa (só comentário) | `pagamento-web-v1035.test.ts:1-13` | Cabeçalho de 13 linhas; o parágrafo `:11-13` repete o título do W1 e a fixture que o `beforeAll` (`:87-90`) já confere | Deixar as linhas 1-10 (critérios) e tirar o parágrafo final | testes |

Sem defeito funcional para encaminhar ao testes.

## C) Reteste `nuvem/v1035-web-engenheiro-apps` @ aec0723 (`git diff e5a5c4a aec0723`) — NÃO LIBERADO (RD-3572)

| ID | Resultado |
|---|---|
| RD-3555 | corrigido: `comCabecalhoApp` saiu de `cabecalho-app.ts` e de `portal-api.ts` (volta `headers: cabecalhos`); o teste do portal passa a URL do `chamarPortal` pelo `proxy` e confere `web/<VERSAO_WEB>`; os comentários tiraram "o cliente do portal também o manda" |
| RD-3556 | corrigido: `portal-api.ts` usa o `PROXY_BASE` do SDK e `portal.ts` usa a constante do web em `CAMINHOS_DE_FORA`; a constante local virou o RD-3572 |
| RD-3557 | corrigido: saíram o `it` do valor do cabeçalho e o de `comCabecalhoApp` |

Achado novo:

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3572 | baixa | `apps/web/lib/cabecalho-app.ts:13` (`PROXY_BASE_NO_SERVIDOR`) × `packages/platform-sdk/src/web/api.ts:81` (`PROXY_BASE`) × `packages/platform-sdk/src/cookie-sessao.ts:25` (`CAMINHO_COOKIE_SESSAO = '/api-proxy/auth'`) | O prefixo `/api-proxy` com três fontes em código de produção. O motivo da cópia é real (`@macuxi/platform-sdk/web` carrega `session.ts` com `'use client'` e quebra o `proxy.ts`), mas a raiz do SDK já é segura para servidor e o web já a importa (`CABECALHO_APP`, `valorCabecalhoWeb`). O teste de igualdade só amarra a cópia: ela continua existindo, e o literal do cookie fica fora da amarra | **engenheiro-software:** levar `PROXY_BASE` à raiz do SDK, num arquivo sem `'use client'` (ex.: `cookie-sessao.ts`), com `CAMINHO_COOKIE_SESSAO = `${PROXY_BASE}/auth``; `web/api.ts` importa e reexporta (sem quebrar quem usa `@macuxi/platform-sdk/web`). **engenheiro-apps**, depois: `import { PROXY_BASE } from '@macuxi/platform-sdk'` em `cabecalho-app.ts` e `portal.ts`, tirar `PROXY_BASE_NO_SERVIDOR`, o comentário dele e o `describe('prefixo do proxy no servidor')` | engenheiro-software + engenheiro-apps |

Mantidos (sem achado):
- Comentário do limite em `proxy.ts:71-72` (10 MiB padrão, parte de 8 MiB): diz o risco do 2º matcher e aponta o teste; os números ajudam a leitura e o teste pega se mudarem. `manter`.
- Teste `PARTE_ENVIO_BYTES < defaultConfig.experimental.proxyClientMaxBodySize` e `proxyClientMaxBodySize` indefinido no `next.config`: guarda nova, sem par em outro teste.
- Linha em branco dupla em `portal-api.ts:15-16` (sobra do import tirado): formatação, não redundância; fica para o lint/prettier do dono.

Sem defeito funcional para encaminhar ao testes.

## D) Reteste do RD-3572 por SHA — LIBERADO

**A) `nuvem/v1035-web-engenheiro-software` @ efc75a4 (`git diff b59f3e6 efc75a4`)**: `PROXY_BASE` nasce em `packages/platform-sdk/src/proxy-base.ts` (sem `'use client'`), publicado por `index.ts`; `CAMINHO_COOKIE_SESSAO = \`${PROXY_BASE}/auth\``; `web/api.ts` só importa e reexporta. Uma fonte no SDK. Sem achado.

**B) `nuvem/v1035-web-engenheiro-apps` @ 442aae1 (`git show 442aae1`; o resto de `aec0723..442aae1` veio pelo merge 83a45f2 de efc75a4 e b59f3e6)**: `cabecalho-app.ts`, `portal.ts`, `portal-api.ts`, `cabecalho-app.test.ts` e `sessao-web.test.ts` importam `PROXY_BASE` de `@macuxi/platform-sdk`; saíram `PROXY_BASE_NO_SERVIDOR`, o comentário dele e o `describe('prefixo do proxy no servidor')`. Nenhum import de `PROXY_BASE` por `@macuxi/platform-sdk/web` sobrou no `apps/web`. Sem achado.

| ID | Resultado |
|---|---|
| RD-3572 | corrigido em efc75a4 + 442aae1 |

Literais `/api-proxy` que ficam (julgados, `manter`):
- `apps/web/proxy.ts:73` (`config.matcher`): o Next lê o matcher por análise estática no build; template ou constante importada não vale ali. A cópia é exigida pela ferramenta e o teste `cabecalho-app.test.ts:51` a confere.
- `apps/web/next.config.ts:95` (`source` do rewrite geral): o `next.config.ts` hoje não importa pacote do workspace (só `node:path` e o tipo `next`), e trazer o SDK para o carregamento da config é mudança de build fora do escopo do RD; o `sessao-web.test.ts:194` procura a regra por `\`${PROXY_BASE}/:path*\``, então o literal já está amarrado à fonte única.
- `PROXY_OPENAPI_HUB`/`PROXY_GUIA_PDF_HUB` (`next.config.ts:18,21`) × `OPENAPI_HUB.viaProxy`/`GUIA_PDF_HUB.viaProxy` (`portal-rotas.ts:92,98`): anteriores a este lote, mesmo motivo do item acima, amarrados por `hosts-bko.test.ts:46,52`.
- Literais em comentários e em entradas de teste (`'/api-proxy/vendedor/pedidos'` etc.): descrevem o caminho para quem lê ou são o dado de entrada do caso; não são fonte do valor.

Observação ao dono (sem RD): em `cabecalho-app.test.ts:51` o esperado `'/api-proxy/:path*'` poderia ser `\`${PROXY_BASE}/:path*\``, para o teste quebrar se o `PROXY_BASE` mudar e o matcher estático ficar para trás. É guarda, não repetição; fica a critério do engenheiro-apps.

Sem defeito funcional para encaminhar ao testes. **LIBERADO no SHA 442aae1** (com efc75a4 no SDK).
