# ADR 0071 — Endereços por caminho em `fdv.macuxifdv.com.br`

- **Status**: aceita em 2026-11-24 (dono do produto, "1 A", pelo PO, ~5h30 de Manaus).
- **Data**: 2026-11-23 (Manaus); revista em 2026-11-24 com a decisão "1 A".
- **Tarefa**: v1.0.33.
- **Autor**: engenheiro-software
- **Origem**:
  - decisão do dono do produto no chat de 23/11/2026, repassada pelo gerente-projetos. Texto literal: "vamos mudar os endereços do macuxifdv. será fdv.macuxifdv.com.br e a partir dele terá o fdv.macuxifdv.com.br/config /bko /catalogo e etc. essa mudança se dá porque agora tenho o erp e ele usará o endereço erp.macuxifdv.com.br/config /bko e etc";
  - respostas do dono do produto às perguntas (a) e (b) da 1ª versão desta ADR, dadas pelo Agente PO em 23/11/2026 às 14h23 (Manaus), em recado gravado e repassado pelo gerente-projetos (decisão 1 abaixo);
  - decisão "1 A" do dono do produto, gravada pelo PO em 24/11/2026 ~5h30 (Manaus). Ela troca o "desligar direto, no mesmo deploy" da versão de 23/11 por convivência dos hosts até o corte (decisão 2).
- **Revê**:
  - a seção "Domínio e endereços" do doc 04;
  - a lista de rotas do túnel da ADR 0028;
  - o item 7 da ADR 0029 (portal só no host `config.`).

  A base do `apk_url` da ADR 0065 e o nome do cookie da ADR 0038 não mudam.
- **Número**: Nos recados de 23 e 24/11, esta decisão aparece como ADR 0068.

## Contexto
O Macuxi usa hoje um subdomínio por superfície. O dono do produto vai ter um ERP próprio no mesmo domínio, em `erp.macuxifdv.com.br`, com os caminhos `/config`, `/bko` e outros. Para os dois produtos ficarem simétricos, as superfícies web do FDV passam a um host só, `fdv.macuxifdv.com.br`, separadas por caminho.

### Hosts que existem hoje (levantamento de 23/11/2026 no `origin/main`)
| Host | Serve | Onde aparece | Nesta ADR |
|---|---|---|---|
| `api.macuxifdv.com.br` | API (`/v1/...`) e Hub (`/integracao/v1/...`), túnel `macuxi-prod` → `api:8100` | `apps/mobile/eas.json`; `apps/api/src/app-versao.ts` (`apk_url` antigo); OpenAPI, exemplos e kit-piloto do Hub; `hub.url` dos Conectores; conferências dos workflows de produção | **não muda** (decisão 1) |
| `bko.macuxifdv.com.br` | BKO (`apps/web`), túnel → `bko:3100` | `apps/web/next.config.ts` (`HOSTS_DO_BKO_PADRAO`); `apps/web/Dockerfile` e `producao-publicar.yml` (`MACUXI_BKO_ORIGEM`; `environment.url`; conferência `/login`); botão "Abrir o backoffice" dos e-mails `acesso_inicial` e `nova_senha` (`MACUXI_EMAIL_URL_BKO`); comentário do `scripts/deploy/producao/compose.yml` | convive com `fdv.` até o corte |
| `config.macuxifdv.com.br` | Portal de implantação, o mesmo serviço `bko:3100`; o `proxy.ts` reescreve `/x` para `/config/x` pelo Host | `apps/web/lib/portal.ts` e `proxy.ts`; `apps/api/src/diagnosticos-worker.ts` (`URL_PORTAL_PADRAO`, link do recado de diagnóstico; `MACUXI_DIAGNOSTICOS_PORTAL_URL`); texto do guia em PDF (`modules/integracao/api/openapi/guia-pdf.ts`); `producao-publicar.yml` | convive com `fdv.../config` até o corte |
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
   - nome `__Secure-macuxi_rt` (no PC, `macuxi_rt`), host-only (sem `Domain`);
   - `Path=/api-proxy/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`;
   - o cabeçalho `X-Macuxi-CSRF: 1` protege contra CSRF.

   Por ser host-only, o cookie gravado em `bko.` não vale em `fdv.`, e vice-versa. O portal guarda o token do super-admin só no `sessionStorage`, que também é por origem.
