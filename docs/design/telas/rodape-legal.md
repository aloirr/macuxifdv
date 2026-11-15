# Rodapé legal nas telas de entrada (Campo, Gestão, BKO e portal `config.`)

> 2026-11-14 · designer-ux · pedido do dono do produto pela ponte, ~20h12 (Manaus), recado R-20261114-201200-alexandre,
> com o print do Entrar do Campo: *"Aqui embaixo no login em vez dessa frase simples macuxi vendedores e promotores deve ter
> lá dizeres legais como a razão social da empresa, CNPJ, versão, todos os direitos reservados. E o site"*.
> 2026-11-15 · revisão: razão social e CNPJ viram cadastro do portal `config.` (R-20261114-202000, resposta do dono do
> produto: *"deixar em branco para eu preencher no config"*).
> Simulações nesta pasta (Playwright, deviceScaleFactor 2; Campo e Gestão a 390 × 844, BKO e portal a 1366 × 768):
> - `rodape-legal-<campo|gestao|bko|portal>-antes.png`;
> - `rodape-legal-<superfície>-depois-preenchido.png` e `-depois-em-branco.png` (fonte `rodape-legal.html?v=<superfície>-<estado>`;
>   `&alvo=1` desenha a área de toque do link);
> - `rodape-legal-config-dados.png` (fonte `rodape-legal-config-dados.html`), o cadastro no portal.
>
> **Dados fictícios** nas simulações: "Exemplo Tecnologia Ltda." e CNPJ 11.222.333/0001-81 (dígitos válidos, empresa
> inexistente). Não vão para código, seed nem teste como dado real.

## 1. Onde está hoje

| Tela | Arquivo | O que aparece embaixo | Destino |
|---|---|---|---|
| Entrar do Campo | `apps/mobile/src/app/login.tsx:217` passa `rodape=` para a `TelaLogin` (`modules/core/app/components/tela-login.tsx:118`, `t.small`, alinhado à esquerda) | "Macuxi Campo · vendedores e promotores" | **sai** |
| Entrar da Gestão | o mesmo `login.tsx:217`, variante `gestao` | "Macuxi Gestão · supervisores e gerentes" | **sai** |
| Entrar do BKO | `apps/web/components/login-screen.tsx` (`LoginReal`, última linha do formulário) | "Vendedores e promotores usam o app Macuxi Campo; supervisores, o Macuxi Gestão." | **fica**: diz a quem errou de lugar para onde ir (ação); não é o rodapé de identidade |
| Entrar do portal `config.` | `apps/web/components/portal/tela-entrar.tsx` (dentro do cartão da `MolduraEstreita`) | "Esqueceu a senha? Use "Esqueci a senha" no backoffice." | **fica** (ação) |

Nenhuma das quatro telas tem hoje razão social, CNPJ, versão, direitos ou site.

## 2. O rodapé (igual nas quatro telas)

Até três linhas, centralizadas, nesta ordem. Preenchido (dados fictícios):

```
Exemplo Tecnologia Ltda. · CNPJ 11.222.333/0001-81
© 2026 · Todos os direitos reservados
Versão 1.0.8 · macuxifdv.com.br
```

Em branco (razão social e CNPJ vazios no cadastro):

```
© 2026 · Todos os direitos reservados
Versão 1.0.8 · macuxifdv.com.br
```

- **Linha 1, empresa:** razão social e CNPJ (máscara `00.000.000/0000-00`), lidos do cadastro "Dados da Macuxi" (seção 3).
  **Campo em branco não aparece**, sem espaço reservado: os dois em branco, a linha some; só um preenchido, só ele
  ("Exemplo Tecnologia Ltda." ou "CNPJ 11.222.333/0001-81"), sem o `·`. O CNPJ nunca quebra no meio: "CNPJ" e o número
  ficam juntos (espaço sem quebra ` ` depois de "CNPJ"). Se a razão social for longa, o CNPJ desce inteiro para a
  linha de baixo.
- **Linha 2, direitos:** `© <ano> · Todos os direitos reservados`. O ano é o do relógio do aparelho/navegador
  (`new Date().getFullYear()`); antes do login não há fuso de tenant, e a diferença só existiria por horas no 31/12.
- **Linha 3, versão e site:** `Versão X.Y.Z · <site>`, com só o endereço como link para `https://<site>`. O site vem do
  cadastro; vazio ou sem resposta, vale `macuxifdv.com.br`. Sem versão conhecida (desenvolvimento local), a linha fica só
  com o site; nunca "Versão ?".
