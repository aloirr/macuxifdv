# Rastreamento no expediente — trajeto do dia (Gestão e BKO) e notificação fixa (Campo) · T-0156

- **Autor**: designer-ux, 19/11/2026 (Manaus). Item 5 do §11 de [`docs/desenho/tracking.md`](../../desenho/tracking.md); ADR 0061.
- **Escopo**: o que ficou na v1.0.15 — o trajeto do dia na Ficha do Gestão e no BKO (PR #502, modulo-gestor) e a notificação fixa
  do Android no Campo (PR #501, engenheiro-apps). Esta spec descreve o código desses PRs.
- **Simulação**: `node docs/design/tracking/gerar.mjs` gera `01-mapa-equipe` e `02-notificacao` (HTML e PNG, escala 2; aparelho
  360×760 e BKO 1366×768). O gerador falha se a legenda cobrir a tela ou se algo sair dela ou ficar cortado.
- **Marca**: cores do kit (`packages/ui/src/comum/contraste.ts`); traço e marcadores em Azul noite #1E3350, fundo do mapa Névoa
  #ECEEF1, borda #C9CED5.
- Nomes de pessoas e valores nas pranchas são exemplo.

## 1. Quem vê

| Quem | O que vê |
|---|---|
| Quem tem `core.trajeto.ver_equipe` (padrão: supervisor e gerente; o admin só com a permissão — [`docs/desenho/tracking.md`](../../desenho/tracking.md) §6 e §7), só na própria equipe | o trajeto do dia na Ficha (§2) e a página Trajeto do dia (§3) |
| Vendedor e promotor | só a notificação fixa do Android (§4); decisão do dono do produto de 19/11, 05h46 |

- Sem a permissão, a seção da Ficha some e a página não entra no menu; a API recusa (403).
- Nenhuma tela exporta pontos nem mostra coordenada.

## 2. Gestão · Ficha da pessoa › "Trajeto do dia" (prancha 01, fila de cima)

`modules/gestor/app/components/trajeto-do-dia.tsx`, na Ficha (`ficha-screen.tsx`) depois dos cartões do painel (Visitas,
Vendas do dia, Mês, Trade) e antes do botão `Fazer pedido em nome de <nome>`.

| Ordem | Linha | Texto | Componente |
|---|---|---|---|
| 1 | Título | `Trajeto do dia` | `Cartao` (preenchimento 14) com `Text t.h2` |
| 2 | Desenho | linha pelos pontos do dia, primeiro ponto vazado, último cheio | `Svg` 320×200 no fundo `colors.mapBg`, borda `colors.mapBorder`, raio `radius.secao` |
| 3 | Primeiro ponto | `Primeiro ponto` · `08:04` | linha rótulo e valor (`t.body` / `t.bodyStrong`) |
| 4 | Último ponto | `Último ponto` · `10:12` | idem |
| 5 | Percorrido | `Percorrido` · `18,6 km` | idem; `formatarDistancia` do Core (`850 m` abaixo de 1 km) |

**Estados**

| Estado | Cartão |
|---|---|
| Dia com pontos | linhas 1 a 5 |
| Dia sem pontos | título + `Nada registrado` |
| Sem sinal | título + `Sem sinal para ver o trajeto. Conecte-se e abra a ficha de novo.` (`t.small`) |
| Erro da API | título + a mensagem do erro (`t.small`) |
| Ficha montada do cache (offline) ou sem a permissão | o cartão não aparece |

- Só o dia de hoje; sem troca de dia, sem toque no desenho. Horas no fuso do tenant. O trajeto não fica guardado no aparelho do gestor.
- Acessibilidade: o desenho é um elemento só, lido como "Trajeto do dia com 10 pontos, de 08:04 a 10:12".

## 3. BKO · Análise › Trajeto do dia (prancha 01, filas de baixo)

`modules/gestor/web/pages/trajeto-do-dia.tsx`, rota `trajeto` do módulo, item `Trajeto do dia` no grupo Análise (menu em ordem
alfabética, depois de Ranking).

| Ordem | Bloco | Texto | Componente |
|---|---|---|---|
| 1 | Título | `Trajeto do dia` | `PageHeader` |
| 2 | Filtros | `Dia` (data; vazio = o dia da visão da equipe) · `Pessoa` (`Escolha uma pessoa` + a equipe) | `FilterBar` com `TextField type="date"` e `SelectField`; vão na URL (`?data=`, `?pessoa=`) |
| 3 | Desenho | o mesmo do §2, 640×320, na largura do painel | `Panel` com `svg role="img"` |
| 4 | Resumo | `Primeiro ponto 08:04 · último 10:12 · 18,6 km` | texto 14 px |

**Estados**: sem pessoa escolhida, só os blocos 1 e 2; carregando, `LoadingBlock` `Carregando o trajeto…`; dia sem pontos,
`EstadoVazio` `Nada registrado`; erro, `ErrorBlock` com `Tentar de novo`.

## 4. Notificação fixa (Campo, prancha 02)

Valores de `apps/mobile/src/lib/trajeto.ts` e `apps/mobile/plugins/notificacao-trajeto.ts` (expo-location 57.0.22).

| Item | Valor |
|---|---|
| Título | `Macuxi Campo ativo` |
| Texto | nenhum |
| Ícone pequeno | `notification_icon` (o `icone-notificacao.png` do plugin do expo-notifications) |
| Cor | círculo do ícone em `notification_icon_color`, Azul noite #1E3350; cartão sem pintar |
| Canal | id `<appId>:macuxi-servico`, nome `Serviço do app`, sem descrição, importância baixa (`IMPORTANCE_LOW`): sem som, em "Silenciosas" |
| Categoria e ações | `CATEGORY_SERVICE`; sem ações |
| Toque | abre o Campo onde ele estava |
| Quando | aparece com o serviço ligado e some quando ele desliga (fora do expediente, feriado, ausência, logout, rastreamento desligado) |

## 5. Fora da v1.0.15

- Na v1.0.16, o resto da antiga prancha 01: tela própria de trajeto no Gestão, troca de dia no app, visitas e trechos sem
  registro no desenho, mapa com ruas, distância e "Ver trajeto" no Painel da equipe.
