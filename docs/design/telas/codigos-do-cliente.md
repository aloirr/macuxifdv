# Códigos do cliente: Código ERP e Código FDV (v1.0.30)

> 2026-11-23 · designer-ux · sessão D da v1.0.30. Base: ADR 0069, item 10 e seção H (resposta (a) do dono do produto);
> todo cliente tem Código FDV, inclusive o do ERP (decisão do dono do produto, 23/11/2026).
> Telas: ficha do cliente no app (Campo e Gestão), formulário do pré-cadastro no Campo, Carteira e Cliente 360 do BKO,
> lista e gaveta dos **Pré-cadastros recusados** (`bko-pre-cadastros-recusados.md`, simulações `pre-cadastro-v1030/01` a `03`).
> Sem cor, token nem componente novos (o código usa o `fonte.mono` que já existe). Validar com o `design-de-marca` (muda layout da Carteira e da lista dos recusados).

## 1. Os dois códigos
| Código | Origem | Quando existe |
|---|---|---|
| **Código ERP** | `core.cliente.external_id` | cliente vindo do ERP; pré-cadastro só depois que o ERP o aprova (retorno `vinculado`) |
| **Código FDV** | `core.cliente.codigo_fdv` (5 dígitos ou mais, só leitura) | **todo cliente**, inclusive o vindo do ERP; a única exceção é o pré-cadastro novo no aparelho antes do 1º sync |

## 2. Forma (igual em toda superfície)
- **Rótulo curto + valor:** `ERP C5007` e `FDV 00012`. O rótulo é a sigla, sempre antes do valor; nunca o valor sozinho.
  Leitor de tela: `Código ERP C5007` / `Código FDV 00012` (`accessibilityLabel` / `aria-label`).
- **Ordem fixa:** ERP primeiro, FDV depois (o ERP é o código da maior parte da base e o que o escritório usa com o ERP; a
  posição não muda de um cliente para outro).
