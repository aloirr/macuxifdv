# Marca Macuxi FDV: proposta v1 (logo e cores oficiais)

> 2026-11-12 · design-de-marca · modo `propor` · T-0169 · pedido R-20261112-155448-alexandre.
> **Situação: em análise.** Nada daqui entra no `docs/marca/manual.md` antes do "aprovo" do Alexandre.

Pranchas (A4 de tela, 3200 px de largura), geradas por `gerar.mjs` (HTML → PNG pelo Playwright):

| Arquivo | O que mostra |
|---|---|
| `comparativa.png` | as 3 opções lado a lado, com o custo, o ganho e o risco de cada uma |
| `opcao-a.png` | **A · Rota** (recomendada) |
| `opcao-b.png` | B · Sol a sol |
| `opcao-c.png` | C · Confluência |
| `contraste.json` | a razão de contraste de cada par, conferida pelo script |

Para refazer as imagens, rode na raiz do repositório:
```bash
node docs/marca/propostas/2026-11-12-marca-v1/gerar.mjs
```

Cada prancha traz: o logo (símbolo e escrita) nas versões positiva, negativa, monocromática e sobre a cor principal; o ícone adaptativo do Android (camada de 108 dp com a zona segura, as máscaras círculo, arredondada e gota, o ícone temático e os tamanhos 48, 32 e 24 px); a paleta com o papel de cada cor; a tipografia; a tabela de contraste; e a aplicação simulada (ícone na tela do celular, Início do Campo, login, cabeçalho do PDF de pedido e assinatura de e-mail).

## 1. O que vi hoje
- **O app não tem logo.** O ícone do Campo e do Gestão, na tela do celular, é o ícone provisório do kit de desenvolvimento (um "A" branco em fundo azul, `apps/mobile/assets/images/icon.png`). O mesmo ícone entra no PDF de pedido quando a distribuidora não cadastrou o logo dela (`LOGO_PADRAO_DATA_URI`, T-0159). O portal `config.` usa um quadrado laranja com "M". É a falha de marca mais visível ao cliente.
- **As cores estão firmes e consistentes.** Laranja `#C2540A` no preenchimento, `#8F3D06` no texto laranja, grafite `#16202A`, fundo `#F3F4F1` e verde `#1D6B4F` só para situação, iguais no app, no BKO e no portal, com o contraste testado (T-0094, `packages/ui/src/comum/contraste.ts`).
- **A tipografia está boa.** A Archivo nos títulos e números e a IBM Plex Sans no texto são legíveis no Android médio e já estão no app e no BKO.
- **Fora da paleta:** o cabeçalho verde da tabela do PDF (`#00843D`, aprovado na T-0159). Não mexo nele nesta proposta; fica registrado para uma decisão futura sua.

## 2. As 3 opções

### A · Rota (recomendada)
- **Ideia:** um traço só desenha o M, como a rota do dia. O ponto no fim é a visita feita. Serve ao vendedor e ao promotor.
- **Cores:** as de hoje, sem nenhuma mudança: Laranja Macuxi `#C2540A` (preenchimento: botão principal, ícone, barra, contador), Laranja texto `#8F3D06` (texto laranja sobre claro), Laranja claro `#F59A52` (laranja sobre o grafite), Laranja suave `#FBE9DC` (fundo de chip e de cartão em destaque), Grafite `#16202A`, Fundo `#F3F4F1` e Verde sucesso `#1D6B4F` (só situação).
- **Escrita:** "Macuxi" em Archivo ExtraBold, com "FORÇA DE VENDAS" em IBM Plex Sans SemiBold espaçada.
- **Ícone:** Campo com fundo laranja, M branco e ponto grafite; Gestão com fundo grafite, M branco e ponto laranja-claro. O mesmo símbolo com os fundos trocados, para ninguém confundir os dois apps.
- **Custo:** baixo. Nenhuma cor muda; entra o logo no ícone do app, no splash, no login, no portal e no logo padrão do PDF.

### B · Sol a sol
- **Ideia:** o sol no horizonte, cortado em faixas: o dia do vendedor, do nascer ao pôr do sol.
- **Cores:** Amarelo sol `#F2A900` (preenchimento com texto grafite), Terra `#7A4100` (texto de destaque sobre claro), Sol suave `#FDF0C8`, Grafite `#16202A`, Fundo `#F3F4F1` e Verde sucesso `#1D6B4F`.
- **Escrita:** "MACUXI" em Archivo ExtraBold, caixa alta, como placa.
- **Ganho:** amarelo com grafite é o par mais legível debaixo do sol, e a marca fica bem visível na tela do celular.
- **Custo:** alto. Troca a cor de todas as telas e do BKO; o botão principal passa a ter texto grafite; o aviso, hoje amarelo-terra, precisa de outro tom; a barra amarela some no fundo branco (2,01:1, abaixo do mínimo de 3:1) e precisa de contorno. O sol é um símbolo comum, pouco nosso.

### C · Confluência
- **Ideia:** dois traços que viram um. O Uraricoera e o Tacutu se juntam e formam o Rio Branco, o rio de Roraima: o campo e o escritório no mesmo fluxo.
- **Cores:** Azul rio `#0A5A8C` (preenchimento e texto de destaque), Azul claro `#7CC4DE` (sobre o grafite), Azul suave `#E1EEF5`, Grafite `#16202A`, Fundo `#F3F4F1` e Verde sucesso `#1D6B4F`.
- **Escrita:** "Macuxi" em IBM Plex Sans Bold.
- **Ganho:** uma cor só para tudo e cara de sistema de gestão.
- **Custo:** médio. Troca o laranja por azul em todas as telas e no BKO. **Risco:** o azul é a cor da maioria dos sistemas e dos aplicativos de banco, e a marca some no meio deles. Perde também o laranja que o vendedor já conhece.

