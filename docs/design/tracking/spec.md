# Rastreamento no expediente — mapa da equipe (Gestão e BKO) e notificação fixa (Campo) · T-0156

- **Autor**: designer-ux, 19/11/2026 (Manaus). Item 5 do §11 de [`docs/desenho/tracking.md`](../../desenho/tracking.md); ADR 0061.
- **Decisão do dono do produto (19/11/2026, 05h46, recado do gerente)**: o rastreamento é **interno**. O vendedor e o promotor não
  veem tela de rastreamento no Campo. Saem desta spec o termo no app, "Meu trajeto", a pausa, a seção Localização no Perfil e o
  Contestar (e os pontos em aberto deles). Ficam o **mapa da equipe** (Gestão e BKO) e a **notificação fixa** do Android, que o
  sistema exige para o serviço em primeiro plano e que não cita localização.
- **Base**: desenho §5.2 (consulta e contrato `core.trajeto_do_dia@1`), §7 (quem vê), §9 (privacidade técnica).
- **Simulação**: `node docs/design/tracking/gerar.mjs` gera `01-mapa-equipe` e `02-notificacao` (HTML e PNG, escala 2; aparelho
  360×760 e BKO 1366×768 na base de `docs/design/menu-parametros/`). O gerador falha se legenda ou nota cobrir a tela, se algo sair
  dela ou ficar cortado.
- **Marca**: Azul noite #1E3350 na faixa, na ação e no traço; check-in concluído em verde #1D6B4F (o mesmo da Rota de hoje); fundo
  Pérola; fonte do sistema, escala 12 · 14 · 16 · 18 · 22 · 28. Validação do design-de-marca pendente.
- **Quem implementa**: mapa da equipe, modulo-gestor (§11 item 4), lendo o `core.trajeto_do_dia@1` do modulo-core; notificação e
  canal, engenheiro-apps (item 3). Componentes já existentes no kit (`packages/ui`); nenhum componente novo.
- Valores entre [colchetes] vêm dos parâmetros do tenant. Nomes de pessoas e clientes nas pranchas são exemplo.

## 1. Quem vê

| Quem | O que vê |
|---|---|
| Supervisor, gerente e admin (`core.trajeto.ver_equipe`, só no escopo da carteira, RN-CORE-04) | o mapa do dia de cada pessoa de campo (§2 e §3) |
| Analista | só a coluna Km do Painel da equipe (resumo `core.deslocamento_dia`); sem "Ver trajeto" |
| Vendedor e promotor | nada do rastreamento; só a notificação fixa do Android (§4), que o sistema exige |

- Sem a permissão ou com o rastreamento desligado pela empresa: o cartão "Trajeto" da Ficha, a coluna Km e o "Ver trajeto" não
  aparecem. A API revalida (desenho §5.2).
- Nenhuma tela exporta pontos; o CSV do Painel leva só o km do dia.

## 2. Gestão (prancha 01, fila de cima)

### 2.1 Ficha da pessoa › cartão "Trajeto"
Na Ficha (`modules/gestor/app/screens/ficha-screen.tsx`), logo depois de **Visitas**, antes de **Vendas do dia**.

| Ordem | Linha | Texto | Componente |
|---|---|---|---|
| 1 | Título | `Trajeto` | `Cartao` com `Text t.h2`, como os outros cartões da Ficha |
| 2 | Km | `Km até agora` · `18,6 km` (hoje) | a mesma `Linha` rótulo e valor da Ficha |
| 3 | Ação | ícone `map` · `Ver no mapa` | `Botao nivel="secundario"` (44); o principal da Ficha segue sendo o pedido em nome |

- Dia sem registro: a linha 2 mostra `—` e o botão continua (o mapa mostra o vazio e deixa voltar dias).

### 2.2 Tela "Trajeto"

| Ordem | Bloco | Texto | Componente |
|---|---|---|---|
| 1 | Cabeçalho | `‹ Carla Lima` (nome da Ficha) · `Trajeto` | `Screen` com `cabecalho` |
| 2 | Dia | `‹` · `Hoje · qua 19/11` / `Ontem · ter 18/11` / `dom 16/11` · `›` | 2 botões de 48 dp + texto 16/600; `›` desabilitado em hoje; `‹` desabilitado no dia mais antigo guardado ([90] dias) |
| 3 | Mapa | trajeto desenhado no aparelho, 236 dp | o mapa em SVG da Rota de hoje (`modules/core/app/telas/rota.tsx`): fundo Névoa, ruas brancas, borda #C9CED5 (P1 A) |
| 4 | Resumo | `Até agora` (hoje) ou `Distância` (dia anterior) · `18,6 km`; depois os eventos em ordem de hora | `Cartao`; número 28/700 tabular; linhas de 44 dp com o marcador do mapa à esquerda; nome do cliente quebra em 2 linhas, nunca corta |

