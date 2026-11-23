# ADR 0068 — Endereços por caminho em `fdv.macuxifdv.com.br`

- **Status**: proposta em 2026-11-23. Ainda falta o aceite da ADR inteira pelo dono do produto.
- **Data**: 2026-11-23 (Manaus)
- **Tarefa**: a definir pelo gerente-projetos. Entra na esteira depois da v1.0.28 e da v1.0.29.
- **Autor**: engenheiro-software
- **Origem**:
  - decisão do dono do produto no chat de 23/11/2026, repassada pelo gerente-projetos. Texto literal: "vamos mudar os endereços do macuxifdv. será fdv.macuxifdv.com.br e a partir dele terá o fdv.macuxifdv.com.br/config /bko /catalogo e etc. essa mudança se dá porque agora tenho o erp e ele usará o endereço erp.macuxifdv.com.br/config /bko e etc";
  - respostas do dono do produto às perguntas (a) e (b) da 1ª versão desta ADR, dadas pelo Agente PO em 23/11/2026 às 14h23 (Manaus), em recado gravado e repassado pelo gerente-projetos (decisões 1 e 2 abaixo).
- **Revê**:
  - a seção "Domínio e endereços" do doc 04;
  - a lista de rotas do túnel da ADR 0028;
  - o item 7 da ADR 0029 (portal só no host `config.`);
  - o nome do cookie da ADR 0038.

  A base do `apk_url` da ADR 0065 não muda.

## Contexto
O Macuxi usa hoje um subdomínio por superfície. O dono do produto vai ter um ERP próprio no mesmo domínio, em `erp.macuxifdv.com.br`, com os caminhos `/config`, `/bko` e outros. Para os dois produtos ficarem simétricos, as superfícies web do FDV passam a um host só, `fdv.macuxifdv.com.br`, separadas por caminho.

### Hosts que existem hoje (levantamento de 23/11/2026 no `origin/main`)
| Host | Serve | Onde aparece | Nesta ADR |
|---|---|---|---|
| `api.macuxifdv.com.br` | API (`/v1/...`) e Hub (`/integracao/v1/...`), túnel `macuxi-prod` → `api:8100` | `apps/mobile/eas.json`; `apps/api/src/app-versao.ts` (`apk_url` antigo); OpenAPI, guia em PDF, exemplos e kit-piloto do Hub; `hub.url` dos Conectores; conferências dos workflows de produção | **não muda** (decisão 1) |
| `bko.macuxifdv.com.br` | BKO (`apps/web`), túnel → `bko:3100` | `apps/web/next.config.ts` (`HOSTS_DO_BKO_PADRAO`); `apps/web/Dockerfile` e `producao-publicar.yml` (`MACUXI_BKO_ORIGEM`, gravada no `next build`; `environment.url`; conferência `/login`); `MACUXI_EMAIL_URL_BKO` (botão "Abrir o backoffice" dos e-mails `acesso_inicial` e `nova_senha`, no `.env` da VM); comentário do `scripts/deploy/producao/compose.yml` | vira `fdv.../bko` e é desligado no corte |
| `config.macuxifdv.com.br` | Portal de implantação, o mesmo serviço `bko:3100`; o `proxy.ts` reescreve `/x` para `/config/x` pelo Host | `apps/web/lib/portal.ts` e `proxy.ts`; `apps/api/src/diagnosticos-worker.ts` (`URL_PORTAL_PADRAO`, link do recado de diagnóstico; `MACUXI_DIAGNOSTICOS_PORTAL_URL`); `modules/integracao/api/openapi/guia-pdf.ts:483` (texto do guia em PDF: "abre o portal de configuração (`config.macuxifdv.com.br`)"); `producao-publicar.yml` | vira `fdv.../config` e é desligado no corte |
| `app.macuxifdv.com.br` | nada; reservado no doc 04 e nunca criado | doc 04, `scripts/demo/LEIA-ME.md` | sai da reserva |
| `api-demo.`, `bko-demo.`, `config-demo.` | demo, desligada pela ADR 0051 | `scripts/demo/*`, `scripts/deploy/demo/*`, `tests/*demo*` | fora |
| `api-hml.`, `bko-hml.`, `config-dev.` | nunca existiram; só exemplos | `docs/testes/T-0074.md`, testes de `portal.ts` | fora |
| `macuxifdv.com.br` (raiz e `www`) | site e portal de compras, fora deste projeto; remetente `nao-responda@`; `site` dos dados legais (rodapé do PDF) | | não muda |

