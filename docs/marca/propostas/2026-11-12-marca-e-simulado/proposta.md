# Marca aprovada (E · Monte Roraima): logo alinhado, simulado de todas as telas e fundo do app

> 2026-11-12 · design-de-marca · T-0169.
> A opção E foi aprovada no chat: "Aprovado o 2 . vamos trabalhar so no fundo agora" (registro em `docs/marca/decisoes.md`).
> Pedido desta rodada, no chat: "Faça um simulado de todas as telas com o modelo do macuxi e simule cores de fundo para mim. Ajuste também o enquadramento entre o MACUXI -> força de vendas e a logo, achei que elas nao estavam alinhadas."
> **Em aberto:** a cor de fundo. O manual só vai ser escrito quando ela for escolhida.

| Arquivo | O que mostra |
|---|---|
| `alinhamento.png` | o logo antes e depois, com as linhas-guia, as versões e os tamanhos mínimos |
| `fundos-comparativo.png` | Início e Novo pedido em 6 fundos, com o contraste de cada um |
| `simulado-areia.png` | todas as telas no fundo Areia `#F6F1E7` (recomendado) |
| `simulado-nevoa.png` | todas as telas no fundo Névoa `#EEF2F7` |
| `simulado-branco.png` | todas as telas no fundo Branco `#FFFFFF` |
| `simulado-topo.png` | todas as telas com a faixa azul serra no topo e o resto branco |
| `azuis.png` | seis azuis (serra, névoa, ardósia, noite, índigo névoa e petróleo), cada um com o seu fundo névoa |
| `noite-fundos.png` | Azul noite no cabeçalho, com seis fundos no corpo (branco, cinza, névoa noite, gelo, pérola e areia) |
| `noite-simulado-branco.png`, `noite-simulado-cinza.png`, `noite-simulado-perola.png` | todas as telas com o cabeçalho Azul noite nesses fundos |
| `contraste.json` | a razão de contraste de cada texto em cada fundo |

Para refazer as imagens, rode na raiz do repositório:
```bash
node docs/marca/propostas/2026-11-12-marca-e-simulado/gerar.mjs
```

## 1. Logo alinhado
Antes, o símbolo só ficava centralizado na altura do texto. O sol passava do topo do "M", e a linha do lavrado não batia com a base de "FORÇA DE VENDAS". Agora o logo é uma peça só (SVG), com regras fixas:
1. **O topo do sol fica na linha do topo do "M"** de "Macuxi".
2. **A linha do lavrado fica na base de "FORÇA DE VENDAS".**
3. **"FORÇA DE VENDAS" tem a largura exata de "Macuxi"**: IBM Plex Sans SemiBold, com o espaço entre as letras ajustado.
4. O espaço entre o símbolo e a escrita é 0,3 da altura do logo.
5. A largura de "Macuxi" é medida no navegador com a fonte carregada. O gerador para com erro se a Archivo não carregar.

Versões:
- positiva;
- negativa no grafite;
- sobre o azul serra;
- monocromática;
- empilhada, para o splash e os materiais.

Tamanhos: com a escrita, no mínimo 20 px de altura; abaixo disso, só o símbolo.

## 2. Simulado de todas as telas
Em cada fundo simulado aparecem:
- **app Campo:** abertura, login, Início, Rota do dia, Clientes, Cliente 360, Novo pedido (itens), Pedidos, Catálogo, Mais e Visita do promotor;
- **app Gestão:** Equipe hoje e Aprovar pedido;
- **BKO:** Pedidos;
- **portal `config.`:** Entrar;
- **PDF de pedido e assinatura de e-mail.** O papel do PDF e o e-mail são sempre brancos.

Uso das cores:
- o azul serra fica nos botões principais, nos links, na aba ativa e nos selos de destaque;
- o laranja sol fica nas barras de meta e de share e no contador de "Pedidos para aprovar";
- o Sincronizar continua grafite, como hoje.

