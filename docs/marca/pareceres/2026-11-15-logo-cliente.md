# Parecer da marca · Logo do cliente, simulação (designer-ux)

> 2026-11-15 (Manaus) · design-de-marca · branch `nuvem/logo-cliente-designer-ux`, head `d832bc4a`.
> Spec `docs/design/telas/logo-cliente.md` e simulações em `docs/design/telas/logo-cliente/` (8 PNG, 6 HTML, CSS e a logo fictícia).
> Decisões do Alexandre: carga com a variação A e login sem logo (R-20261114-234500); nome fantasia no Mais (R-20261114-223500).
> Parecer anterior: `pareceres/2026-11-15-lote-noite.md` (branch `nuvem/reteste-lotes-b-design-de-marca`), parte 2, lote 13 (MC-0066, MC-0067 e MC-0068).

## Veredito
**Liberado com ajustes.** A convivência das duas marcas está certa em todas as superfícies. As MC-0066 e MC-0067 fecham. Abre a **MC-0088** (baixa): a linha "Etapa n de N · nome" saiu da carga, o que diverge da entrada aprovada (manual §4). Essa MC precisa de uma decisão antes da implementação, que só vem depois do build da v1.0.9. Ela não segura a simulação.

## Como conferi
- Abri os 8 PNG e li os HTML e o CSS.
- Medi os pixels nos PNG de 2×, com Python/PIL, e converti para dp.
- Calculei as razões de contraste pela fórmula WCAG.

## Princípio da convivência (manual §2.4 e §7)
- **PDF:** a marca é a do cliente. A Macuxi não aparece.
- **App e portal:** a marca é a Macuxi. A logo do cliente entra como assinatura de quem licenciou: sempre menor, numa placa branca e fora da área de proteção.
- **Login:** sem a logo do cliente, por decisão do Alexandre. Assim a disputa da MC-0067 no login deixa de existir.

## Conferência por superfície

| Superfície | O que medi ou vi | Resultado |
|---|---|---|
| **Carga, Campo, com logo** (`carga-campo.png`) | Logo empilhado negativo com 124 × 116 dp e o "M" com 24,5 dp. O filete fica a 24 dp do logo e a 24 dp da placa, em `#3A4D68` (o trilho, §4). A placa mede 112 × 64 dp, é branca, sem borda e tem raio 12. A logo ocupa até 96 × 48 dp, em `contain`. Barra `#F59A52` sobre `#3A4D68` e ✓ `#7FD1A8`, como na §4 | **conforme** (variação A). A Macuxi fica com 116 dp de altura contra 64 da placa, então a hierarquia está clara. O filete encosta no limite da área de proteção (24 contra 24,5 dp, abaixo de 1 px no print). Na implementação, use 24 dp fixos com o logo a 124 dp |
| **Carga, Gestão, com logo** (`carga-gestao.png`) | Mesmas medidas, sobre o Pérola. Logo empilhado positivo, filete `#DFE2E6` e placa com borda `#DFE2E6`. Barra `#C2540A` sobre `#DFE2E6` (gráfico: 4,26:1 no Pérola) e ✓ `#1D6B4F` com texto ao lado | **conforme** |
| **Carga, sem logo** | Igual à entrada de hoje, menos a linha "Etapa 2 de 5 · Clientes e rota", que virou só `aria-label` (RD-0451) | **MC-0088** |
| **Login e telas de senha** | Sem a logo do cliente (spec §4) | **conforme**. A MC-0067 fecha no login |
| **Mais** (`mais.png`) | "Licenciado para Exemplo Norte" em 13/18, `#4A5562` (7,03:1 no Pérola). Placa de 52 × até 176 dp com borda `#DFE2E6` e logo de 36 dp. Faixa "Mais" em Azul noite e aba ativa em Azul noite. Sem logo, fica só a frase | **conforme**. A MC-0067 fecha no Mais. A frase é curta e diz o que é. O nome fantasia vem da decisão R-20261114-223500 |
| **Portal `config.`** (`portal-tela.png`, `portal-estados.png`) | Barra Azul noite com o logo negativo de 104 px (≈22 px de altura, acima do mínimo de 20, §2.3). Cartão "Logo" com caixa branca de 240 × 96, borda `#DFE2E6` e raio 12. Vazio tracejado em `#C9CED5` sobre o Pérola. "Salvar" em Azul noite. "Remover" secundário com texto `#A8261B` (7,10:1). O diálogo usa o botão de perigo `#A8261B` com texto branco. O erro vai em `#A8261B` com ícone e texto. Os limites vão em `#4A5562` | **conforme**. Ali a logo do cliente é o conteúdo que se edita, e não disputa com a Macuxi da barra |
| **PDF de pedido e de orçamento com logo** | A logo do cliente vai no cabeçalho, sem a Macuxi. Caixa de 16 mm de altura e até 48 mm de largura, em `contain`, à esquerda, sem raio. "PEDIDO" e "ORÇAMENTO" saem em Azul noite. O cabeçalho da tabela é `#00843D`, como foi aprovado (§7) | **conforme** |
| **PDF sem logo** | Volta a `logo-padrao-pdf-256.png` com 16 × 16 mm (§7) | **conforme** |
| **Regras gerais (spec §1)** | Placa branca única, `contain`, sem recolorir, sem sombra, sem texto de explicação, rótulo "Logo da <nome fantasia>" e logo decorativa no Mais | **conforme** |