Fora do domínio, também não mudam:
- os links assinados do S3 da Magalu (APK, Conector, fotos e ZIP; ADRs 0037, 0058 e 0065);
- o `trycloudflare.com` do desenvolvimento.

### Fatos técnicos que pesam na decisão
1. **TLS.** O DNS e o TLS ficam na Cloudflare, com túnel e sem porta aberta (ADR 0028). O Universal SSL cobre `*.macuxifdv.com.br`, um nível só, então `fdv.` e `erp.` já estão cobertos.
2. **Um app web só.** O BKO e o portal são o mesmo Next (`apps/web`), com o portal na rota `/config`, que hoje responde 404 fora do host `config.`. As páginas dos módulos já ficam na raiz: `/catalogo/...`, `/vendedor/...` (`app/(bko)/[...caminho]`). O `fdv.../catalogo` da decisão é a página do Catálogo no BKO.
3. **Sem CORS.** O navegador só fala com a própria origem pelo `/api-proxy`. O rewrite do Next chama a API pela rede interna do Compose (desenho T-0038 §3), e a API não tem CORS.
4. **Cookie de sessão do BKO** (ADR 0038):
   - nome `__Secure-macuxi_rt`, host-only (sem `Domain`);
   - `Path=/api-proxy/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`;
   - o cabeçalho `X-Macuxi-CSRF: 1` protege contra CSRF.

   O portal guarda o token do super-admin só no `sessionStorage`, hoje na origem `config.`, separada da do BKO.
5. **E-mails.** Os modelos `acesso_inicial` e `nova_senha` levam o código da empresa, o e-mail, a senha temporária e o botão "Abrir o backoffice" (`MACUXI_EMAIL_URL_BKO`). O despachante do worker monta o e-mail na hora do envio (`renderizarEmail` em `despachante.ts`). Por isso, o que estiver pendente na outbox no corte já sai com o endereço novo. Os que já foram entregues ficam com o botão para `bko.`.
6. **Os apps Android e o Conector só falam com `api.`.** O endereço fica gravado no APK (`EXPO_PUBLIC_API_URL`) e no `hub.url`. Nenhum dos dois usa `bko.` nem `config.`.

## Decisão
1. **A API continua em `api.macuxifdv.com.br`** (dono do produto, pelo PO, 23/11/2026 14h23). `/v1` e `/integracao/v1` não mudam de host nem de caminho. Ficam iguais:
   - o túnel `api.` → `api:8100`;
   - `URL_API_PUBLICA_PADRAO` e o `apk_url` antigo;
   - o `eas.json`;
   - o `hub.url` dos Conectores;
   - OpenAPI e exemplos.

   **Os APKs instalados e os Conectores seguem funcionando sem nenhuma troca.** O ERP do dono do produto (`erp.`) integra pelo Hub em `api.`, de servidor para servidor.