5. **E-mails.** Os modelos `acesso_inicial` e `nova_senha` levam o código da empresa, o e-mail, a senha temporária e o botão "Abrir o backoffice". O despachante do worker monta o e-mail na hora do envio (`renderizarEmail` em `despachante.ts`): o que estiver pendente na outbox quando a variável mudar já sai com o endereço novo.
6. **Os apps Android e o Conector só falam com `api.`.** O endereço fica gravado no APK (`EXPO_PUBLIC_API_URL`) e no `hub.url`. Nenhum dos dois usa `bko.` nem `config.`.
7. **O SDK está fora da v1.0.33.** O nome do cookie mora em `packages/platform-sdk` (`cookie-sessao.ts`), que não entra nesta versão.

## Decisão
1. **A API continua em `api.macuxifdv.com.br`** (dono do produto, pelo PO, 23/11/2026 14h23). `/v1` e `/integracao/v1` não mudam de host nem de caminho. Ficam iguais:
   - o túnel `api.` → `api:8100`;
   - `URL_API_PUBLICA_PADRAO` e o `apk_url` antigo;
   - o `eas.json`;
   - o `hub.url` dos Conectores;
   - OpenAPI e exemplos.

   **Os APKs instalados e os Conectores seguem funcionando sem nenhuma troca.** O ERP do dono do produto (`erp.`) integra pelo Hub em `api.`, de servidor para servidor.
2. **Convivência até o corte, sem redirecionamento** (dono do produto, "1 A", pelo PO, 24/11/2026 ~5h30).
   - A v1.0.33 funciona nos dois endereços ao mesmo tempo: o novo `fdv.macuxifdv.com.br` (`/bko`, `/config`, `/<área>`) e os antigos `bko.` e `config.`.
   - Nenhum host redireciona para o outro: não há 307 nem 308 entre `bko.`/`config.` e `fdv.`.
   - Os antigos só são desligados **depois** que o dono do produto configurar o túnel e o Access do `fdv.` na Cloudflare. O corte é **passo de configuração, sem versão nova** (seção "O corte").
3. **Mapa de caminhos do host `fdv.macuxifdv.com.br`**, todo para `bko:3100`:

   | Caminho | O que é | Nos hosts antigos |
   |---|---|---|
   | `/` | redireciona (307, dentro do host) para `/bko` | `bko./` |
   | `/bko` | página inicial do BKO (a atual `app/(bko)/page.tsx`) | `bko./` |
   | `/login` | entrada do BKO | `bko./login` |
   | `/<modulo>/...` (`/catalogo`, `/vendedor`...), `/parametros`, `/auditoria` | páginas do BKO, como hoje | `bko./<modulo>/...` |
   | `/config`, `/config/...` | portal de implantação, pela rota que já existe, sem reescrita por host | `config./...` (reescrito como hoje) |
   | `/convite`, `/convite/<token>` | página dos links antigos de convite (`aviso-link-antigo.tsx`), como hoje | `bko./convite...` |
   | `/api-proxy/...` | rewrite do Next para `api:8100` (inalterado) | `bko./api-proxy/...` |
   | `/_next/...`, `/favicon.ico` | arquivos do Next | igual |

   **Prefixos reservados na raiz:** `api-proxy`, `bko`, `config`, `login`, `convite`, `_next`, `parametros`, `auditoria` e `.well-known`. Nenhum módulo pode ter id ou rota de BKO com esses nomes. O teste que confere isso contra os manifestos fica em `apps/web` (engenheiro-apps).
4. **DNS e TLS.**
   - Um host público `fdv` no túnel `macuxi-prod` → `http://bko:3100`. A Cloudflare cria o CNAME com proxy. O certificado é o Universal SSL que já existe.
   - HSTS no host `fdv.`, sem `includeSubDomains` na raiz: a raiz é do site, fora deste projeto.
   - O Cloudflare Access recomendado para o portal (ADR 0029 §7) passa a ser uma aplicação por caminho, `fdv.macuxifdv.com.br/config`, criada **antes** de o `fdv.` abrir.
   - Não entra Caddy nem nginx: o túnel tem uma regra só por host.
