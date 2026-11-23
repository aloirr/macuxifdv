# ADR 0068 — Endereços por caminho em `fdv.macuxifdv.com.br`

- **Status**: proposta em 2026-11-23. Tem duas perguntas abertas, (a) e (b), que o dono do produto decide antes da implementação.
- **Data**: 2026-11-23 (Manaus)
- **Tarefa**: a definir pelo gerente-projetos. Entra na esteira depois da v1.0.28 e da v1.0.29.
- **Autor**: engenheiro-software
- **Origem**: decisão do dono do produto no chat de 23/11/2026, repassada pelo gerente-projetos. Texto literal: "vamos mudar os endereços do macuxifdv. será fdv.macuxifdv.com.br e a partir dele terá o fdv.macuxifdv.com.br/config /bko /catalogo e etc. essa mudança se dá porque agora tenho o erp e ele usará o endereço erp.macuxifdv.com.br/config /bko e etc".
- **Revê**:
  - a seção "Domínio e endereços" do doc 04;
  - a lista de rotas do túnel da ADR 0028;
  - o item 7 da ADR 0029 (portal só no host `config.`);
  - o nome do cookie da ADR 0038;
  - a base do `apk_url` da ADR 0065.

## Contexto
O Macuxi usa hoje um subdomínio por superfície. O dono do produto vai ter um ERP próprio no mesmo domínio, em `erp.macuxifdv.com.br`, com os caminhos `/config`, `/bko` e outros. Para os dois produtos ficarem simétricos, o FDV passa a ter um host só, `fdv.macuxifdv.com.br`, e separa as superfícies por caminho.

