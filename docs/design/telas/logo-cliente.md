# Logo do cliente: cadastro no portal `config.` e onde aparece (simulação)

> 2026-11-15 · designer-ux · pedido do dono do produto R-20261114-223000-alexandre (pelo gerente-projetos): mostrar a
> logo do cliente (a distribuidora). **Agora é só a simulação.** A implementação fica para depois do build da v1.0.9.
> Frase do Mais com o **nome fantasia** (decisão do dono do produto, R-20261114-223500-alexandre).
> Simulações em `docs/design/telas/logo-cliente/`: HTML + PNG (Playwright, deviceScaleFactor 2). Celular a 360 dp;
> portal a 1366 px; PDF em A4 paisagem.
>
> **Dados fictícios:**
> - empresa: razão social "Distribuidora Exemplo Norte Ltda", nome fantasia "Exemplo Norte", código `AM4821`,
>   CNPJ 11.222.333/0001-81;
> - logo: `logo-ficticia-exemplo-norte.svg`;
> - pedido: cliente "Auto Peças Exemplo".
>
> Nada disso vai para código, seed nem teste como dado real.

## 0. O que existe hoje no `main` (busca em `db/`, `modules/` e `apps/`)

**Não existe cadastro de logo do cliente.**
- **Banco:** nenhuma coluna nem tabela de logo (`db/migrations`, `plataforma.tenant` desde a 0001).
- **API:** nenhuma rota recebe ou serve a logo (`apps/api`).
- **Portal e BKO:** nenhuma tela de logo (`apps/web/app/config/**`, `apps/web/components/portal/**`).
- **App:** nenhuma tela com logo do cliente (`apps/mobile`).
- **O único ponto pronto** é o PDF: `OrderPdfContext.logo_src` (`modules/vendedor/domain/pdf-pedido.ts:124`) usa
  `LOGO_PADRAO_DATA_URI` quando vem vazio (linha 332). O comentário do campo diz: *"Hoje o tenant não tem o campo: vale
  sempre a padrão."* Há teste da troca (`pdf-pedido.test.ts:421`).

## 1. Regras de todas as superfícies

- **Uma logo por empresa** (tenant). Sem logo, cada lugar volta a ser como é hoje (§3 a §6); nenhum lugar mostra espaço
  vazio nem "sem logo".
- **Placa branca no app:** a logo do cliente fica sempre numa placa branca (`#FFFFFF`, raio 12, borda `#DFE2E6` 1 px sobre o
  Pérola; sem borda sobre o Azul noite). Logo de cliente costuma ter fundo branco ou cores escuras, e some no Azul noite.
  Com a placa, uma regra serve para os dois fundos e para PNG transparente ou JPG com fundo.
- **Nunca recortar nem esticar:** a logo cabe na caixa (`contain`), com a proporção dela.
- **Nunca alterar a logo do cliente:** sem recolorir, sem sombra, sem filtro.
- **Sem texto de explicação** junto da logo ("sua marca aqui", "a logo aparece em…"); R-20261110-192153.
- **Offline:** o app guarda a logo no aparelho na carga, junto do resto da empresa, e usa a cópia guardada sem rede.
- **Acessibilidade:** a logo tem o rótulo "Logo da <nome fantasia>". No fim do Mais ela é decorativa (a frase acima já diz
  o nome), então fica sem rótulo, para o leitor não ler o nome duas vezes.

## 2. Portal `config.`: cadastro da logo

Fica **só no portal `config.`**: na página da empresa, aba **Empresa**, um cartão **"Logo"**, o primeiro da aba. Quem
vê e muda é quem já entra nessa aba: o time da Macuxi e o administrador do cliente. O BKO não tem esse cadastro.

| Simulação | Arquivo |
|---|---|
| Página com a logo salva | ![portal](logo-cliente/portal-tela.png) `portal-tela.png` |
| Os estados do cartão | ![estados](logo-cliente/portal-estados.png) `portal-estados.png` |

**Cartão "Logo":** título; à esquerda, a caixa da pré-visualização (240 × 96 px, branca, borda `#DFE2E6`, raio 12,
12 px de folga, logo em `contain`); à direita, os botões; embaixo, a linha dos limites.

| # | Estado | Caixa | Botões | Linha de baixo |
|---|---|---|---|---|
| 1 | Sem logo | tracejada `#C9CED5`, fundo Pérola, vazia | **Enviar logo** (secundário) | limites |
| 2 | Arquivo escolhido | a logo nova | **Salvar** (principal) · **Cancelar** | limites |
| 3 | Salvando | a logo nova | **Salvando…** e Cancelar desabilitados | limites |
| 4 | Logo salva | a logo salva | **Trocar** (secundário) · **Remover** (secundário, texto `#A8261B`) | limites |
| 5 | Arquivo recusado | volta ao estado anterior (vazia ou com a logo salva) | os do estado anterior | o erro, no lugar dos limites |
| 6 | Remover | — | diálogo **"Remover a logo?"** com **Cancelar** e **Remover** (perigo) | — |

