# Parecer de marca · portal `config.` · revisão completa

> 2026-11-14 · design-de-marca · pedido do recado R-20261114-130000-alexandre (alexandre → gerente-projetos, delegado ao design-de-marca).
> **Base:** branch `nuvem/config-auditoria-marca`, a partir do `main` `bb20d06`, contra `docs/marca/manual.md` v1 (com MC-0004 B e MC-0014 A) e `decisoes.md`.
> **Como:** BKO rodando com `NEXT_PUBLIC_PORTAL_FALSO=1` (`pnpm dev`, host `config.localhost:3000`), sem Docker e sem Postgres. Prints do Playwright/Chromium, 1280 px de largura e `deviceScaleFactor` 2, com os acessos de `apps/web/lib/portal-falso.ts`: `time@macuxi.com.br` (time da Macuxi) e `admin@duas.com.br` (admin do cliente com 2 empresas).
> **Prints:** [`auditorias/2026-11-14-portal-config/`](../auditorias/2026-11-14-portal-config/). As PNG foram reduzidas a 128 cores para caber no repositório. **Não meça hex nelas:** o hex de cada achado vem do código.
> **Recados:** a CLI de recados não tem acesso ao GitHub nesta sessão (HTTP 403, GraphQL indisponível). Os recados ficam no fim deste parecer, com o texto pronto para envio.

## Veredito: **segura**
Três achados médios ferem o manual aprovado em telas que o cliente vê (MC-0021, MC-0022 e MC-0023), e há um baixo (MC-0024). Todos têm a correção pronta e ficam com o engenheiro-apps. O designer-ux consolida a especificação final do cabeçalho do portal (MC-0023) antes da aplicação.

**Para liberar:** corrigir MC-0021, MC-0022 e MC-0023 e mandar o print do navegador das telas Entrar, Empresas e Empresa (aba Bases) para o reteste. A MC-0024 pode ir no mesmo PR.

## Telas auditadas
| Tela | Rota | Print | Marca |
|---|---|---|---|
| Início | `/` (`components/portal/inicio.tsx`) | redireciona para Entrar ou para Empresas: só mostra o carregando no Pérola | conforme |
| Entrar | `/entrar` | `01-entrar.png` | logo na faixa sem área de proteção (MC-0022) |
| Escolher empresa | `/escolher-empresa` | `02-escolher-empresa.png` | MC-0022 |
| Empresas | `/empresas` | `03-empresas.png` | "Nova empresa" em grafite (MC-0021); cabeçalho branco (MC-0023) |
| Nova empresa | `/empresas/nova` | `04-nova-empresa.png` | MC-0023 |
| Empresa · Bases (com a Equipe) | `/empresas/:id#bases` | `05-empresa-bases.png` | número dos passos em grafite (MC-0024); MC-0023 |
| Empresa · Integração e Conector | `#integracao` | `06-empresa-integracao.png` | MC-0023 |
| Empresa · Admins (aba Empresa) | `#empresa` | `07-empresa-admins.png` | MC-0023 |
| Diagnósticos | `/diagnosticos` | `08-diagnosticos.png` | MC-0023; o voltar do "sem acesso" é o `LinkBotao` da MC-0021 |
| Detalhe do cabeçalho | — | `10-cabecalho-detalhe.png` | MC-0022 e MC-0023 |