**Cores dos HTML:** só a paleta. O `#E4E6E9`, o `#BFC4CC` e as sombras são da prancha e da moldura do celular, e não vão para o produto. A logo "Exemplo Norte" é fictícia, então não há marca de terceiros.

**Neutros do PDF:** `#F1F2F0`, `#F3F4F1` e `#ECEEEA` continuam em `modules/vendedor/domain/pdf-pedido.ts:207/229/239` no `main`. É a **MC-0068** (baixa, modulo-vendedor), que segue aberta, fora deste lote e com a correção já dada no parecer do lote 13.

## MC-0088 (baixa): a linha "Etapa n de N · nome" saiu da carga

| Campo | Conteúdo |
|---|---|
| ID | MC-0088 |
| Onde | `docs/design/telas/logo-cliente/carga.html`, função `carga()`: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span>`. Prints `carga-campo.png` e `carga-gestao.png`, nas telas sem logo e com logo |
| Tipo | aplicação |
| Fere | manual §4, "Entrada no app (aprovada em 12/11/2026)": "'Etapa n de N · nome' e o percentual em branco". Também contradiz a spec §3, que diz que a tela sem logo é "igual a hoje" (no `main`, `docs/design/entrada-sync.md:24` ainda tem a linha) |
| Gravidade | baixa: cor e logo seguem certos, e é uma simulação |
| Correção | A simulação da logo não muda a entrada aprovada. Volte a linha visível: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span>` → `<span>Etapa 2 de 5 · ${T.etapas[1]}</span>`, em branco no Campo e Azul noite no Gestão, e gere de novo os dois PNG. Se o corretor mantiver a RD-0451, isso vira uma proposta à parte para o Alexandre, porque muda a §4 do manual e a tela de produção. Só entra com o "aprovo" dele |
| Dono | designer-ux |

## Para o Alexandre (nada entra no manual sem o "aprovo")
Quando a implementação for aprovada, proponho a **§2.5 "Logo do cliente"** no manual:
1. a logo do cliente vai sempre numa placa branca: 64/48 dp na carga e 52/36 dp no Mais;
2. a logo do cliente é sempre menor que o logo Macuxi da tela e fica fora da área de proteção;
3. no PDF vai só a marca do cliente;
4. no login não vai a logo do cliente.

## Reteste
No print do aparelho (Campo e Gestão), do portal a 1366 px e do PDF real, quando a implementação vier, depois da v1.0.9.