### Hosts que existem hoje (levantamento de 23/11/2026 no `origin/main`)
| Host | Serve | Onde aparece |
|---|---|---|
| `api.macuxifdv.com.br` | API (`/v1/...`) e Hub (`/integracao/v1/...`), túnel `macuxi-prod` → `api:8100` | `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL` dos dois perfis de produção); `apps/api/src/app-versao.ts` (`URL_API_PUBLICA_PADRAO`, base do `apk_url` antigo `/v1/app/atualizar`); `modules/integracao/api/openapi/{gerar,guia-pdf}.ts` e `docs/openapi-hub-v1.json` (servidor do OpenAPI e do guia em PDF); exemplos do Hub (C#, Python, Node, Postman, Insomnia) e `kit-piloto`; `hub.url` do arquivo de configuração de cada Conector instalado; `.github/workflows/producao-publicar.yml` e `producao-diagnostico-outbox.yml` (conferência de `/v1/saude`) |
| `bko.macuxifdv.com.br` | BKO (`apps/web`), túnel → `bko:3100` | `apps/web/next.config.ts` (`HOSTS_DO_BKO_PADRAO`); `apps/web/Dockerfile` e `producao-publicar.yml` (`MACUXI_BKO_ORIGEM`, gravada no `next build`); `apps/web/lib/portal.ts` (`PREFIXOS_DO_PORTAL`: o link do convite troca `config.` por `bko.`); `MACUXI_EMAIL_URL_BKO` (botão "Abrir o backoffice" do e-mail, no `.env` da VM) |
| `config.macuxifdv.com.br` | Portal de implantação, o mesmo serviço `bko:3100`; o `proxy.ts` reescreve `/x` para `/config/x` pelo Host | `apps/web/lib/portal.ts` e `proxy.ts`; `apps/api/src/diagnosticos-worker.ts` (`URL_PORTAL_PADRAO`, link do recado de diagnóstico; `MACUXI_DIAGNOSTICOS_PORTAL_URL`); `producao-publicar.yml` |
| `app.macuxifdv.com.br` | nada; reservado no doc 04 e nunca criado | doc 04, `scripts/demo/LEIA-ME.md` |
| `api-demo.`, `bko-demo.`, `config-demo.` | demo, desligada pela ADR 0051 | `scripts/demo/*`, `scripts/deploy/demo/compose.yml`, `tests/scripts/*demo*`, `tests/integracao/demo/*`, roteiros antigos do app. Ficam fora desta mudança. |
| `api-hml.`, `bko-hml.`, `config-dev.` | nunca existiram; só exemplos | `docs/testes/T-0074.md`, testes de `portal.ts` |
| `macuxifdv.com.br` (raiz e `www`) | site e portal de compras, fora deste projeto; também o domínio do remetente `nao-responda@macuxifdv.com.br` e o `site` dos dados legais (`plataforma.dados_legais`, rodapé do PDF) | não mudam |

Fora do domínio, também não mudam:
- os links assinados do S3 da Magalu (`br-se1.magaluobjects.com`): APK e Conector pela ADR 0065 e pela ADR 0037, fotos e ZIP pela ADR 0058;
- o `trycloudflare.com` do desenvolvimento.

### Fatos técnicos que pesam na decisão
1. **TLS.** O DNS e o TLS ficam na Cloudflare, com túnel e sem porta aberta (ADR 0028). O certificado grátis (Universal SSL) cobre `macuxifdv.com.br` e `*.macuxifdv.com.br`, só um nível. Ele cobre `fdv.` e `erp.`, mas não cobre `api.fdv.macuxifdv.com.br`, que é de segundo nível. Esse host exige o Advanced Certificate Manager (pago) ou um certificado próprio.
2. **Um app web só.** O BKO e o portal são o mesmo Next (`apps/web`), com o portal na rota `/config`. Hoje `/config` responde 404 fora do host `config.`. As páginas dos módulos já ficam na raiz: `/catalogo/...`, `/vendedor/...` (`app/(bko)/[...caminho]`). O caminho `fdv.../catalogo` da decisão é, portanto, a página do Catálogo no BKO, como hoje em `bko.../catalogo`.
3. **Sem CORS.** O navegador só fala com a própria origem pelo `/api-proxy` (rewrite do Next, desenho T-0038 §3). A API não tem CORS.
4. **Cookie de sessão do BKO** (ADR 0038):
   - nome `__Secure-macuxi_rt`, host-only (sem `Domain`);
   - `Path=/api-proxy/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`;
   - o cabeçalho próprio `X-Macuxi-CSRF: 1` protege contra CSRF.

   O portal guarda o token do super-admin só no `sessionStorage`, nunca em cookie. Hoje é a origem `config.`, separada do BKO.
5. **Apps Android instalados.** O build de produção usa sempre o `EXPO_PUBLIC_API_URL` gravado no APK. Não tem campo Servidor, e o endereço salvo por versão antiga é ignorado (`apps/mobile/src/lib/endereco-do-build.ts`). Só um APK novo troca o endereço.
6. **Redirecionamento quebra a API.** O OkHttp do app e o `fetch` do Conector (undici) tiram o `Authorization` quando o redirecionamento muda de host. Além disso, 301 e 302 transformam POST em GET. Redirecionar `api.` para o host novo derrubaria a sessão dos apps e o envio dos Conectores.
7. **Bases com caminho.** O Conector monta `hub.url + '/integracao/v1'` por texto (`apps/conector/src/hub/cliente.ts`), então aceita base com caminho. Já o `urlApiPublicaDoAmbiente` (`app-versao.ts`) só aceita `https://host`, sem caminho. Uma API em `/api` exige mudar essa função.

## Decisão
1. **Um host só para o FDV: `fdv.macuxifdv.com.br`.** O ERP fica em `erp.macuxifdv.com.br`, em outro serviço, e os dois não compartilham cookie, storage, assets nem rota. Mapa de caminhos do host `fdv.`:

   | Caminho | Serviço | Hoje em |
   |---|---|---|
   | `/` | redireciona (307) para `/bko` | `bko./` |
   | `/bko` | página inicial do BKO (a atual `app/(bko)/page.tsx`) | `bko./` |
   | `/login` e `/convite/<token>` | entrada e convite do BKO | `bko./login` e `bko./convite/...` |
   | `/<modulo>/...` (`/catalogo`, `/vendedor`...), `/parametros`, `/auditoria` | páginas do BKO, como hoje | `bko./<modulo>/...` |
   | `/config`, `/config/...` | portal de implantação, pela rota que já existe, sem reescrita por host | `config./...` |
   | `/api-proxy/...` | rewrite do Next para a API (inalterado) | `bko./api-proxy/...` |
   | `/_next/...`, `/favicon.ico` | arquivos do Next | igual |
   | API | depende da pergunta (a): `fdv.../api/v1/...` e `/api/integracao/v1/...`, ou `api.fdv.macuxifdv.com.br/v1/...` | `api./v1/...` |

   **Prefixos reservados na raiz:** `api`, `api-proxy`, `bko`, `config`, `login`, `convite`, `_next`, `parametros`, `auditoria` e `.well-known`.
   - Nenhum módulo pode ter id ou rota de BKO com esses nomes. Um teste do SDK confere isso contra os manifestos.
   - A regra de caminho da API é `^/api(/|$)`, nunca `^/api`: a segunda pegaria o `/api-proxy`.
2. **DNS e TLS.**
   - Um registro `fdv` (CNAME do túnel `macuxi-prod`, criado pela Cloudflare ao incluir o host público), com proxy laranja. O certificado é o Universal SSL que já existe.
   - HSTS no host `fdv.`, sem `includeSubDomains` na raiz: a raiz é do site, fora deste projeto.
   - Os hosts antigos ficam no túnel durante a convivência (item 9).
   - Se a resposta da pergunta (a) for o subdomínio, entram o `api.fdv` e o Advanced Certificate Manager.
   - O Cloudflare Access recomendado para o portal (ADR 0029 §7) passa a ser uma aplicação por caminho, `fdv.macuxifdv.com.br/config`.
3. **Proxy por caminho no túnel, sem servidor novo.** As regras do host público `fdv.` no túnel `macuxi-prod` (painel da Cloudflare, pelo dono do produto), na ordem:
   1. caminho `^/api(/|$)` → `http://api:8100`, só se a pergunta (a) for `/api`;
   2. o resto → `http://bko:3100`.

   O túnel não tira o prefixo. A API passa a aceitar `MACUXI_API_PREFIXO_PUBLICO=/api`: um `rewriteUrl` do Fastify, no bootstrap, tira o prefixo antes do roteamento. Os logs, o `request_id` e as rotas ficam iguais, e `/v1/...` sem prefixo continua valendo para `api.` e para o loopback do `/api-proxy`.

   Não entra Caddy nem nginx na VM. O redirecionamento dos hosts antigos fica no código versionado e testado (item 9), não em regra do painel.
4. **Next (`apps/web`): sem `basePath` e sem `assetPrefix`.** O app fica na raiz do host `fdv.`:
   - O `basePath` é um por build e separaria o BKO do portal em duas imagens. As rotas que a decisão pede (`/config`, `/bko`, `/catalogo`) já são rotas do app.
   - Os `/_next` ficam na raiz do `fdv.`. Não colidem com o ERP, que tem outro host.
   - `HOSTS_DO_BKO_PADRAO` passa a `['fdv.macuxifdv.com.br']`, mais os dois antigos durante a convivência. O `MACUXI_BKO_ORIGEM` do `producao-publicar.yml` e do `Dockerfile` passa a `https://fdv.macuxifdv.com.br`.
   - O `proxy.ts` deixa de reescrever pelo Host: o portal é o caminho `/config` em `fdv.`, e o `bloqueadoForaDoPortal` vale só para os hosts que não são `fdv.` nem `config.`.
   - Os cabeçalhos do portal (`x-robots-tag: noindex, nofollow`, `cache-control: no-store`) passam a ser por caminho (`/config/*`), não por host.
   - `PREFIXOS_DO_PORTAL` sai: o link do convite é relativo à mesma origem (`/convite/<token>`).
   - Um web novo que nascer separado (outro serviço) recebe `basePath` `/<nome>`, uma regra de caminho no túnel e um prefixo reservado no item 1.
5. **Cookies e storage.**
   - **Cookie de sessão do BKO:**
     - nome `__Secure-fdv_rt`, em vez de `__Secure-macuxi_rt`; nome do PC `fdv_rt`;
     - continua host-only (sem `Domain`), com `Path=/api-proxy/auth`, `HttpOnly`, `Secure` e `SameSite=Strict`.

     Na convivência, a API lê os dois nomes e grava só o novo. Quem entra pelo host novo faz login de novo de qualquer jeito, porque a origem mudou.
   - **Contra cookie injetado por outro subdomínio:**
     - `fdv.` e `erp.` são o mesmo *site* (`macuxifdv.com.br`), então o `SameSite` não separa os dois. Um subdomínio comprometido pode gravar um cookie com `Domain=.macuxifdv.com.br` e o mesmo nome.
     - Defesa: a rota de sessão recusa (401, e apaga) quando o `Cookie` traz mais de um `fdv_rt`.
     - O prefixo `__Host-` resolveria sem essa conta, mas exige `Path=/` e mandaria o token de renovação em toda requisição de página. Fica como alternativa (ver Alternativas).
   - **Convenção para o ERP** (sem código aqui, recado ao dono do ERP):
     - cookies host-only, sem `Domain=.macuxifdv.com.br`;
     - nomes com prefixo `erp_`;
     - nada no `localStorage` com chave `macuxi.*` ou `fdv.*`.
   - **Portal e BKO na mesma origem.** O `sessionStorage` continua por aba, mas um XSS em qualquer página do `fdv.` passa a alcançar o token do super-admin, que antes ficava em outra origem. Compensações:
     - CSP estrita nas páginas `/config/*` (`script-src 'self'`, sem `unsafe-eval`; `frame-ancestors 'none'`);
     - as páginas do portal não carregam extensão de módulo (já é assim);
     - chaves de storage do portal com prefixo próprio, limpas no "Sair" e no fim da sessão;
     - Cloudflare Access no caminho `/config` (item 2).
6. **CORS: continua sem.**
   - O BKO e o portal falam com a API pela própria origem (`/api-proxy`).
   - O app Android e o Conector não são navegador.
   - O ERP integra de servidor para servidor pelo Hub (`/integracao/v1`, chave de API), nunca pelo navegador em `erp.`.
   - **Bucket:** o CORS do bucket para o PUT assinado das partes do ZIP (ADR 0058, `MACUXI_ENVIO_URL_ASSINADA`) passa a listar `https://fdv.macuxifdv.com.br`. Esse item é do dono do produto, no painel da Magalu.
7. **Links em e-mail, PDF e APK.** Tudo vem de configuração, sem host fixo novo no código:
   - `MACUXI_EMAIL_URL_BKO=https://fdv.macuxifdv.com.br/bko` e `MACUXI_EMAIL_URL_ATIVOS` com a nova base, no `.env` da VM;
   - `URL_PORTAL_PADRAO` (diagnóstico) = `https://fdv.macuxifdv.com.br`. O link do recado continua `<base>/config/diagnosticos/<id>`, que agora é o caminho de verdade;
   - convite e redefinição de senha: caminho relativo, montado pela origem em que o admin está;
   - OpenAPI e guia em PDF do Hub: o servidor vem da variável `MACUXI_API_URL_PUBLICA`, com a base da pergunta (a). Em seguida vêm `docs/openapi-hub-v1.json`, os exemplos e o kit-piloto;
   - `apk_url` do contrato antigo (apps v1.0.17 e v1.0.18): `urlApiPublicaDoAmbiente` passa a aceitar base com caminho, sempre `https` e sem `?`/`#`;
   - o rodapé do PDF (`site` dos dados legais, raiz `macuxifdv.com.br`) não muda;
   - os links do APK e do Conector são do S3 e não mudam.
8. **Apps Android: endereço fixo no build, troca só por APK novo.**
   - `EXPO_PUBLIC_API_URL` dos perfis de produção do `eas.json` passa à base nova + `/v1`. O comportamento do app não muda: sem campo Servidor, e o endereço salvo por versão antiga continua ignorado.
   - Os APKs já instalados continuam chamando `api.macuxifdv.com.br`, que precisa continuar respondendo (item 9 e pergunta b).
   - O fim da convivência depende de todo aparelho ativo estar na versão nova. A API registra a contagem por host e variante, sem dado pessoal, a partir do `Host` e da versão do app. Hoje o app não manda cabeçalho de versão (só `X-Macuxi-Tenant` e `X-Macuxi-Sync-Modo`): entra um `X-Macuxi-App: <variante>/<versão>` aditivo no APK da F3, e o APK antigo conta como "sem versão".
9. **Conector e ERPs.**
   - O `hub.url` de cada Conector instalado passa à base nova. É um arquivo de configuração no servidor do cliente, trocado na visita ou pelo suporte, sem versão nova do Conector.
   - O kit-piloto e os exemplos saem já com a base nova.
   - ERP que chama o Hub direto: o mesmo, pela documentação.
   - A busca na API do ERP pelo worker (ADR 0066) é de saída e não depende do endereço.
   - O ERP do dono do produto (`erp.`) é mais um cliente do Hub, de servidor para servidor, na base nova.
   - O Hub registra a contagem por host e por `conector_id`, para saber quem falta migrar.
10. **Ordem de migração** (cada fase é uma versão, e nenhuma quebra a anterior):
    1. **F1 — host novo ao lado dos antigos:**
       - o DNS e a regra do túnel para `fdv.`;
       - a API aceita o prefixo (se a resposta de (a) for `/api`) e a lista de hosts do Next ganha `fdv.`;
       - o portal passa a ser por caminho em `fdv.`, sem mudar `bko.` e `config.`;
       - o cookie grava o nome novo e lê os dois;
       - teste de fumaça nos dois hosts.
    2. **F2 — o web passa a ser `fdv.`:**
       - `MACUXI_BKO_ORIGEM`, as variáveis de e-mail e de diagnóstico, e os servidores do OpenAPI e do guia;
       - as conferências do `producao-publicar.yml` e do `producao-diagnostico-outbox.yml` passam a cobrir `fdv.` e continuam nos antigos;
       - `bko.` e `config.` começam a redirecionar as páginas (pergunta b).
    3. **F3 — apps:**
       - APK novo com a base nova;
       - os apps antigos seguem pelo `api.` sem redirecionamento.
    4. **F4 — Conectores e ERPs:**
       - troca do `hub.url` cliente a cliente, acompanhada pela contagem do Hub;
       - o kit-piloto e os exemplos novos.
    5. **F5 — desligamento:**
       - os hosts antigos saem do túnel quando os critérios da pergunta (b) forem cumpridos;
       - saem os hosts antigos de `HOSTS_DO_BKO_PADRAO`, a leitura do cookie antigo e a reescrita do `config.`;
       - o doc 04 e o kit são atualizados.
11. **Testes:**
    - **Unidade:**
      - `portal.ts` e `proxy.ts` por caminho em `fdv.`, mais o legado em `config.`;
      - o redirecionamento dos hosts antigos: o caminho é preservado, a query também (menos o token do convite em log), e `/api-proxy` e `/_next` não são redirecionados;
      - o `rewriteUrl` do prefixo `/api`: `/api-proxy` não casa, `/apix` não casa e `/api` sozinho casa;
      - `urlApiPublicaDoAmbiente` com caminho;
      - o cookie: nome novo, leitura dos dois nomes, recusa de cookie duplicado;
      - prefixos reservados contra os manifestos;
      - `hub.url` com caminho no Conector.
    - **Integração (sessão):**
      - API com e sem prefixo no mesmo processo;
      - login no BKO pelo `/api-proxy` com o cookie novo;
      - portal e BKO na mesma origem com sessões que não se misturam.
    - **E2E (`apps/web/e2e`)** com o host `fdv.localhost`.
    - **Fumaça de produção:** `/v1/saude` pela base nova e pelo `api.`, `/bko`, `/login`, `/config/entrar`, redirecionamento 30x de `bko./x` e `config./x`, e o Conector de homologação apontado para a base nova.
    - **APK:** um APK v1.0.29 instalado continua sincronizando depois da F2 e da F3.

## Perguntas abertas (o dono do produto decide; nada aqui está decidido)
### (a) Onde fica a API
| Opção | A favor | Contra |
|---|---|---|
| **A1. `fdv.macuxifdv.com.br/api`** (`/api/v1/...`, `/api/integracao/v1/...`) | Um host e um certificado. É simétrico ao `erp.../api`. Sem custo novo. Usa a regra de caminho no túnel. | O túnel não tira o prefixo, então a API precisa do `rewriteUrl` e o `urlApiPublicaDoAmbiente` precisa mudar. A API divide o host com o BKO: um erro de regra no túnel derruba os dois, e o limite de requisições da Cloudflare passa a ser contado junto. O Conector e os exemplos passam a ter base com caminho (já suportado). |
| **A2. `api.fdv.macuxifdv.com.br`** | A API fica isolada (regras de cache, WAF e limite próprios). A base não tem caminho, e nada muda na API. | Segundo nível: o Universal SSL não cobre. Exige o Advanced Certificate Manager (pago, por mês) ou um certificado próprio no túnel. Não é simétrico ao "tudo por caminho" pedido. |
| A3. Manter `api.macuxifdv.com.br` e mover só o web | Zero mudança nos apps, no Conector e nos ERPs | Não segue a decisão ("tudo a partir de `fdv.`") e deixa o `api.` ambíguo com o ERP |

**Recomendação: A1 (`fdv.macuxifdv.com.br/api`).** Segue a decisão ao pé da letra, não tem custo de certificado e o código aguenta com duas mudanças pequenas e testáveis (o prefixo na API e a base com caminho). O risco do host dividido se cobre com uma conferência de cada regra do túnel no `producao-publicar.yml`.

### (b) Redirecionamento dos endereços antigos
O redirecionamento só serve ao navegador. A API e o Hub antigos (`api.`) não podem redirecionar (fato 6): os APKs e os Conectores instalados perderiam o `Authorization`.

| Opção | Como fica |
|---|---|
| **B1. Páginas com 307 por 2 semanas e depois 308, por 90 dias; `api.` como apelido sem redirecionar até o fim da migração** | `bko./x` → `fdv./x` (a raiz vai para `/bko`) e `config./x` → `fdv./config/x`. `/api-proxy/*` e `/_next/*` nos hosts antigos são servidos, não redirecionados: abas abertas não quebram no meio de uma chamada. O `api.` responde igual ao novo até os critérios: nenhum acesso de app ou Conector pelo `api.` por 30 dias seguidos e versão mínima do app com a base nova. Mínimo de 180 dias. Os APKs antigos continuam funcionando durante todo esse prazo. |
| B2. 301 já na F2, sem prazo de teste | O navegador guarda o 301 para sempre: se algo der errado, a volta é difícil. 301 em POST vira GET. A API continua igual ao B1. |
| B3. Corte seco numa data, sem convivência | Simples, mas derruba os apps e os Conectores que não foram atualizados. Não recomendado. |

**Recomendação: B1.**
- Começar com 307, que não fica guardado no navegador, permite voltar atrás nas primeiras semanas. O 308 depois é permanente e preserva o método.
- Entre 301 e 308, o 308: não troca POST por GET.
- O redirecionamento é feito no código (`proxy.ts` para `bko.` e `config.`), testado e versionado, e não por regra no painel.
- Prazo do web: 90 dias com 308. Depois disso os hosts antigos de página podem sair do túnel ou virar uma regra de redirecionamento da Cloudflare, à escolha do dono do produto.
- `api.`: sem prazo fixo, pelos critérios de uso. **Os APKs antigos continuam funcionando** até o desligamento, que só acontece com o dono do produto vendo a contagem zerada.

## Alternativas
- **Um subdomínio por superfície, como hoje** (`bko.`, `config.`, `api.`). Não atende à decisão e colidiria com o ERP nos mesmos nomes.
- **Caddy ou nginx na VM para o roteamento por caminho.** Daria o Caddyfile versionado, mas é uma peça nova na produção sem necessidade: o túnel já roteia por caminho, e o redirecionamento cabe no `proxy.ts` e na API, com teste. Revisitar se as regras passarem de três.
- **`basePath` `/bko` no Next, com o portal numa segunda imagem de `basePath` `/config`.** Duas imagens do mesmo app, o dobro de build e de memória na VM, e as páginas dos módulos iriam para `/bko/catalogo`, o que não é o pedido.
- **Cookie `__Host-fdv_rt` com `Path=/`.** Imune a cookie injetado por outro subdomínio, mas manda o token de renovação em toda requisição de página e de arquivo. Fica a recusa de cookie duplicado, mais o `Path` restrito.
- **Redirecionar o `api.` com 308.** O método se preserva, mas o OkHttp e o undici tiram o `Authorization` quando muda o host, e os apps e os Conectores instalados param.

## Consequências
- Com o mesmo host para o BKO e o portal, a barreira de origem entre o super-admin e o tenant some. Ela é compensada pela CSP, pelo Access e pelo storage com prefixo (item 5). O `testes` faz o ensaio de XSS no portal.
- Quem está logado no BKO ou no portal entra de novo uma vez, no host novo.
- O doc 04 ("Domínio e endereços") é reescrito pelo dono dele quando a ADR for aceita.
- O kit-piloto, os exemplos e o guia em PDF saem com versão nova.
- A convivência custa duas regras a mais no túnel e uma lista de hosts legados no código, removidas na F5.

### Esforço estimado da implementação, por dono (dias de sessão)
| Dono | O que faz | Esforço |
|---|---|---|
| engenheiro-software | prefixo `/api` na API (`rewriteUrl`), `urlApiPublicaDoAmbiente` com caminho, cookie novo com leitura dos dois nomes e recusa de duplicado (SDK), contagem por host, workflows de produção (conferências e `MACUXI_BKO_ORIGEM`), compose e `env.modelo`, teste dos prefixos reservados, revisão final | 2,5 |
| engenheiro-apps | `apps/web`: hosts, `proxy.ts` e `portal.ts` por caminho, `/` e `/bko`, convite relativo, redirecionamento 307/308 dos hosts antigos, CSP do `/config`, e2e com `fdv.localhost`; `apps/mobile`: `eas.json` e o APK novo | 3 |
| modulo-integracao | `hub.url` e testes do Conector com base com caminho; servidor do OpenAPI e do guia em PDF; `openapi-hub-v1.json`, exemplos C#/Python/Node/Postman/Insomnia e kit-piloto; contagem por `conector_id` no Hub | 1,5 |
| modulo-core | rota de diagnóstico e links de convite e redefinição, se algum montar o host no servidor (conferir na F1) | 0,5 |
| testes | roteiro de fumaça dos dois hosts, ensaio de XSS no portal, APK antigo × novo, Conector de homologação | 1,5 |
| gerente-projetos | doc 04, quadro, tarefas e recado ao dono do ERP sobre a convenção de cookies | 0,5 |
| dono do produto | DNS e túnel (regras do `fdv.`), Access em `/config`, CORS do bucket, `.env` da VM, `hub.url` nos clientes, decisão de (a) e (b) e o fim da convivência | fora da conta |

Total do time: cerca de 9,5 dias de sessão, em 3 ou 4 versões (F1 a F4), mais o prazo de convivência até a F5.

## Riscos
| Risco | Mitigação |
|---|---|
| A regra `^/api` pega o `/api-proxy` e quebra o BKO | A regra é `^/api(/|$)`, com teste no `rewriteUrl`; a fumaça da F1 confere `/api-proxy/...` em `fdv.` |
| Ordem errada das regras no túnel (o "resto" antes do `/api`) | Conferência de `/api/v1/saude` e de `/bko` no `producao-publicar.yml` a cada versão |
| XSS no BKO alcança o token do super-admin (mesma origem) | CSP no `/config`, Access, storage com prefixo e ensaio do `testes` (item 5) |
| Cookie injetado por `erp.` ou outro subdomínio | Recusa de cookie duplicado, nomes distintos e convenção do ERP |
| APK antigo sem rede para o host novo | O `api.` continua como apelido, sem redirecionamento, até a contagem zerar |
| Conector de cliente esquecido no endereço antigo | Contagem por `conector_id`; o `api.` só sai com zero por 30 dias |
| 301 guardado no navegador impede voltar atrás | Começar com 307; o 308 só depois de 2 semanas estáveis |
| Módulo novo com rota que colide com um prefixo reservado | Teste do SDK contra os manifestos |
| Certificado de segundo nível, se a resposta de (a) for `api.fdv` | Advanced Certificate Manager contratado antes da F1, ou A1 |
| Link de e-mail antigo (convite em trânsito) para `bko.` | O redirecionamento preserva caminho e query; se o link vencer, o admin reenvia o convite pelo BKO |