## O que está conforme
- **Logo:** o login não mostra mais o quadrado laranja com "M". Em todas as telas está o arquivo pronto `macuxi-logo-negativo-azul-noite.svg` (`apps/web/lib/logo-marca.ts`, copiado sem alteração), sobre o Azul noite, com 28 px de altura (o mínimo é 20 px), sem deformação, sombra ou contorno. O sol está no Sol claro `#F59A52` sobre o Azul noite (5,85:1). **Se o `config.` publicado ainda mostra o quadrado laranja, a versão no ar é anterior à T-0172:** é publicação, não código, e fica com o gerente conferir a versão em produção.
- **Favicon:** `apps/web/app/favicon.ico` traz exatamente `favicon-48.png` e `favicon-192.png` dos ativos v1 (conferido byte a byte).
- **Fundo:** Pérola `#F8F6F1` em todas as telas (`bg-ground`), com os cartões em branco.
- **Botão principal (`<Button variant="primary">`):** Azul noite `#1E3350` com texto branco (12,77:1) em Entrar, Criar empresa, Acrescentar módulos, Importar, Gerar credencial e Copiar (`packages/ui/src/web/ui.tsx:143`).
- **Link e aba ativa:** "← Empresas", "Baixar modelo", "Dicionário de campos", "Gerar o link do Conector" e "Sair" em `accent-ink` (Azul noite, 11,82:1 no Pérola); a aba ativa da empresa e do menu com o filete Azul noite (`border-accent`).
- **Sol laranja:** nenhum uso no portal. Não há laranja em texto, link nem botão (`grafico`, `accent-light` e `#C2540A` não aparecem em `apps/web/components/portal` nem em `apps/web/app/config`).
- **Neutros (MC-0004 B):** linha `#DFE2E6`, linha suave `#ECEEF1` e campo `#C9CED5` pelos tokens de `globals.css`. Não há hex esverdeado no portal.
- **Situação:** "Ativa" e "licenciado" em verde, "Bloqueado" e o erro em vermelho, e o aviso do modo falso em âmbar, sempre com texto.
- **Tipografia:** títulos das telas em Archivo ExtraBold e dos cartões em Archivo Bold (`font-display`, `packages/ui/src/web/ui.tsx:20` e `:76`), texto em IBM Plex Sans e o código da empresa em IBM Plex Mono.
- **Nome:** "Macuxi" sempre inteiro e com inicial maiúscula, inclusive no título da aba do navegador ("… · Portal de implantação Macuxi", `app/config/layout.tsx:4`).

## Achados
### MC-0021 · botão-link principal do portal em grafite, com hex solto no hover · média
| Campo | Conteúdo |
|---|---|
| Onde | Empresas: "Nova empresa" no cabeçalho (`tela-empresas.tsx:56`) e "Cadastrar a primeira empresa" na lista vazia (`:75`); Diagnósticos: "Ir para a sua empresa" no "sem acesso" (`tela-diagnosticos.tsx:74`). Código: `apps/web/components/portal/base.tsx:61` |
| Print | `03-empresas.png` (botão "Nova empresa" quase preto, ao lado do Azul noite do resto) |
| Tipo | cor |
| Fere | §3: o Azul noite é a cor do **botão principal**, e o grafite fica para texto, Sincronizar e menu. Checklist A: nada de hex solto nem de cor "quase igual" (`#0B1218` ≈ grafite). No mesmo portal, "Criar empresa" e "Entrar" já são Azul noite: o principal tem duas cores |
| Código atual | `primario ? 'bg-ink text-white hover:bg-[#0b1218]' : …` |
| Correção | `primario ? 'bg-accent text-white hover:bg-accent/90' : …` (o mesmo do `Button primary` em `packages/ui/src/web/ui.tsx:143`; branco no Azul noite 12,77:1). É o mesmo defeito da MC-0019 no `BotaoLink` do kit: se o designer-ux corrigir o `BotaoLink`, o portal pode usá-lo e apagar o `LinkBotao` (o corretor confirma) |
| Dono | engenheiro-apps |