**Eventos do resumo** (a lista é a legenda do mapa; os marcadores são os mesmos):

| Evento | Marcador | Texto | Hora |
|---|---|---|---|
| Primeiro ponto do dia | círculo vazado Azul noite | `Início` | `08:04` |
| Visita concluída | círculo verde #1D6B4F com o número da visita | nome do cliente | `08:22–08:51` (check-in–checkout) |
| Visita em andamento | círculo Azul noite com o número | nome do cliente | `desde 09:58` |
| Intervalo sem pontos maior que [15] min dentro do expediente (P2 A) | traço tracejado #5B6673 | `Sem registro` (cinza) | `12:02–12:58` |
| Hoje: último ponto recebido | círculo cheio com halo | `Último ponto` | `10:12` |
| Dia anterior: último ponto do dia | círculo cheio Azul noite | `Fim` | `17:52` |

- **Km**: o mesmo número do `core.deslocamento_dia` (`metrosDoTrajeto`); 1 casa decimal com vírgula (`42,3 km`); abaixo de
  1 km, em metros (`850 m`). Horas no fuso do tenant.
- **Check-ins**: as visitas do dia da pessoa, na ordem do check-in; a posição no mapa é o GPS do check-in (RN-CORE-13).
- O mapa enquadra o dia com 16 dp de margem; sem arrastar nem zoom na v1. Toque num número não abre nada na v1.

**Estados**

| Estado | Tela |
|---|---|
| Dia com trajeto | blocos 1 a 4 |
| Dia sem registro (fim de semana, feriado, ausência, rastreamento desligado) | blocos 1 e 2 + `EstadoVazio` ícone `pin`, `Nada registrado neste dia` |
| Carregando | blocos 1 e 2 + `Loading` no lugar do mapa |
| Sem sinal | blocos 1 e 2 + `EstadoVazio` ícone `wifiOff`, `Sem sinal`, ação `Tentar de novo` (`Botao nivel="secundario"`); o trajeto não fica no aparelho do gestor (P3 A) |
| Erro do servidor | `EstadoVazio` do padrão de erro do kit, com `Tentar de novo` |
| Pessoa fora do escopo | o mesmo da Ficha: `Esta pessoa não está na sua equipe` |

**Acessibilidade**: o mapa é um elemento só (`accessibilityRole="image"`) com o resumo falado: "Trajeto de hoje de Carla Lima:
18,6 km até agora, início 8:04, 3 visitas, último ponto 10:12". As setas têm rótulo `Dia anterior` e `Próximo dia`; o dia é
anunciado ao trocar (`accessibilityLiveRegion`). A linha do resumo é lida inteira ("2, Padaria Estrela, das 9:05 às 9:31"); o
marcador é decorativo. Alvos ≥ 44 dp.

## 3. BKO (prancha 01, filas de baixo)

### 3.1 Análise › Painel da equipe
Página que já existe (`modules/gestor/web/pages/painel-page.tsx`). Muda só a tabela de pessoas:
- coluna nova **`Km`** (numérica, à direita, depois de `Visitas`): `18,6 km`; `—` sem registro no dia;
- coluna de ações no fim da linha (`⋯`, menu da linha, o mesmo padrão das tabelas do BKO) com o item **`Ver trajeto`**, que abre
  o §3.2 com a pessoa e o dia do filtro. Sem `core.trajeto.ver_equipe`, a coluna de ações não aparece.

### 3.2 Página "Trajeto"
Rota filha do Painel (`/gestor/painel/trajeto?usuario=…&data=…`); o menu lateral segue em Análise › Painel da equipe.

| Ordem | Bloco | Texto | Componente |
|---|---|---|---|
| 1 | Volta | `‹ Painel da equipe` (mantém o dia) | link do `PageHeader` |
| 2 | Título | `Trajeto de Carla Lima` | `PageHeader` |
| 3 | Filtros | `Pessoa` (lista do escopo) · `Dia` (data) | `FilterBar` com `Select` e `TextField type="date"`; os dois vão na URL |
| 4 | Mapa | o mesmo desenho do §2.2, na largura que sobra, altura até o fim da página | `Panel` |
| 5 | Resumo | o mesmo do §2.2 (km e eventos), coluna de 340 px à direita, com rolagem própria | `Panel` |

Estados: os do §2.2 com os blocos do BKO (`LoadingBlock`, `ErrorBlock` com `Tentar de novo`, `EstadoVazio`
`Nada registrado neste dia`). Teclado: filtros, depois o mapa (um elemento com `role="img"` e o resumo no `aria-label`), depois a lista.

