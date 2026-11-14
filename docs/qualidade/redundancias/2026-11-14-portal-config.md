# Portal `config.` · auditoria de excesso, tela por tela (corretor-redundancias)

> **Renumeração (14/11, relatório [2026-11-14-v1.0.8](2026-11-14-v1.0.8.md) §5):** os IDs deste relatório foram dados como RD-0260 a RD-0295 no branch `nuvem/config-auditoria-corretor`, e colidiram com o reteste v1.0.7 e com os pareceres dos PRs de 14/11. Aqui eles valem como **RD-0271 a RD-0306** (provisório + 11). O catálogo traz o provisório de cada um.

Corretor-redundancias, 14/11/2026. A auditoria responde ao recado R-20261114-130000-alexandre: o corretor não viu o excesso de frases no portal `config.`, e o exemplo do dono do produto é o cartão Equipe, com 3 frases.
Li a árvore no branch `nuvem/config-auditoria-corretor` (base `bb20d06`) e rodei o BKO com `NEXT_PUBLIC_PORTAL_FALSO=1`, no host `config.localhost:3000`.
Os prints são do Playwright (Chromium, 1280×800, deviceScaleFactor 1) e estão em [`2026-11-14-portal-config/`](2026-11-14-portal-config/).

**Escopo:** `apps/web/app/config/**`, `apps/web/components/portal/**` e os textos que essas telas leem de `apps/web/lib/portal-*.ts`, `apps/web/lib/equipe-csv.ts` e `apps/web/lib/conector-download.ts`.
**Acessos usados:** time da Macuxi (`time@macuxi.com.br`) e admin do cliente com 1 empresa (`admin@uma.com.br`) e com 2 empresas (`admin@duas.com.br`). Também usei `troca@uma.com.br` (senha a trocar).

**Regra aplicada (Definição de pronto, rigor máximo):**
- fica só o que o usuário usa para agir agora;
- saem a explicação de funcionamento, o que o sistema faz por trás, o texto de garantia, o texto que repete rótulo ou coluna e a instrução que o modelo ou o arquivo já traz;
- uma informação fica num lugar só (R-20261110-062506, R-20261110-093124, R-20261110-192153).

**Veredito: NÃO LIBERADO.** São 36 achados novos (**RD-0271 a RD-0306**): 1 alto, 25 médios e 10 baixos. Nenhum está só em comentário ou título de teste, então os 36 seguram o lote.
Fecho também o RD-0089 e o RD-0090 (T-0158), que estavam abertos no catálogo e já estão corrigidos na spec e no código.

---

## 0. O que a revisão anterior do portal deixou passar, e por quê

| O que passou | Por quê |
|---|---|
| **Nenhuma tela do portal teve parecer de texto, exceto o Diagnósticos.** O único parecer de tela foi o da T-0158 ([2026-11-10-T-0158-diagnostico](2026-11-10-T-0158-diagnostico.md)): as imagens e o código de Portal › Diagnósticos. | Entrar, Escolher empresa, Empresas, Nova empresa e Empresa (Bases, Equipe, Integração, Admins) nasceram na T-0087 (06/11), na T-0093 e na T-0094 (07 e 08/11). Isso foi **antes** de o corretor entrar na esteira (R-20261108-135639) e antes das regras "uma informação, um lugar" (R-20261110-093124) e "só o que o usuário usa para agir" (R-20261110-192153). Ninguém pediu o parecer retroativo, e eu também não o abri. |
| Nas rodadas seguintes, o portal só apareceu **como código**: RD-0021 (regra da senha em `passo-empresa.tsx`), RD-0044 e RD-0051 (CSV e BOM em `portal-carga.ts` e `portal-falso.ts`). | Abri esses arquivos com o jscpd e o grep atrás de regra duplicada e não li o texto de tela que estava ao lado. Foi um erro de método: o arquivo passou pela minha mão, e as frases não passaram pelo filtro. |
| A regra "o parecer olha o print do aparelho" nunca valeu para o portal. | O roteiro de ensaio só leva os builds Campo e Gestão. O portal sai no deploy do BKO, sem print e sem roteiro do testes, e eu não pedi esse print. |
| A T-0171 (listas) deixou o Portal › Diagnósticos "para a próxima rodada" ([2026-11-12-T-0171-listas](2026-11-12-T-0171-listas.md) §5), e a próxima rodada não veio. | Não registrei a pendência no catálogo, então ela sumiu da fila. |
| A T-0172 (marca na entrada) mudou a `Marca` do portal (`base.tsx:57`, `MarcaNaFaixa`), e o meu parecer ([2026-11-13-T-0172-marca-entrada](2026-11-13-T-0172-marca-entrada.md)) só olhou o app e o login do BKO. | Defini o escopo pela tarefa e não por quem usa o componente. |

**O que muda no método** (a partir desta rodada):
- toda superfície web (BKO e `config.`) entra no parecer com print, como o app;
- quando um arquivo de tela aparece num achado de código, o texto da tela entra na mesma passada;
- pendência "para a próxima rodada" vira linha no catálogo com status `aberto`.

---

