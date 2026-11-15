# Parecer de marca · reteste de 4 lotes de 15/11/2026 (Início do Campo, bloqueio de usuário, revisão do BKO e PR #250)

> 2026-11-15 · design-de-marca · pedido do dono do produto pela ponte.
> **Base:** `main` `17d91b28`, contra `docs/marca/manual.md` v1 e `decisoes.md`. Cada lote lido com `git diff origin/main...<SHA>`.
> **Numeração:** a MC-0057 a MC-0060 foram dadas no parecer anterior (revisão do BKO e simulações de 15/11) e entram agora no catálogo. Os achados novos começam na **MC-0061**.
> **Recados:** a CLI de recados respondeu HTTP 403 nesta sessão. Os recados aos donos vão pelo gerente-projetos.

## Resumo
| Lote | Branch · SHA | Reteste | Achados novos | Parecer |
|---|---|---|---|---|
| 1 | `nuvem/inicio-cabecalho-designer-ux` · `6f7023f` | MC-0059 fechada | nenhum | **liberado** |
| 2 | `nuvem/usuario-bloqueio-designer-ux` · `8ad8a87` | MC-0060 fechada | MC-0064 (baixa) | **liberado com ajustes** |
| 3 | `nuvem/bko-revisao-designer-ux` · `ec94326` | nome "Promotor" conforme R-20261114-205500; MC-0057 e MC-0058 conferidas | nenhum | **liberado** |
| 4 | PR #250, `nuvem/acesso-bko-modulo-core` · `e6453f5` | MC-0027 e MC-0028 fechadas | MC-0061 (média), MC-0062 (média), MC-0063 (baixa) | **segura** até a MC-0061 e a MC-0062 |

## Lote 1 · Início do Campo, cabeçalho com a foto (MC-0059)
- **MC-0059 fechada.** Nos 4 HTMLs (`00-comparativo`, `01-variacao-a-56`, `02-variacao-b-64` e `03-variacao-c-72`) não sobrou nenhum balão numerado em `#C2540A`. O sino agora é o do app (`coresDoSino(true)` em `apps/mobile/src/lib/sino.ts` e `components/sino.tsx`):
  - botão de 48 com borda de 1 px `faixaTrilho` `#3A4D68` e raio 12 (`radius.md`);
  - ícone branco de 22;
  - bolinha de 12, sem número, em `graficoEscuro` `#F59A52` (5,85:1 na faixa), com aro de 2 px `faixa` `#1E3350`, a 10 px do topo e da direita.

  As medidas e as cores batem com o código. Os PNGs refeitos (o comparativo e as três variações) mostram o mesmo sino em todas as colunas, inclusive na "Antes".
- O laranja `#C2540A` que sobrou nos HTMLs é só o preenchimento das barras de meta sobre o branco, que é o papel dele (§3).
- **Achado novo:** nenhum. As cores são só da paleta, a tipografia é Archivo e IBM Plex nos pesos do kit e o contraste na faixa fica ≥ 4,5:1 (12,77, 8,07 e 10,99:1, como na spec).

## Lote 2 · Bloqueio de usuário no BKO (MC-0060)
- **MC-0060 fechada.** Na simulação (`usuario-bloqueio.html:63`), o item em foco do menu "⋯" agora tem fundo `accent-soft` `#DFE2E6` e contorno de 2 px Azul noite `#1E3350` por dentro. É o mesmo padrão do `MenuAcoes` do kit (`packages/ui/src/web/menu-acoes.tsx:132` no `ec94326`: `focus-visible:bg-accent-soft focus-visible:outline-accent focus-visible:-outline-offset-2`). O Pérola ficou só para o hover, e o print `2-menu-desbloquear-1366x768.png` mostra isso.
- **Achado novo:** MC-0064 (baixa). O resto do menu e os ícones de módulo da simulação seguem o desenho próprio do `modulo-core` (ver a MC-0061 e a MC-0062), e não o do kit que a própria spec cita.

