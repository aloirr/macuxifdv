# Início do Campo (vendedor): 3 opções para aprovar (T-0170)

> 2026-11-12 · designer-ux · pedido do dono do produto R-20261112-123055-alexandre ("Quero algo intuitivo, apresentável,
> que agrade o vendedor quando ele entrar. Essa parte de recados não gostei, achei que não tem separação de uma área pra
> outra."). **Só proposta:** nada muda no app até a aprovação. Depois dela, a opção escolhida substitui o §1 de
> `docs/design/inicio.md`, e o promotor (§2) e a Gestão (§3) seguem o mesmo desenho.
> Imagens na resolução do aparelho do dono (412 × 892 dp, 923 × 1998 px, com os dados do print da v1.0.4):
> `telas/T-0170-inicio-opcao-a.png`, `-b.png` e `-c.png`, com o `.html` ao lado e o estilo em `telas/T-0170-inicio.css`.

## 1. O que falha na tela de hoje (print da v1.0.4, 12/11 12:29)
1. **As áreas não se separam.** Recados, Meta do mês e Pedidos são três cartões brancos iguais, com o mesmo rótulo cinza
   pequeno. Nada diz onde acaba uma área e começa a outra.
2. **Recado sem cara de recado.** A linha mistura título e corpo num texto só, e o não lido só se distingue pela bolinha.
   O aviso do sistema ("Pedido 000014 aprovado") e o recado da supervisão ("Prioridade") têm o mesmo desenho.
3. **O corpo do aviso de pedido repete o título.** "Pedido 000014 aprovado: Seu pedido foi aprovado e segue para o ERP."
   diz "aprovado" duas vezes, e "segue para o ERP" é o que o sistema faz por trás.
4. **Hora errada.** Às 12:29 o recado mostra "22:49". Recado de ontem deve mostrar "ontem" (`inicio.md` §1.2).
5. **O Sincronizar fica fora da primeira tela**, e o Pedidos gasta altura: linhas de 65 dp e "(1 aguardando aprovação)"
   quebrado em duas linhas à direita.
6. **A saudação passa por baixo da barra de status** quando a tela rola (os ícones do Android ficam por cima do texto).

## 2. O que muda nas três opções
Pranchas na marca v1 (MC-0013, v1.0.6): saudação na faixa Azul noite com o sino da MC-0009 à direita, fundo Pérola, ação e
aba ativa Azul noite; o laranja só na barra de meta e no contador.

- **Cada área tem um título com ícone e um desenho próprio.** "Recados" com o sino; o selo "1 novo" e a seta `›` no título.
  O título inteiro abre a central (alvo 48). Com isso sai o "Ver todos" do rodapé.
- **Linha de recado em duas partes.** Título na 1ª linha, em negrito quando não lido. Corpo em `ink2` na 2ª e na 3ª linha.
  Hora à direita da 1ª linha ("09:15", "ontem", "seg", "28/10").
  - À esquerda, um círculo de 36 com o ícone do tipo: balão Azul noite para o recado da supervisão, ✓ verde para pedido
    aprovado ou faturado, sino cinza para o resto. O ícone substitui a bolinha de cor; a cor nunca vai sozinha.
  - Não lido: só o título em negrito, sem ponto de cor (RD-0200); o selo do título conta os novos. Vale também na central.
    Leitor: "Pedido 000014 aprovado, Mercadinho São Jorge, ontem, novo".
- **Aviso de pedido com o cliente no corpo.** No lugar de "Seu pedido foi aprovado e segue para o ERP.", o corpo é o nome do
  cliente ("Mercadinho São Jorge"). O texto é do Core: só pedimos a troca depois da aprovação.
- **Indicadores numa linha de três colunas** ("Positivação 5 de 15 · Visitas 1 de 90 · Cobertura 17% de 90%"). Hoje são três
  linhas: a troca devolve uns 50 dp e põe o Sincronizar na primeira tela.
- **Valores:** o % do mês aparece uma vez (no título da meta). Nos Pedidos, "1 · R$ 110" e "5 · R$ 2.446" no formato de
  hoje. A pendência fica numa linha própria em `warningInk` ("1 aguardando aprovação").
- **Fica como está:**
  - o Sincronizar é o único botão de 52 (grafite) e traz "Última sincronização hh:mm · N na fila" e o aviso de dado antigo;
  - puxar para baixo sincroniza;
  - o que não for aprovado de `inicio.md` (estados de meta, vazio, sem sinal) continua valendo.

## 3. As opções
| | A · Seções com título | B · Painel do mês no topo | C · Recados em primeiro |
|---|---|---|---|
| Ideia | A tela de hoje com títulos de seção (Archivo 17 + ícone Azul noite) fora dos cartões e mais espaço entre as áreas | Painel na faixa Azul noite no alto com a saudação e a meta do mês ("Sem rota" sem "hoje", que já está em "Meta de hoje"; RD-0201). Abaixo, Recados num cartão com faixa de título Azul suave, Pedidos em dois blocos | Cabeçalho curto com as iniciais (abrem o Perfil). Recados num painel Azul suave, cada recado num balão branco. Depois Meta e Pedidos |
| Ordem | Saudação · Recados · Meta · Pedidos · Sincronizar | Saudação + Meta (painel) · Recados · Pedidos · Sincronizar | Saudação · Recados · Meta · Pedidos · Sincronizar |
| Como Recados se separa | Pelo título e pelo espaço; o cartão é branco como os outros | Pela faixa de título colorida e pelo contraste com o painel escuro acima | Pela cor do painel inteiro: é a única área colorida da tela |
| Ao entrar, o vendedor vê primeiro | O nome | O nome e quanto já vendeu no mês | O nome e os recados |
| Cabe numa tela (412 × 892) com o Sincronizar | Sim, justo | Sim, com folga | Sim |
| Custo no app | Baixo: títulos e linha de recado | Médio: painel escuro novo e barra de status clara sobre ele | Médio: painel de recados e cabeçalho com iniciais |

Componentes: `Cartao`, `ProgressBar`, `Icon` (`bell`, `chat`, `check`, `target`, que o kit já tem) e `BotaoSincronizar`,
todos de `@macuxi/ui/mobile`, sem dependência nova. As opções B e C ganham no kit um `PainelInicio` (fundo grafite ou `accentSoft`,
raio 24). A linha de recado vira o `LinhaRecado` do kit, o mesmo na central de notificações.

## 4. Recomendação: opção B
1. **Agrada ao entrar.** A primeira coisa que o vendedor vê é o nome e o mês dele, num painel da cor da marca. Branco sobre
   grafite também é o que melhor se lê ao sol (contraste acima de 9:1 com o texto a 74%).
2. **Três áreas que não se confundem:**
   - o painel escuro é "eu e minha meta";
   - o cartão com faixa Azul suave é "Recados";
   - os dois blocos são "Pedidos";
   - o Sincronizar fica no pé.

   A separação vem da cor e da forma, não só do espaço.
3. **Cabe numa tela só, com folga**, no aparelho do dono, com o Sincronizar visível sem rolar.
4. **Recados continuam logo abaixo da saudação** e são o primeiro cartão branco, com a faixa de cor. Na opção C a área
   laranja inteira disputa a atenção com a meta e repete o laranja do selo e do ícone.

Ressalva: a T-0076 tirou do Início o cartão escuro "Recado do dia". Aqui o escuro é o painel do vendedor e da meta. Se o
dono preferir a tela toda clara, a segunda escolha é a C.

## 5. Depois da aprovação (não fazer antes)
- designer-ux: `LinhaRecado` e `PainelInicio` em `packages/ui` e reescrita do §1 de `inicio.md`.
- engenheiro-apps: montagem em `apps/mobile/src/components/inicio.tsx` e `(tabs)/index.tsx`, barra de status clara sobre o
  painel (B) e fundo sólido atrás da barra de status ao rolar (falha 6).
- modulo-core: hora "ontem" no `recados_hoje` (falha 4) e o cliente no corpo do aviso de pedido (falha 3).

## 6. Painel do topo de ponta a ponta (14/11/2026)
> Pedido do dono do produto (chat, 14/11 às 5h40, com o print do Início): "Não gostei dessa parte azul do jeito que está.
> Nas simulações fica o azul de ponta a ponta e não quadrado arredondado. Simule e ajuste". Referência: quadro 8 de
> `docs/marca/propostas/2026-11-12-entrada-sync/entrada-sync.png`. Simulação: `telas/T-0170-inicio-ponta-a-ponta.png`
> (Hoje × Ajustado, com o `.html` ao lado). Substitui o "raio 24" do `PainelInicio` (§3).

**Como fica:**
- O Azul noite (`colors.faixa`, `#1E3350`) começa no topo da tela, atrás da barra de status, com os ícones do sistema em
  branco.
- O painel ocupa a largura toda: sem raio, sem margem lateral, colado no topo. A borda de baixo é reta.
- Respiro interno: 8 no alto (logo abaixo da barra de status), 20 nas laterais (alinha o texto com a coluna dos cards),
  20 embaixo. Altura mínima 140, como hoje.
- O avatar (96 × 128, raio 16, Azul suave com as iniciais) continua dentro do painel, à direita.
- Abaixo do painel, o Pérola, com o mesmo espaço de hoje (14) até "Metas do mês". O resto da tela não muda.
- Ao rolar, o painel sobe com o conteúdo; a faixa da barra de status continua Azul noite enquanto o Início estiver em foco.
- O Sol (`#C2540A`) fica só nas barras de meta, no ponto "fora" da Produtividade e no contador do sino.

**Quem faz:**
| Parte | Dono | Onde |
|---|---|---|
| Faixa da barra de status em Azul noite, ícones claros, enquanto o Início está em foco; volta ao Pérola nas outras abas | engenheiro-apps (shell) | `useCorDaFaixa` em `apps/mobile` |
| Painel sem raio, sem margem lateral e colado no topo (o `Screen` do Início sem o padding de cima e lateral só no painel) | modulo-core | `s.painel` em `modules/core/app/telas/inicio/tela-inicio-campo.tsx` |

**Pronto quando:** o print do aparelho bate com o quadro "Ajustado": nenhuma faixa Pérola acima do painel, nenhum canto
arredondado no painel, o Azul noite tocando as duas bordas da tela.