## 3. Contraste conferido
Mesma conta do `packages/ui/src/comum/contraste.ts` (WCAG 2.x): texto ≥ 4,5:1; gráfico e ícone ≥ 3:1. A lista completa está em `contraste.json`.

| Opção | Par | Razão |
|---|---|---|
| A | branco no botão laranja `#FFFFFF`/`#C2540A` | 4,60 ✓ |
| A | laranja texto no fundo `#8F3D06`/`#F3F4F1` | 6,70 ✓ |
| A | laranja texto no branco `#8F3D06`/`#FFFFFF` | 7,40 ✓ |
| A | laranja claro no grafite `#F59A52`/`#16202A` | 7,56 ✓ |
| A | ponto grafite no ícone laranja (gráfico) `#16202A`/`#C2540A` | 3,58 ✓ |
| A | símbolo laranja no branco (gráfico) `#C2540A`/`#FFFFFF` | 4,60 ✓ |
| B | grafite no botão amarelo `#16202A`/`#F2A900` | 8,20 ✓ |
| B | terra no fundo `#7A4100`/`#F3F4F1` | 7,36 ✓ |
| B | amarelo no grafite `#F2A900`/`#16202A` | 8,20 ✓ |
| B | amarelo no branco (gráfico) `#F2A900`/`#FFFFFF` | **2,01 ✗** (por isso a barra precisa de contorno) |
| C | branco no botão azul `#FFFFFF`/`#0A5A8C` | 7,36 ✓ |
| C | azul no fundo `#0A5A8C`/`#F3F4F1` | 6,66 ✓ |
| C | azul claro no grafite `#7CC4DE`/`#16202A` | 8,48 ✓ |

O texto grafite no fundo dá 14,93 ✓ nas 3 opções.

## 4. Recomendação: opção A · Rota
1. **O problema real é a falta de logo, não a cor.** Hoje o vendedor vê na tela do celular um ícone que não é nosso, e o cliente pode receber um PDF com esse mesmo ícone. A opção A resolve isso sem refazer nenhuma tela.
2. **Marca se constrói repetindo os mesmos sinais.** O laranja e o grafite já estão em todas as telas do Campo, do Gestão, do BKO, do portal e do PDF. Trocar a cor agora joga fora o que o vendedor já reconhece e abre retrabalho em todo o time às vésperas do build.
3. **O laranja se destaca na tela do celular**, que costuma estar cheia de ícones azuis e verdes. O símbolo do M com o ponto deixa o ícone nosso, e não só laranja.
4. **Custo e risco baixos:** as cores e o contraste já estão testados (T-0094). Entram só os arquivos do logo e do ícone.

Se você preferir mudar de verdade, a B é a mais forte para o uso ao sol, mas é a mais cara de aplicar. A C é a mais segura no visual e a mais fácil de confundir com outros sistemas.

## 5. Cultura macuxi
- Nenhuma opção usa grafismo tradicional, símbolo sagrado ou ritual. Os símbolos vêm do trabalho de campo (rota e visita), do sol e dos rios de Roraima (o Uraricoera e o Tacutu formam o Rio Branco).
- As cores não levam nome de pigmento ou de pintura tradicional.
- "Macuxi" é o nome de um povo: a escrita fica sempre inteira, com inicial maiúscula (ou caixa alta na B), sem letra deformada, sem sombra e sem contorno.
- Se no futuro a marca usar um padrão inspirado na cultura macuxi, ele só entra com um artista ou uma organização macuxi, com a origem registrada e o crédito.

## 6. A proposta anterior (recusada)
Não repito nada da proposta da ponte: a paleta "Urucum/Jenipapo/Buriti/Lavrado" e os logos "Tepui", "Trama" e "Buriti". Nenhuma opção usa montanha, palmeira, trançado nem cor com nome de pigmento.

## 7. Depois do "aprovo"
1. design-de-marca: registra a opção no `docs/marca/manual.md` e no `docs/marca/decisoes.md` e gera os ativos finais em `docs/marca/ativos/` (SVG do símbolo e da escrita; PNG do ícone em 1024 px; camadas do ícone adaptativo: frente, fundo e monocromática em 432 px; splash).
2. designer-ux: na opção A, nenhum token muda. Na B ou na C, troca os tokens de `packages/ui` e o `apps/web/app/globals.css`, com o teste de contraste.
3. engenheiro-apps: troca o ícone e o splash do app (`apps/mobile/assets/images/*`, `app.config.ts`) e a `Marca` do portal (`apps/web/components/portal/base.tsx`).
4. modulo-vendedor: troca o logo padrão do PDF (`LOGO_PADRAO_DATA_URI`) pelo ícone novo.
5. design-de-marca: valida tudo no print do aparelho, do PDF e do navegador antes do lote e do build.

## Premissas
- Empresas, pessoas, CNPJ e endereços das simulações são fictícios.
- O nome dos apps continua "Macuxi Campo" e "Macuxi Gestão", e o domínio continua `macuxifdv.com.br`.
- O Início do Campo não ganha logo (seria repetição na tela): a marca aparece na cor do destaque, na aba ativa e na barra da meta.
- O cabeçalho verde da tabela do PDF (`#00843D`, T-0159) fica como você aprovou.