2. **Os endereços antigos não redirecionam: `bko.` e `config.` são desligados direto, na troca** (dono do produto, pelo PO, 23/11/2026 14h23). Não há convivência, 307, 308 nem lista de hosts legados no código.
3. **Mapa de caminhos do host `fdv.macuxifdv.com.br`**, todo para `bko:3100`:

   | Caminho | O que é | Hoje em |
   |---|---|---|
   | `/` | redireciona (307, dentro do host) para `/bko` | `bko./` |
   | `/bko` | página inicial do BKO (a atual `app/(bko)/page.tsx`) | `bko./` |
   | `/login` | entrada do BKO | `bko./login` |
   | `/<modulo>/...` (`/catalogo`, `/vendedor`...), `/parametros`, `/auditoria` | páginas do BKO, como hoje | `bko./<modulo>/...` |
   | `/config`, `/config/...` | portal de implantação, pela rota que já existe, sem reescrita por host | `config./...` |
   | `/convite`, `/convite/<token>` | página dos links antigos de convite (`aviso-link-antigo.tsx`), como hoje | `bko./convite...` |
   | `/api-proxy/...` | rewrite do Next para `api:8100` (inalterado) | `bko./api-proxy/...` |
   | `/_next/...`, `/favicon.ico` | arquivos do Next | igual |

   **Prefixos reservados na raiz:** `api-proxy`, `bko`, `config`, `login`, `convite`, `_next`, `parametros`, `auditoria` e `.well-known`. Nenhum módulo pode ter id ou rota de BKO com esses nomes, e um teste do SDK confere isso contra os manifestos.
4. **DNS e TLS.**
   - Um host público `fdv` no túnel `macuxi-prod` → `http://bko:3100`. A Cloudflare cria o CNAME com proxy. O certificado é o Universal SSL que já existe.
   - HSTS no host `fdv.`, sem `includeSubDomains` na raiz: a raiz é do site, fora deste projeto.
   - O Cloudflare Access recomendado para o portal (ADR 0029 §7) passa a ser uma aplicação por caminho, `fdv.macuxifdv.com.br/config`.
   - Não entra Caddy nem nginx: o túnel tem uma regra só por host.
5. **Next (`apps/web`): sem `basePath` e sem `assetPrefix`.**
   - O `basePath` é um por build e separaria o BKO do portal em duas imagens. As rotas da decisão já existem.
   - Os `/_next` ficam na raiz do `fdv.`. Não colidem com o ERP, que tem outro host.
   - `HOSTS_DO_BKO_PADRAO` passa a `['fdv.macuxifdv.com.br']`. O `MACUXI_BKO_ORIGEM` do `Dockerfile` e do `producao-publicar.yml` passa a `https://fdv.macuxifdv.com.br`.
   - O `proxy.ts` deixa de olhar o Host para o portal. Saem `PREFIXOS_DO_PORTAL`, `destinoNoPortal` e `bloqueadoForaDoPortal`.
   - Os cabeçalhos do portal (`x-robots-tag: noindex, nofollow`, `cache-control: no-store`) passam a ser por caminho (`/config/*`).
   - Um web novo que nascer separado (outro serviço) recebe `basePath` `/<nome>`, uma regra de caminho no túnel e um prefixo reservado no item 3.
6. **Cookies e storage.**
   - **Cookie de sessão do BKO:**
     - nome `__Secure-fdv_rt` (no PC, `fdv_rt`), em vez de `__Secure-macuxi_rt`;
     - continua host-only (sem `Domain`), com `Path=/api-proxy/auth`, `HttpOnly`, `Secure` e `SameSite=Strict`.

     Sem convivência, a API não lê o nome antigo. O cookie antigo morre com o host `bko.`, e todos entram de novo uma vez.
   - **Contra cookie injetado por outro subdomínio:**
     - `fdv.` e `erp.` são o mesmo *site*, então o `SameSite` não separa os dois. Um subdomínio comprometido pode gravar `Domain=.macuxifdv.com.br` com o mesmo nome.
     - A rota de sessão recusa (401, e apaga) quando o `Cookie` traz mais de um `fdv_rt`.
   - **Convenção para o ERP** (sem código aqui, recado ao dono do ERP):
     - cookies host-only, sem `Domain=.macuxifdv.com.br`;
     - nomes com prefixo `erp_`;
     - nada no storage com chave `macuxi.*` ou `fdv.*`.
   - **Portal e BKO na mesma origem.** Um XSS em qualquer página do `fdv.` passa a alcançar o token do super-admin, que antes ficava em outra origem. Compensações:
     - CSP estrita nas páginas `/config/*` (`script-src 'self'`, sem `unsafe-eval`; `frame-ancestors 'none'`);
     - as páginas do portal não carregam extensão de módulo (já é assim);
     - chaves de storage do portal com prefixo próprio, limpas no "Sair";
     - Access no caminho `/config` (item 4).