- **Valor:** como está no banco (o FDV já vem com zeros à esquerda, `formatarCodigoFdv`). O valor é sempre mono com algarismos
  tabulares (manual da marca §5.1: código do cliente é código); a sigla e o separador ficam na fonte de texto.
  - **BKO:** valor 13 px `text-ink` em `font-family: ui-monospace, "Cascadia Mono", "Roboto Mono", monospace` com
    `font-variant-numeric: tabular-nums`; sigla 12/500 `text-ink-2` (#4A5562), como o código do aceite na gaveta dos recusados.
  - **App:** valor com o token `fonte.mono` de `packages/ui/src/mobile/theme.ts` (`fontFamily: 'monospace'`, a mono do
    sistema, e `fontVariant: ['tabular-nums']`), no tamanho e na cor do texto onde aparece; sigla no estilo desse texto.
    Texto aninhado: `<Text style={t.sub}>FDV <Text style={fonte.mono}>00012</Text> · …</Text>`.
- **Não é selo:** código não usa `Badge`/`ChipEstado` (selo é estado, e estado tem cor com texto; código é identificação).
- **Código FDV sempre aparece** onde a superfície mostra códigos. Fica vazio só no aparelho, no pré-cadastro novo antes do
  1º sync: aí não aparece (regra abaixo), e o selo `Não enviado` da ficha já dá o estado.
- **Código que não existe não aparece** — nem a sigla, nem traço, nem "sem código", nem explicação ("gerado no próximo sync",
  "aguardando vínculo"). O estado do pré-cadastro já está no selo da própria tela (`Aguardando ERP`, `Recusado pelo ERP`,
  `Não enviado` no app; `Recusado`, `Reenviado`, `Aceito` no BKO): uma informação, um lugar.
- **"Aguardando o ERP"** só onde o estado do pré-cadastro já é a informação mostrada: no cartão da revisão sem resposta na
  gaveta dos recusados (§5). Em nenhum outro lugar o Código ERP vazio vira texto.

## 3. App (Campo e Gestão)
### 3.1 Ficha do cliente (`modules/core/app/components/cliente360.tsx`, `subtituloDaFicha`)
Subtítulo, uma linha, separador ` · `: **códigos, bairro, cidade/UF**.

| Cliente | Subtítulo |
|---|---|
| do ERP | `ERP C5007 · FDV 00012 · Centro · Boa Vista/RR` |
| pré-cadastro vinculado | `ERP C5007 · FDV 00012 · Centro · Boa Vista/RR` |
| pré-cadastro já no servidor, sem vínculo | `FDV 00012 · Centro · Boa Vista/RR` (o selo `Aguardando ERP` ou `Recusado pelo ERP` fica onde já está) |
| pré-cadastro antes do 1º sync | `Centro · Boa Vista/RR` |

- Os valores `C5007` e `00012` em `fonte.mono` (§2); sigla, bairro e cidade no estilo do subtítulo.
- `numberOfLines={1}`; se não couber, as reticências cortam o fim (cidade), nunca os códigos (eles vêm antes).
- Campo e Gestão usam a mesma ficha do Core: nada muda entre as variantes.
- **Kit:** `cabecalho={{ titulo, subtitulo: 'Centro · Boa Vista/RR', codigos: { erp, fdv } }}` (`CabecalhoTela`/`Screen`); o
  `subtitulo` leva só bairro e cidade. O kit monta a linha, a mono e a leitura (`Código ERP C5007, Código FDV 00012, Centro · Boa Vista/RR`).

### 3.2 Lista de clientes (`telas/clientes.tsx`)
Sem código na linha (RN-CORE-47: nome, uma tag, última visita, seta). A **busca** casa também pelo Código FDV (§6).

### 3.3 Formulário do pré-cadastro ("Corrigir e reenviar")
- Com Código FDV: no **cabeçalho**, na linha de subtítulo do `CabecalhoTela`, **`FDV 00012`**, com o valor em `fonte.mono` (§2). Nada no corpo:
  o motivo da recusa é o único texto acima dos campos (`campo-cliente-pre-cadastro.md` §3.1). Sem campo de formulário (não é editável) e sem cadeado.
- Sem Código FDV (antes do 1º sync) ou em **Novo cliente**: nada.
- **Kit:** `cabecalho={{ titulo: 'Corrigir cliente', codigos: { fdv: codigoFdv } }}` (`CabecalhoTela`/`Screen`); some sozinho quando o código está vazio.
- Código ERP nunca aparece aqui (a correção só existe sem vínculo).

## 4. BKO — Carteira (`modules/core/web/components/carteira/carteira-page.tsx`)
- **Tabela "N clientes vigentes":** coluna nova **Código**, a 2ª (depois de **Cliente**), 104 px, `white-space: nowrap`.
  Conteúdo: uma linha por código existente, empilhadas, ERP em cima e FDV embaixo (`ERP C5007` / `FDV 00012`), 13/16 px.
  Toda linha tem `FDV`; `ERP` só quando o cliente veio do ERP ou o pré-cadastro foi aprovado (no servidor não há cliente sem código).
  A linha já tem 44 px (os `select`s); duas linhas de 16 px cabem sem crescer. `TableScroll minWidth` passa de 880 para 984.
- **"Vincular cliente"** (candidatos da busca): o mesmo bloco de códigos entre o nome e a cidade (em linha, `ERP C5007 · FDV 00012`),
  para o usuário conferir o cliente certo antes de **Vincular**.
- **Kit:** `partesDosCodigos`, `textoDosCodigos`, `leituraDosCodigos` e `SEPARADOR_CODIGOS` de `@macuxi/ui/web` (a mesma parte pura
  do Campo, em `packages/ui/src/comum`); a web não importa de `@macuxi/ui/mobile`.
- Rótulo da busca inalterado: `ROTULO_BUSCA_CLIENTE_BKO` (**Código, CNPJ ou nome (mínimo 3 caracteres)**); "Código" passa a
  valer para os dois (§6).

## 5. BKO — Cliente 360 e Pré-cadastros recusados
### 5.1 Cliente 360 (`cliente360-page.tsx`, `PageHeader.subtitle`)
Ordem: **códigos · razão social (se diferente do nome) · CPF/CNPJ · cidade / UF**.
Ex.: `ERP C5007 · FDV 00012 · Mercadinho São Jorge Ltda · 45.723.174/0001-10 · Manaus / AM`. Código que não existe sai da
lista do `join`, como os outros itens. O selo `Bloqueado` não muda.

### 5.2 Pré-cadastros recusados (detalhe em `bko-pre-cadastros-recusados.md`)
- **Lista:** coluna **Código** (1ª, 92 px), mesmo bloco empilhado da Carteira. `Recusado` e `Reenviado` mostram só `FDV`;
  `Aceito` mostra `ERP` e `FDV`. Sem "Aguardando o ERP" na célula: a coluna Situação já diz.
- **Gaveta, histórico:** subtítulo `FDV 00031 · CPF/CNPJ · Vendedor [selo]`. O Código ERP fica só no cartão da revisão aceita
  (**Aceita pelo ERP em dd/mm/aaaa hh:mm · Código ERP C5112**); a revisão sem resposta mostra **Aguardando o ERP**.
- **Gaveta, Editar e reenviar:** subtítulo **`FDV 00031`** (o código não é campo do formulário; o Código ERP não existe enquanto
  o pré-cadastro está recusado).

## 6. Busca
- A regra continua única: `clienteCasaBusca` (`modules/core/contracts/busca-cliente.ts`) passa a receber `codigo_fdv` e a
  comparar cada palavra também com ele (mesma regra do `external_id`: contém, sem caixa). Vale para a Carteira do app, a busca
  do BKO e a lista dos recusados.
- Rótulo sem mudança: **Código, CNPJ ou nome** (`ROTULO_BUSCA_CLIENTE`). Nada de "Código FDV ou ERP": "Código" cobre os dois.
- A lista dos recusados troca o placeholder **Razão social ou CPF/CNPJ** por `ROTULO_BUSCA_CLIENTE` (a mesma regra de
  casamento, que já inclui razão social, fantasia e documento).
- Fora da sessão D: a busca de cliente do pedido (`modules/vendedor/app/lib/catalog.ts`), pelo `modulo-vendedor`, se ele quiser
  o FDV também lá (mesmo rótulo, mesma regra).

## 7. Fora da tela (regra do corretor)
Nenhum texto sobre como o código nasce ("gerado pelo servidor", "chega no próximo sync"), nenhum "Sem código ERP",
nenhum traço no lugar do código, nenhum aviso de vínculo fora da área de alertas, nenhum código repetido na mesma camada
(a gaveta não repete o Código ERP no subtítulo quando ele já está no cartão do aceite).

## 8. testIDs
App: nenhum novo (muda só o texto do subtítulo da ficha). BKO: `carteira.codigo.<id>` · `cliente360.codigos` ·
`core.pre_cadastros.linha.<id>.codigo`. Dentro do bloco: `…codigo.erp` e `…codigo.fdv`, só quando o código existe.