## 1. Moldura comum (todas as telas internas, os dois acessos)
Print: [03-empresas](2026-11-14-portal-config/03-empresas.png) (time) · [12-cliente-bases](2026-11-14-portal-config/12-cliente-bases.png) (admin do cliente)

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0271** | média | `Sessão até 01:01 · encerra após 15 min sem uso` (`base.tsx:446-449`) | "encerra após 15 min sem uso" explica o funcionamento da sessão. O usuário não age por ele. | `Sessão até 01:01` |
| **RD-0272** | média | Admin do cliente: `Distribuidora Uma Ltda` no cabeçalho (`base.tsx:440-444`, `portal.empresa-atual`) e `Distribuidora Uma Ltda` no título da página (`tela-empresa.tsx:113`) | O mesmo fato aparece 2× na mesma tela. | O nome **sai do cabeçalho** e fica só no título da página. |
| **RD-0273** | média | 3 diálogos que só servem a "links dos convites": `Sua sessão terminou` + `Os links dos convites aparecem só nesta tela. Baixe agora, antes de entrar de novo: …`; `Sua sessão termina em N min` + `… Baixe agora: quando a sessão terminar, eles somem.`; `Baixar os convites antes de sair?` + `… Se sair agora, eles somem e cada pessoa vai precisar de um link novo pelo Renovar.` (`base.tsx:200,291-345,477-496`) | **Código morto com texto velho.** O convite saiu na T-0094, e o `segurarSaida` de `lib/portal-saida.ts:29` não tem chamador fora do teste. Os 3 diálogos, o `TEXTO_UMA_VEZ`, o `rotuloDeBaixar`, o `useSaidaSegurada`, o `pedirSaida` e o `avisoDeFimDaSessao` nunca abrem. | Apagar os 3 diálogos e o que só eles usam. Em `lib/portal-saida.ts`, fica só o que a sessão ainda usa, ou o arquivo sai junto com o teste. |
| **RD-0274** | baixa | Código repetido: `const hora = …toLocaleTimeString…` em `base.tsx:363` e `baixar-conector.tsx:17`; o tom do selo da situação em `tela-empresas.tsx:108` e `tela-empresa.tsx:119`; `Não deu para ler o arquivo. Salve como CSV (UTF-8) e escolha de novo.` e `Lendo o arquivo…` em `cartao-equipe.tsx:74,141` e `cartao-base.tsx:151,255`; e `ListaDeErros` (`cartao-equipe.tsx:26`) × `ListaErros` (`cartao-base.tsx:58`) | Peças iguais copiadas no mesmo shell. O jscpd não acha (os trechos têm menos de 50 tokens), mas são as mesmas. | `hora` e `tomDaSituacao` num lugar só (`base.tsx` ou `lib/portal.ts`). As 2 strings viram constantes. A lista de erros por linha vira um componente só. |

Fica (`manter`): `Modo falso: dados fictícios no navegador, sem chamar a API.`, porque só existe fora de produção (`MODO_PORTAL_FALSO`).

## 2. Entrar
Prints: [01-entrar](2026-11-14-portal-config/01-entrar.png) · [01-entrar-vazio](2026-11-14-portal-config/01-entrar-vazio.png) · [01-entrar-erro](2026-11-14-portal-config/01-entrar-erro.png) · [01-entrar-senha-a-trocar](2026-11-14-portal-config/01-entrar-senha-a-trocar.png)

Os estados bloqueado (423), limite por IP (429), sem segredos (503) e "Sua sessão terminou" foram **lidos no código** (`tela-entrar.tsx:34-42`, `portal-api.ts:36,40`).
As frases deles são uma por estado e estão certas.

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0275** | baixa | `Crie a sua senha no backoffice antes de entrar aqui. Use o código da empresa, o e-mail e a senha que você recebeu.` (`tela-entrar.tsx:42`) | A 2ª frase é a instrução que a própria tela de entrada do backoffice já traz: os 3 campos têm rótulo. | `Crie a sua senha no backoffice antes de entrar aqui.` |

Ficam: `Esqueceu a senha? Use "Esqueci a senha" no backoffice.` (é a única saída de quem esqueceu), `Informe o e-mail e a senha.` e `E-mail ou senha incorretos.`

## 3. Escolher empresa (admin do cliente com 2+ empresas)
Prints: [02-escolher-empresa](2026-11-14-portal-config/02-escolher-empresa.png) · [02-escolher-empresa-atual](2026-11-14-portal-config/02-escolher-empresa-atual.png) · [02-cliente-duas-empresa](2026-11-14-portal-config/02-cliente-duas-empresa.png)

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0276** | média | Título `Escolha a empresa` + `Seu acesso vale para estas empresas.` (`tela-escolher-empresa.tsx:43`) | O subtítulo explica a lista que está logo abaixo. O usuário não age por ele. | **Sai.** Fica só o título. |

Ficam: o código abaixo do nome (separa empresas de nome parecido e é o código do login do BKO), o selo `Atual` e o aviso de empresa indisponível (`info`, com o nome).

