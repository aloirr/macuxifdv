# Catálogo: aplicação ("Serve em"), referência cruzada ("Equivale a"), ficha e seção Catálogo do BKO (T-0084, T-0085)

> 2026-11-08 · designer-ux · pedido R-20261105-212836 (engenheiro-software), lote 1. Revisão das telas: R-20261105-223106.
> Desenho: `docs/desenho/T-0084.md` §11 e `docs/desenho/T-0085.md` §8. Referência: canvas "Telas do app", quadros 6b, 6c e 10b.
> **Vale a caixa por item** (R-20261105-191229), não a chave única da folha do PDF do quadro 6b.
> Regras: RN-CAT-05 (promotor sem preço e estoque), RN-CAT-09 (referência cruzada), RN-CAT-11 (oferece junto), RN-CAT-12
> (busca pela aplicação), RN-VEN-19 (aplicação no orçamento).
> Dados que a tela recebe: `serve_em = { texto ≤ 90, marcas: [inicio, fim][], inclui_ano }` e
> `equivale_a = { marca_nome, codigo, marcas }` (`modules/catalogo/contracts/busca.ts`).
> Telas: modulo-catalogo (`app/telas/comum.tsx`, `app/telas/produto.tsx`, `web/pages/catalogo-page.tsx`), modulo-vendedor
> (seletor, item do pedido, detalhe e PDFs), modulo-catalogo também na página Marcas concorrentes (T-0113, ADR 0034; antes Parâmetros → Produtos → Concorrentes no Core). Navegação pela
> hierarquia (sem tela "Por linha", T-0142): `catalogo-por-linha.md`. Busca sem resultado: `catalogo-busca-vazio.md`.

## 1. Busca e lista (app Campo e Gestão; BKO no que couber)

### 1.1 Linha "Serve em" (RN-CAT-12)
Aparece no cartão do resultado quando a busca casou na aplicação (`serve_em` presente), logo abaixo do nome.
- Texto: **`Serve em: <texto>`** e, se houver ano incluído, o sufixo **` · inclui 2012`** (fora dos 90 caracteres).
- Rótulo "Serve em:" em `t.label`; o texto em 14 (`t.sub`, `ink2`); os termos achados em negrito `ink`.
- Até **2 linhas**, com reticências no fim. O sufixo "· inclui 2012" vem logo depois do texto (pode ser cortado junto: a
  ficha mostra tudo).
- As marcas (`[inicio, fim]`) são posições no texto **sem** o rótulo: a tela soma 10 ("Serve em: ").

### 1.2 Linha "Equivale a" (RN-CAT-09)
Quando a busca casou num código de concorrente: **`Equivale a: <marca> <código>`** (ex.: `Equivale a: Freiomax CB 3401`),
o trecho achado em negrito. Rótulo em `t.label`, texto em `t.sub`. 1 linha. As marcas somam 12 ("Equivale a: ").
Com "Serve em" e "Equivale a" juntos, "Serve em" vem primeiro.

### 1.3 Lista do seletor do Novo pedido
A mesma linha "Serve em", em 2 linhas com reticências, abaixo do nome e acima do preço. Sem busca pela aplicação, a linha não
aparece (o seletor não mostra a aplicação inteira de cada item).

### 1.4 TalkBack
O cartão é lido inteiro: "<nome>. Serve em: <texto>, inclui 2012. <preço>". Os negritos não mudam a leitura.

## 2. Pedido (modulo-vendedor)

### 2.1 Item do pedido
- As 2 linhas do item como hoje; abaixo da linha 3, a caixa **"Incluir aplicação no orçamento"** (por item, alvo de 48 dp,
  marcada pelo padrão do tenant, RN-VEN-19). TalkBack: `Incluir aplicação no orçamento: <nome do produto>`.
- Item sem aplicação: sem a caixa.

### 2.2 Detalhe (Campo, Gestão e BKO) e PDFs
- **`Aplicação: <texto>`** abaixo da descrição do item, em `t.small` `ink2` (app) / 13 px `text-ink-2` (BKO). No PDF, o texto
  já vem cortado em 300 caracteres.
- Só sai quando a caixa do item está marcada (no orçamento) ou, no pedido, quando o item tem aplicação.
- **"Equivale a" só no PDF interno** (o do vendedor e do escritório); nunca no PDF que vai ao cliente.

## 3. Ficha do produto e aba Catálogo (app)

### 3.1 Ordem da ficha (quadro 10b)
1. Título, código, medida e embalagem; **etiquetas em chips logo abaixo do título**, junto do "Destaque" (até 4, cada uma
   com até 20 caracteres; `ChipEstado` neutro).
2. Foto.
3. Preço e estoque no contexto do cliente (escondidos para o promotor, RN-CAT-05).
4. **Sobre o produto** (descrição).
5. **Aplicação**: o texto inteiro; acima de 6 linhas, corta em 6 e mostra **"Ver mais"** / **"Ver menos"** em `accentInk`
   (14/600), alvo de 48 dp. TalkBack: "Ver mais da aplicação" / "Ver menos da aplicação".
6. **Oferece junto** (até 5): uma linha por produto, tocável (abre a ficha dele), alvo de 48 dp, nome + código, **chevron
   `chevron-right` em `ink3` à direita**, retorno ao toque (escala 0,97 em 120 ms ou fundo `ground`), sem borda na última.
