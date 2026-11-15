# Parecer de marca · lote da noite de 15/11/2026 (Início do Campo v1.0.9, revisão do BKO por módulo, e-mails de senha e ações de empresa no portal)

> 2026-11-15 · design-de-marca · pedido do Alexandre (R-20261114-221000-alexandre), via gerente-projetos.
> **Base:** `main` `a073edf1`, contra `docs/marca/manual.md` v1, `decisoes.md`, a spec da revisão do BKO (`docs/design/telas/bko-revisao.md`, T-0173) e a spec dos e-mails (`docs/design/emails/redefinir-senha.md`, #286, aprovada em R-20261114-202700).
> Cada lote foi lido com `git diff origin/main...<SHA>`. O SHA de cada branch foi conferido com `git rev-parse`.
> **Recados:** a CLI de recados dá HTTP 403 nesta nuvem. Os avisos aos donos vão pelo gerente-projetos.
> **Achados novos:** MC-0065. A numeração segue na MC-0066.

## Resumo
| Lote | Branch · SHA | Achados | Parecer |
|---|---|---|---|
| 7 | `nuvem/inicio-cabecalho-modulo-core` · `6f04e77e` | nenhum | **liberado** (build v1.0.9; reteste no print do aparelho) |
| 1 | `nuvem/bko-revisao-modulo-vendedor` · `1a151258` | nenhum | **liberado** |
| 2 | `nuvem/bko-revisao-modulo-gestor` · `2a2b5151` | nenhum | **liberado** |
| 3 | `nuvem/bko-revisao-modulo-integracao` · `d42516c9` | nenhum | **liberado** |
| 4 | `nuvem/bko-revisao-modulo-pesquisa` · `bf81b42b` | nenhum | **liberado** |
| 5 | `nuvem/bko-revisao-modulo-promotor` · `e4d71be3` | nenhum | **liberado** |
| 6 | `nuvem/bko-revisao-modulo-treinamento` · `0d9178c2` | MC-0065 (média) | **segura** |
| 8 | `nuvem/email-senha-engenheiro-software` · `d679a1a7` | nenhum | **liberado** (pendência dos PNG do logo) |
| 9 | `nuvem/empresa-acoes-engenheiro-apps` · `3dec04a5` | nenhum (a MC-0021 continua aberta, fora do lote) | **liberado** |

Os lotes 1 a 6 e o 9 não trazem print. A validação foi feita no código: cada classe e cada cor conferidas contra o kit e o manual. O reteste no navegador (1366×768) fica pendente, como pede a §P11 da spec.

## Lote 7 · Início do Campo, foto de 72 (modulo-core, `6f04e77e`)
- O que mudou desde o `d6a3623`, que já foi liberado (`pareceres/2026-11-15-reteste-lotes-b.md`, lote 4): o commit `6f04e77` (RD-0398) e o merge do `main`. A tela (`tela-inicio-campo.tsx`) e os prints **não mudaram**.
- O commit `6f04e77` liga a foto real ao cabeçalho: `foto-perfil.ts` lê a escolha viva em `usuario_avatar` (RN-CORE-42) e o shell resolve a URI. Sem foto, sem arquivo no aparelho ou com falha, ficam as iniciais. A conta da altura do painel virou uma só (`alturaDoPainel`, `linhasDeTexto`, `alturaDeLinha`). Nada disso mexe em cor, tipografia ou forma.
- Conferido de novo: só tokens (`faixaTitulo`, `faixaSub`, `accentInk` sobre `neutralBg`), `fonts.display` 22 na saudação (mínimo 0,75), `fonts.body` 13 na data e na frase, iniciais `fonts.display` 24, foto de 72 com piso de 56, raio `radius.xl` (16) com `overflow: 'hidden'` e a `Image` em `cover`. O sino é o `<Sino sobreFaixa />` do shell.
- Print `inicio-cabecalho-390x844-fonte-1-nome-curto-com-foto.png`: faixa Azul noite de ponta a ponta, foto de 72 com raio 16, "Boa noite, Lucas" em branco, data · DU e frase em `#C9CED5`, sino com a bolinha Sol claro. Igual ao aprovado.
- **Liberado** para o build v1.0.9.
- **Reteste no print do aparelho** (continua pendente): foto real recortada no raio 16, o sino na linha da saudação e a fonte do sistema em 1,0 e 1,3.

## Lote 1 · Revisão do BKO, Vendedor (`1a151258`)
Pedidos, aprovações, Transportadoras, Formas de pagamento e Alçadas.
- **Cor:** tudo do kit (`PageHeader`, `TabelaDados`, `MenuAcoes`, `SeloSituacao`, `Drawer`, `CampoFormulario`, `EstadoVazio`). Os selos usam os tons do kit, sempre com texto (Ativa/Inativa em `success`/`neutral`, status do pedido por `orderStatusTone`). Não há hex solto.
- **Total do filtro** ao lado do `h1`: Archivo 700, 18 px, `text-ink-2` (§P6, regra 4).
- **"Frete padrão: CIF"** no `Badge` `neutral` ao lado do título (MC-0057 conferida: é informação e não situação boa).
- **PDF:** só mudou de lugar (`exportar-pdf.ts`). O `buildOrderPdfHtml` é o mesmo, então cabeçalho, cores e "PEDIDO" em Azul noite não mudam.
- **Liberado.**

## Lote 2 · Revisão do BKO, Gestor (`2a2b5151`)
Alertas, Aprovações, Painel da equipe, Ranking e Regras de alerta.
- Kit em tudo. "Vencidos" em `text-danger` só quando há vencido, com o rótulo no KPI. Situação da regra: "Ligada" em `success` e "Desligada" em `neutral`, sempre com texto. O período do Ranking ao lado do título fica em `text-ink-2`. Não há hex solto nem cor nova.
- **Liberado.**

## Lote 3 · Revisão do BKO, Integração (`d42516c9`)
Monitor, lotes, gaveta do lote, carga por arquivo, de-para, conectores e inativações.
- Kit em tudo. Códigos em IBM Plex Mono (manual §5: Mono para códigos). Erros e percentuais acima do limite em `text-danger`, sempre ao lado de rótulo ou texto. Situação do de-para: `success`/`neutral`. Ícone de download do kit (`IconDownload`).
- **Liberado.**

## Lote 4 · Revisão do BKO, Pesquisa (`bf81b42b`)
Questionários, construtor e resultados.
- O botão principal "Novo questionário" é o `Button primary` do kit (Azul noite). O voltar "‹ Pesquisas" fica em `text-accent-ink`. Os selos são: Publicada `success`, Rascunho `pending` e Arquivado `neutral`.
- "Alterações não salvas" e "Suspeitas" em `text-warning`, com texto. A barra dos resultados em `bg-accent` (primeira série, manual §3, MC-0014 A).
- O link "Resultados" do construtor tem estilo local de botão secundário (`border-field`, `text-ink`). As cores são do kit, então não é achado de marca. A troca pelo componente do kit fica com o corretor, se ele julgar repetição.
- **Liberado.**

## Lote 5 · Revisão do BKO, Promotor (`e4d71be3`)
Cadastros de trade e Trade marketing.
- Menu "Trade" no grupo Conteúdo de campo (§M2 e §M7). O título da página continua "Cadastros de trade". O nome do módulo é "Promotor" (R-20261114-205500).
- Kit em tudo. Situação do share: atingiu `success`, abaixo `danger` e sem meta `neutral`, sempre com o rótulo. O aviso de marcas usa o `Notice` `info`. O link dentro dele já existia e herda a cor do aviso.
- **Liberado.**

## Lote 6 · Revisão do BKO, Treinamento (`0d9178c2`): segura
Trilhas e Editar trilha.
- Aba ativa em `border-accent text-accent-ink`, "Salvar" com o `Button primary`, barra de conclusão em `bg-accent` (primeira série). Tudo certo.
- **MC-0065 (média):** o botão "Nova trilha" é um `Link` com estilo próprio em grafite e com hex solto no hover. Ele aparece duas vezes: no cabeçalho e no vazio. Na tela vizinha, o "Novo questionário" da Pesquisa é Azul noite: o mesmo papel com duas cores no mesmo BKO.

| Campo | Conteúdo |
|---|---|
| ID | MC-0065 |
| Onde | BKO · Trilhas: `modules/treinamento/web/pages/trilhas-page.tsx:91` (cabeçalho, `treinamento.nova-trilha`) e `:357` (estado vazio) |
| Tipo | cor |
| Fere | manual §3 (o Azul noite é o botão principal; o grafite é texto, o botão Sincronizar e o menu do BKO) e checklist A (hex solto `#0b1218`, fora da paleta) |
| Gravidade | média (botão principal na cor errada, visível ao cliente) |
| Correção | nas duas linhas: `bg-ink … hover:bg-[#0b1218]` → `bg-accent … hover:bg-accent/90`, as mesmas classes do `Button primary` do kit (`packages/ui/src/web/ui.tsx:269`; branco no Azul noite 12,77:1). Se preferir, use o `Button variant="primary"` com navegação. |
| Dono | modulo-treinamento |

O defeito já existia no `main` (`trilhas-page.tsx:37`). O lote reescreveu a linha e ainda a copiou para o vazio, então é deste lote. É o mesmo padrão da MC-0021 do portal.

## Lote 8 · E-mails de senha (engenheiro-software, `d679a1a7`)
Conferi o código contra a spec do #286 (`docs/design/emails/redefinir-senha.md` §2, §3 e §5) e renderizei o HTML de `packages/platform-sdk/src/email/modelos.ts` no navegador, em três casos: Campo com logo, backoffice com o botão e celular no modo escuro.
- **Estrutura igual à spec:** fundo Pérola `#F8F6F1`, folha branca de 600 px com raio 12, logo positivo de 30 × 139, alt "Macuxi Força de Vendas" em Archivo 16/700 Azul noite, título Archivo 24/30 grafite `#16202A`, contexto em 15/22 `#4A5562` e bloco Pérola com borda `#DFE2E6`. No bloco, os rótulos vão em 13/18 `#5B6673`, os valores em Mono 17/24 e a senha em Mono 22/30 700.
- **Botão e assinatura:** botão "Abrir o backoffice" em Azul noite com texto branco, só com `web` e o endereço configurado. Filete Azul noite de 2 px e a assinatura do manual §7, "Equipe Macuxi FDV · Boa Vista, RR · macuxifdv.com.br".
- **Modo escuro:** folha Azul noite, bloco `#3A4D68`, textos `#C9CED5`, valores brancos, filete `#C9CED5`, botão branco com texto Azul noite e troca do logo para o negativo Azul noite.
- **Cores:** todas da paleta. O `#3A4D68` é o trilho do manual §4. Hex no HTML do e-mail é inevitável, porque o e-mail não lê token.
- **Remetente:** "Macuxi FDV", que não mudou.
- **Liberado.**
- **Pendência (não segura o lote):** sem `MACUXI_EMAIL_URL_ATIVOS`, o e-mail sai sem a imagem e com o alt em texto no lugar do logo. Para o logo aparecer, faltam três coisas:
  - **design-de-marca:** exportar `macuxi-logo-positivo-email.png` (fundo branco opaco) e `macuxi-logo-negativo-email.png` (fundo Azul noite), em 2× com 60 px de altura (spec §7);
  - **engenheiro-apps:** publicar os dois em `apps/web/public/email/`;
  - **quem faz o deploy:** configurar a variável no `email.env`.

  Reteste no e-mail real (Gmail e Outlook) depois disso.

## Lote 9 · Ações de empresa no portal (engenheiro-apps, `3dec04a5`)
Backup, Inativar/Reativar e Excluir na lista de Empresas.
- **Kit:** o menu "⋯" é o `MenuAcoes` do kit, com Excluir por último em perigo. Os diálogos usam o `Dialog` com `Button` `danger` ("Inativar", "Excluir empresa") e os campos do Excluir usam a `CLASSE_CAMPO`, com o código em Mono. O giro do backup é `border-line` com `border-t-accent`. Erros: linha `text-danger` ou `ErrorBlock`. Avisos: `Notice`.
- **Situação:** "Ativa" em `success` e as outras em `neutral` (`tomDoStatus`), sempre com texto. Não há hex solto nem cor nova.
- **Liberado.**
- **Fora deste lote, ainda aberta:** a **MC-0021** (média, engenheiro-apps). O `LinkBotao` do portal (`apps/web/components/portal/base.tsx:61`) segue em grafite com `hover:bg-[#0b1218]`, e o vazio "Cadastrar a primeira empresa" usa esse componente. O lote não mexeu no `base.tsx`.
- **Nota para o gerente:** o código cita "`portal-config-enxuto.md` §15" (textos e layout das ações), mas essa seção não está no `main` nem em nenhum branch buscado. Peça ao designer-ux a spec e os prints, para o reteste no navegador.

## Achados
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0065 | média | `modules/treinamento/web/pages/trilhas-page.tsx:91,357` ("Nova trilha" em grafite, `hover:bg-[#0b1218]`) | §3 e checklist A | `bg-ink … hover:bg-[#0b1218]` → `bg-accent … hover:bg-accent/90` | modulo-treinamento | **aberto**; segura o lote 6 |

Continuam abertos, fora destes lotes: MC-0021 (média, engenheiro-apps, `portal/base.tsx:61`), MC-0061 e MC-0062 (média) e MC-0063 (baixa), do `modulo-core`.

## Pendências para o gerente-projetos
- **Lote 6:** mandar a MC-0065 ao `modulo-treinamento`. Reteste no diff do commit novo.
- **Lote 7:** o `testes` manda o print do aparelho do v1.0.9, para o reteste final da marca no Início.
- **Lote 8:** os PNG do logo do e-mail (design-de-marca exporta, engenheiro-apps publica) e o `MACUXI_EMAIL_URL_ATIVOS` no deploy.
- **Lotes 1 a 6 e 9:** os prints 1366×768 de antes e depois (§P11) para o reteste no navegador. O lote 9 também precisa da spec §15 do portal.

---

# Parte 2 · lotes 10 a 13 (15/11/2026)

> 2026-11-15 · design-de-marca · continuação, pedido do gerente-projetos. Mesma base (`docs/marca/manual.md` v1, `decisoes.md` e a spec da T-0173, `docs/design/telas/bko-revisao.md`).
> Cada lote foi lido com `git diff origin/main...origin/nuvem/<branch>`. O SHA foi conferido com `git rev-parse`. Os prints foram abertos um a um, e as cores conferidas no pixel.
> **Achados novos:** MC-0066 a MC-0072. A numeração segue na MC-0073. **Retestadas e fechadas:** MC-0061, MC-0062 e MC-0063.
> **Recados:** a CLI continua com HTTP 403. Os avisos aos donos vão pelo gerente-projetos.

## Resumo da parte 2
| Lote | Branch · SHA | Achados | Parecer |
|---|---|---|---|
| 10 | `nuvem/acesso-bko-modulo-core` · `1ecb5fce` (PR #250) | MC-0061, MC-0062 e MC-0063 fechadas; nenhum novo | **liberado** |
| 13 | `nuvem/logo-cliente-designer-ux` · `184319e4` | MC-0066 (média), MC-0067 (média); MC-0068 (baixa, fora do lote) | **segura** (carga e login); portal, Mais (frase) e PDF conformes |
| 11 | `nuvem/bko-revisao-modulo-core` · `0c276eb5` | MC-0069 (média); MC-0070 (baixa, kit, fora do lote) | **segura** até a MC-0069 |
| 12 | `nuvem/bko-revisao-modulo-catalogo` · `5df48729` | MC-0071 e MC-0072 (baixas) | **liberado com ajustes** |

## Lote 10 · PR #250, Acesso no BKO e Desbloquear (modulo-core, `1ecb5fce`)
Reteste no commit `1ecb5fc`, sobre o `e6453f5` já lido (`pareceres/2026-11-15-reteste-lotes.md`, lote 4).
- **MC-0061 fechada.** O `menu-linha.tsx` foi apagado. Usuários (`usuarios-page.tsx`, coluna "⋯") e Perfis (`perfis-page.tsx:163`) usam o `MenuAcoes` do kit. Nos prints `usuarios-menu-desbloquear` e `perfis-menu`, o botão "⋯" e os itens são os do kit, com "Desativar" por último, em perigo e com a divisória.
- **MC-0062 fechada.** O `icones-modulo.tsx` e o `NOME_DO_MODULO_ACESSO` foram apagados. Nome e ícone vêm de `modulos.tsx` (`IconeModulo`, `modulosContrataveis`, traço 1,9). No print da lista, o Promotor é a gôndola do kit. No Novo perfil, o cabeçalho do Core leva o ícone do kit em branco sobre o Azul noite. O nome "Core" segue a §P10.
- **MC-0063 fechada.** Os 12 prints antigos (1366 e 1920) foram apagados. Os 11 de `docs/modulos/core/telas/acesso/` foram refeitos em 1366×768 com o shell atual: logo negativo grafite com o nome da distribuidora abaixo, títulos de grupo em Sol claro, tela atual em `#2B3743` com a barra laranja de 3 px.
- **Desbloquear (novo):**
  - **Selos:** um por linha, sempre com texto. "Inativo" em `neutral`, "Bloqueado" (pelo admin) em `danger` e "Bloqueado até 20h55" (por tentativas) em `warning`, pelo `Badge` do kit (`lib/usuarios.ts:218`). É situação, não enfeite (§3).
  - **Menu:** "Desbloquear" é o primeiro item do "⋯".
  - **Gaveta:** faixa `border-line bg-surface` com o selo e o `Button` secundário "Desbloquear".
  - **Cores e anúncio:** não há hex solto nem cor nova. O anúncio vai só para o leitor de tela.
- **Achado novo:** nenhum. **Liberado.**
- **Fora da marca, para o `testes` e o `engenheiro-apps`:** no print `usuarios-gaveta-bloqueado-1366x768.png`, a linha "Pesquisa" (caixa e ícone) aparece abaixo do rodapé da gaveta (Cancelar/Salvar), na borda de baixo da tela. Conferir se o rodapé do `Drawer` fica preso ao fundo com a lista rolando por trás.

## Lote 13 · Logo do cliente, simulação (designer-ux, `184319e4`)
Spec `docs/design/telas/logo-cliente.md` (no branch). Abri os 8 PNG e conferi os HTML e o CSS.

**Princípio da convivência das duas marcas** (manual §2.4 e §7):
- No **PDF**, a marca é a do cliente, e a Macuxi não aparece.
- No **app, no login e no portal**, a marca é a Macuxi, e a do cliente entra como assinatura de quem licenciou, **sempre menor e fora da área de proteção**.

O lote foi lido por esse princípio.

| Superfície | Conferência | Resultado |
|---|---|---|
| Portal `config.`, cartão "Logo" | barra Azul noite com o logo negativo; caixa de 240 × 96 branca, borda `#DFE2E6`, raio 12; "Salvar" no Azul noite; "Remover" secundário com texto `#A8261B` e diálogo com `danger`; erro em `#A8261B` com ícone e texto; limites em `#4A5562`. Ali a logo do cliente é o conteúdo editado, não compete com a marca | conforme |
| Carga, sem logo (telas 1) | igual à entrada aprovada (§4: empilhado negativo a 170, barra Sol claro, trilho `#3A4D68`, ✓ `#7FD1A8`) e, no Gestão, o Pérola com Sol laranja | conforme |
| **Carga, com logo (telas 2)** | logo empilhado Macuxi a 124 dp (≈115 dp de altura, "M" ≈24 dp), filete de 1 × 84 a **22 dp**, placa branca de **136 × 84 dp** | **MC-0066** |
| **Login, com logo (telas 4)** | logo Macuxi da faixa a **44 dp** de altura; logo do cliente a **48 dp** de altura e até 196 dp de largura, na placa de 64 | **MC-0067** |
| Mais | "Licenciado para Exemplo Norte" em `type.small` `#4A5562` (7,03:1), centralizado, no pé; a faixa "Mais" segue Azul noite. É uma voz certa, curta e de quem conhece o negócio. A placa é de **72 dp com logo de 56 dp**, maior que no login | frase conforme; tamanho na **MC-0067** |
| PDF de pedido e de orçamento | a logo do cliente no cabeçalho, sem a Macuxi (§7); a caixa nova `.logo` (altura de 16 mm, largura até 48 mm, `contain`, à esquerda, sem raio) não deforma a logo; "PEDIDO" em Azul noite e o cabeçalho verde `#00843D` da tabela, como aprovado; sem logo volta a `logo-padrao-pdf-256.png` | conforme. Os neutros do PDF estão fora da paleta, mas isso vem do `main`: **MC-0068** |
| Regras gerais (§1 da spec) | `contain`, nunca recortar nem recolorir, sem sombra, sem texto explicativo e com rótulo de acessibilidade | conforme |

Cores dos HTML: só a paleta. O `#E4E6E9` e o `#BFC4CC` são o fundo da prancha e a moldura do celular, que não vão para o produto. A logo "Exemplo Norte" é fictícia, e não há marca de terceiros.

**MC-0066 (média): carga com logo, as duas marcas no mesmo nível.**
- **Por que fere o manual:** ao lado, com a mesma altura de bloco (84 dp de placa contra ~115 dp do empilhado) e mais larga que o logo Macuxi (136 contra 124 dp), a placa branca é o elemento mais claro e pesado da tela Azul noite. A leitura é de **co-marca**, e o manual proíbe pôr o logo da Macuxi no mesmo nível do logo da distribuidora (§2.4).
- **Área de proteção:** o filete fica a 22 dp do logo e o "M" mede ~24 dp, então ele entra na área de proteção (§2.3).
- **Decisão do Alexandre:** é pedido dele ("ao lado"), e só ele aprova a marca. Opções:

| Opção | Como fica | Para o negócio |
|---|---|---|
| **A (recomendada)** | Continua **ao lado**, com hierarquia: placa de **64 dp** de altura e até **112 dp** de largura (logo com 48 dp de altura e até 96 dp de largura); filete de 1 × 64 a **24 dp** de cada lado (a altura do "M"). Largura total: 124 + 24 + 1 + 24 + 112 = 285 dp, que cabe nos 312 úteis | atende ao pedido. A Macuxi segue como a marca do produto (115 dp contra 64), e o cliente se reconhece logo na entrada |
| B | Placa de 64 dp **abaixo** do logo Macuxi, entre o logo e o "Olá" (a alternativa da própria spec §8.1) | hierarquia mais clara, mas foge do "ao lado" que foi pedido |
| C | Fica como está (84 dp) | exige mudar o §2.4 do manual: a carga vira co-marca. Não recomendo, porque abre precedente para o cliente "dividir" a marca do produto |

- **Imagem simulada:** o designer-ux gera as telas A e B no próprio `carga-login.html`, nos dois apps, para o Alexandre escolher. Até a decisão, a carga com logo **segura**.

**MC-0067 (média): tamanho da logo do cliente no login e no Mais.**
- **No login:** a logo do cliente (48 dp) fica **maior** que o logo Macuxi da faixa (44 dp), com quase a mesma largura (196 contra ~204 dp). A posição no formulário, fora da faixa, está certa (spec §4). Mas o tamanho põe o cliente acima da Macuxi na tela de entrada do app (§2.4).
- **No Mais:** a placa é outra, de 72/56. A mesma peça muda de tamanho de uma tela para a outra, e marca se constrói com o mesmo sinal repetido.
- **Correção:** **uma placa só**, nos dois lugares:
  - placa de **52 dp** de altura e até **176 dp** de largura (8 dp de folga em cima e embaixo e 12 dp dos lados);
  - logo com **36 dp** de altura e até **152 dp** de largura.

  No login: `.form .placa{height:64px;max-width:220px}` → `height:52px;max-width:176px`, e `.form .placa img{height:48px;max-width:196px}` → `height:36px;max-width:152px`. No Mais, a mesma medida no lugar de 72/56. Na spec, a §4 e a §5 passam a citar a placa única, que vira o componente de `packages/ui` da §7.

**MC-0068 (baixa, fora do lote, `modulo-vendedor`): neutros fora da paleta no PDF.** A simulação usa o `buildOrderPdfHtml` do `main`, e ali estão:
- `modules/vendedor/domain/pdf-pedido.ts:207` (`.ficha`, `#F1F2F0`);
- `:229` (zebra, `#F3F4F1`, o cinza que o Alexandre recusou em 12/11, `decisoes.md`);
- `:239` (`.totalbox`, `#ECEEEA`).

São "quase iguais" aos neutros aprovados (§3, combinações proibidas, e a regra dos neutros da MC-0004 B). **Correção:** `#F1F2F0` → `#ECEEF1` (Névoa), `#ECEEEA` → `#ECEEF1` (Névoa) e `#F3F4F1` → `#F8F6F1` (Pérola, a zebra fica leve). Não segura este lote, porque não é dele. Vai junto com a aplicação da MC-0004 no PDF.

**Para o Alexandre (nada entra no manual sem o "aprovo" dele):** a regra "logo do cliente no app" é **nova** e, depois de aprovada, vira a §2.5 do manual com três pontos: placa branca única de 52/36, sempre menor que o logo Macuxi da tela, e fora da área de proteção.

## Lote 11 · Revisão do BKO, Core, 16 telas (modulo-core, `0c276eb5`)
Farol, Usuários e módulos, Aparelhos, Carteira, Cliente 360, Coordenadas, Preço e custo, Recados, Visitas, Motivos, Fotos do PDV, Metas, Plano de RV, Indicadores, Rotas e Filiais (e Tarefas, no código). Diff com 2.063 linhas a mais e 2.207 a menos, e 32 prints.
- **Código:** não há hex solto (as únicas ocorrências do filtro são `font-mono`, de códigos, coordenadas, CNPJ e sigla, como manda o §5). As cores são só tokens do kit:
  - links e "não lida" em `text-accent-ink` (no Cliente 360, "Ligar", "WhatsApp" e "‹ Carteira" saem em `#1E3350` no pixel);
  - "Recado do dia" em chip `bg-accent-soft text-accent-ink` (o Azul suave do chip em destaque, §3);
  - erros em `text-danger`, com texto.
- **Farol:** as abas Clientes e Vendedores usam `border-accent text-accent-ink` com foco do kit. Os KPIs das faixas têm uma barra `bg-success`/`bg-warning`/`bg-danger`/`bg-disabled`, sempre com o rótulo ("Verdes", "Amarelos", "Vermelhos", "Sem compra"). O farol é situação, e a cor tem texto ao lado. A "Positivação" sai na cor da faixa, como diz a §P6 da spec. O marcado leva um traço de 2 px Azul noite.
- **Prints (depois):** o botão principal está no Azul noite `#1E3350` em Recados, Indicadores, Metas, Plano de RV e Carteira. As abas de Recados são `Button` primário e secundário.
- **MC-0069 (média):** Usuários e módulos (`licencas-page.tsx:122`): a aba ativa "Empresa / Perfil / Usuário" sai em **grafite** `#16202A` (pixel do print `depois/licencas`). No mesmo lote, a aba ativa de Recados é Azul noite e a do Farol é traço Azul noite. A linha já existia no `main`, mas a tela está na revisão deste lote (§P11) e o arquivo foi reescrito. É o mesmo padrão da MC-0065. **Correção:** `'border-ink bg-ink text-white'` → `'border-accent bg-accent text-white'`, ou o `Button size="sm" variant={n === nivel ? 'primary' : 'secondary'}` como em Recados (`recados-page.tsx:150`).
- **MC-0070 (baixa, kit, fora do lote, `designer-ux`):** o interruptor ligado do `CartaoDeModulo` e do `LinhaDePermissao` é grafite (`packages/ui/src/web/permissoes.tsx:118`, `marcado ? 'bg-ink'`), e aparece em Usuários e módulos. O Azul noite é a cor de ação e de estado ativo (§3), como na MC-0051 (caixa marcada) e na MC-0018 (interruptor da prancha). **Correção:** `'bg-ink'` → `'bg-accent'` (a bolinha branca no Azul noite dá 12,77:1, e a trilha no branco passa de 3:1). Não segura o lote, porque é do kit e já existia.
- **Para o gerente (evidência, não é marca):** 6 dos 16 pares de prints são **o mesmo arquivo** em `antes/` e `depois/` (blob igual): Filiais, Fotos do PDV, Motivos, Preço e custo, Recados e Visitas. O print de Recados já mostra o layout novo, então um dos dois lados está errado. O `modulo-core` precisa gerar de novo o "antes" do `main` (ou o "depois") dessas 6 telas, para o corretor e o reteste da marca no navegador.
- **Para o corretor e o testes (não é marca):** o campo Mês mostra "November 2026" (o `input type="month"` no idioma do navegador da captura), e o Cliente 360 mostra "Última compra 2026-11-10" em formato ISO.
- **Segura** até a MC-0069.

## Lote 12 · Revisão do BKO, Catálogo (modulo-catalogo, `5df48729`)
Catálogo (produtos, sinônimos e exportação), Marcas e Tabelas de preço. O lote **não traz print**, então a validação foi feita no código.
- **Kit em tudo:** `PageHeader`, `TabelaDados`, `MenuAcoes`, `Drawer`, `Dialog`, `CampoBusca`, `CLASSE_CAMPO`, `EstadoVazio` e `SeloSituacao`.
- **Abas:** as de Catálogo e de Tabelas de preço são `Button` primário e secundário (Azul noite), iguais às de Recados.
- **Botões:** "Novo …" usa o `Button primary`, e os de remover e inativar usam o `danger`.
- **Situação:** "Ativo/Ativa" em `success` e "Inativo/Inativa" em `neutral`. Nas faixas, "Vigente" em `success`, "Acima da tabela" em `warning` e "Fora da vigência" em `neutral`. Sempre com texto.
- **Cores e fontes:** códigos em Mono. Não há hex solto.
- **MC-0071 (baixa):** `catalogo-page.tsx:191`: o produto em **destaque** (campanha) leva um selo `success` (verde) "Destaque". Destaque não é situação de sucesso, e o verde fica como enfeite (§3, mesmo caso da MC-0057). O manual reserva o Azul suave para o "chip e o cartão em destaque". **Correção:** `{ tom: 'success', texto: 'Destaque' }` → `{ tom: 'pending', texto: 'Destaque' }`, que no kit é `text-accent-ink bg-accent-soft` (Azul noite no Azul suave, 9,83:1).
- **MC-0072 (baixa):** `catalogo-page.tsx:533`: o link para Marcas saiu do `Notice` e ficou dentro de um `span text-ink-2`, então sai em cinza `#4A5562`, e o link é Azul noite (§3). **Correção:** `className="font-semibold underline"` → `className="font-semibold text-accent-ink underline"`.
- **Liberado com ajustes:** as duas correções são de uma linha cada e vão no mesmo PR, antes do merge.
- **Pendente:** os prints 1366×768 de antes e depois (§P11), para o reteste no navegador.

## Achados da parte 2
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0061 | média | `#250`: menu "⋯" próprio | §3, MC-0058 | `MenuAcoes` do kit | modulo-core | **fechado** (`1ecb5fc`) |
| MC-0062 | média | `#250`: ícones de módulo próprios | MC-0042, §P10 | `IconeModulo` de `modulos.tsx` | modulo-core | **fechado** (`1ecb5fc`) |
| MC-0063 | baixa | `#250`: 12 prints antigos | §2.1, MC-0056 | apagados e refeitos | modulo-core | **fechado** (`1ecb5fc`) |
| MC-0066 | média | simulação da carga com logo (`docs/design/telas/logo-cliente.md` §3, `carga-login.html:16-17`) | §2.4 (mesmo nível) e §2.3 (filete a 22 dp, "M" ≈24 dp) | decisão do Alexandre; recomendada a opção A: placa de 64 × até 112 dp, filete de 1 × 64 a 24 dp | designer-ux | **aberto**; segura |
| MC-0067 | média | simulação: login (`carga-login.html:31-32`, logo de 48 dp contra 44 dp da Macuxi) e Mais (72/56) | §2.4 e consistência (B) | placa única de 52 × até 176 dp com logo de 36 × até 152 dp | designer-ux | **aberto**; segura |
| MC-0068 | baixa | `modules/vendedor/domain/pdf-pedido.ts:207,229,239` (`#F1F2F0`, `#F3F4F1`, `#ECEEEA`), no `main` | §3 (quase igual) e MC-0004 B | `#ECEEF1`, `#F8F6F1` (zebra) e `#ECEEF1` | modulo-vendedor | **aberto**; fora do lote |
| MC-0069 | média | `modules/core/web/components/licencas/licencas-page.tsx:122` (aba ativa grafite) | §3 (aba ativa Azul noite) | `border-ink bg-ink` → `border-accent bg-accent` | modulo-core | **aberto**; segura o lote 11 |
| MC-0070 | baixa | `packages/ui/src/web/permissoes.tsx:118` (interruptor ligado grafite) | §3, MC-0051 | `bg-ink` → `bg-accent` | designer-ux | **aberto**; fora do lote |
| MC-0071 | baixa | `modules/catalogo/web/pages/catalogo-page.tsx:191` (selo "Destaque" verde) | §3 (verde como enfeite) | `tom: 'success'` → `tom: 'pending'` | modulo-catalogo | **aberto** |
| MC-0072 | baixa | `modules/catalogo/web/pages/catalogo-page.tsx:533` (link em `text-ink-2`) | §3 (link Azul noite) | adicionar `text-accent-ink` | modulo-catalogo | **aberto** |

## Pendências da parte 2 para o gerente-projetos
- **Lote 10:** o #250 está liberado pela marca. Mandar a nota da gaveta ao `testes` e ao `engenheiro-apps`.
- **Lote 13:**
  - levar a MC-0066 ao Alexandre, com as opções A, B e C, e pedir ao designer-ux as telas A e B simuladas;
  - mandar a MC-0067 ao designer-ux;
  - mandar a MC-0068 ao `modulo-vendedor`.
- **Lote 11:**
  - mandar a MC-0069 ao `modulo-core`, junto com o pedido de refazer os 6 pares de prints iguais;
  - mandar a MC-0070 ao `designer-ux`.
- **Lote 12:** mandar a MC-0071 e a MC-0072 ao `modulo-catalogo` e pedir os prints da §P11.