## Lote 3 · Revisão do BKO, nome do módulo "Promotor"
- Conferido contra a decisão R-20261114-205500 ("Promotor" em todo lugar, "avulso" só na linha do preço):
  - `docs/design/telas/bko-revisao.md:300` (nomes dos módulos), `:308` (nome do adicional) e `:353` (§P13 e, decidida). Fora a linha do preço e o comentário de `adicionais.tsx:5`, não há "avulso" no doc, nas simulações de `bko-revisao/` nem no kit.
  - O kit segue a decisão: `modulos.tsx:51` (`promotor: { nome: 'Promotor', ... }`), e `adicionais.tsx:14` lê o nome e o ícone de `modulos.tsx` (um mapa só).
  - `portal-config-enxuto.md:210` mantém "Promotor · R$ 80,00 por licença avulsa/mês", que é a linha do preço e está permitida. Os testIDs `promotor-avulso` são identificadores técnicos e não aparecem para o cliente.
  - "Trade marketing" (`bko-revisao.md:33`) é o nome da **tela** de análise (menu aprovado em R-20261114-143000), não o do módulo. Fica como está.
- Conferidas de passagem: a MC-0058 (foco do `MenuAcoes`, citado no lote 2) e a MC-0057 (selo "Frete padrão: CIF" em `neutral`, `bko-revisao.md:292`).
- **Achado novo:** nenhum.

## Lote 4 · PR #250, Usuários e Perfis de acesso no menu em 9 grupos
- **Adaptação ao menu:** os 4 prints novos (`modules/core/web/docs/prints/acesso/*-1366x768.png`) mostram o shell certo:
  - logo A negativo no grafite, com o nome da distribuidora abaixo (MC-0056);
  - títulos de grupo em Sol claro `#F59A52` (MC-0054);
  - tela atual com a barra de 3 px e o fundo `#2B3743` (MC-0055);
  - "Acesso" aberto, com Aparelhos, Perfis de acesso e Usuários;
  - botão principal em Azul noite e campos com foco Azul noite.

  Está conforme a simulação aprovada.
- **MC-0027 fechada:** não há mais `accent-[#1e3350]`. As caixas usam `accent-accent` (`novo-perfil.tsx:57`).
- **MC-0028 fechada:** a `CaixaDoCabecalho` (`novo-perfil.tsx:32-55`) é branca, com o ✓ e o traço do estado "parte" em `text-accent`, sem o `#3B3B3B` do navegador. O print do Novo perfil mostra os três estados.
- **Achados novos:** MC-0061 e MC-0062 (médias, seguram) e MC-0063 (baixa).