7. **CORS: continua sem.**
   - O BKO e o portal falam com a API pela própria origem (`/api-proxy`).
   - O app e o Conector não são navegador.
   - O ERP integra de servidor para servidor.
   - **Bucket:** se o PUT assinado do ZIP estiver ligado (`MACUXI_ENVIO_URL_ASSINADA=1`, ADR 0058), o CORS do bucket troca `https://bko.macuxifdv.com.br` por `https://fdv.macuxifdv.com.br`. Desligado, como é o padrão, nada muda.
8. **Links em e-mail, PDF e convite:**
   - **E-mail:**
     - `MACUXI_EMAIL_URL_BKO=https://fdv.macuxifdv.com.br/bko`;
     - `MACUXI_EMAIL_URL_ATIVOS` passa a uma base que não morre no corte. Se hoje os PNG do logo estão em `bko.` ou `config.`, vão para `fdv.` ou para o bucket público.
   - **Diagnóstico:** `URL_PORTAL_PADRAO` e `MACUXI_DIAGNOSTICOS_PORTAL_URL` = `https://fdv.macuxifdv.com.br`. O link do recado continua `<base>/config/diagnosticos/<id>`, que agora é o caminho de verdade.
   - **PDF:** o texto do guia da API do Hub (`guia-pdf.ts:483`) passa a "`fdv.macuxifdv.com.br/config`". O `guia-api-hub.pdf` e o `.sha256` são gerados de novo. O servidor do guia e do OpenAPI continua `api.`. O rodapé dos PDFs de pedido e NF (`site` = raiz) não muda.
   - **Convite:** o link antigo `/convite/<token>` só mostra um aviso desde a T-0094 e vale igual em `fdv.`. O acesso de hoje é por e-mail com senha temporária (item 5 do Contexto).
   - **APK e Conector:** links do S3, sem mudança.

## O corte (bko. e config. desligados no mesmo deploy)
### O que precisa estar pronto antes
1. **No código, numa versão só (vX)** com o item 5:
   - `MACUXI_BKO_ORIGEM` e `HOSTS_DO_BKO_PADRAO` só com `fdv.`;
   - o cookie novo;
   - os padrões do diagnóstico;
   - o texto e o PDF do guia;
   - as conferências do `producao-publicar.yml`: `fdv.../login` e `fdv.../config/entrar` obrigatórios, `api.../v1/saude` igual, sem `bko.` nem `config.`;
   - o `environment.url` do workflow passa a `https://fdv.macuxifdv.com.br/bko`.
2. **Na Cloudflare, antes do deploy** (dono do produto):
   - o host público `fdv.` → `http://bko:3100` no túnel `macuxi-prod`. Criar antes é inofensivo: na imagem antiga, o `fdv.` mostra o BKO e o `/config` responde 404;
   - a aplicação do Access em `fdv.macuxifdv.com.br/config`, se ele usar Access no `config.`.
3. **Na VM, no mesmo deploy:** `MACUXI_EMAIL_URL_BKO`, `MACUXI_EMAIL_URL_ATIVOS` e `MACUXI_DIAGNOSTICOS_PORTAL_URL` (variáveis do ambiente, ao lado do `email.env`). A api e o worker sobem com elas.
4. **Aviso aos administradores das empresas, antes do corte:** a data e o endereço novo, pelo canal que o dono do produto escolher. Como não há redirecionamento, o favorito antigo para de abrir.