## 4. Empresas (só o time da Macuxi)
Print: [03-empresas](2026-11-14-portal-config/03-empresas.png). O estado vazio foi **lido no código** (o modo falso sempre traz 3 empresas).

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0277** | média | `Cada empresa cliente é um tenant. Crie a empresa e carregue as bases dela, na ordem dos cartões.` (`tela-empresas.tsx:56`) | Explica o funcionamento ("é um tenant") e o fluxo da tela seguinte. | **Sai.** Fica só o título `Empresas` com o botão `Nova empresa`. |
| **RD-0278** | média | Coluna Módulos: `Core, Vendedor, Integração com o ERP` / `Core, Vendedor, Integração com o ERP` / `Core, Promotor, Integração com o ERP` (`tela-empresas.tsx:106`) | `Core` e `Integração com o ERP` entram sempre (`MODULOS_SEMPRE`), então se repetem em toda linha e não separam uma empresa da outra. | Só os opcionais: `Vendedor` / `Vendedor` / `Promotor`. Sem opcional, mostrar `—`. |
| **RD-0279** | média | Vazio: `Nenhuma empresa ainda.` + `Comece pela empresa cliente: razão social, CNPJ, fuso, módulos e os parâmetros iniciais.` + botão `Cadastrar a primeira empresa`, com o `Nova empresa` do cabeçalho na mesma tela (`tela-empresas.tsx:73-79`) | A 2ª frase repete os campos do formulário. O 2º botão repete a ação do cabeçalho. | `Nenhuma empresa ainda.` Sem a frase e sem o 2º botão. |

## 5. Nova empresa (só o time da Macuxi)
Prints: [04-nova-empresa](2026-11-14-portal-config/04-nova-empresa.png) · [04-nova-empresa-erros](2026-11-14-portal-config/04-nova-empresa-erros.png) · [04-nova-empresa-admin](2026-11-14-portal-config/04-nova-empresa-admin.png) · [04-nova-empresa-conferido](2026-11-14-portal-config/04-nova-empresa-conferido.png)

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0280** | média | `Passo 1` + `Confira antes de gravar: o código da empresa não muda depois. As bases vêm nos próximos passos.` (`tela-empresas.tsx:126`) | Não existe "Passo 2": depois de gravar, a tela vai para a página da empresa. "O código não muda depois" já está na ajuda do campo Código. "As bases vêm nos próximos passos" explica o fluxo. | **Saem** o `Passo 1` e o subtítulo. O aviso do código fica só no campo. |
| **RD-0281** | média | Fuso: `Datas e horários do app e do BKO aparecem neste fuso.` (`passo-empresa.tsx:355`). Administrador: `É o primeiro acesso da empresa. Ele cria os outros usuários no BKO.` (`:91`) e `Passe esta senha ao administrador. No primeiro acesso ao backoffice, ele cria a dele.` (`:92`). Alçada: `Desconto que o vendedor dá sem aprovação.` (`:460`) | Todas explicam o funcionamento. Nenhuma muda o que se digita. | Fuso: **sai**. Administrador: a 1ª **sai**, e a outra vira `Passe esta senha ao administrador.` Alçada: **sai** (o rótulo `Alçada do vendedor (%)` basta). |
| **RD-0282** | média | Ajuda dos módulos (`passo-empresa.tsx:35-42,433`), por exemplo `Usuários, clientes, produtos e permissões. Sempre entra.` e `Hub de carga das bases e Conector. Sempre entra: o portal carrega as bases por ele.` | "Sempre entra" repete o selo `sempre` e a caixa travada (2× por módulo). As outras frases descrevem o produto para quem já vende o contrato com esses nomes. | As 8 ajudas **saem**. Fica o nome, com o selo `sempre` / `licenciado`. |
| **RD-0283** | baixa | Senha vazia ao gravar: `Informe a senha inicial.` + as 4 regras em vermelho (`passo-empresa.tsx:97,110,392-399`) | O mesmo problema aparece 2× no mesmo campo. | Com a senha vazia, só `Informe a senha inicial.`, e as regras ficam neutras. O vermelho volta quando há senha digitada. |
| **RD-0284** | média | Conferir: `Conferido, nada gravado: empresa criada ao gravar.` / `Módulos que entram: Core, Integração com o ERP.` / `Parâmetros que serão gravados: 5.` / `Administrador que será criado: rui@teste.com.br.` (`passo-empresa.tsx:495-503`; `:206-211`) | São 4 linhas para 1 resposta. Core e Integração entram sempre. O "5" não serve para decidir. O e-mail é o que está digitado logo acima. "nada gravado" repete o botão `Conferir sem gravar`. | Uma linha só: `Conferido: a empresa será criada.` · `Conferido: entram Vendedor, Promotor.` · `Conferido: nada muda.`, mais os `avisos` da API. Depois de gravar uma existente: `Módulos acrescentados: Vendedor.` Saem as linhas de parâmetros e de administrador, inclusive `Administrador mantido: a senha não muda/mudou.` (ver RD-0301). |

Fica: `Confira os campos marcados.` no fim do formulário. O botão está a ~1.800 px dos primeiros campos, e a frase explica por que nada aconteceu.

## 6. Empresa › Bases, com o cartão Equipe (os dois acessos)
Prints: [05-empresa-bases-topo](2026-11-14-portal-config/05-empresa-bases-topo.png) · [05-empresa-bases-inteira](2026-11-14-portal-config/05-empresa-bases-inteira.png) · [06-equipe-vazio](2026-11-14-portal-config/06-equipe-vazio.png) · [06-equipe-conferir-erros](2026-11-14-portal-config/06-equipe-conferir-erros.png) · [06-equipe-conferido-ok](2026-11-14-portal-config/06-equipe-conferido-ok.png) · [06-equipe-gravada](2026-11-14-portal-config/06-equipe-gravada.png) · [07-base-vazio](2026-11-14-portal-config/07-base-vazio.png) · [07-base-conferir-erros](2026-11-14-portal-config/07-base-conferir-erros.png) · [07-base-completo-erros](2026-11-14-portal-config/07-base-completo-erros.png) · [07-base-dialogo-completo](2026-11-14-portal-config/07-base-dialogo-completo.png) · [07-base-importada-erros](2026-11-14-portal-config/07-base-importada-erros.png) · [07-base-importada-ok](2026-11-14-portal-config/07-base-importada-ok.png) · [07-base-modelo-em-breve](2026-11-14-portal-config/07-base-modelo-em-breve.png) · [12-cliente-bases](2026-11-14-portal-config/12-cliente-bases.png)