- **Envio:** "Enviar logo" e "Trocar" abrem o seletor de arquivo do sistema, filtrado em PNG e JPG. Nada de "Choose
  File / No file chosen" na tela (portal-config-enxuto, regra 3).
- **Pré-visualização:** o arquivo escolhido aparece na caixa **antes de salvar** (estado 2). Só "Salvar" grava. "Cancelar"
  volta ao que estava.
- **Troca:** "Trocar" → escolhe o arquivo → estado 2 com a logo nova → "Salvar". A antiga sai quando a nova é salva. Não
  há diálogo de confirmação: a pré-visualização já é a conferência.
- **Remoção:** "Remover" → diálogo sem texto de corpo → "Remover" volta ao estado 1. Os lugares das §3 a §6 voltam a ser como
  são hoje.
- **Limites** (linha de baixo, `#4A5562` 13 px): **"PNG ou JPG · até 1 MB · pelo menos 200 px de altura"**.
  - **PNG ou JPG:** o `Image` do app e o PDF mostram os dois sem biblioteca nova. SVG fica fora, porque pode levar
    script e o app precisaria do `SvgXml` para cada logo.
  - **1 MB:** a logo vai para cada aparelho na carga.
  - **200 px de altura:** a altura mínima para a logo sair nítida no PDF (16 mm ≈ 190 px a 300 dpi).
- **Erros** (uma frase com a ação, `#A8261B` 13 px semibold, com o ícone de alerta; erro do arquivo, nunca do servidor
  em inglês):
  - formato: **"Use um arquivo PNG ou JPG."**;
  - tamanho: **"O arquivo passa de 1 MB. Envie um menor."**;
  - altura: **"A imagem tem menos de 200 px de altura. Envie uma maior."**;
  - falha ao salvar: **"Não foi possível salvar. Tente de novo."**;
  - rota ausente no servidor: **"Ainda não disponível neste servidor."** (a constante única do portal, RD-0288).
- **Teclado e leitor:** os botões são `button` com foco visível (`outline` Azul noite); o erro é região viva
  (`aria-live="polite"`); a pré-visualização tem `alt` "Logo da <nome fantasia>".

## 3. Carga do app (entrada com sincronização)

Abaixo, `carga-login-campo.png` e `carga-login-gestao.png`, telas 1 e 2:

![Campo](logo-cliente/carga-login-campo.png)
![Gestão](logo-cliente/carga-login-gestao.png)

- **As telas 1 e 2 mostram o mesmo momento** (depois do login, etapa 2 de 5): a única diferença entre elas é a logo do
  cliente.
- **Sem logo (tela 1):** igual a hoje (`docs/design/entrada-sync.md`): o logo empilhado da Macuxi a 170 dp de largura,
  no centro, com "Olá, Lucas", a barra e as etapas.
- **Com logo (tela 2):** a logo do cliente fica **ao lado** da marca Macuxi, na mesma linha, centralizada:
  - o logo empilhado da Macuxi passa a 124 dp de largura;
  - um filete vertical de 1 × 84 dp, com 22 dp de cada lado: `#3A4D68` no Campo e `#DFE2E6` no Gestão;
  - a placa branca de 136 × 84 dp, com 12 dp de folga, e a logo dentro em `contain`.
  O resto da tela não muda: "Olá, Lucas", a barra, as etapas e o erro.
- **Quando aparece:** só quando o aparelho já tem a logo guardada da empresa do último login. Na primeira abertura, antes
  de qualquer login, não há empresa: vale a tela sem logo.
- **Splash nativa:** a splash do sistema é uma imagem fixa do build (`app.config.ts`) e não pode ter a logo de cada
  cliente. A passagem da splash para a entrada fica assim:
  1. o logo Macuxi reduz de 170 para 124 dp e desliza para a esquerda;
  2. o filete e a placa entram com esmaecer;
  3. tudo em 240 ms.
  Com "reduzir movimento", a troca é direta, sem animação.

## 4. Login (Entrar) do app

Telas 3 e 4 das mesmas imagens.

- **Sem logo (tela 3):** igual a hoje: a faixa Azul noite com o logo horizontal negativo e o formulário no Pérola, com o
  rodapé legal (`rodape-legal.md`).
- **Com logo (tela 4):** a placa branca com borda `#DFE2E6` fica **no topo do formulário, acima de "Entrar"**, alinhada
  à esquerda:
  - placa de 64 dp de altura e até 220 dp de largura;
  - logo com 48 dp de altura e até 196 dp de largura;
  - 14 dp até o título.
  A faixa da Macuxi não muda.
- **Por que no formulário e não na faixa:** na faixa, a logo do cliente ficaria do tamanho do logo Macuxi e lado a lado
  com ele, e o manual proíbe o logo Macuxi no mesmo nível do logo da distribuidora (§2.4). Também não sobra largura:
  360 − 48 de margem − 204 do logo = 108 dp.
- **Quando aparece:** quando o aparelho tem a logo guardada do último login, que é o mesmo `codigoSalvo` que já
  preenche o "Código da empresa". Se a pessoa apaga o código ou digita outro, a placa some na hora: a logo é da empresa
  do código salvo, não da digitada.