## Achados
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0057 | baixa | revisão do BKO: frete padrão num selo de situação boa | §3 (verde só para sucesso) | selo `neutral` (`text-ink-3 bg-neutral-soft`) | designer-ux | fechado (`ec94326`, `bko-revisao.md:292`) |
| MC-0058 | baixa | revisão do BKO: foco do teclado no item do menu "⋯" | §3 (Azul noite é a cor de ação) | fundo `accent-soft` e contorno de 2 px Azul noite por dentro | designer-ux | fechado (`ec94326`, `menu-acoes.tsx:132`) |
| MC-0059 | baixa | simulação do Início do Campo: sino com balão numerado em `#C2540A` sobre a faixa (2,78:1) | §3 e MC-0009 (sino do app) | sino de `coresDoSino(true)` | designer-ux | fechado (`6f7023f`) |
| MC-0060 | baixa | simulação do bloqueio de usuário: foco do menu "⋯" em Pérola | §3 e MC-0058 | foco do kit (`accent-soft` + contorno Azul noite) | designer-ux | fechado (`8ad8a87`) |
| MC-0061 | média | PR #250: menu "⋯" próprio, o `MenuDaLinha` (`modules/core/web/components/acesso/menu-linha.tsx:39` e `:55`), usado em `usuarios-page.tsx:373` e `perfis-page.tsx:163` | §3 e MC-0058. O foco do item é só o contorno, sem o `accent-soft` e com o contorno por fora. O botão "⋯" (44 px, borda `field`, `font-bold`) e o item (`font-semibold`, 44 px) não são os do kit (botão de 36 px; item `font-medium` de 40 px). Usuários e Perfis ficam com um "⋯" diferente do de Pedidos, Clientes e Transportadoras | trocar o `MenuDaLinha` pelo `MenuAcoes` de `@macuxi/ui/web` (chega com o `ec94326`) e apagar `menu-linha.tsx`. Se o #250 entrar antes do kit, mudar a linha 55: `hover:bg-ground focus-visible:outline-2 focus-visible:outline-accent` → `hover:bg-ground focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`, e trocar pelo `MenuAcoes` no lote seguinte | modulo-core | aberto |
| MC-0062 | média | PR #250: ícones de módulo desenhados à parte (`modules/core/web/components/acesso/icones-modulo.tsx:15-62`), usados em `usuarios-page.tsx:368` e `:476` e em `novo-perfil.tsx:78` | MC-0042 (um desenho por módulo, no kit). O Promotor sai como **loja com toldo** (`:44`), e no kit é a **gôndola com produtos** (`IconPromotor`, `packages/ui/src/web/icons.tsx` no main). Pesquisa, Treinamento, Gestor e Vendedor também têm outro desenho, com traço 2 (o kit usa `TRACO_DO_MODULO`, 1,9). O admin vê dois ícones diferentes para o mesmo módulo no BKO e no portal. O comentário da linha 6 ("o kit ainda não tem ícones de módulo") não vale mais | usar `iconeDoModulo(id)` de `modulos.tsx` (com `IconVendedor`, `IconGestor` e `IconCore`, que chegam com o `ec94326`) e apagar os desenhos locais. Se o #250 entrar antes, `IconPromotor`, `IconPesquisa` e `IconTreinamento` já estão no main, e Gestor e Vendedor trocam no lote seguinte | modulo-core | aberto |
| MC-0063 | baixa | PR #250: 12 prints em `docs/modulos/core/telas/acesso/` (`usuarios-*`, `perfis-*`, `perfil-novo-*` e `usuarios-novo-*`, em 1366 e 1920), arquivos novos no `main` | §2.1 e MC-0056. Mostram o logo antigo, com "Macuxi FDV" escrito, e o menu antigo, com itens soltos e sem grupos. Não batem com a tela do PR | apagar os 12 (os 4 prints de `modules/core/web/docs/prints/acesso/` já cobrem as telas) ou refazê-los com o shell do PR | modulo-core | aberto |
| MC-0064 | baixa | simulação do bloqueio, `docs/design/telas/usuario-bloqueio/usuario-bloqueio.html`: `:57-58` (botão "⋯" de 44 px com borda e `font-weight:700`), `:62` (item de 44 px com `font-weight:600`) e `:125` e `:134-135` (ícones de módulo com traço 2, os do `modulo-core`) | §5 e checklist C. A spec diz que a tela usa o `MenuAcoes` do kit, sem estilo próprio, mas a imagem mostra o menu e os ícones do `MenuDaLinha` e do `icones-modulo.tsx` (MC-0061 e MC-0062) | simular o "⋯" como o do kit (36 px, raio 10, sem borda; item de 40 px com peso 500) e usar os ícones de `icons.tsx`, com traço 1,9 | designer-ux | aberto |

## Pendências para o gerente-projetos
- **O #250 segura** até a MC-0061 e a MC-0062. O caminho mais curto é fazer o merge do `ec94326` (kit com o `MenuAcoes` e o `modulos.tsx`) antes do #250, e o modulo-core trocar os dois componentes próprios pelos do kit. A MC-0063 vai no mesmo commit.
- A MC-0064 não segura o lote 2: é só imagem, e a spec já manda usar o kit. Vai no próximo commit do designer-ux.
- Fora do escopo da marca, para o `testes`: no print `usuarios-lista-1366x768.png` do #250, a "Renata Promotora" aparece com os módulos Gestor e Vendedor. Confirmar se é só o dado da demonstração.