Estados **lidos no código**:
- carga em várias partes (barra, `Enviando a parte N de M…`, contagens da sessão);
- `O Hub continua gravando…`, `já tinha sido enviado…` e `aguardando confirmação`;
- 503 de e-mail na Equipe;
- 403 sem Integração.

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0285** | média | `Carregue na ordem: cada base usa as anteriores. Confira sem gravar, corrija pelo "Baixar erros" e importe.` (`tela-empresa.tsx:41`) | A ordem já está no número de cada cartão (0, 1, 2…). "cada base usa as anteriores" explica o funcionamento, e o resto repete os nomes dos botões. | **Sai.** |
| **RD-0286** | **alta** | Cartão Equipe (o exemplo do dono do produto): `Usuários do app e do backoffice, uma pessoa por linha: nome, e-mail, telefone, perfil, e-mail do superior, código no ERP e módulos. Gerentes, supervisores e campo entram nessa ordem. Ninguém recebe senha no arquivo: cada pessoa nova recebe uma senha temporária por e-mail e cria a dela no primeiro acesso.` (`cartao-equipe.tsx:117-120`) | São 3 frases. A 1ª é a lista de colunas que o modelo já traz. A 2ª explica a ordem de gravação e **confunde**: dá a entender que o arquivo precisa vir ordenado. A 3ª conta o que o sistema faz por trás. | **Sai inteiro.** Fica o título `Equipe`, com o `Baixar modelo (.csv)`. |
| **RD-0287** | média | Abaixo dos botões da Equipe: `Se alguma linha tiver erro, nada é gravado: corrija o arquivo e importe de novo. Quem já existe (mesmo e-mail) é atualizado, não duplicado.` (`cartao-equipe.tsx:156`) | É garantia e funcionamento. Quando o erro acontece, o resultado já diz `Nada foi gravado … Corrija o arquivo…`. O "atualizado" aparece no `Ver o que muda` (`Atualizar`). | **Sai.** |
| **RD-0288** | baixa | `equipe-erro.csv: 3 pessoas.` (`cartao-equipe.tsx:143-145`) e `vend-erro.csv: 3 linhas.`, com `… em 4 partes (até 5.000 linhas cada, na mesma sessão).` (`cartao-base.tsx:255-260`) | O nome do arquivo aparece 2× (o campo de arquivo já mostra). O parêntese explica o funcionamento. | `3 pessoas.` · `3 linhas.` · `20.000 linhas em 4 partes.` |
| **RD-0289** | média | Resultado da Equipe (`cartao-equipe.tsx:164-192`): `Nada foi gravado: 2 pessoas com erro de 3 pessoas. Corrija o arquivo e confira de novo.` · `Conferido, nada gravado: 2 novas · 0 atualizadas · 0 sem mudança · 0 com erro. Pode importar.` · selo `gravada` + `Equipe gravada: 2 novas · 0 atualizadas · 0 sem mudança · 0 com erro.` + `2 acessos enviados por e-mail.` · `Avisos (não impedem a gravação)` | A unidade se repete ("pessoas … de 3 pessoas"). "nada gravado" vem depois de um `Conferir sem gravar`. Aparecem 3 zeros. "gravada" está 2× (selo e aviso). Os "2 acessos" repetem as "2 novas" e contam o que o sistema faz por trás. O parêntese é explicação. | Conferir com erro: `2 de 3 pessoas com erro. Corrija o arquivo e confira de novo.` Importar com erro: `Nada foi gravado: 2 de 3 pessoas com erro. Corrija o arquivo e importe de novo.` Conferido sem erro: `2 novas. Pode importar.` Gravado: `Equipe gravada: 2 novas.` (só as contagens acima de 0). Saem o selo `gravada` e a linha dos acessos. `Avisos`. |
| **RD-0290** | média | Descrição das 16 bases (`lib/portal-carga.ts:24-41`), por exemplo `Código e nome de cada vendedor no ERP. A carteira dos clientes aponta para eles.` e `Parcelas em dias de cada forma (à vista, 28/56). O prazo médio é calculado pelo Macuxi.` | A 2ª frase explica o funcionamento: "aponta para eles", "é calculado pelo Macuxi", "Vem depois dos produtos e preços". Várias 1ªs frases repetem o título e o dicionário de campos. | Fica só onde o título não diz o que vai no arquivo: `catalogo_no` `Departamentos, grupos e subgrupos.` · `prazo_pagamento` `Parcelas em dias de cada forma (à vista, 28/56).` · `filial` `Unidades de onde saem as entregas.` · `produto_unidade` `Embalagens de venda (caixa, fardo) e o fator.` · `tabela_escalonada` `Preço por faixa de quantidade, com vigência.` · `cliente` `Com o vendedor responsável por cada um.` · `cliente_endereco` `Entrega e cobrança.` · `rota` `Dias de visita de cada vendedor a cada cliente.` · `titulo` `Contas a receber em aberto.` · `nota` `Notas fiscais emitidas.` Saem as descrições de `vendedor`, `forma_pagamento`, `produto`, `preco`, `estoque` e `transportadora` (o título basta). |
| **RD-0291** | média | Modo: `title` de cada opção = a ajuda, e a ajuda de novo abaixo (`cartao-base.tsx:241,253`). Delta: `Grava só as linhas do arquivo; o que não veio continua como está.` Completo: `O arquivo é a lista inteira: o que não vier é inativado no fim da última parte. O registro de uma linha com erro continua como está, sem ser inativado.` O aviso da conferência repete `O registro de uma linha com erro continua como está, sem ser inativado. Se alguma linha com erro vier sem código, nada é inativado nesta carga.` (`:23-24,283`), e o diálogo repete `o que já existe e não vier nele será inativado no fim da última parte` + o mesmo `TEXTO_COMPLETO_COM_ERROS` (`:344-347`) | A regra do completo aparece **3× na mesma tela**: ajuda, aviso e diálogo. A ajuda também está no `title`. O Delta é o padrão e não pede decisão. "no fim da última parte" é funcionamento. | Delta: ajuda **sai**. Completo: `O que não vier no arquivo é inativado.` Saem os `title`. O aviso da conferência fica sem o `TEXTO_COMPLETO_COM_ERROS`. O diálogo (confirmação destrutiva, **manter**) fica assim: **`vend-erro.csv, 3 linhas.`** `Os vendedores do ERP que não vierem no arquivo serão inativados.` e, com erro, `2 linhas com erro: o registro delas não é inativado; se alguma vier sem código, nada é inativado.` |
| **RD-0292** | média | Conferência das bases (`cartao-base.tsx:280-283`): `Conferido, nada gravado: 3 linhas sem erro de formato. As referências entre bases são conferidas ao gravar.` · `Conferido, nada gravado: 2 linhas com erro de 3 linhas. Corrija o arquivo e confira de novo, ou importe assim: as linhas com erro ficam de fora.` | "nada gravado" repete o botão. A 2ª frase do caso sem erro é funcionamento. A unidade se repete ("linhas … de 3 linhas"). | `3 linhas sem erro de formato. Pode importar.` · `2 de 3 linhas com erro. Corrija e confira de novo, ou importe assim: as linhas com erro ficam de fora.` |
| **RD-0293** | baixa | `O Hub continua gravando este arquivo. Volte a esta página daqui a pouco para ver o resultado.` · `Este arquivo já tinha sido enviado com a mesma chave: nada foi gravado de novo.` · `Gravando no Hub…` · contagens da sessão com zeros `N novas · 0 atualizadas · 0 sem mudança · 0 com erro` (`cartao-base.tsx:309,316-317,324-328`) | "o Hub" e "com a mesma chave" contam o que acontece por trás. Os zeros são estado vazio repetido. | `Ainda gravando. Volte daqui a pouco para ver o resultado.` · `Este arquivo já tinha sido enviado: nada mudou.` · `Gravando…` · contagens só acima de 0. |
| **RD-0294** | baixa | Modo falso: `Linha 3 · email: Linha 3: informe um e-mail válido, como nome@empresa.com.br.` ([06-equipe-conferir-erros](2026-11-14-portal-config/06-equipe-conferir-erros.png); `portal-falso.ts:492-493`) | A tela já põe `Linha N · coluna`, e o falso repete `Linha N:` na mensagem. A API real (`core/domain/equipe-importacao.ts:217-223`) não faz isso. O falso mostra ao revisor uma repetição que a produção não tem. | No falso, a mensagem sem `Linha ${linha}: `, como no Core. |

