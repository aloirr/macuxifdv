# Códigos do cliente: Código ERP e Código FDV (v1.0.29)

> 2026-11-23 · designer-ux · sessão D da v1.0.29. Base: ADR 0069, item 10 e seção H (resposta (a) do dono do produto).
> Telas: ficha do cliente no app (Campo e Gestão), formulário do pré-cadastro no Campo, Carteira e Cliente 360 do BKO,
> lista e gaveta dos **Pré-cadastros recusados** (`bko-pre-cadastros-recusados.md`, simulações `pre-cadastro-v1029/01` a `03`).
> Sem cor, token nem componente novos. Validar com o `design-de-marca` (muda layout da Carteira e da lista dos recusados).

## 1. Os dois códigos
| Código | Origem | Quando existe |
|---|---|---|
| **Código ERP** | `core.cliente.external_id` | cliente vindo do ERP; pré-cadastro só depois do retorno `vinculado` |
| **Código FDV** | `core.cliente.codigo_fdv` (5 dígitos ou mais, só leitura) | pré-cadastro (Campo ou BKO), a partir do momento em que o servidor o recebe; no aparelho, só depois do 1º sync; cliente vindo do ERP não tem |

## 2. Forma (igual em toda superfície)
- **Rótulo curto + valor:** `ERP C5007` e `FDV 00012`. O rótulo é a sigla, sempre antes do valor; nunca o valor sozinho.
  Leitor de tela: `Código ERP C5007` / `Código FDV 00012` (`accessibilityLabel` / `aria-label`).
- **Ordem fixa:** ERP primeiro, FDV depois (o ERP é o código da maior parte da base e o que o escritório usa com o ERP; a
  posição não muda de um cliente para outro).
- **Valor:** como está no banco (o FDV já vem com zeros à esquerda, `formatarCodigoFdv`). No BKO, valor em mono 13 px
  `text-ink` e sigla 12/500 `text-ink-2` (#4A5562), como o código do aceite na gaveta dos recusados. No app, o estilo do texto
  onde aparece (sem mono).
- **Não é selo:** código não usa `Badge`/`ChipEstado` (selo é estado, e estado tem cor com texto; código é identificação).
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
| do ERP | `ERP C5007 · Centro · Boa Vista/RR` |
| pré-cadastro vinculado | `ERP C5007 · FDV 00012 · Centro · Boa Vista/RR` |
| pré-cadastro já no servidor, sem vínculo | `FDV 00012 · Centro · Boa Vista/RR` (o selo `Aguardando ERP` ou `Recusado pelo ERP` fica onde já está) |
| pré-cadastro antes do 1º sync | `Centro · Boa Vista/RR` |

- `numberOfLines={1}`; se não couber, as reticências cortam o fim (cidade), nunca os códigos (eles vêm antes).
- Campo e Gestão usam a mesma ficha do Core: nada muda entre as variantes.

### 3.2 Lista de clientes (`telas/clientes.tsx`)
Sem código na linha (RN-CORE-47: nome, uma tag, última visita, seta). A **busca** casa também pelo Código FDV (§6).

### 3.3 Formulário do pré-cadastro ("Corrigir e reenviar")
- Com Código FDV: abaixo do título da tela, no estilo de subtítulo (`t.sub`), **`FDV 00012`**. Sem campo de formulário (não é
  editável) e sem cadeado.
- Sem Código FDV (antes do 1º sync) ou em **Novo cliente**: nada.
- Código ERP nunca aparece aqui (a correção só existe sem vínculo).

## 4. BKO — Carteira (`modules/core/web/components/carteira/carteira-page.tsx`)
- **Tabela "N clientes vigentes":** coluna nova **Código**, a 2ª (depois de **Cliente**), 104 px, `white-space: nowrap`.
  Conteúdo: uma linha por código existente, empilhadas, ERP em cima e FDV embaixo (`ERP C5007` / `FDV 00012`), 13/16 px.
  Sem nenhum código: célula vazia (não acontece na prática: cliente do ERP sempre tem ERP; pré-cadastro no servidor sempre tem FDV).
  A linha já tem 44 px (os `select`s); duas linhas de 16 px cabem sem crescer. `TableScroll minWidth` passa de 880 para 984.
- **"Vincular cliente"** (candidatos da busca): o mesmo bloco de códigos entre o nome e a cidade (em linha, `ERP C5007 · FDV 00012`),
  para o usuário conferir o cliente certo antes de **Vincular**.
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