7. **Equivale a** (até 3): `<marca> <código>`, o código em negrito. Só leitura.

Seção sem dado: não aparece (sem título vazio).

### 3.2 Aba Catálogo pela hierarquia
Ver `catalogo-por-linha.md` (T-0142: um nível por tela com a contagem, trilha sistema › grupo › linha; no último nível, o
`CartaoProduto` com "Serve em:" em 2 linhas, "Equivale a:" e etiquetas; "Oferece junto" só aqui na ficha).

### 3.3 Estados
| Estado | O que aparece |
|---|---|
| vazio (produto sem aplicação, sem oferece junto, sem referência, sem etiqueta) | só as seções 1 a 4; nada de "Sem aplicação" |
| longo (aplicação com 2.000 caracteres) | 6 linhas + "Ver mais"; aberto, rola com a tela |
| offline | tudo vem do aparelho; Oferece junto de produto que não está no aparelho: a linha aparece **sem** chevron e sem toque, com o apoio `Ainda não está no aparelho` (`ink2`) |
| promotor | a ficha inteira sem preço e estoque (RN-CAT-05); aplicação, oferece junto, equivale a e etiquetas iguais |

## 4. BKO: seção Catálogo do cadastro do produto (T-0085)
- Só com `produto.enriquecer` a seção é editável. Sem a permissão: **só leitura**, com os mesmos campos como texto (pendência
  registrada na revisão; até lá, a seção não aparece).
- **Aplicação**: textarea; embaixo, à direita, o contador **`1.234 / 2.000`** (o limite vem do parâmetro
  `aplicacao_max_cadastro`, nunca fixo), em `text-danger` quando passa; na linha de baixo, a dica
  `Ex.: "Fiat Uno 1.0/1.4 2010–2014". A busca acha o ano dentro da faixa.`
- **Oferece junto**: até 5. Na v1, um código ERP por linha; embaixo de cada código achado, o nome do produto
  (`CB-0002 · Disco de freio ventilado`) para conferir. Depois: seletor de produto reordenável (pendência).
- **Equivale a**: 3 linhas com a marca (lista das marcas concorrentes) + o código (até 30 caracteres).
- **Etiquetas**: separadas por vírgula, até 4, cada uma com até 20 caracteres.
- Sem marca cadastrada: `Cadastre as marcas em Cadastros → Marcas concorrentes para usar a referência cruzada.` (link para `/catalogo/marcas`; sem citar o módulo Promotor)
- **Um só botão principal** na tela ("Salvar catálogo"); o do Conteúdo é secundário enquanto as seções forem separadas.
  Sucesso de uma seção não fecha a outra: `Catálogo salvo.` / `Conteúdo salvo.` (Notice success).

### 4.1 Mensagens dos limites (nunca mostrar o caminho técnico do campo, como `referencias.0.codigo`)
| Limite | Texto |
|---|---|
| aplicação acima do limite | `Aplicação: use até 2.000 caracteres (agora: 2.140).` |
| mais de 3 referências | `Use até 3 referências de concorrente.` |
| código do concorrente acima de 30 | `Código <n>: use até 30 caracteres.` |
| marca sem código | `Há uma marca sem código. Informe o código do concorrente ou tire a marca.` |
| código sem marca | `Referência "<código>": escolha a marca concorrente da lista.` |
| mais de 5 em oferece junto | `Oferece junto: use até 5 produtos.` |
| código de oferece junto não achado | `Não achamos o produto de código <código>. Confira o código ou busque o produto no filtro acima e tente de novo.` |
| mais de 4 etiquetas / etiqueta acima de 20 | `Use até 4 etiquetas, com até 20 caracteres cada.` |

### 4.2 Exportação (PDF e CSV)
- Escolha de sistema ou linha (lista suspensa) e dois botões: **"Baixar PDF"** (secundário) e **"Baixar Excel (CSV)"**
  (secundário); não há principal nesta área.
- PDF: capa com o sistema/linha e a data (fuso do tenant); **sumário** com a contagem de itens por linha; a tabela
  **Código · Aplicação · Oferece junto · Equivale a**, aplicação inteira, quebrando na célula.
- CSV com `;` e UTF-8 com BOM (abre direto no Excel), as mesmas colunas.
- Carregando: `Gerando o arquivo…` no botão. Vazio: `Nenhum produto nesta linha.` Erro: o texto padrão com "Tentar de novo".

### 4.3 Cadastros → Marcas concorrentes (Catálogo, T-0113, ADR 0034)
Página `modules/catalogo/web/pages/marcas-page.tsx` (substitui a do Core prevista no desenho). Lista das marcas concorrentes (nome, ativa/inativa com `ChipEstado`), **"Nova marca"** (principal) e "Inativar" por linha com
confirmação `Inativar a marca <nome>? As referências com esta marca deixam de aparecer na busca.` Vazio:
`Nenhuma marca concorrente ainda. Cadastre a primeira para usar a referência cruzada no catálogo.`

## 5. Contraste e alvos
Texto laranja só em `accentInk` (`componentes.md` §1.1). Alvos de toque ≥ 44 dp no app (48 nas linhas tocáveis da ficha).