## 3. Fundos simulados
| Fundo | Hex | Leitura | Texto de apoio `#5B6673` | Laranja sol (gráfico) |
|---|---|---|---|---|
| Cinza de hoje | `#F3F4F1` | neutro e frio; só referência | 5,29 ✓ | 4,17 ✓ |
| Branco | `#FFFFFF` | o mais legível ao sol; sem calor | 5,84 ✓ | 4,60 ✓ |
| **Areia (recomendado)** | `#F6F1E7` | quente sem pesar; os cartões brancos se destacam | 5,19 ✓ | 4,09 ✓ |
| Palha | `#EFE8DA` | a areia mais forte; cansa mais em tela cheia | 4,79 ✓ | 3,77 ✓ |
| Névoa | `#EEF2F7` | azul bem claro; combina com o azul, mas é frio | 5,20 ✓ | 4,09 ✓ |
| Topo azul + branco | `#24456B` + `#FFFFFF` | o mais marcante; muda o layout de todas as telas | 5,84 ✓ | 4,60 ✓ |

Todos os pares passam nos 6 fundos: texto ≥ 4,5:1 e gráfico ≥ 3:1. Na faixa azul do Topo, o texto claro `#C9D6E8` dá 6,67:1. A lista completa está em `contraste.json`.

**Recomendação: Areia `#F6F1E7`.**
- Tira a cara de sistema genérico trocando um token só, sem mexer em nenhuma tela.
- Dá o calor de Roraima e combina com o azul serra e com o sol.
- Todos os textos ficam bem acima do mínimo.

A Palha é a mesma ideia, mais forte. O Topo azul pode vir depois, se você quiser mais marca na tela, porque muda o layout.

## 4. Depois da escolha do fundo
1. design-de-marca:
   - escreve o `docs/marca/manual.md` com a marca inteira (símbolo, lockup e regras de alinhamento, paleta, fundo, tipografia e aplicações);
   - registra o fundo no `docs/marca/decisoes.md`;
   - gera os ativos finais em `docs/marca/ativos/`: SVG do lockup, empilhado e símbolo; ícone de 1024 px; camadas do ícone adaptativo; splash.
2. designer-ux:
   - troca nos tokens (`packages/ui`, `apps/web/app/globals.css`) o destaque laranja pelo azul serra nos botões e links, e o fundo `#F3F4F1` pelo escolhido;
   - mantém o laranja nos gráficos;
   - roda o teste de contraste.
3. engenheiro-apps: troca o ícone, o splash e a `Marca` do portal.
4. modulo-vendedor: troca o logo padrão do PDF.
5. design-de-marca: valida no print do aparelho, do PDF e do navegador antes do lote e do build.


## 5. Outros azuis
Pedido no chat, 12/11/2026: "Veja para mim como é que fica um azul mais névoa. Eu queria ver um azul diferente, um azul mais estiloso, mais refinado, mais elegante."

Prancha `azuis.png`. Ela mostra o mesmo logo, os mesmos ícones, o Início e o login, trocando só o azul. Cada azul vem com o seu **fundo névoa**, que é o próprio azul bem clarinho (7% de azul no branco). O sol laranja não muda.

| Azul | Hex | Fundo névoa | Leitura | Branco no botão | Azul no chip suave |
|---|---|---|---|---|---|
| Azul serra (aprovado) | `#24456B` | `#F0F2F5` | firme, mas é o azul de muito sistema | 9,82 ✓ | 7,75 ✓ |
| Azul névoa | `#4A6C8C` | `#F2F5F7` | acinzentado e leve, a névoa do topo do monte | 5,50 ✓ | 4,56 ✓ (no limite) |
| **Azul ardósia (recomendado)** | `#3D5A73` | `#F1F3F5` | azul de pedra, com cinza: sóbrio e elegante | 7,22 ✓ | 5,86 ✓ |
| Azul noite | `#1E3350` | `#EFF1F3` | marinho profundo, o mais premium | 12,77 ✓ | 9,83 ✓ |
| Índigo névoa | `#4C5F86` | `#F2F4F7` | toque de violeta, empoeirado: o mais ousado | 6,39 ✓ | 5,25 ✓ |
| Azul petróleo | `#1F4F5C` | `#EFF3F4` | das águas do Rio Branco, mas perto do verde de "sucesso" | 9,01 ✓ | 7,14 ✓ |

Todos os pares passam nos 6 azuis:
- branco no botão;
- azul no fundo névoa;
- azul no chip;
- azul claro no grafite;
- texto de apoio no fundo névoa;
- sol laranja no fundo névoa, que é gráfico e precisa de no mínimo 3:1.

A lista completa está em `contraste.json`, chave `azuis`. Cada azul gera o próprio azul claro (55% de branco), o azul suave (86%) e o texto claro sobre o azul (76%).