## 7. Empresa › Integração automática e Conector (os dois acessos)
Prints: [08-integracao](2026-11-14-portal-config/08-integracao.png) · [08-integracao-dialogo](2026-11-14-portal-config/08-integracao-dialogo.png) · [08-integracao-credencial](2026-11-14-portal-config/08-integracao-credencial.png) · [08-integracao-em-breve](2026-11-14-portal-config/08-integracao-em-breve.png) · [12-cliente-integracao](2026-11-14-portal-config/12-cliente-integracao.png)

O link do Conector gerado (arquivo, versão, validade e SHA-256) foi **lido no código** (`baixar-conector.tsx:53-61`), porque o falso não tem pacote. Ali é um fato por linha, sem achado.

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0295** | média | `Nenhum Conector ainda. A primeira importação de CSV cria o Conector de arquivo do portal.` (`aba-integracao.tsx:120`) | A 2ª frase conta o que o sistema faz por trás. | `Nenhum Conector ainda.` |
| **RD-0296** | média | `Gera a chave que o Conector instalado no servidor do cliente usa para enviar as bases e buscar os pedidos.` (`:164`) e a ajuda do Identificador `Vai no arquivo de configuração do Conector.` (`:166`) | Explicam o funcionamento. O título `Credencial da API do Conector do ERP` e o botão `Gerar credencial` já dizem a ação. | As duas **saem**. |
| **RD-0297** | média | Credencial gerada (`:44-62`): título interno `Credencial do Conector "erp"` dentro do painel `Credencial da API do Conector do ERP` · `Esta chave aparece só agora. Copie e cole na configuração do Conector; depois desta tela ela não é mostrada de novo.` · rodapé `Identificador: erp · escopo integracao.v1 · prefixo mx_falso` | O título está 2×. O identificador aparece 3× (título, rodapé e tabela logo acima). "Aparece só agora" e "não é mostrada de novo" dizem a mesma coisa. O escopo e o prefixo não servem para nenhuma ação (o prefixo está na própria chave). | Sem o título interno e sem o rodapé. Aviso (**manter**, a chave aparece uma vez): `Copie agora e cole na configuração do Conector: esta chave não aparece de novo.` |
| **RD-0298** | média | Diálogo `Passar as bases ao Conector do ERP?`: `As bases carregadas por CSV vêm do Conector de arquivo do portal. Na v1 cada base vem de um único Conector por empresa: para o ERP mandar todas, o Conector de arquivo é desativado (a carga por CSV deixa de funcionar nesta empresa).` + o botão `Gerar só para as bases livres` **desabilitado** quando não há base livre (`:202-223`) | "vêm do Conector de arquivo" e "Na v1 cada base…" explicam o funcionamento. Botão desabilitado sem motivo é um botão a mais. | `Para o ERP mandar todas as bases, o Conector de arquivo é desativado, e a carga por CSV deixa de funcionar nesta empresa.` + (com livres) `Sem desativar, o Conector do ERP leva só: …`. Sem base livre, o botão `Gerar só para as bases livres` **não aparece**. |
| **RD-0299** | média | Sempre visível: `O guia da API (autenticação, delta e cursor, idempotência, ordem de carga, limites e erros) chega em breve neste servidor.` (`:196-198`). E 11 textos diferentes para o mesmo estado "rota ausente": `Modelos e dicionário chegam em breve neste servidor.` · `"Baixar erros" chega em breve neste servidor.` · `A lista de erros deste lote ainda não está disponível neste servidor.` · `"Conferir sem gravar" chega em breve neste servidor.` · `O modelo da Equipe ainda não está disponível neste servidor.` · `A Equipe por CSV ainda não está disponível neste servidor.` · `A ordem de carga ainda não está disponível neste servidor.` · `A lista de administradores ainda não está disponível neste servidor.` · `A redefinição de senha ainda não está disponível neste servidor.` · `A documentação chega em breve neste servidor.` · `o pacote será publicado aqui em breve.` | O guia é um anúncio permanente, sem ação. O resto é um estado só escrito de 11 jeitos, quase sempre repetindo o nome do botão ao lado. | O guia **sai**. Um texto só, ao lado do controle: `Ainda não disponível neste servidor.` (constante única em `lib/portal-api.ts`). |