### MC-0022 · logo da faixa sem a área de proteção · média
| Campo | Conteúdo |
|---|---|
| Onde | `MarcaNaFaixa` (`apps/web/components/marca-faixa.tsx:8`, `:12` e `:21`), usada no portal (`components/portal/base.tsx:50`: Entrar, Escolher empresa e o cabeçalho de todas as telas) e no login do BKO (`components/login-screen.tsx:65`) |
| Print | `01-entrar.png`, `02-escolher-empresa.png`, `10-cabecalho-detalhe.png` |
| Tipo | logo |
| Fere | §2.3: em volta do logo nenhum elemento entra numa margem igual à altura do "M". Com o logo em 130 px de largura (28 px de altura), o "M" mede ~17 px. Hoje a borda da faixa fica a 10 px em cima e embaixo (`py-2.5`) e a 14 px à esquerda (`px-3.5`), e o filete divisor fica a 12 px (`gap-3`) |
| Código atual | `LARGURA_LOGO = 130`; `className="flex items-center gap-3 rounded-xl bg-faixa px-3.5 py-2.5"` |
| Correção | **logo a 104 px** (`LARGURA_LOGO = 104`, `w-[104px]`: 22 px de altura, acima do mínimo de 20 px, com o "M" em ~14 px) e **14 px de folga em volta**: `gap-3 … px-3.5 py-2.5` → `gap-3.5 … p-3.5`. A faixa fica com 50 px de altura, quase a mesma de hoje (48 px), e "Portal de implantação" (ou "Backoffice") continua ao lado do filete. Simulação: `S1-entrar-depois-simulado.png` |
| Dono | engenheiro-apps |

### MC-0023 · cabeçalho do portal branco, com o logo numa "pílula" · média
| Campo | Conteúdo |
|---|---|
| Onde | cabeçalho de todas as telas com sessão: Empresas, Nova empresa, Empresa (Bases, Integração e Admins) e Diagnósticos. Código: `apps/web/components/portal/base.tsx:412` (header), `:428-429` (abas), `:438` (sessão), `:452` e `:456` (Trocar de empresa e Sair) |
| Print | `03-empresas.png`, `10-cabecalho-detalhe.png` (antes); `S2-empresas-depois-simulado.png` e `S3-bases-depois-simulado.png` (depois, simulado) |
| Tipo | aplicação · cor |
| Fere | §4: no portal `config.` o logo negativo fica **na faixa Azul noite**, como a barra superior Azul noite do BKO. Hoje a barra é branca (`bg-surface`) e o Azul noite vira um selo arredondado solto dentro dela: o logo parece um botão, e o portal não tem a mesma cara do BKO e dos apps |
| Código atual | `<header className="border-b border-line bg-surface">`; aba: `ativo ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'`; sessão: `text-ink-2`; Trocar de empresa e Sair: `Button` secundário (branco) |
| Correção | a própria barra vira a faixa: `<header className="bg-faixa">` (largura total). Dentro dela: a `Marca` **sem** o fundo e o arredondado próprios (uma variante da `MarcaNaFaixa` sem `rounded-xl bg-faixa`, mantendo os 14 px da MC-0022); aba ativa `border-white text-white`, inativa `border-transparent text-faixa-texto hover:text-white` (`#C9CED5`, 8,07:1); sessão e empresa atual `text-faixa-texto` e `text-white`; Trocar de empresa e Sair com borda `#C9CED5`, fundo transparente e texto branco (12,77:1); e o foco de teclado `outline-white` (o `outline-accent` de hoje some no Azul noite). O corpo continua no Pérola. Antes de aplicar, o designer-ux fecha a especificação (variante da `MarcaNaFaixa`, botão secundário sobre a faixa e foco) em `docs/design/componentes.md` |
| Dono | designer-ux (especificação) · engenheiro-apps (aplicação) |

### MC-0024 · número dos passos das bases em grafite · baixa
| Campo | Conteúdo |
|---|---|
| Onde | Empresa · Bases: o círculo com o número de cada base, da Equipe (0) às Notas (15). Código: `apps/web/components/portal/cartao-base.tsx:213` e `apps/web/components/portal/cartao-equipe.tsx:113` |
| Print | `05-empresa-bases.png` |
| Tipo | cor |
| Fere | §3: o grafite é texto principal, Sincronizar e menu; elemento de identidade cheio é Azul noite. É o mesmo caso da MC-0002 (chip ativo em grafite), já corrigida no app |
| Código atual | `rounded-full bg-ink text-[12px] font-bold text-white` |
| Correção | `bg-ink` → `bg-accent` nas duas linhas (branco no Azul noite 12,77:1). Simulação: `S3-bases-depois-simulado.png` |
| Dono | engenheiro-apps |