**Recomendação: Azul ardósia `#3D5A73` com o fundo névoa dele (`#F1F3F5`).**
- É o que mais tira a cara de sistema: um azul com cinza de pedra, sóbrio e elegante.
- Conversa com o sol laranja sem brigar.

Há duas alternativas:
- o **Azul noite**, se você quiser o mais premium;
- o **Índigo névoa**, se você quiser o mais diferente.

O Azul petróleo não é recomendado, porque se confunde com o verde de "sucesso".

O azul e o fundo podem ser escolhidos juntos ("ardósia com névoa") ou separados, por exemplo o ardósia com o fundo Areia `#F6F1E7`.

## 6. Azul noite com o cabeçalho azul
Pedido no chat, 12/11/2026: "Coloque o azul noite, naquele modelo que eu tinha escolhido, né? Lá o cabeçalho com fundo azul, né? E coloque uma simulação com fundo cinza, fundo branco e veja mais alguns fundos lá para mim."

O modelo agora tem o título de cada tela numa faixa **Azul noite `#1E3350`** e o corpo num fundo claro. Os cartões continuam brancos e o sol laranja continua igual. Junto com o azul noite vêm o azul claro `#9AA3B0` (no grafite), o azul suave `#DFE2E6` (chips) e o texto claro na faixa `#C9CED5`. O texto claro na faixa dá 8,07:1.

Pranchas:
- `noite-fundos.png`: Início, Novo pedido e login em seis fundos, com o contraste de cada um;
- `noite-simulado-branco.png`, `noite-simulado-cinza.png` e `noite-simulado-perola.png`: todas as telas (app Campo, app Gestão, BKO, portal, PDF e e-mail) em cada um desses fundos.

| Fundo do corpo | Hex | Leitura | Texto de apoio `#5B6673` | Laranja sol (gráfico) |
|---|---|---|---|---|
| Branco | `#FFFFFF` | o mais limpo e o mais legível ao sol; os cartões precisam de borda | 5,84 ✓ | 4,60 ✓ |
| Cinza de hoje | `#F3F4F1` | melhora com o topo azul, mas continua frio | 5,29 ✓ | 4,17 ✓ |
| Névoa noite | `#EFF1F3` | o azul noite bem clarinho: calmo e coerente | 5,16 ✓ | 4,06 ✓ |
| Gelo | `#E8ECF1` | azul-acinzentado mais presente; os cartões saltam, mas é mais frio | 4,93 ✓ | 3,88 ✓ |
| **Pérola (recomendado)** | `#F8F6F1` | branco quebrado com um toque quente: a dupla clássica com o marinho | 5,41 ✓ | 4,26 ✓ |
| Areia | `#F6F1E7` | quente e elegante, mas é o fundo que mais aparece | 5,19 ✓ | 4,09 ✓ |

Todos os pares passam nos 6 fundos. A lista completa está em `contraste.json`, na chave `noite`.

**Recomendação: Pérola `#F8F6F1` com o cabeçalho Azul noite.**
- Marinho com branco quebrado é a dupla clássica de marca elegante.
- O corpo fica claro como o branco, mas sem o brilho frio e sem a cara de sistema do cinza.
- Se a prioridade for a leitura ao sol, a opção é o Branco puro.

## 7. Ajuste na lista de Clientes
Pedido de 12/11/2026, 18h (R-20261112-180115, repassado por outra sessão). A tela Clientes não pode misturar informações. Cada linha agora tem:
- o nome do cliente;
- **uma tag só:** "Vencido" (vermelha) ou "Em dia" (verde). A tag amarela "Sem pedido" saiu;
- **embaixo, só a última visita:** "Visitado hoje", "Visitado ontem", "Visitado há 42 dias" ou "Nunca visitado". Sem cidade, título, pedido ou prazo.

Os filtros do topo continuam. Todas as pranchas que mostram a tela Clientes foram geradas de novo: `simulado-*` e `noite-simulado-*`. O mesmo pedido foi aos agentes do app.

## Premissas
- Empresas, pessoas, produtos e números das simulações são fictícios.
- As telas são simulações da marca sobre o layout de hoje. O conteúdo e os textos de cada tela continuam sendo do `designer-ux` e dos módulos.
- O cabeçalho verde da tabela do PDF (`#00843D`, T-0159) fica como está.
