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

---

# Parte 3 · lotes 14 a 19 (15/11/2026)

> 2026-11-15 · design-de-marca · continuação, pedido do gerente-projetos. Mesma base: `docs/marca/manual.md` v1, `decisoes.md`, a spec da T-0173 (`docs/design/telas/bko-revisao.md`) e a spec do rodapé legal (`docs/design/telas/rodape-legal.md`, no `main` pelo #290).
> Cada lote foi lido com `git diff origin/main...origin/<branch>`. Nos retestes, também com o diff contra o SHA lido na parte 2. O SHA de cada branch foi conferido com `git rev-parse`. Os prints foram abertos um a um, e as cores conferidas no pixel.
> **Achados novos:** MC-0073 e MC-0074. A numeração segue na MC-0075. **Retestadas e fechadas:** MC-0065, MC-0067, MC-0069, MC-0071 e MC-0072.
> **Recados:** a CLI continua com HTTP 403. Os avisos aos donos vão pelo gerente-projetos.

## Resumo da parte 3
| Lote | Branch · SHA | Achados | Parecer |
|---|---|---|---|
| 14 | `nuvem/rodape-shell-engenheiro-apps` · `155bc0d4` | nenhum | **liberado** (build v1.0.9; reteste no print do aparelho e do navegador) |
| 15 | `agente/engenheiro-apps-login-v109` · `0e3292de` | nenhum | **liberado** (build v1.0.9) |
| 16 | `nuvem/bko-revisao-modulo-treinamento` · `1d1436eb` | MC-0065 fechada | **liberado** |
| 17 | `nuvem/bko-revisao-modulo-core` · `6bf52819` | MC-0069 fechada; MC-0073 (baixa) | **liberado com ajustes** |
| 18 | `nuvem/bko-revisao-modulo-catalogo` · `a058713b` | MC-0071 e MC-0072 fechadas; MC-0074 (média, fora do lote) | **liberado** |
| 19 | `nuvem/logo-cliente-designer-ux` · `64a18b97` | MC-0067 fechada; MC-0066 com as variações A e B prontas | **segura só a carga com logo**, até a escolha do Alexandre; login, Mais, portal e PDF conformes |

## Lote 14 · Rodapé legal e T-0173 no shell do BKO (engenheiro-apps, `155bc0d4`)
Commits `a3b5b1c` (rodapé legal nas quatro telas Entrar) e `155bc0d` (Auditoria e Início do BKO), sobre o merge da parte da API do engenheiro-software (`a9965d7`, `1e0eaae`, `788cc48`), que não tem superfície de marca. O lote não traz print. Conferi o código contra a spec `rodape-legal.md` §2 e as simulações dela (`rodape-legal-campo-depois-preenchido.png`).
- **Rodapé no Campo e no Gestão** (`apps/mobile/src/components/rodape-legal.tsx`):
  - texto em `fonts.body` 12/16, `colors.ink2` (`#4A5562`, 7,03:1 no Pérola), centralizado, 2 dp entre linhas;
  - o site é link em `fonts.semibold` 12, `colors.accentInk` (`#1E3350`, 11,82:1) e sublinhado;
  - é o último item do bloco de baixo e some com o teclado aberto;
  - a frase "Macuxi Campo · vendedores e promotores" saiu, como pede a spec. O logo da faixa já diz a marca.
- **Rodapé no BKO e no portal** (`apps/web/components/rodape-legal.tsx`): `<footer>` em `text-[12px] leading-4 text-ink-2`, `max-w-[440px]`, link `font-semibold text-accent-ink underline` com o foco `outline-accent` do kit. Fica no pé da página (`mt-auto pt-8 pb-6`), no Entrar do BKO (real e demonstração) e no Entrar do portal. A "Escolha a empresa" não leva o rodapé.
- **Voz:** "© 2026 · Todos os direitos reservados", "Versão X.Y.Z · macuxifdv.com.br" e a linha da empresa só com o que estiver no cadastro. É curto e direto, sem repetir o nome do produto, e o site sai sem `https://` e sem `www`. Conforme.
- **T-0173 no shell:**
  - Início do BKO: só o título "Backoffice", sem o `eyebrow`, e o vazio é o `EstadoVazio` do kit;
  - Auditoria: título com a contagem, "Atualizar" no `MenuAcoes`, "Limpar filtros" e a `TabelaDados`, tudo do kit;
  - o `later-page.tsx` foi apagado (não era mais usado), e com ele o "Em breve" em `text-accent-ink`.
  Não há hex solto nem cor nova.
- **MC-0052, MC-0054, MC-0055 e MC-0056:** o lote não mexe no menu lateral nem na barra superior. As três decisões do menu (Sol claro no título de grupo, `#2B3743` na tela atual, logo negativo grafite com o nome da distribuidora) continuam aplicadas, como se vê nos prints dos lotes 17 e 18. A **MC-0052** (barra superior Azul noite) continua aberta, fora deste lote.
- **MC-0021** (portal, `LinkBotao` em grafite): o lote mexe no `portal/base.tsx` só na `MolduraEstreita`. A MC-0021 continua aberta, fora do lote.
- **Liberado** para o build v1.0.9.
- **Reteste:** no print do aparelho (Campo e Gestão, com e sem razão social e CNPJ) e no navegador (Entrar do BKO e do portal, 1366×768).

## Lote 15 · Código da empresa no login do BKO e no Esqueci (engenheiro-apps, `0e3292de`)
O lote muda só as propriedades do campo: `maxLength` de UF + 4 dígitos, no BKO (`login-screen.tsx`, `ciclo-senha.tsx`) e no app (`propsDoCampoCodigoEmpresa`, com maiúsculas e sem corretor). O rótulo, a classe do campo, a ordem e o espaçamento não mudam, e não há cor nem fonte nova.
- **Liberado** para o build v1.0.9.
- **Para o gerente (não é marca):** os dois lotes do v1.0.9 mexem no `tela-login.tsx` e no `login-screen.tsx`. O lote 14 tira a prop `rodape` do `login.tsx`, e o 15 mexe nas linhas vizinhas. Conferir o merge dos dois antes do build.

## Lote 16 · Treinamento, reteste da MC-0065 (`1d1436eb`, anterior `0d9178c2`)
- **MC-0065 fechada.** O "Nova trilha" do cabeçalho (`trilhas-page.tsx:91`) e o do vazio (`:357`) passaram a ser o `Button variant="primary"` do kit, em Azul noite com o hover do kit. Saíram o `bg-ink` e o `hover:bg-[#0b1218]`. O botão agora tem a mesma cor do "Novo questionário" da Pesquisa.
- O resto do diff (`d5b5f52`) só tira texto, sem efeito na marca: o aviso de só leitura e o rótulo "Ativos".
- **Liberado.**

## Lote 17 · Core, reteste da MC-0069 e dos prints (`6bf52819`, anterior `0c276eb5`)
- **MC-0069 fechada.** A aba ativa de Usuários e módulos (`licencas-page.tsx:122`) passou a `border-accent bg-accent text-white`. No print `depois/licencas-1366x768.png`, o pixel da aba "Empresa" é `#1E3350`.
- **Prints:** os 6 pares que eram o mesmo arquivo foram refeitos (Filiais, Fotos do PDV, Motivos, Preço e custo, Recados e Visitas). Nenhum par de `antes/` e `depois/` é mais igual. Abri os 6 pares, e o "antes" mostra o layout do `main`, com subtítulo, quadro e botões soltos na linha. O "depois" mostra o layout da revisão.
  - Em todos: botão principal Azul noite, abas de Preço e custo e de Recados em `Button` primário e secundário, menu "⋯" do kit e selos sempre com texto.
  - O shell segue as decisões do menu (MC-0054 a MC-0056).
- **Ainda no print de Licenças:** o interruptor ligado continua grafite `#16202A`. É a **MC-0070**, do kit (`designer-ux`), aberta e fora do lote.
- **MC-0073 (baixa): "Inativo" com duas cores no mesmo BKO.** Nos prints de Filiais e Fotos do PDV, "Inativa" e "Inativo" saem no tom de aviso (âmbar `#7A4F00` no `#FFF1D6`). Em Usuários, Perfis, Catálogo, Marcas e Vendedor, a mesma situação sai em `neutral`.
  - O amarelo do aviso pede atenção, e um cadastro inativo não pede ação: é um estado parado (§3, cor no seu papel). A mesma situação em duas cores também quebra a repetição dos mesmos sinais.
  - As linhas foram reescritas neste lote. O defeito vem do `main`.
  - Faixas e situações que pedem ação, como "Incompleta" na Filial, continuam no tom de aviso, e isso está certo.
  - Correção nas linhas abaixo:

| Arquivo:linha | Antes | Depois |
|---|---|---|
| `modules/core/web/components/filiais/filiais-page.tsx:119` | `{ tom: 'warning', texto: 'Inativa' }` | `{ tom: 'neutral', texto: 'Inativa' }` |
| `modules/core/web/components/fotos-pdv/fotos-pdv-page.tsx:83` | `t.ativo ? 'success' : 'warning'` | `t.ativo ? 'success' : 'neutral'` |
| `modules/core/web/components/motivos/motivos-page.tsx:97` | `… m.ativo ? 'success' : 'warning'` ("Desativado") | `… m.ativo ? 'success' : 'neutral'` |
| `modules/core/web/components/produtos/medidas-panel.tsx:93` | `m.ativo ? 'success' : 'warning'` | `m.ativo ? 'success' : 'neutral'` |

- **Liberado com ajustes:** as quatro correções são de uma linha cada e vão no mesmo PR, antes do merge.
- **Para o corretor e o testes (não é marca):** continuam o "November 2026" e as datas ISO apontados na parte 2.

## Lote 18 · Catálogo, reteste da MC-0071, da MC-0072 e dos prints (`a058713b`, anterior `5df48729`)
- **MC-0071 fechada.** O selo "Destaque" (`catalogo-page.tsx:191`) passou a `tom: 'pending'`. No print `catalogo-produtos-depois`, o selo é o texto `#1E3350` sobre o `#DFE2E6` (9,83:1).
- **MC-0072 fechada.** O link "Cadastrar marcas concorrentes" (`:533`) ganhou `text-accent-ink`. No print `catalogo-produto-gaveta-link-marcas-depois`, ele sai em `#1E3350`, sublinhado.
- **Prints:** abri os 13 prints de 1366×768 em `docs/modulos/catalogo/bko-revisao/`. O lote não tem prints "antes", o que o README avisa.
  - Abas em `Button` primário e secundário, com a contagem.
  - "Nova marca", "Novo grupo", "Nova faixa" e "Salvar" em Azul noite.
  - "Inativar" por último no "⋯", em vermelho.
  - Selos sempre com texto: "Ativa" `success`, "Inativa" `neutral`, "Vigente" `success`, "Acima da tabela" `warning`, "Fora da vigência" `neutral`.
  - Erro do campo em `#A8261B`, com ícone e texto.
  - O vazio é o `EstadoVazio` do kit.
  - Shell conforme.
- **MC-0074 (média, fora do lote, `engenheiro-apps`): caixa de seleção nativa em azul do navegador.** Na gaveta "Nova faixa" (`tabelas-preco-escalonada-gaveta-depois`), a caixa "Ativa" marcada sai em **`#0075FF`**, o azul padrão do Chrome. É uma cor fora da paleta, visível ao cliente.
  - O `globals.css` não define `accent-color`. As caixas nativas do BKO (cerca de 30 no `main`, em vários módulos, por exemplo `tabelas-preco-page.tsx:405` e `catalogo-page.tsx:686`) usam a cor de cada navegador.
  - O defeito não é deste lote, por isso não segura.
  - **Correção, num lugar só**, em `apps/web/app/globals.css`, dentro do `@layer base`: `input[type='checkbox'], input[type='radio'] { accent-color: var(--color-accent); }` (Azul noite, o mesmo da MC-0051).
  - A caixa do `SeletorDePerfis` (`permissoes.tsx:341`, `accent-[var(--color-ink)]`) continua na MC-0051, do `designer-ux`.
- **Liberado.**
- **Para o testes e o corretor (não é marca):** os campos de data da gaveta mostram "mm/dd/yyyy", no idioma do navegador da captura.

## Lote 19 · Logo do cliente, reteste da MC-0067 e variações da MC-0066 (designer-ux, `64a18b97`, anterior `184319e4`)
Um commit (`64a18b9`): a spec `logo-cliente.md` §3, §4, §5, §7 e §8, o `carga.html` (que era o `carga-login.html`), o `login.html` novo, o `mais.html` e 7 PNG. Abri os 7 PNG e medi no pixel.
- **MC-0067 fechada.** A placa única tem 52 dp de altura, até 176 de largura, e a logo dentro tem 36 dp, até 152:
  - no login (`login-campo.png`, `login-gestao.png`), a placa mede ~51 dp de altura e o logo Macuxi da faixa, 44 dp. A logo do cliente agora é menor que a Macuxi e fica no formulário, fora da faixa;
  - no Mais (`mais.png`), a placa é a mesma, abaixo de "Licenciado para Exemplo Norte" (`#4A5562`). Nas três telas, a peça é igual.
- **MC-0066, variações prontas para o Alexandre.** Cada imagem tem, à esquerda, a carga sem logo (igual à aprovada, §4) e, à direita, a carga com logo.

| | Variação A (recomendada): ao lado | Variação B: abaixo |
|---|---|---|
| Medida no pixel | Logo Macuxi com ~115 dp de altura e "M" de ~24,6 dp. Filete a ~24,6 dp do logo, igual à altura do "M", então no limite da área de proteção, sem invadir (§2.3). Placa de 64 dp | Logo Macuxi a 170 dp, como na tela sem logo. Placa de 64 dp a ~38 dp do logo, mais que o "M" (~33 dp) |
| Hierarquia | A Macuxi tem quase o dobro da altura da placa: o produto é Macuxi, licenciado ao cliente | Ainda mais clara: o logo Macuxi não diminui |
| Pedido do Alexandre | atende ao "ao lado" | foge do "ao lado" |
| Campo e Gestão | Campo: placa branca sem borda no Azul noite, filete `#3A4D68`. Gestão: placa com borda `#DFE2E6` no Pérola, filete `#DFE2E6` | a mesma placa, sem filete |

- **Cores:** só da paleta e da entrada aprovada: Sol claro `#F59A52` e trilho `#3A4D68` no Campo, Sol laranja `#C2540A` e trilho `#DFE2E6` no Gestão, e o ✓ `#7FD1A8` e `#1D6B4F`. A logo "Exemplo Norte" é fictícia, então não há marca de terceiros.
- **Recomendação (mantida):** a **A**. Atende ao que o Alexandre pediu e mantém a Macuxi como a marca do produto na tela de entrada. A B é a saída segura, se ele achar que lado a lado ainda parece co-marca.
- **Parecer:** a carga com logo **segura** até a escolha do Alexandre. Nada dela vai para o código antes disso, e a spec já diz isso (§3). Login, Mais, portal e PDF estão **conformes** e podem seguir para a implementação.
- **A regra nova também depende do "aprovo" dele:** placa branca única de 52/36 no login e no Mais, 64/48 na carga, sempre menor que o logo Macuxi da tela e fora da área de proteção. Ela só entra no manual (§2.5) depois disso.
- **MC-0068** (neutros do PDF, `modulo-vendedor`): continua aberta, fora do lote.

**Para o gerente mandar ao Alexandre** (todos no branch `nuvem/logo-cliente-designer-ux` `64a18b97`, pasta `docs/design/telas/logo-cliente/`):
1. **A escolha A ou B da carga:**
   - `carga-campo-a.png` e `carga-campo-b.png`;
   - `carga-gestao-a.png` e `carga-gestao-b.png`.
2. **Para conhecimento da placa única**, que entra na mesma aprovação da regra §2.5: `login-campo.png` e `mais.png`. O `login-gestao.png` é igual ao do Campo, só muda a legenda.

Pergunta sugerida: *"Carga do app com a logo da distribuidora: A (ao lado, recomendada) ou B (abaixo)? E aprova a placa única da logo do cliente no login e no Mais (52 dp, sempre menor que o logo Macuxi)?"*

## Achados da parte 3
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0065 | média | `trilhas-page.tsx:91,357` | §3, checklist A | `Button variant="primary"` | modulo-treinamento | **fechado** (`1d1436e`) |
| MC-0066 | média | carga com logo (`logo-cliente.md` §3) | §2.4, §2.3 | variações A e B prontas (`64a18b9`) | designer-ux · dono do produto | **aberto**; aguarda a escolha do Alexandre |
| MC-0067 | média | placa do login e do Mais | §2.4, consistência | placa única de 52/36 | designer-ux | **fechado** (`64a18b9`) |
| MC-0069 | média | `licencas-page.tsx:122` | §3 | `border-accent bg-accent` | modulo-core | **fechado** (`6bf5281`) |
| MC-0071 | baixa | `catalogo-page.tsx:191` | §3 | `tom: 'pending'` | modulo-catalogo | **fechado** (`a058713`) |
| MC-0072 | baixa | `catalogo-page.tsx:533` | §3 | `text-accent-ink` | modulo-catalogo | **fechado** (`a058713`) |
| MC-0073 | baixa | `filiais-page.tsx:119`, `fotos-pdv-page.tsx:83`, `motivos-page.tsx:97`, `medidas-panel.tsx:93` ("Inativo" em `warning`) | §3 (cor no seu papel) e consistência | `'warning'` → `'neutral'` | modulo-core | **aberto**; liberado com ajustes |
| MC-0074 | média | caixas de seleção nativas do BKO em `#0075FF` (sem `accent-color` no `apps/web/app/globals.css`) | §3 (cor fora da paleta) | `input[type='checkbox'], input[type='radio'] { accent-color: var(--color-accent); }` | engenheiro-apps | **aberto**; fora do lote |

Continuam abertos, fora destes lotes: MC-0021, MC-0052, MC-0068 e MC-0070 (além dos antigos do catálogo).

## Pendências da parte 3 para o gerente-projetos
- **Build v1.0.9:** os lotes 14 e 15 estão liberados pela marca. Pedir ao `testes` os prints do aparelho (rodapé com e sem os dados legais, Campo e Gestão) e do navegador (Entrar do BKO e do portal), para o reteste.
- **Lote 16:** liberado, pode seguir para o merge.
- **Lote 17:** mandar a MC-0073 ao `modulo-core`, com as quatro linhas.
- **Lote 18:** liberado. Mandar a MC-0074 ao `engenheiro-apps` e a nota da data ao `testes` e ao corretor.
- **Lote 19:** mandar ao Alexandre os 4 PNG da carga, mais o `login-campo.png` e o `mais.png`, com a pergunta acima. Com a resposta, o design-de-marca registra a decisão em `decisoes.md` e põe a §2.5 no manual.

---

# Parte 4 · lotes 20 a 28 (v1.0.10, 15/11/2026)

> 2026-11-15 · design-de-marca · continuação, pedido do gerente-projetos, para a v1.0.10. Mesma base: `docs/marca/manual.md` v1, `decisoes.md` e a spec da T-0173 (`docs/design/telas/bko-revisao.md`). `origin/main` = `b536b82` (v1.0.9).
> Cada lote foi lido com `git diff origin/main...origin/<branch>`. Nos retestes, também com o diff contra o SHA lido nas partes 1 a 3. O SHA de cada branch foi conferido com `git rev-parse`. Os prints foram abertos um a um, e as cores conferidas no pixel.
> **Achado novo:** MC-0075. A numeração segue na MC-0076. **Retestadas e fechadas:** MC-0066 (decisão do Alexandre, com o registro pendente abaixo), MC-0073 e MC-0074.
> **Recados:** a CLI continua com HTTP 403. Os avisos aos donos vão pelo gerente-projetos.

## Resumo da parte 4
| Lote | Branch · SHA | Achados | Parecer |
|---|---|---|---|
| 20 | `nuvem/bko-revisao-modulo-core` · `da495ed0` | MC-0073 fechada; MC-0075 (média, fora das linhas do lote) | **liberado** |
| 21 | `nuvem/bko-revisao-modulo-catalogo` · `364ac40a` | nenhum | **liberado** |
| 22 | `nuvem/rodape-shell-engenheiro-apps` · `474164cb` | MC-0074 fechada no código | **liberado** (reteste no navegador) |
| 23 | `nuvem/empresa-acoes-engenheiro-apps` · `8705f496` | nenhum (a MC-0021 continua aberta, fora do lote) | **liberado** |
| 24 | `nuvem/logo-cliente-designer-ux` · `c6d5a4b4` | MC-0066 fechada pela escolha A | **liberado**; registro em `decisoes.md` pendente do texto literal do recado |
| 25 | `nuvem/inicio-cabecalho-engenheiro-apps` · `b227367e` | nenhum | **liberado** (reteste no print do aparelho) |
| 26 | `nuvem/push-fcm-engenheiro-apps` · `9334bf0e` | sem impacto de marca | **liberado** |
| 27 | `nuvem/bko-revisao-modulo-vendedor` · `f93f44cd` | nenhum (a MC-0068 continua aberta, fora do lote) | **liberado** |
| 28 | `nuvem/bko-revisao-modulo-treinamento` · `cf22a7a6` | nenhum | **liberado** |

## Lote 20 · Core, reteste da MC-0073 e dos prints (`da495ed0`, anterior `6bf52819`)
Um commit (`da495ed`): 15 telas, `lib/lista-bko.tsx`, `lib/indicadores.ts` e 10 prints refeitos.
- **MC-0073 fechada.** As quatro linhas passaram a `neutral`: `filiais-page.tsx:119` ("Inativa"), `fotos-pdv-page.tsx:83` ("Inativo"), `motivos-page.tsx:97` ("Desativado") e `produtos/medidas-panel.tsx:93` ("Inativa"). Nos prints de Filiais, Fotos do PDV e Motivos, o fundo do selo é a Névoa `#ECEEF1` no pixel, igual a Usuários, Catálogo e Vendedor. A "Incompleta" da Filial continua no tom de aviso, e isso está certo.
- **O resto do diff:**
  - "Limpar filtros" em todas as telas virou um componente só (`LimparFiltros`, o `Button size="sm"` do kit);
  - Indicadores perdeu a gaveta "Definir meta de venda" e ganhou a coluna "Por dia útil (12 restantes)";
  - Rotas juntou "Visitadas" e "Pendentes" num KPI ("8 de 24", em `text-success`, com o rótulo);
  - Coordenadas pôs o nome do vendedor em `text-ink-3` abaixo da data;
  - Cliente 360 e Visitas passaram a data para dd/mm.

  Tudo com tokens do kit. Não há hex solto nem cor nova.
- **Prints** (abri Filiais, Fotos do PDV, Motivos, Rotas, Indicadores e Coordenadas): botão principal Azul noite, menu "⋯" do kit, selos sempre com texto, shell conforme (MC-0054 a MC-0056). As datas já saem no formato do Brasil. O "November 2026" do campo Mês continua, e isso é para o `testes` e o corretor, não é marca.
- **MC-0075 (média, fora das linhas do lote, `modulo-core`): seleção ativa em grafite em Rotas e em Parâmetros do Início.** No print `depois/rotas-1366x768.png`, o "Dia" ativo do alternador Dia/Semana/Mês sai em grafite `#16202A` no pixel. É o mesmo caso da MC-0069 (aba ativa de Usuários e módulos, já fechada): no mesmo BKO, a aba e o segmento ativos são Azul noite em Recados, Catálogo e Licenças (§3, o Azul noite é ação e estado ativo).
  - As linhas vêm do `main` e o lote não as tocou. A tela de Rotas já estava no print da parte 2, e o achado passou na leitura daquela parte.
  - **Não segura o lote:** o defeito é de antes, e as linhas não foram reescritas, como na MC-0070 e na MC-0074. Vai no próximo lote do `modulo-core`.
  - Correção:

| Arquivo:linha (no branch) | Antes | Depois |
|---|---|---|
| `modules/core/web/components/routes/routes-page.tsx:67` (Dia/Semana/Mês) | `'bg-ink text-white'` | `'bg-accent text-white'` |
| `routes-page.tsx:352` (chip "Todos") | `'border-ink bg-ink text-white'` | `'border-accent bg-accent text-white'` |
| `routes-page.tsx:364` (chip do vendedor) | `'border-ink bg-ink text-white'` | `'border-accent bg-accent text-white'` |
| `modules/core/web/components/metas/inicio-parametros-panel.tsx:206` (dias marcados) | `'border-ink bg-ink text-white'` | `'border-accent bg-accent text-white'` |

  O branco no Azul noite dá 12,77:1. O "CD" da legenda do mapa (`routes-page.tsx:111`) é o desenho do marcador de saída, não é estado ativo, e fica como está.
- **Liberado.**

## Lote 21 · Catálogo (`364ac40a`, anterior `a058713b`)
Um commit (`364ac40`): "Limpar filtros" num componente só (`lib/lista.tsx`, o `Button size="sm"` do kit), "Mais ações" sem o rótulo repetido, o selo "Destaque" passa para dentro da célula do produto e a coluna "Situação" de Marcas sai (o filtro "Ativas/Inativas/Todas" continua).
- O selo "Destaque" continua `pending` (MC-0071): no print `catalogo-produtos-depois`, Azul noite no Azul suave, ao lado do nome. O link de Marcas segue `text-accent-ink` (MC-0072).
- Abri os prints `catalogo-produtos-depois` e `marcas-depois`: botões e abas no Azul noite, shell conforme, não há cor nova. Os nomes de marca (Bosch, NGK…) são dado de cadastro do cliente, não marca no produto.
- **Liberado.**

## Lote 22 · Rodapé e shell do BKO, reteste da MC-0074 (engenheiro-apps, `474164cb`, anterior `155bc0d4`)
Um commit (`474164c`): CNPJ pelo `formatarDocumento` comum, quadro da Auditoria sem título, `LIMITE_AUDITORIA` num lugar só e a MC-0074.
- **MC-0074 fechada no código.** `apps/web/app/globals.css`, dentro do `@layer base`: `input[type='checkbox'], input[type='radio'] { accent-color: var(--color-accent); }`. O `--color-accent` é `#1e3350`, então as caixas nativas do BKO e do portal saem em Azul noite, não no `#0075FF` do navegador. Falta o print do navegador com uma caixa marcada (a gaveta "Nova faixa" serve).
- **Exceção que continua:** a caixa do `SeletorDePerfis` (`packages/ui/src/web/permissoes.tsx:341`) tem a classe `accent-[var(--color-ink)]`, que vence a regra geral e fica grafite. É a **MC-0051** (designer-ux), aberta.
- **Rodapé:** o texto da linha do CNPJ é o mesmo (máscara `00.000.000/0000-00`). Não há mudança de cor, fonte ou posição.
- **Liberado.** Reteste no navegador (1366×768).

## Lote 23 · Ações de empresa no portal (engenheiro-apps, `8705f496`, anterior `3dec04a5`)
Diff grande (38 arquivos), quase todo de banco, API e SDK (migração 0072, rotas do ADR 0052). Do lado da tela, o que mudou foi:
- as frases de recusa passam a vir de uma tabela só do SDK (`MENSAGENS_ACOES_EMPRESA`), com os mesmos textos do lote 9;
- nenhum componente `.tsx` de tela mudou (só o teste), e não há CSS nem print.

A frase "O backup está indisponível neste servidor. Avise o suporte da Macuxi." é curta e direta, como pede o tom da marca. O texto de interface é do designer-ux e do corretor.
- **Liberado.**
- **MC-0021** (`LinkBotao` do portal em grafite, `apps/web/components/portal/base.tsx:61`): continua aberta, fora do lote.

## Lote 24 · Logo do cliente, decisão do Alexandre (designer-ux, `c6d5a4b4`, anterior `64a18b97`)
Dois commits (`147ce5c`, `c6d5a4b`): a spec `logo-cliente.md` registra no topo a decisão "R-20261114-234500-alexandre, 14/11/2026 ~23h45, Manaus, pelo gerente-projetos":
- a carga com a logo **ao lado**, que é a variação A;
- o login e as telas de senha **sem a logo do cliente** (§4);
- o Mais, os PDFs e o portal ficam como estavam.

Saem a variação B, a opção C, o `login.html` e os PNG do login.
- **Imagens:** `carga-campo.png` e `carga-gestao.png` são os PNG da variação A no pixel. A única diferença é a legenda ("Carga, com logo"). Abri o do Campo: logo Macuxi de 124 dp, filete `#3A4D68` a 24 dp, placa branca de 64 dp e o resto da tela igual à entrada aprovada. O `carga.html` só perdeu o ramo da B.
- **Mais:** a mesma placa de 52/36, que agora existe só ali, e o comentário do `mais.html` acompanha. Conforme.
- **MC-0066 fechada pela escolha A**, a recomendada no parecer. Com o login sem logo, a placa de 52/36 fica só no Mais, e a MC-0067 continua fechada.
- **A escolha está registrada?**
  - **Na spec, sim:** pelo ID do recado (`logo-cliente.md`, topo e §4), e no diário do designer-ux.
  - **Em `docs/marca/decisoes.md`, não.** Não consegui ler o texto do recado, porque o repositório de recados dá HTTP 403 nesta sessão.
  - **Por isso não registrei a decisão em `decisoes.md` nem a §2.5 no manual.** Pela regra, só entra o "aprovo" do Alexandre com o texto dele.
- **Parecer:** **liberado** para a implementação da carga A e do Mais, desde que o gerente confirme que o recado diz "A". Com o texto literal (ou a cópia do chat), o design-de-marca grava a decisão em `decisoes.md` e a §2.5 do manual: a placa branca, sempre menor que o logo Macuxi da tela e fora da área de proteção, com 64/48 na carga, 52/36 no Mais e nada no login. Se o recado não disser isso, a carga com logo volta a segurar.

## Lote 25 · Início do Campo, foto do perfil pelo shell (engenheiro-apps, `b227367e`)
O branch traz o lote 7 (`6f04e77`, liberado na parte 1) e mais dois commits: `e0ac444` (modulo-core) tira o `painelAltura` sem uso e expõe a `ENTIDADE_USUARIO_AVATAR`, e `b227367` (engenheiro-apps) liga a foto do perfil pelo mesmo download e cache da miniatura do Catálogo (`foto-perfil-endereco.ts`, `services/miniaturas.ts`, `state/plataforma.tsx`).
- A tela (`tela-inicio-campo.tsx`) e os dois prints não mudaram desde o `6f04e77`: foto de 72 com raio 16 e `cover`, iniciais quando não há foto, faixa Azul noite. O diff contra o `6f04e77` também traz o `ci.yml` e os `scripts/ci/shards`, que vêm do `main` e não têm superfície de marca.
- **Liberado.** O reteste no print do aparelho continua pendente, agora com a foto real baixada (recorte no raio 16 e troca para as iniciais sem sinal).

## Lote 26 · Push pelo FCM direto (engenheiro-apps, `9334bf0e`)
O diff mexe no `app.config.ts` (caminho do `google-services.json`) e no `push.ts` (token FCM do aparelho em vez do token do Expo, e o push só de dados com o app aberto).
- O ícone, a cor e o canal da notificação não mudaram: `icone-notificacao.png`, `AZUL_NOITE` e o canal `avisos` (`app.config.ts:180`). O título e o texto da notificação vêm do servidor, como antes.
- **Sem impacto de marca. Liberado.** No primeiro push real da v1.0.10, conferir no print do aparelho que o ícone e a cor continuam (o FCM direto usa a mesma configuração do `expo-notifications`).

## Lote 27 · Vendedor (`f93f44cd`, anterior `1a151258`)
Dois commits: a frase de erro da impressão vai para uma constante só (`ERRO_IMPRESSAO`, no mesmo `Notice` `danger` e no toast), sai o `totalDoPeriodo` sem uso, e os parâmetros da consulta de Pedidos voltam a ficar inline. Não há mudança de cor, fonte nem do PDF.
- **Liberado.**
- **MC-0068** (neutros do PDF, `pdf-pedido.ts:207,229,239`): continua aberta, fora do lote.

## Lote 28 · Treinamento (`cf22a7a6`, anterior `1d1436eb`)
Um commit: o `MenuAcoes` perde o `rotulo="Mais ações"`, que é o rótulo padrão do kit. Não há efeito visual. O "Nova trilha" continua o `Button primary` (MC-0065 fechada).
- **Liberado.**

## Achados da parte 4
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0066 | média | carga com logo (`logo-cliente.md` §3) | §2.4, §2.3 | variação A (`c6d5a4b`) | designer-ux · dono do produto | **fechado** pela escolha A (R-20261114-234500); registro em `decisoes.md` e §2.5 pendentes do texto literal |
| MC-0073 | baixa | `filiais-page.tsx:119`, `fotos-pdv-page.tsx:83`, `motivos-page.tsx:97`, `medidas-panel.tsx:93` | §3 | `'neutral'` | modulo-core | **fechado** (`da495ed`; Névoa no pixel) |
| MC-0074 | média | `apps/web/app/globals.css` (caixas nativas) | §3 | `accent-color: var(--color-accent)` | engenheiro-apps | **fechado** no código (`474164c`); print do navegador pendente |
| MC-0075 | média | `routes-page.tsx:67,352,364` e `inicio-parametros-panel.tsx:206` (seleção ativa em grafite, no `main`) | §3 (estado ativo Azul noite) e MC-0069 | `bg-ink` → `bg-accent` (e `border-ink` → `border-accent`) | modulo-core | **aberto**; fora das linhas do lote, não segura |

Continuam abertos, fora destes lotes: MC-0021, MC-0051, MC-0052, MC-0068 e MC-0070 (além dos antigos).

## Pendências da parte 4 para o gerente-projetos
- **Lotes 20 a 23 e 25 a 28:** liberados pela marca para a v1.0.10.
- **Lote 24:** mandar ao design-de-marca o texto literal do R-20261114-234500-alexandre (ou a cópia do chat). Se disser "A" e "login sem logo", fica liberado, e o design-de-marca grava a decisão em `decisoes.md` e a §2.5 no manual. Se não disser, a carga com logo volta a segurar.
- **MC-0075:** mandar ao `modulo-core`, com as quatro linhas, para o próximo lote.
- **Prints para reteste:**
  - navegador (1366×768): uma caixa de seleção marcada no BKO (MC-0074) e o Entrar do BKO e do portal com o rodapé;
  - aparelho (v1.0.10): o Início com a foto real e o ícone da notificação no primeiro push pelo FCM.