- **Não repete o nome do produto:** o logo da faixa já diz "Macuxi Força de Vendas" e a faixa do BKO/portal já diz a área
  ("Backoffice", "Portal de implantação"). Nada de "Macuxi Campo", "app", "plataforma" ou explicação de funcionamento
  (R-20261110-093124, R-20261110-192153). O site aparece sem `https://` e sem `www`.

### 2.1 Visual

| Item | Celular (Campo, Gestão) | Web (BKO, portal) |
|---|---|---|
| Texto | `type.small`: 12/400, altura de linha 16, `colors.ink2` #4A5562 | `text-[12px] leading-4 text-ink-2` |
| Contraste | #4A5562 no Pérola #F8F6F1 = **7,03:1** (AA e AAA para texto) | idem |
| Link | `colors.accentInk` #1E3350, semibold 12, **sublinhado** — 11,82:1 no Pérola. O sublinhado é obrigatório: entre o link e o texto ao lado a diferença de cor é pequena (WCAG 1.4.1) | `text-accent-ink font-semibold underline underline-offset-2` |
| Espaço entre linhas | 2 dp | `gap-0.5` |
| Alinhamento | centro, largura total menos 16 dp de cada lado | centro, `max-w-[440px]` |
| Posição | no pé da tela, como **último item** do bloco fixo `login.rodape` (abaixo dos avisos e do "Avançado"), com o respiro do `insets.bottom` que o bloco já tem | no pé da página: a moldura vira `min-h-screen flex flex-col` e o rodapé ganha `mt-auto pt-8 pb-6`; com janela baixa, fica no fluxo, depois do formulário (rola junto) |
| Teclado aberto (celular) | **some** enquanto o teclado está aberto (`teclado` que o `login.tsx` já calcula): o formulário tem prioridade | — |

Medidas nas simulações: no celular de 390 × 844, o formulário termina perto de 590 dp e o rodapé ocupa ~52 dp no pé;
sobra espaço. No BKO a 1366 × 768, o rodapé fica no pé da janela sem rolar.

### 2.2 Acessibilidade

- **Celular:** o bloco é um `View` com `accessibilityRole="text"` nas linhas 1 e 2 e o link separado:
  - linha 1 (quando existe): o leitor lê "Exemplo Tecnologia Ltda., CNPJ 11.222.333/0001-81" (o `·` vira vírgula no
    `accessibilityLabel`);
  - linha 2: `accessibilityLabel` "Copyright 2026. Todos os direitos reservados.";
  - link: `Pressable` com `accessibilityRole="link"`, `accessibilityLabel` "Abrir o site <site>", abre com
    `Linking.openURL(url)` (`https://<site>`) no navegador do aparelho. **Área de toque ≥ 48 dp de altura** por
    `hitSlop` (16 em cima e embaixo, 8 dos lados), sem aumentar o desenho. Toque: escala 0,97 em 120 ms (padrão do kit).
- **Web:** `<footer>` (landmark `contentinfo`); link `<a href="https://<site>" target="_blank"
  rel="noopener noreferrer">` com o texto visível do site e `aria-label` "<site> (abre em nova
  aba)"; foco visível no padrão do kit (`focus-visible:outline-2 outline-accent`); área de clique de 44 px de altura com
  `py-[14px] -my-[14px]` (não muda o desenho). Ordem de tabulação: depois do último controle do formulário.
- Nada no rodapé é só cor: o link tem sublinhado.

## 3. Onde ficam os dados legais (um lugar só)

Razão social, CNPJ e site são um **cadastro da plataforma**, editado pelo time da Macuxi no portal `config.` e lido pelas
quatro superfícies. Não ficam constantes no código.

### 3.1 Tela no portal: "Dados da Macuxi" (`rodape-legal-config-dados.png`)

- **Acesso:** item "Dados da Macuxi" no cabeçalho, depois de "Diagnósticos" (`MENU_TIME_MACUXI`), só para o super-admin.
  O admin do cliente não vê o item; no endereço direto, "Esta área é só do time Macuxi." com o link para a empresa dele
  (o mesmo padrão dos Diagnósticos). Endereço `/dados-da-macuxi`.