5. **Next (`apps/web`): sem `basePath` e sem `assetPrefix`; os três hosts sempre, sem ler variável.**
   - O `basePath` é um por build e separaria o BKO do portal em duas imagens. As rotas da decisão já existem.
   - Os `/_next` ficam na raiz do `fdv.`. Não colidem com o ERP, que tem outro host.
   - O web aceita `fdv.`, `bko.` e `config.` em toda versão, sem ler a `MACUXI_HOSTS_ANTIGOS`. No `config.`, o portal segue reescrito pelo Host, como hoje. No `fdv.`, o portal fica em `/config`, por caminho, e `/` responde 307 para `/bko`. No `bko.`, nada muda.
   - O `MACUXI_BKO_ORIGEM` do `Dockerfile` e do `producao-publicar.yml` passa a `https://fdv.macuxifdv.com.br`.
   - Os cabeçalhos do portal (`x-robots-tag: noindex, nofollow`, `cache-control: no-store`) valem no `config.` e em `fdv.../config/*`.
   - Um web novo que nascer separado (outro serviço) recebe `basePath` `/<nome>`, uma regra de caminho no túnel e um prefixo reservado no item 3.
   - A limpeza do código dos hosts antigos (`config.` no `proxy.ts`, `bko.` nas listas) fica para uma versão posterior: com os hosts fora do túnel, o código não é mais alcançado.
6. **Cookies e storage.**
   - **Cookie de sessão do BKO: o nome não muda na v1.0.33.** Fica `__Secure-macuxi_rt` (no PC, `macuxi_rt`), host-only (sem `Domain`), com `Path=/api-proxy/auth`, `HttpOnly`, `Secure` e `SameSite=Strict`. O SDK, onde o nome mora, está fora desta versão (fato 7). Como o cookie é host-only, quem passa de `bko.` para `fdv.` entra de novo uma vez; as duas sessões não se misturam.
   - **Contra cookie injetado por outro subdomínio:**
     - `fdv.` e `erp.` são o mesmo *site*, então o `SameSite` não separa os dois. Um subdomínio comprometido pode gravar `Domain=.macuxifdv.com.br` com o mesmo nome.
     - **As rotas de sessão do BKO (`renovar` e `encerrar`) recusam com 401 `SESSAO_INVALIDA`, e apagam o cookie, quando o `Cookie` traz mais de um cookie de sessão com o mesmo nome**, sem chamar o Core: a API não escolhe qual dos dois vale. Fica em `apps/api/src/sessao-web.ts`, com teste em `apps/api/test/sessao-web-cookie.test.ts`. O app Android (token no corpo) não é afetado.
     - O `Set-Cookie` que apaga é host-only: ele não remove o cookie gravado com `Domain=` por outro subdomínio. Enquanto o injetado existir, a renovação segue recusada e o usuário entra com senha; o injetado sozinho, sem o host-only ao lado, é um token que o Core valida como qualquer outro (não abre sessão sem um token válido).
     - A troca do nome (`__Secure-fdv_rt`) fica para uma versão que inclua o SDK, com ADR própria ou adendo a esta.
   - **Convenção para o ERP** (sem código aqui, recado ao dono do ERP pelo gerente-projetos):
     - cookies host-only, sem `Domain=.macuxifdv.com.br`;
     - nomes com prefixo `erp_`;
     - nada no storage com chave `macuxi.*` ou `fdv.*`.
   - **Portal e BKO na mesma origem (no `fdv.`).** Um XSS em qualquer página do `fdv.` passa a alcançar o token do super-admin, que no `config.` fica em outra origem. Compensações:
     - CSP estrita nas páginas `/config/*` (`script-src 'self'`, sem `unsafe-eval`; `frame-ancestors 'none'`);
     - as páginas do portal não carregam extensão de módulo (já é assim);
     - chaves de storage do portal com prefixo próprio, limpas no "Sair";
     - Access no caminho `/config` (item 4).
7. **CORS: continua sem.**
   - O BKO e o portal falam com a API pela própria origem (`/api-proxy`).
   - O app e o Conector não são navegador.
   - O ERP integra de servidor para servidor.
   - **Bucket:** se o PUT assinado do ZIP estiver ligado (`MACUXI_ENVIO_URL_ASSINADA=1`, ADR 0058), o CORS do bucket precisa aceitar `https://fdv.macuxifdv.com.br` (ao lado de `bko.` até o corte). Desligado, como é o padrão, nada muda.