## 8. Empresa › Empresa, com Admins
Prints (time): [10-aba-empresa-time](2026-11-14-portal-config/10-aba-empresa-time.png) · [09-aba-empresa-nova](2026-11-14-portal-config/09-aba-empresa-nova.png) · [10-admins](2026-11-14-portal-config/10-admins.png) · [10-admins-dialogo](2026-11-14-portal-config/10-admins-dialogo.png) · [10-admins-sucesso](2026-11-14-portal-config/10-admins-sucesso.png) · [10-admins-erro-email](2026-11-14-portal-config/10-admins-erro-email.png). Admin do cliente: [12-cliente-aba-empresa](2026-11-14-portal-config/12-cliente-aba-empresa.png), só com os módulos e sem achado.

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0300** | média | Time: painel `Módulos licenciados` (`Core` · `Vendedor · 10 licenças` · `Integração com o ERP`, `tela-empresa.tsx:162-173`) e, na mesma aba, `Módulos e licenças` com `Vendedor` `licenciado` e `Licenças 10` (`passo-empresa.tsx:412-455`) | A mesma informação aparece 2× na mesma aba. | Para o time, o painel `Módulos licenciados` **sai** (o formulário mostra o mesmo). O admin do cliente continua com o painel. |
| **RD-0301** | média | Time, empresa existente: painel `Empresa` com os 4 campos travados (`Distribuidora Uma Ltda`, `11.222.333/0001-81`, `distribuidora-uma`, fuso) e as ajudas `Usado no login do BKO e do app…` e `Datas e horários…` (`passo-empresa.tsx:319-357`). Painel `Administrador da empresa` com `Esta empresa já tem administrador. A senha dele não muda aqui.` (`:404-409`) | Os 4 dados estão no cabeçalho da página (título e subtítulo). O painel do administrador repete a lista `Administradores` que está logo acima, e "a senha não muda aqui" é garantia. | Na empresa existente, os dois painéis **saem**. O formulário fica com `Módulos e licenças` e os botões. |
| **RD-0302** | média | `Quem administra esta empresa no backoffice. Se um deles perdeu a senha, mande uma senha temporária nova por e-mail.` (`portal-admins.ts:19`) · diálogo `O Macuxi gera uma senha temporária e manda para admin@uma.com.br. Ela vale por 72 horas; no próximo acesso ao backoffice, a pessoa cria uma senha nova. Ana Souza sai do Macuxi agora, em todos os aparelhos.` (`:25-26`) · sucesso `Senha temporária enviada para admin@uma.com.br. Vale até 17/11 às 12:59.` (`:56`), com o selo da linha `Troca de senha pendente · vence em 17/11 às 12:59` | A ajuda repete o título e o botão. No diálogo, "gera" e "cria uma senha nova no próximo acesso" são funcionamento. A validade aparece 2× (aviso e selo). | A ajuda **sai**. Diálogo (confirmação, **manter**): `A senha temporária vai para admin@uma.com.br. Ana Souza sai do Macuxi agora, em todos os aparelhos.` Sucesso: `Senha temporária enviada para admin@uma.com.br.` |
| **RD-0303** | baixa | Mesmo fato, 2 textos com ações diferentes: `O envio de e-mail não está configurado neste servidor, e a senha não foi trocada. Confira a configuração de e-mail e tente de novo.` (`portal-admins.ts:30`) × `O envio de e-mail não está configurado, e nada foi gravado. Fale com o suporte da Macuxi.` (`equipe-csv.ts:12`). O time da Macuxi vê o 2º na Equipe ("fale com o suporte", que é ele mesmo). | O mesmo fato tem 2 textos, e a ação depende da tela e não de quem lê. | Uma constante por acesso. Time: `O envio de e-mail não está configurado neste servidor: nada foi gravado. Confira a configuração de e-mail.` Admin do cliente: `O envio de e-mail não está configurado: nada foi gravado. Fale com o suporte da Macuxi.` |
| **RD-0304** | baixa | `Empresa não encontrada. Volte à lista de empresas.` (`tela-empresa.tsx:127`) e `Empresa não encontrada ou inativa. Volte à lista de empresas.` (`portal-admins.ts:33`), com o `← Empresas` logo acima | A instrução repete o link que está na tela. | `Empresa não encontrada.` · `Empresa não encontrada ou inativa.` |