- **Ordem:** título "Dados da Macuxi"; subtítulo "Aparecem no rodapé das telas Entrar."; cartão de até 720 px com os
  campos e o botão. Padrão visual do portal (`MolduraPortal`, `Campo`, `Button` do kit).

| Campo | Regra | Erro (embaixo do campo, ao sair dele e ao salvar) |
|---|---|---|
| Razão social (largura toda) | opcional; sem espaços nas pontas; até 120 caracteres; vazio = sem valor | "Use até 120 caracteres." |
| CNPJ | opcional; máscara `00.000.000/0000-00` enquanto digita (a `mascararCnpj` do passo Empresa); confere os dígitos verificadores (`cnpjComDigitosValidos`); sem consulta à Receita; vazio = sem valor | "CNPJ inválido. Confira os 14 dígitos." (o texto do passo Empresa) |
| Site | já vem com `macuxifdv.com.br`; ao sair do campo tira `https://`, `http://`, `www.` e a barra final; só o domínio; vazio ao salvar volta para `macuxifdv.com.br`. | "Use só o endereço, ex.: macuxifdv.com.br." |

- **Botão:** um só, "Salvar" (principal), desabilitado enquanto nada mudou; no envio, "Salvando…". Deu certo: aviso no
  rodapé "Dados salvos.". Erro de rede ou do servidor: `ErrorBlock` do kit com "Tentar de novo", e os campos guardam o
  que foi digitado.
- **Carregando:** `LoadingBlock` do kit. Cadastro nunca preenchido: razão social e CNPJ vazios, site `macuxifdv.com.br`.

### 3.2 Tabela (banco-dados)

`plataforma.dados_legais`, **uma linha só** (a migração cria a linha com razão social e CNPJ vazios):

| Coluna | Tipo e regra |
|---|---|
| `id` | `uuid` pk |
| `razao_social` | `text` nulo; `btrim <> ''` e até 120 caracteres |
| `cnpj` | `text` nulo; só os 14 dígitos (`^\d{14}$`); o dígito verificador é conferido no contrato e na API |
| `site` | `text not null default 'macuxifdv.com.br'`; só domínio |
| `atualizado_por` | `uuid` nulo, `plataforma.super_admin.id` |
| `created_at`, `updated_at`, `deleted_at`, `external_id` | padrão da regra 5 |

- **Premissa do `tenant_id`:** é dado da plataforma, fora dos tenants, como `plataforma.super_admin`. Fica **sem
  `tenant_id`**, com exceção nominal em `TABELAS_SEM_TENANT_ID` e `TABELAS_SO_POR_FUNCAO` (`db/src/excecoes.ts`), RLS
  ligado e forçado, sem política nem grant para `macuxi_app` e `macuxi_worker` (falha fechada). Se o banco-dados
  preferir outro desenho, vale o dele, desde que o contrato da seção 3.3 não mude.
- **Acesso só por função `SECURITY DEFINER`:**
  - `plataforma.sa_dados_legais()` e `plataforma.sa_gravar_dados_legais(...)`: EXECUTE só ao `macuxi_portal`; gravar só
    o super-admin, com auditoria em `plataforma.auditoria_plataforma` (valor anterior e novo; dado de pessoa jurídica,
    não é dado pessoal);
  - `plataforma.dados_legais_publicos()`: devolve só `razao_social`, `cnpj` e `site`; EXECUTE ao papel da rota pública
    (banco-dados e engenheiro-software combinam; entra na lista de funções revisadas da conformidade).

### 3.3 Contrato (engenheiro-software, `packages/platform-sdk/src/plataforma.ts`)

- `DadosLegaisSchema`: `{ razao_social: string | null; cnpj: string | null /* 14 dígitos */; site: string }`, resposta
  das leituras.
- `GravarDadosLegaisSchema`: razão social sem espaços nas pontas, vazia vira `null`, até 120; CNPJ sem a máscara, vazio
  vira `null`, conferido com `cnpjComDigitosValidos`; site normalizado, vazio vira `SITE_PADRAO`.
- Constantes: `SITE_PADRAO = 'macuxifdv.com.br'`, `ROTA_DADOS_LEGAIS_PUBLICOS = '/v1/publico/dados-legais'`,
  `ROTA_PORTAL_DADOS_LEGAIS = '/v1/plataforma/dados-legais'`.

### 3.4 Rotas (engenheiro-software, `apps/api/src/dados-legais.ts`, registrada no `app.ts` como a `/v1/saude`)