8. **Links que o sistema gera: `MACUXI_HOSTS_ANTIGOS` (api e worker), padrão LIGADA.**
   - **Leitura** (`hostsAntigosLigados` em `apps/api/src/config.ts`, um lugar só): `0`, `false`, `nao` ou `não` desligam; ausente, vazia, `1`/`true`/`sim` ou qualquer outro valor deixam ligada. É o mesmo padrão do `MACUXI_SESSAO_COOKIE_SEGURO`: valor que não se entende fica no padrão, que é o que funciona antes do corte.
   - **Ligada** (até o corte):
     - botão do e-mail → `https://bko.macuxifdv.com.br`;
     - link do recado de diagnóstico → `https://config.macuxifdv.com.br/config/diagnosticos/<id>` (o `config.` reescreve para a rota do portal; já funciona hoje).
   - **Desligada** (no corte):
     - botão do e-mail → `https://fdv.macuxifdv.com.br/bko`;
     - diagnóstico → base `https://fdv.macuxifdv.com.br`, link `<base>/config/diagnosticos/<id>`, agora o caminho de verdade.
   - **Variáveis explícitas por cima:** `MACUXI_EMAIL_URL_BKO` e `MACUXI_DIAGNOSTICOS_PORTAL_URL`, se definidas, valem sobre a `MACUXI_HOSTS_ANTIGOS`, ligada ou desligada.
   - **Botão do e-mail sem `MACUXI_EMAIL_URL_BKO`:** passa a ter padrão derivado da variável, **só em produção** (`NODE_ENV=production`). Até a v1.0.32, sem a variável não havia botão; a produção não a define, então os e-mails da v1.0.33 ganham o botão para `bko.` (que funciona) e, no corte, para `fdv.../bko`. Fora de produção (PC, testes), sem a variável o e-mail segue sem botão, para um e-mail local nunca apontar para o BKO de produção.
   - **`MACUXI_EMAIL_URL_ATIVOS`** (logo do e-mail) passa a uma base que não morre no corte: `fdv.` ou o bucket público, nunca `bko.` nem `config.`.
   - **PDF:** o texto do guia da API do Hub (`guia-pdf.ts`) deixa de citar host nenhum para o portal ("portal de configuração"); o `guia-api-hub.pdf` e o `.sha256` são gerados de novo (modulo-integracao). O servidor do guia e do OpenAPI continua `api.`. O rodapé dos PDFs de pedido e NF (`site` = raiz) não muda.
   - **Convite:** o link antigo `/convite/<token>` só mostra um aviso desde a T-0094 e vale igual nos três hosts. O acesso de hoje é por e-mail com senha temporária (fato 5).
   - **APK e Conector:** links do S3, sem mudança.

## O corte
A v1.0.33 sobe com os três hosts no ar e a `MACUXI_HOSTS_ANTIGOS` ligada. O corte acontece quando o dono do produto decidir.

O `producao-publicar.yml` da v1.0.33 aceita os dois estados, antes e depois do corte:
- `api.macuxifdv.com.br/v1/saude` com a versão da tag continua obrigatório;
- o BKO passa se `fdv.../login` **ou** `bko.../login` responder (erro só se nenhum responder);
- o portal é conferido em `fdv.../config/entrar` ou `config.../login`, só com aviso;
- o host que não responder vira aviso, não erro.

### Ordem do corte (dono do produto; horário de pouco uso, em Manaus)
Nenhum passo pede segredo novo nem mostra segredo. Os passos (a) a (c) podem ser feitos a qualquer momento depois do deploy da v1.0.33; nada muda para os usuários até o (d).

1. **(a) Host público `fdv.` no túnel.** No painel da Cloudflare (Zero Trust › Redes › Túneis › `macuxi-prod` › Hostnames públicos), acrescente `fdv.macuxifdv.com.br` → serviço `http://bko:3100`. A Cloudflare cria o CNAME com proxy; o certificado é o Universal SSL que já existe.
   - Voltar atrás: apagar o hostname `fdv.` do túnel. `bko.` e `config.` seguem como estão.
2. **(b) Access em `fdv.macuxifdv.com.br/config`, antes de abrir o `fdv.` para alguém.** Em Zero Trust › Acesso › Aplicações, crie uma aplicação "self-hosted" com domínio `fdv.macuxifdv.com.br` e caminho `config`, com a mesma política da aplicação do `config.` (se houver). Para não deixar o portal exposto nem por minutos, este passo pode vir antes do (a): a aplicação do Access vale assim que o host existir.
   - Voltar atrás: apagar a aplicação (o portal segue com o login próprio de e-mail e senha).
3. **(c) Conferir no navegador, numa janela anônima:**
   - `https://fdv.macuxifdv.com.br/login` abre a entrada do BKO, e o login funciona;
   - `https://fdv.macuxifdv.com.br/bko` abre a página inicial do BKO (e `https://fdv.macuxifdv.com.br/` leva a ela);
   - `https://fdv.macuxifdv.com.br/config/entrar` pede o Access (passo b) e depois abre a entrada do portal.
   - Se algo falhar: os hosts antigos seguem no ar; desfaça (a) e avise o gerente-projetos.