### Ordem do corte, no mesmo deploy (horário de pouco uso, em Manaus)
1. `producao-publicar.yml` da vX com "aprovo deploy vX": imagens novas, api, worker e bko.
2. As conferências do workflow passam em `fdv.` e em `api.`. Se falharem, volta-se a imagem anterior, com `bko.` e `config.` ainda no túnel.
3. O dono do produto remove os hosts públicos `bko.` e `config.` do túnel. A Cloudflare apaga os CNAMEs e o DNS deixa de responder. A partir daqui, o host antigo não abre.
4. Conferência manual:
   - login no BKO e no portal em `fdv.`;
   - um e-mail de `nova_senha` de teste com o botão para `fdv.../bko`;
   - um recado de diagnóstico com o link novo;
   - `bko.` e `config.` sem resposta.
5. O CORS do bucket, se o item 7 se aplicar.

Os apps e os Conectores não percebem o corte: só falam com `api.`.

### Link antigo em e-mail já enviado
Os e-mails `acesso_inicial` e `nova_senha` entregues antes do corte têm o botão para `bko.`, que deixa de abrir.

**O que continua valendo:** o e-mail também traz o código da empresa, o e-mail e a senha temporária, que seguem válidos em `fdv.`. A temporária vence em 72 h (`VALIDADE_SENHA_PROVISORIA_HORAS`), e a do acesso inicial pode não vencer.

**Mitigação:**
1. O aviso do item 4 de "antes".
2. Corte fora do horário de uso.
3. Para quem ainda não entrou, o admin da empresa (ou o super-admin, no portal) gera nova senha depois do corte: o e-mail novo já sai com `fdv.`.
4. A outbox pendente no corte já sai com o endereço novo, porque o e-mail é montado no despacho.
5. O suporte orienta quem chegar pelo link antigo.

O dono do produto pode pôr, no lugar dos hosts antigos, uma página estática "o endereço mudou para fdv.macuxifdv.com.br" (Cloudflare, sem redirecionamento). Não é o padrão desta ADR, que segue a decisão 2.

### Versões
Com a API fora da mudança, saem:
- a F3 (APK novo), porque o APK não muda;
- a F4 (Conectores e ERPs), porque o `hub.url` não muda;
- a F5 (desligamento depois da convivência), porque não há convivência.

A F1 (host novo ao lado) e a F2 (web passa a `fdv.`) viram uma versão só, com o corte no mesmo deploy. **De 4 versões mais a convivência, cai para 1 versão.** O aviso aos administradores não precisa de versão: sai por canal do dono do produto.

## Testes
- **Unidade:**
  - `proxy.ts` e `portal.ts` por caminho: `/config` liberado e com os cabeçalhos do portal em `fdv.`, `/` → `/bko`, nenhum comportamento por Host;
  - `HOSTS_DO_BKO_PADRAO` só com `fdv.`;
  - o cookie com o nome novo e a recusa de cookie duplicado;
  - prefixos reservados contra os manifestos;
  - padrão do link de diagnóstico;
  - texto do guia em PDF.
- **Integração (sessão):** login no BKO pelo `/api-proxy` com o cookie novo; portal e BKO na mesma origem com sessões que não se misturam.
- **E2E (`apps/web/e2e`)** com o host `fdv.localhost`: BKO e portal, sem 404 em `/config`.
- **Ensaio de segurança:** XSS no portal na mesma origem (CSP do `/config`).
- **Fumaça do corte:** o roteiro do item 4 da ordem do corte, mais um APK v1.0.29 e um Conector de homologação sincronizando antes e depois do corte, sem nenhuma troca.

## Alternativas
- **API em `fdv.../api` ou em `api.fdv.`** (perguntas da 1ª versão). Recusadas pela decisão 1: o `/api` exigia prefixo na API e APK novo; o `api.fdv.` exigia certificado pago. Os dois exigiam a troca dos Conectores.
- **Redirecionar `bko.` e `config.` com 307 e depois 308, com convivência** (recomendação da 1ª versão). Recusada pela decisão 2.
- **Caddy ou nginx na VM.** Sem necessidade: uma regra por host no túnel.
- **`basePath` `/bko`, com o portal numa 2ª imagem de `basePath` `/config`.** Duas imagens do mesmo app, e os módulos iriam para `/bko/catalogo`, o que não é o pedido.
- **Cookie `__Host-fdv_rt` com `Path=/`.** Imune a cookie injetado, mas manda o token de renovação em toda requisição de página. Fica a recusa de duplicado, mais o `Path` restrito.

