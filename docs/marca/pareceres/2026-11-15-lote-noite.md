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