- **Teclado aberto:** a placa some com o teclado, como o rodapé legal; o formulário tem prioridade.

## 5. Fim do menu Mais

`mais.png`:

![Mais](logo-cliente/mais.png)

- **O bloco:** é o último da tela "Mais" (`apps/mobile/src/app/(tabs)/mais.tsx`), depois da lista "Outras telas":
  1. **"Licenciado para <nome fantasia>"**: `type.small` 13/18, `#4A5562` (7,03:1 no Pérola), centralizado;
  2. 10 dp abaixo, a placa branca com borda `#DFE2E6`: 72 dp de altura, até 200 dp de largura; logo com 56 dp de
     altura e até 176 dp de largura.
- **Posição:** com espaço sobrando, o bloco vai para o pé da área de rolagem, logo acima da barra de abas (`marginTop:
  auto`, 24 dp mínimos acima). Com lista comprida, fica depois do último item e rola junto.
- **Sem logo:** só a frase, no mesmo lugar.
- **Nome:** o **nome fantasia** da empresa (R-20261114-223500-alexandre). Se o nome fantasia estiver vazio no cadastro,
  vale a razão social, para a frase nunca sair com o nome vazio.
- **Campo e Gestão:** o mesmo bloco nos dois apps. A simulação mostra o Campo.
- **Lista vazia** ("Todas as suas telas já estão na barra de baixo."): o bloco continua no pé.

## 6. PDF de pedido e de orçamento

Simulações geradas do próprio `buildOrderPdfHtml` (versão do cliente):

| Simulação | Arquivo |
|---|---|
| Pedido com logo | ![pedido](logo-cliente/pdf-pedido-com-logo.png) `pdf-pedido-com-logo.png` |
| Orçamento com logo | ![orçamento](logo-cliente/pdf-orcamento-com-logo.png) `pdf-orcamento-com-logo.png` |
| Pedido sem logo (hoje) | ![sem logo](logo-cliente/pdf-pedido-sem-logo.png) `pdf-pedido-sem-logo.png` |

- **Fonte da logo:** `ctx.logo_src` recebe a logo cadastrada. Vazio, continua a `logo-padrao-pdf-256.png`, como manda
  o manual §7. O resto do cabeçalho não muda: nome da distribuidora, "PEDIDO"/"ORÇAMENTO" em Azul noite e o
  cabeçalho verde da tabela.
- **Caixa da logo** (a única mudança de CSS): hoje é um quadrado de 16 × 16 mm com raio de 2 mm, que deixa minúscula uma
  logo larga. Passa a ter altura de 16 mm e largura até 48 mm, alinhada à esquerda e sem raio:
  `.logo { width: auto; max-width: 48mm; height: 16mm; object-fit: contain; object-position: left center; border-radius: 0 }`.
  Uma logo quadrada continua com 16 × 16 mm.
- **Os dois PDFs** (cliente e escritório) e os dois tipos (pedido e orçamento) usam o mesmo cabeçalho.
- **PDF gerado offline no aparelho:** usa a cópia guardada (§1).

## 7. Quem faz (depois do build da v1.0.9)

| Dono | O quê |
|---|---|
| engenheiro-software | desenho e contrato: onde a logo fica (arquivo no armazenamento, URL ou bytes no tenant), rota do portal de envio e remoção, campo na carga do app |
| banco-dados | campo/tabela da logo do tenant (com os campos comuns e RLS) |
| engenheiro-apps | cartão "Logo" do portal (`apps/web/components/portal/tela-empresa.tsx`); entrada, login e Mais no shell (`apps/mobile`); cópia no aparelho |
| modulo-core | a logo e o nome fantasia na carga do app (contrato da empresa) |
| modulo-vendedor | `logo_src` com a logo cadastrada e a caixa nova da `.logo` em `pdf-pedido.ts` |
| designer-ux | placa da logo como componente em `packages/ui` (mobile) e revisão de UX |
| design-de-marca | validação nos prints (Campo, Gestão, portal e PDF) |

## 8. Premissas e pontos para o dono do produto e o design-de-marca

1. **"Ao lado" na carga × manual §2.4:** o manual proíbe "pôr o logo da Macuxi no mesmo nível do logo da distribuidora".
   Na carga, como foi pedido, as duas ficam lado a lado. A diferença de nível vem do filete e da placa branca, e as duas
   têm a mesma altura (84 dp). **O design-de-marca precisa validar.** Se não passar, a alternativa é a mesma placa
   **abaixo** do logo Macuxi, menor (64 dp), entre o logo e o "Olá".
2. **No login**, a logo fica no formulário e não na faixa (§4). É uma leitura de "no login do app" que respeita o manual e a
   largura da tela.
3. **Limites** (PNG/JPG, 1 MB, 200 px de altura): são uma proposta minha. O engenheiro-software pode ajustá-los no
   desenho.
4. **Sem cadastro no BKO:** só o portal `config.`, como foi pedido.
5. **Gestão:** a carga dele continua no Pérola (`entrada-sync.md` §7). A placa ganha borda para não sumir no fundo claro.