- `GET /v1/publico/dados-legais`: **sem login e sem tenant**, porque a tela Entrar vem antes do login. Responde
  `DadosLegaisSchema` com `Cache-Control: public, max-age=300, stale-while-revalidate=86400`; cache em
  memória de 60 s na API; limite por IP como as outras rotas sem login. Banco fora: 503, e o cliente usa o próprio
  cache.
- `GET` e `PUT /v1/plataforma/dados-legais`: token do portal, só super-admin (403 para o admin do cliente). O `PUT`
  revalida com `GravarDadosLegaisSchema` (400 com o campo), é idempotente, vai para a auditoria e limpa o cache em
  memória da rota pública.

### 3.5 Quem lê e como

- **App (Campo e Gestão):** na tela Entrar, mostra na hora o que está no cache local (AsyncStorage, chave
  `macuxi.dados-legais`, conferido com `DadosLegaisSchema`) e, em paralelo, chama `GET /v1/publico/dados-legais` no
  servidor em uso (o mesmo do login, inclusive o do "Avançado"), com prazo de 5 s. Resposta válida: grava o cache e
  atualiza o rodapé. Sem rede: fica o cache. Primeira abertura sem rede e sem cache: linhas 2 e 3, com o site padrão.
  Nunca segura o login.
- **Web (BKO e portal):** busca a rota pública no servidor do Next (`fetch` com `revalidate: 300`), para a linha 1 já
  vir no HTML; se o engenheiro-apps preferir no navegador, `useQuery` com `staleTime` de 5 min. Carregando ou com erro:
  linhas 2 e 3, com o site padrão, sem esqueleto nem aviso.
- **`packages/ui` (designer-ux):** só a montagem e o desenho. `linhasDoRodapeLegal({ dados, versao, ano })` é pura e
  testada (campo em branco não aparece, máscara do CNPJ, só um dos dois, site padrão, versão ausente);
  `<RodapeLegal dados versao />` recebe os dados prontos. O kit não chama a API nem guarda cache, e não importa o
  `platform-sdk`: o tipo do kit é estrutural (`{ razao_social, cnpj, site }`), compatível com `DadosLegaisSchema`.
- O mesmo cadastro serve, quando pedirem, ao rodapé dos PDFs, dos e-mails e do site.
- A versão **não** vem do cadastro: cada shell lê a sua (seção 4).

## 4. De onde vem a versão

- **App (Campo e Gestão):** `Constants.expoConfig?.version` (`expo-constants`, já usado em
  `apps/mobile/src/components/tela-de-erro.tsx` e `services/diagnostico.ts`), que o `apps/mobile/app.config.ts` preenche de
  `apps/mobile/scripts/eas/versao.json` (hoje `1.0.8`; fonte única das duas variantes). O kit não importa `expo-constants`:
  o shell passa `versao` como prop.
- **Web (BKO e portal, mesmo `apps/web`):** variável de build `NEXT_PUBLIC_VERSAO`, com o número da tag publicada sem o
  `v` (ex.: tag `v1.0.7` → `1.0.7`). `apps/web/package.json` (`0.1.0`) **não** serve: não acompanha as publicações.
  Caminho: `producao-publicar.yml` passa `MACUXI_VERSAO=<versão da tag>` como `build-arg` da imagem do BKO;
  `apps/web/Dockerfile` recebe `ARG MACUXI_VERSAO` e expõe `NEXT_PUBLIC_VERSAO=$MACUXI_VERSAO` no `next build`. Sem a
  variável (dev, demo), a linha 3 fica só com o site.

## 5. Quem implementa o quê

Ordem: banco e contrato primeiro; rotas; kit; depois as telas, todas no mesmo lote.