## Fora do escopo da marca (encaminhar, não catalogado)
- **"Choose File" e "No file chosen"** em inglês nos campos de arquivo das bases (`05-empresa-bases.png`): texto de interface, do designer-ux e do corretor-redundancias.
- **Diagnósticos no modo falso** mostra "Empresa não encontrada ou inativa. Tentar de novo" para o time da Macuxi (`08-diagnosticos.png`): defeito do modo falso ou da tela, do engenheiro-apps e do testes.
- **Botão desabilitado:** o principal desabilitado usa `#8B96A3` com texto branco (3,00:1) e o secundário, texto `#8B96A3` no branco. O manual tem o `#8B96A3` como "desabilitado do BKO" e a Névoa com `#5B6673` como "botão desabilitado". Não fere o manual, mas são dois padrões para a mesma coisa: o designer-ux escolhe um na especificação, e eu registro no manual com o "aprovo" do Alexandre.

## Recados (texto pronto; não enviados, CLI com HTTP 403)
**1. design-de-marca → designer-ux, cc gerente-projetos** (tipo `pedido`, assunto "Portal config.: marca, especificação do cabeçalho (MC-0023)")
> Revisão de marca do portal `config.` (R-20261114-130000-alexandre), parecer em `docs/marca/pareceres/2026-11-14-portal-config.md`, veredito **segura**. Preciso que você consolide a especificação final do cabeçalho do portal (MC-0023, média): a barra inteira em `bg-faixa` (Azul noite `#1E3350`); uma variante da `MarcaNaFaixa` sem fundo e sem arredondado, com o logo a 104 px e 14 px de folga (MC-0022); aba ativa `text-white border-white`, inativa `text-faixa-texto hover:text-white`; botão secundário sobre a faixa (borda `#C9CED5`, fundo transparente, texto branco); foco `outline-white`. Registre em `docs/design/componentes.md` e mande ao engenheiro-apps. Simulação em `docs/marca/auditorias/2026-11-14-portal-config/S2-empresas-depois-simulado.png`. De quebra: escolha um padrão só para o botão desabilitado (`#8B96A3` com branco ou Névoa `#ECEEF1` com `#5B6673`) e me diga, para eu levar ao Alexandre; e "Choose File / No file chosen" em inglês nas bases é texto seu e do corretor. A MC-0019 (`BotaoLink`) segue aberta e resolve também a MC-0021 se o portal passar a usá-lo.

**2. design-de-marca → engenheiro-apps, cc gerente-projetos e designer-ux** (tipo `pedido`, assunto "Portal config.: MC-0021 a MC-0024")
> Revisão de marca do portal `config.`, parecer em `docs/marca/pareceres/2026-11-14-portal-config.md`, veredito **segura**. Correções:
> - **MC-0021 (média)** `apps/web/components/portal/base.tsx:61`: `'bg-ink text-white hover:bg-[#0b1218]'` → `'bg-accent text-white hover:bg-accent/90'` ("Nova empresa" e o voltar dos Diagnósticos).
> - **MC-0022 (média)** `apps/web/components/marca-faixa.tsx`: `LARGURA_LOGO = 130` → `104` (e `w-[130px]` → `w-[104px]`); `:12` `gap-3 … px-3.5 py-2.5` → `gap-3.5 … p-3.5`. Vale para o portal e para o login do BKO.
> - **MC-0023 (média)** `base.tsx:412`: o cabeçalho vira a faixa Azul noite, conforme a especificação que o designer-ux vai fechar (simulação em `S2-empresas-depois-simulado.png`).
> - **MC-0024 (baixa)** `apps/web/components/portal/cartao-base.tsx:213` e `cartao-equipe.tsx:113`: `bg-ink` → `bg-accent`.
> Para o reteste, mande o print do navegador de Entrar, Empresas e Empresa (aba Bases). Fora da marca: no modo falso, Diagnósticos mostra "Empresa não encontrada ou inativa" para o time da Macuxi (`08-diagnosticos.png`), confira com o testes.