## Consequências
- Com o mesmo host para o BKO e o portal, a barreira de origem entre o super-admin e o tenant some. Ela é compensada pela CSP, pelo Access e pelo storage com prefixo (item 6).
- Todos que usam o BKO ou o portal entram de novo uma vez, em `fdv.`. Favoritos e e-mails antigos com `bko.` e `config.` param de abrir.
- O doc 04 ("Domínio e endereços") é reescrito pelo dono dele quando a ADR for aceita: `fdv.` para o web e `api.` para a API, e sai a reserva do `app.`.
- O kit-piloto e os exemplos do Hub não mudam. Só o guia em PDF sai com versão nova (texto do portal).

### Esforço estimado da implementação, por dono (dias de sessão)
| Dono | O que faz | Esforço |
|---|---|---|
| engenheiro-software | cookie novo e recusa de duplicado (SDK e API); padrão do diagnóstico; `producao-publicar.yml` (`MACUXI_BKO_ORIGEM`, `environment.url`, conferências em `fdv.`); comentários do `compose.yml` e o `env.modelo` com as URLs de e-mail e diagnóstico; teste dos prefixos reservados; revisão final | 1,5 |
| engenheiro-apps | `apps/web`: `HOSTS_DO_BKO_PADRAO`, `Dockerfile`, `proxy.ts` e `portal.ts` por caminho, `/` → `/bko`, cabeçalhos e CSP do `/config`, e2e com `fdv.localhost`. Nada no `apps/mobile`. | 2 |
| modulo-integracao | texto do guia (`guia-pdf.ts`), novo `guia-api-hub.pdf` e `.sha256` | 0,5 |
| designer-ux | `docs/design/telas/T-0158-diagnosticos-portal.html` e as specs com o host antigo | 0,25 |
| testes | roteiro do corte, ensaio de XSS no portal, APK e Conector antes e depois | 1 |
| gerente-projetos | doc 04, quadro, tarefa, recado ao dono do ERP sobre a convenção de cookies | 0,5 |
| dono do produto | host `fdv.` no túnel, Access em `/config`, variáveis da VM, aviso aos administradores, remoção de `bko.` e `config.` no corte e, se for o caso, o CORS do bucket | fora da conta |

Total do time: cerca de 5,75 dias de sessão, numa versão só.

## Riscos
| Risco | Mitigação |
|---|---|
| Link antigo em e-mail já enviado (`bko.`) | As credenciais do e-mail seguem válidas em `fdv.`; aviso antes do corte, nova senha com o e-mail novo e suporte (seção do corte) |
| Favorito antigo para de abrir, sem redirecionamento | Aviso antes do corte, com a data |
| Corte com a imagem nova falhando | As conferências do workflow vêm antes da remoção de `bko.` e `config.` do túnel. Se falharem, volta-se a imagem anterior, com os hosts antigos ainda lá |
| Portal exposto sem Access entre o deploy e a configuração | A aplicação do Access em `fdv.../config` é criada antes do deploy (o caminho dá 404 na imagem antiga) |
| Logo do e-mail quebrado nos e-mails já entregues | `MACUXI_EMAIL_URL_ATIVOS` passa a uma base que não morre no corte, antes do deploy |
| XSS no BKO alcança o token do super-admin (mesma origem) | CSP no `/config`, Access, storage com prefixo e ensaio do `testes` |
| Cookie injetado por `erp.` ou outro subdomínio | Recusa de cookie duplicado, nomes distintos e convenção do ERP |
| Módulo novo com rota que colide com um prefixo reservado | Teste do SDK contra os manifestos |