| Dono | Arquivo | O que muda |
|---|---|---|
| **banco-dados** | `db/migrations/00NN_plataforma_dados_legais.{up,down}.sql`, `db/src/excecoes.ts` | tabela, linha única, RLS e funções da seção 3.2; exceção nominal sem `tenant_id` |
| **engenheiro-software** | `packages/platform-sdk/src/plataforma.ts` | `DadosLegaisSchema`, `GravarDadosLegaisSchema`, `SITE_PADRAO` e as duas rotas (seção 3.3) |
| **engenheiro-software** | `apps/api/src/dados-legais.ts`, `apps/api/src/app.ts` | rota pública e rotas do portal (seção 3.4), com testes |
| **engenheiro-software** | `.github/workflows/producao-publicar.yml` | `build-args`: `MACUXI_VERSAO=${{ needs.conferir.outputs.versao }}` sem o `v` (seção 4) |
| **designer-ux** | `packages/ui/src/comum/legal.ts` (+ `legal.test.ts`) | `linhasDoRodapeLegal({ dados, versao, ano })` e o tipo estrutural (seção 3.5); sem dados fixos |
| **designer-ux** | `packages/ui/src/mobile/rodape-legal.tsx`, export em `mobile/index.ts` | `<RodapeLegal dados versao />` (seção 2, celular), `testID="login.rodape-legal"` e `login.site` |
| **designer-ux** | `packages/ui/src/web/rodape-legal.tsx`, export em `web/index.ts` | `<RodapeLegal dados versao className? />` (seção 2, web), `data-testid="rodape-legal"` |
| **engenheiro-apps** | `apps/mobile/src/app/login.tsx` e um serviço de leitura com cache (`apps/mobile/src/services/`) | tira `rodape=` da `TelaLogin` (linha 217); põe `{!teclado ? <RodapeLegal dados={…} versao={Constants.expoConfig?.version} /> : null}` como último filho do `View` `login.rodape`, só na etapa Entrar; leitura e cache da seção 3.5 |
| **engenheiro-apps** | `apps/mobile/src/components/login-tela.test.tsx:166` | troca a conferência do texto antigo pela presença de `login.rodape-legal`; casos com cache, sem rede e em branco |
| **engenheiro-apps** | `apps/web/components/login-screen.tsx` | `Moldura` vira `min-h-screen flex flex-col`; `<RodapeLegal dados={…} versao={process.env.NEXT_PUBLIC_VERSAO} className="mt-auto" />` na etapa Entrar (real e demonstração). A linha "Vendedores e promotores usam…" fica |
| **engenheiro-apps** | `apps/web/components/portal/base.tsx` e `portal/tela-entrar.tsx` | `MolduraEstreita` ganha a prop opcional `rodapeLegal` (só o Entrar liga; a "Escolha a empresa" não) |
| **engenheiro-apps** | `apps/web/components/portal/tela-dados-legais.tsx`, `apps/web/app/config/dados-da-macuxi/`, `base.tsx` (`MENU_TIME_MACUXI`), `lib/portal-rotas.ts` | a tela da seção 3.1 e o item do cabeçalho |
| **engenheiro-apps** | `apps/web/Dockerfile`, `apps/web/next.config.ts` | `ARG MACUXI_VERSAO` → `NEXT_PUBLIC_VERSAO` (seção 4) |
| **modulo-core** | `modules/core/app/components/tela-login.tsx` | remove a prop `rodape` (linhas 23–24 e 118) **no mesmo lote** do `login.tsx`, para não haver dois rodapés nem typecheck quebrado |
| **dono do produto** | portal `config.` › Dados da Macuxi | preenche a razão social e o CNPJ quando quiser; até lá a linha 1 não aparece |

## 6. Antes do lote e do build

- **Validação do design-de-marca** (mudança de layout nas quatro superfícies e tela nova no portal; R-20261112-065914):
  com estes PNG, antes do lote. Só o dono do produto aprova a marca.
- **Parecer do corretor-redundancias** sem achado em aberto, antes do lote (R-20261110-062506), olhando o print do
  aparelho. Pontos para ele conferir: o rodapé não repete o nome do produto do logo; a linha do BKO "Vendedores e
  promotores usam…" e a do portal "Esqueceu a senha?…" ficaram por serem ação, não identidade.
- **Revisão de UX** (designer-ux) das telas implementadas: contraste, alvo do link, teclado aberto, leitor de tela, a
  tela "Dados da Macuxi".
- Roteiro do testes:
  - Campo e Gestão com e sem teclado; versão igual à do `versao.json`; toque no site abre o navegador;
  - BKO e portal com e sem `NEXT_PUBLIC_VERSAO`;
  - cadastro preenchido, em branco, só a razão social e só o CNPJ, nas quatro telas;
  - app sem rede com cache (mostra o último) e sem cache (linhas 2 e 3);
  - "Dados da Macuxi": CNPJ com dígito errado recusado na tela e na API; site com `https://www.` normalizado; admin do
    cliente sem acesso (tela e 403); gravação na auditoria; o Entrar mostra o valor novo em até 5 min.