## 4. Notificação fixa (Campo, prancha 02)

O Android exige notificação enquanto o serviço em primeiro plano roda. Ela **não cita localização** em nenhum lugar.

| Item | Valor |
|---|---|
| Cabeçalho (sistema) | nome do app `Macuxi Campo` + hora; ícone pequeno `icone-notificacao-96.png` (branco e transparente, o sistema pinta) |
| Título | `Macuxi Campo ativo` |
| Texto | nenhum |
| Cor (`color`) | Azul noite #1E3350 |
| Canal | id `macuxi-servico`, nome `Serviço do app`, sem descrição; importância baixa (`IMPORTANCE_LOW`): sem som, sem vibração, sem aparecer por cima; fica em "Silenciosas" |
| Ações | nenhuma; não pode ser dispensada (serviço em primeiro plano) |
| Toque | abre o Campo onde ele estava (ou no Início) |
| Quando aparece e some | aparece quando o serviço liga e some quando ele desliga (desenho §3.2): fora do expediente, feriado, ausência, logout, rastreamento desligado pela empresa |

- O título repete o nome do app que o Android já mostra no cabeçalho; é o texto decidido pelo dono do produto e fica assim.
- O ícone de localização que o próprio Android mostra na barra de status enquanto um app usa o GPS é do sistema; o app não o
  controla nem o esconde.
- Sem tela, aviso ou texto no app sobre o serviço (decisão de 19/11).

## 5. Fica fora

- Qualquer tela de rastreamento no Campo: termo, "Meu trajeto", pausa, seção Localização no Perfil, Contestar (decisão de 19/11).
- Mapa com a posição de toda a equipe ao mesmo tempo (P4).
- Velocidade, precisão e lista de pontos; exportação de pontos.
- Parâmetros › Rastreamento e cadastro de ausências no BKO (modulo-core; spec à parte, quando pedida).
- Tela de permissões do Campo (já existe, `apps/mobile/src/lib/permissoes.ts`).

## 6. Pedidos a outros donos (pelo gerente; esta sessão não envia recado)

- **modulo-gestor**: cartão "Trajeto" na Ficha, tela "Trajeto" no Gestão, coluna Km, "Ver trajeto" e a página do §3.2 no BKO.
- **modulo-core**: o `core.trajeto_do_dia@1` com os pontos, os intervalos sem registro (P2) e as visitas do dia (cliente, check-in,
  checkout, posição), com o escopo conferido; o km na visão do Painel.
- **engenheiro-apps**: canal `macuxi-servico` e a notificação do §4.
- **design-de-marca**: validar as pranchas (traço, marcadores, ícone da notificação).

## 7. Pontos em aberto para o dono do produto

**P1 — Fundo do mapa.**
- **A** — o mapa em SVG da Rota de hoje (ruas desenhadas, sem provedor): sem dependência nova e sem mandar a posição a ninguém.
- **B** — mapa real com ruas (biblioteca e provedor de mapa, chave de API): mais referência para o gestor, mas custo, dependência
  nova e o provedor recebe a área do trajeto, o que o desenho §9 evita.
- **Recomendo A** na v1.0.15; B só se o gestor precisar reconhecer a rua.

**P2 — Intervalo sem pontos no expediente** (aparelho desligado, sem GPS, serviço parado).
- **A** — trecho tracejado no mapa e a linha `Sem registro 12:02–12:58` no resumo, quando passar de [15] min.
- **B** — linha contínua ligando os pontos, sem marcar o intervalo.
- **Recomendo A**: sem a marca, o gestor lê uma reta de 56 min como deslocamento.

**P3 — Trajeto no aparelho do gestor sem sinal.**
- **A** — não guarda: sem sinal, `Sem sinal` e `Tentar de novo`.
- **B** — guarda o último dia aberto de cada pessoa.
- **Recomendo A**: o trajeto é dado pessoal sensível; guardar no celular do gestor amplia a exposição (minimização).

**P4 — Entrada do mapa.**
- **A** — por pessoa: Ficha (Gestão) e "Ver trajeto" (BKO), um dia de cada vez.
- **B** — um mapa com a última posição de toda a equipe agora.
- **Recomendo A** na v1.0.15: cumpre o "trajeto do dia" do desenho §5.2; B é acompanhamento em tempo real, outra finalidade, e
  pediria nova base no texto legal.

## 8. Decisões

| Data | Decisão |
|---|---|
| 19/11/2026, 05h46 (dono do produto) | Rastreamento interno: o vendedor não vê nada. Saem termo, "Meu trajeto", pausa, Localização no Perfil e Contestar; ficam o mapa da equipe e a notificação `Macuxi Campo ativo`, sem citar localização. |