## 9. Diagnósticos (só o time da Macuxi)
Prints: [11-diagnosticos-carregando](2026-11-14-portal-config/11-diagnosticos-carregando.png) · [12-cliente-diagnosticos-sem-acesso](2026-11-14-portal-config/12-cliente-diagnosticos-sem-acesso.png)

**Lista com dados, vazio e detalhe: estado lido no código.** O modo falso não responde `/plataforma/diagnosticos`: a tela fica em `Buscando os diagnósticos…` e depois cai em `Rota não encontrada.`
Para o reteste com print, peço ao engenheiro-apps a resposta falsa (recado 2, item 6). A imagem aprovada é `docs/design/telas/T-0158-diagnosticos-portal.png`.

| RD | Grav. | Texto atual (literal) | Achado | Proposta |
|---|---|---|---|---|
| **RD-0305** | baixa | `0 diagnósticos` + `Nenhum diagnóstico com estes filtros.` (ou `Nenhum diagnóstico recebido.`), juntos (`tela-diagnosticos.tsx:133-140`) | O estado vazio é dito 2×. | A contagem só aparece com 1 ou mais. |
| **RD-0306** | baixa | `Enviados pelos aparelhos. Ficam 90 dias.` (`portal-diagnosticos.ts:27`) | "Enviados pelos aparelhos" explica a origem, que a coluna App/Aparelho já mostra. | `Ficam 90 dias.` |

Fechados nesta passada (estavam `aberto` no catálogo):
- **RD-0089**: `Sem relato.` em `portal-diagnosticos.ts:34` e na spec `diagnostico.md:50`;
- **RD-0090**: `Ocorrido` só no botão, em `mostrarOcorrido` (`portal-diagnosticos.ts:289-291`) e na spec `diagnostico.md:51`.

Ficam: `Esta área é só do time Macuxi.` com `Ir para a sua empresa` (uma frase e uma ação).

## 10. Início (raiz `/`)
Só redireciona (`inicio.tsx`), com `Abrindo o portal…`. **Sem achado.**

---

## 11. Totais

| Tela | Alta | Média | Baixa | Total |
|---|---|---|---|---|
| Moldura comum | 0 | 3 | 1 | 4 |
| Entrar | 0 | 0 | 1 | 1 |
| Escolher empresa | 0 | 1 | 0 | 1 |
| Empresas | 0 | 3 | 0 | 3 |
| Nova empresa | 0 | 4 | 1 | 5 |
| Empresa › Bases + Equipe | 1 | 6 | 3 | 10 |
| Integração e Conector | 0 | 5 | 0 | 5 |
| Empresa › Empresa + Admins | 0 | 3 | 2 | 5 |
| Diagnósticos | 0 | 0 | 2 | 2 |
| Início | 0 | 0 | 0 | 0 |
| **Total** | **1** | **25** | **10** | **36** |

**Donos:**
- **engenheiro-apps**: implementa todos (os arquivos estão em `apps/web/**`);
- **designer-ux**: consolida a spec final do portal. Os textos nasceram em `docs/design/portal-entrar.md` e `ciclo-de-senha.md` §6-7, e a maior parte não tem spec própria.

## 12. Encaminhado ao `testes` (defeito funcional, sem RD)
1. Diálogo da carga completa: `lista inteira de vendedores do erp`. O `cartao.titulo.toLowerCase()` (`cartao-base.tsx:346`) deixa a sigla ERP em minúscula.
2. Bases sem Integração (403): `Acrescente o módulo na aba Empresa para carregar as outras bases.` (`tela-empresa.tsx:52`). Para o admin do cliente, a aba Empresa não tem como acrescentar módulo: a instrução não tem saída para ele.
3. O campo de arquivo nativo aparece em inglês: `Choose File` / `No file chosen` (Equipe e as 16 bases).