4. **(d) Variáveis na VM.** Em `/opt/macuxi/.env` (modo 600; os nomes estão no `scripts/deploy/producao/env.modelo`):
   - acrescente `MACUXI_HOSTS_ANTIGOS=0`;
   - se existirem `MACUXI_EMAIL_URL_BKO` ou `MACUXI_DIAGNOSTICOS_PORTAL_URL` com `bko.` ou `config.`, remova as duas (vale o padrão da `MACUXI_HOSTS_ANTIGOS`) ou troque por `https://fdv.macuxifdv.com.br/bko` e `https://fdv.macuxifdv.com.br`;
   - se existir `MACUXI_EMAIL_URL_ATIVOS` com `bko.` ou `config.`, troque por uma base que não morre no corte (`fdv.` ou o bucket público), com os dois PNG do logo publicados lá;
   - recrie a api e o worker, em `/opt/macuxi`: `docker compose --env-file .env --env-file imagens.env up -d --force-recreate --no-deps api worker` (o `restart` não relê o `.env`). Confira com `docker compose --env-file .env --env-file imagens.env ps` (api `healthy`).
   - A partir daqui, os e-mails novos (e os pendentes na outbox) saem com o botão para `fdv.../bko`, e os recados de diagnóstico com `fdv.../config/diagnosticos/<id>`.
   - Voltar atrás: tirar a linha `MACUXI_HOSTS_ANTIGOS=0` (ou pôr `1`), restaurar as variáveis como estavam e recriar a api e o worker com o mesmo comando.
5. **(e) Aviso aos administradores das empresas:** o endereço novo (`https://fdv.macuxifdv.com.br/bko`) e a data em que `bko.` deixa de abrir, pelo canal que o dono do produto escolher.
   - Voltar atrás: novo aviso, se a data mudar.
6. **(f) Remover `bko.` e `config.` do túnel**, na data avisada. No painel do túnel `macuxi-prod`, apague os hostnames públicos `bko.macuxifdv.com.br` e `config.macuxifdv.com.br`; a Cloudflare apaga os CNAMEs. A partir daqui, o host antigo não abre. A aplicação do Access do `config.` (se houver) pode ser apagada junto.
   - Voltar atrás: recriar os dois hostnames → `http://bko:3100`. A imagem da v1.0.33 em diante atende os dois de novo, sem deploy.
7. **(g) Conferência:**
   - login no BKO e no portal em `fdv.`;
   - um e-mail de `nova_senha` de teste com o botão para `https://fdv.macuxifdv.com.br/bko`;
   - um recado de diagnóstico com o link `https://fdv.macuxifdv.com.br/config/diagnosticos/<id>`;
   - `bko.` e `config.` sem resposta;
   - um APK em uso e um Conector sincronizando, sem nenhuma troca (só falam com `api.`).
8. **(h) CORS do bucket**, só se o PUT assinado do ZIP estiver ligado (`MACUXI_ENVIO_URL_ASSINADA=1`, ADR 0058): a regra de CORS do bucket `macuxi-prod` passa a aceitar a origem `https://fdv.macuxifdv.com.br` (antes do passo f, ao lado de `bko.`; depois dele, só `fdv.`). Desligado, como é o padrão, nada a fazer.
   - Voltar atrás: devolver a origem `https://bko.macuxifdv.com.br` à regra.

### Link antigo em e-mail já enviado
Os e-mails entregues antes do passo (d) têm o botão para `bko.` (ou nenhum botão, até a v1.0.32), que deixa de abrir no passo (f).

**O que continua valendo:** o e-mail também traz o código da empresa, o e-mail e a senha temporária, que seguem válidos em `fdv.`. A temporária vence em 72 h (`VALIDADE_SENHA_PROVISORIA_HORAS`), e a do acesso inicial pode não vencer.

**Mitigação:**
1. A convivência: entre o (d) e o (f), o link antigo ainda abre.
2. O aviso do passo (e), com a data.
3. Para quem ainda não entrou, o admin da empresa (ou o super-admin, no portal) gera nova senha depois do (d): o e-mail novo já sai com `fdv.`.
4. A outbox pendente no (d) já sai com o endereço novo, porque o e-mail é montado no despacho.
5. O suporte orienta quem chegar pelo link antigo.