---

## 13. Recados prontos (o `coord.mjs` não grava nesta sessão: HTTP 403; o gerente repassa)

### Recado 1, para o designer-ux
```
node scripts/coord.mjs enviar --de corretor-redundancias --para designer-ux --cc gerente-projetos --tipo pedido --tarefa <T-nnnn do gerente> \
  --assunto "Portal config.: spec final dos textos (RD-0271 a RD-0306)" \
  --corpo "Contexto | O dono do produto reclamou do excesso de frases no portal config. (R-20261114-130000-alexandre; o exemplo dele é o cartão Equipe). Auditei as 10 telas com print nos dois acessos: 36 achados (1 alto, 25 médios, 10 baixos), todos com o texto final proposto em docs/qualidade/redundancias/2026-11-14-portal-config.md (prints na pasta 2026-11-14-portal-config/). A maior parte dos textos do portal não tem spec; os que têm estão em docs/design/portal-entrar.md e ciclo-de-senha.md §6-7. | O que preciso | (1) Consolidar numa spec única do portal (sugestão: docs/design/portal-config.md) o texto final de cada tela, partindo das propostas dos RD-0271 a RD-0306. Onde você discordar, diga qual RD e o texto que fica. (2) Decidir 2 pontos de spec: RD-0272 (o nome da empresa sai do cabeçalho do admin do cliente; contraria a escolha de R-20261107-174216 🟢 3) e RD-0290 (quais bases mantêm a descrição de 1 frase). (3) Atualizar portal-entrar.md §1/§3 (RD-0271, RD-0275, RD-0276) e ciclo-de-senha.md §6 (RD-0289 e RD-0302) para não ficar texto velho na spec. (4) Mandar a spec ao engenheiro-apps e a mim. | Pronto quando | A spec existe com o texto final de cada tela e de cada estado, sem frase de funcionamento, de garantia ou de repetição; portal-entrar.md e ciclo-de-senha.md batem com ela; o meu parecer sobre a spec sai sem achado aberto."
```

### Recado 2, para o engenheiro-apps
```
node scripts/coord.mjs enviar --de corretor-redundancias --para engenheiro-apps --cc gerente-projetos,designer-ux --tipo pedido --tarefa <T-nnnn do gerente> \
  --assunto "Portal config.: aplicar RD-0271 a RD-0306 (excesso de texto, código morto dos convites)" \
  --corpo "Contexto | Auditoria do portal config. com print (R-20261114-130000-alexandre): 36 achados em apps/web/components/portal/** e apps/web/lib/{portal-*,equipe-csv,conector-download}.ts, cada um com o texto atual, o arquivo:linha e o texto final em docs/qualidade/redundancias/2026-11-14-portal-config.md. O designer-ux consolida a spec final em paralelo; onde ele mudar um texto, vale o dele. | O que preciso | (1) Textos (RD-0271/0261, 0264 a 0282, 0284 a 0295): aplicar o texto final ou tirar a frase, conforme a tabela; o alto é o RD-0286 (as 3 frases do cartão Equipe saem). (2) RD-0273: apagar os 3 diálogos de 'links dos convites' em base.tsx (TEXTO_UMA_VEZ, rotuloDeBaixar, useSaidaSegurada, pedirSaida, aviso de fim) e o que sobrar sem uso em lib/portal-saida.ts, porque segurarSaida não tem chamador desde a T-0094. (3) RD-0274: hora e tom da situação num lugar só; as strings de leitura do arquivo como constantes; uma lista de erros por linha só para a Equipe e as bases. (4) RD-0299: uma constante só para 'Ainda não disponível neste servidor.', e o texto do guia da API sai. (5) RD-0294: no portal-falso, a mensagem da Equipe sem o prefixo 'Linha N:'. (6) Para o meu reteste com print: resposta falsa para GET /plataforma/diagnosticos e /plataforma/diagnosticos/:id no portal-falso.ts (lista com 2-3 itens, um de cada origem, e o vazio). | Pronto quando | Lint, typecheck e testes verdes em apps/web; os testes que conferem os textos antigos (portal-telas.test.ts, portal-admins.test.ts, portal-saida.test.ts, cartao-admins.test.tsx e afins) atualizados ou apagados junto com o código; o grep pelos textos atuais de cada RD não acha nada fora do histórico; o reteste com print nos dois acessos sai sem achado aberto."
```

### Recado 3, para o testes (encaminhamento da seção 12, sem RD)
```
node scripts/coord.mjs enviar --de corretor-redundancias --para testes --cc gerente-projetos --tipo aviso --tarefa <T-nnnn do gerente> \
  --assunto "Portal config.: 3 desvios funcionais vistos na auditoria de texto" \
  --corpo "Contexto | Na auditoria de excesso do portal (docs/qualidade/redundancias/2026-11-14-portal-config.md §12) vi 3 desvios que não são redundância. | O que preciso | Conferir e abrir ao dono: (1) cartao-base.tsx:346, 'vendedores do erp' com a sigla em minúscula; (2) tela-empresa.tsx:52, a instrução do 403 manda o admin do cliente acrescentar módulo na aba Empresa, e ele não pode; (3) o campo de arquivo nativo em inglês ('Choose File'/'No file chosen') na Equipe e nas bases. | Pronto quando | Cada item confirmado ou descartado por você, com o dono avisado."
```