O dono do produto pode pôr, no lugar dos hosts antigos, uma página estática "o endereço mudou para fdv.macuxifdv.com.br" (Cloudflare, sem redirecionamento). Não é o padrão desta ADR, que segue a decisão 2.

## Testes
- **Unidade (`apps/api`):**
  - `MACUXI_HOSTS_ANTIGOS` ligada (ausente, `1`, `sim`), desligada (`0`, `false`, `nao`) e inválida (fica ligada) em `hostsAntigosLigados`, `enderecosWebPadrao` e `urlPortalDiagnosticos` (`test/config.test.ts`);
  - padrão do botão do e-mail em produção pela variável, `MACUXI_EMAIL_URL_BKO` por cima e sem botão fora de produção (`src/email/config.test.ts`);
  - link do recado de diagnóstico em `fdv.../config/diagnosticos/<id>` com a variável desligada (`test/diagnosticos-worker.test.ts`);
  - recusa do cookie de sessão repetido em `renovar` e `encerrar`, no modo seguro e no do PC, sem afetar o app (`test/sessao-web-cookie.test.ts`).
- **Unidade (`apps/web`, engenheiro-apps):** `proxy.ts` e `portal.ts` nos três hosts (`config.` reescrito como hoje; `fdv.` com `/config` por caminho, cabeçalhos do portal e `/` → `/bko`); prefixos reservados contra os manifestos.
- **Unidade (modulo-integracao):** texto do guia em PDF sem host.
- **Integração (sessão, testes):** `tests/integracao/api/sessao-web-cookie-t0117.test.ts` segue verde; o caso do cookie repetido pela API real (Core e Postgres) é do `testes`, dono do arquivo.
- **E2E (`apps/web/e2e`)** com o host `fdv.localhost`: BKO e portal, sem 404 em `/config`.
- **Ensaio de segurança:** XSS no portal na mesma origem (CSP do `/config`).
- **Fumaça do corte:** o passo (g), mais um APK v1.0.29 ou posterior e um Conector de homologação sincronizando antes e depois, sem nenhuma troca.

## Alternativas
- **API em `fdv.../api` ou em `api.fdv.`** (perguntas da 1ª versão). Recusadas pela decisão 1: o `/api` exigia prefixo na API e APK novo; o `api.fdv.` exigia certificado pago. Os dois exigiam a troca dos Conectores.
- **Desligar `bko.` e `config.` no mesmo deploy da versão** (versão de 23/11 desta ADR). Trocada pela decisão "1 A" (decisão 2).
- **Redirecionar `bko.` e `config.` com 307 e depois 308** (recomendação da 1ª versão). Recusada: a convivência sem redirecionamento já dá o tempo de troca, e o redirecionamento exigiria código por host e uma versão para desligá-lo.
- **Ler a `MACUXI_HOSTS_ANTIGOS` também no web.** Recusada: a variável do `next build` exigiria imagem nova para o corte. O web atende os três hosts sempre; o túnel decide quais existem.
- **Trocar o nome do cookie já na v1.0.33.** Fica para depois: o SDK está fora desta versão, e o cookie host-only já separa `bko.` de `fdv.`.
- **Caddy ou nginx na VM.** Sem necessidade: uma regra por host no túnel.
- **`basePath` `/bko`, com o portal numa 2ª imagem de `basePath` `/config`.** Duas imagens do mesmo app, e os módulos iriam para `/bko/catalogo`, o que não é o pedido.
- **Cookie `__Host-` com `Path=/`.** Imune a cookie injetado, mas manda o token de renovação em toda requisição de página. Fica a recusa de duplicado, mais o `Path` restrito.

## Consequências
- Na v1.0.33 nada muda para quem usa `bko.` e `config.`. Os e-mails de produção passam a ter o botão "Abrir o backoffice" (antes, sem `MACUXI_EMAIL_URL_BKO`, não tinham).
- No `fdv.`, com o mesmo host para o BKO e o portal, a barreira de origem entre o super-admin e o tenant some. Ela é compensada pela CSP, pelo Access e pelo storage com prefixo (item 6).
- Favoritos e e-mails antigos com `bko.` e `config.` param de abrir só no passo (f) do corte.
- O doc 04 ("Domínio e endereços") é reescrito pelo dono dele: `fdv.` para o web e `api.` para a API, os antigos até o corte, e sai a reserva do `app.`.
- O kit-piloto e os exemplos do Hub não mudam. Só o guia em PDF sai com versão nova (texto do portal sem host).
