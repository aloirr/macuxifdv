# Visita concluída com etapa pendente: Campo, Gestão e BKO (T-0039)

> 2026-11-05 · designer-ux · Regra: RN-CORE-12 com o complemento de 05/11 (doc 03). Desenho técnico: `docs/desenho/T-0039.md` §2.
> Funções puras: `modules/core/domain/checkout-tolerancia.ts`. Telas: modulo-core (Campo, Gestão e BKO). O modulo-gestor
> só entra se quiser levar a pendência para a aba Alertas (§4.3). **Substitui os textos do §2.4 do desenho**: lá aparecem
> "servidor" e "fila de envio", que não usamos na tela do vendedor (`componentes.md` §7.1).

## 0. Princípios
- **Nada bloqueia e nada assusta.** O checkout já foi aceito e a visita está concluída. Na maioria das vezes a resposta
  está na fila e chega sozinha. Por isso usamos o tom **aviso** (âmbar), nunca erro (vermelho), e a notificação tem
  prioridade **normal**, não "Importante".
- **Não há aviso na hora do checkout.** O app só libera o checkout com a etapa feita (RN-CORE-12). A pendência nasce no
  Macuxi e chega pelo pull (`visita.etapas_pendentes`). Nada de `AvisoRodape`: ele é a resposta passageira a uma ação da
  pessoa, e aqui ela não fez nada.
- **A pendência some sem festa.** Quando o pull traz `etapas_pendentes = 0`, o chip e o aviso somem. Sem texto de "resolvido".
- **O app só conhece a contagem.** `visita_etapa` não vai ao aparelho, então no app o texto é genérico ("uma etapa"). O
  nome da etapa (o `rotulo` da consulta, ex.: `Pesquisa obrigatória: "Gôndola do mês"`) aparece só na notificação e no BKO.
- Datas no fuso do tenant. Nos avisos, **sem ponto final**.

## 1. App Campo (vendedor e promotor)

### 1.1 Rota de hoje, linha da parada feita (`modules/core/app/telas/rota.tsx`, `StopRow`)
Quando a visita da parada tem `etapas_pendentes > 0`:
- À direita, no lugar que o botão Check-in ocupa nas paradas abertas: `ChipEstado` `pequeno`, `tom="aviso"`,
  `icone="clock"`, texto **`Etapa pendente`**, `rotuloAcessivel` **`Visita feita com etapa pendente`**.
- O resto da linha não muda (ícone de visto verde, subtítulo "Pedido R$ … · 8h02 · 25 min"). A linha inteira continua
  abrindo a ficha do cliente.
- Não é "Pendente" sozinho: na rota, "pendente" já quer dizer parada não visitada.

### 1.2 Ficha do cliente (`modules/core/app/telas/cliente.tsx`)
Se alguma visita deste cliente no aparelho tiver `etapas_pendentes > 0`, um `Banner`
`tone="warning"` `icon="clock"`, logo abaixo do cabeçalho do cliente e acima das abas. Data e contagem vêm da **mais recente
entre as visitas com pendência** (esclarecido em 05/11): uma visita nova sem pendência **não** esconde a pendência de uma
visita anterior, que continua real até o pull trazer 0.

| Situação | Linha 1 (forte, `t.bodyStrong`) | Linha 2 (`t.small`) |
|---|---|---|
| 1 etapa, visita de hoje | `Uma etapa da visita de hoje ainda não chegou ao Macuxi` | ver abaixo |
| N etapas, visita de hoje | `2 etapas da visita de hoje ainda não chegaram ao Macuxi` | ver abaixo |
| visita de outro dia | troque "de hoje" por "de 04/11" (dd/mm) | ver abaixo |

Linha 2, pelo `useSincronizacao()` do kit (só a contagem `naFila`, sem ler a fila de outro módulo):
- `naFila > 0` e com sinal: **`Ela vai sozinha da fila quando houver sinal. Se a fila mostrar erro, fale com seu supervisor`**
- `naFila > 0` e sem sinal (`semSinal`): **`Ela vai sozinha da fila quando houver sinal`**
- `naFila = 0`: **`Fale com seu supervisor`**
- Com N etapas (concordância, 05/11): **`Elas vão sozinhas da fila…`** no lugar de "Ela vai sozinha da fila…"; o resto igual.

Ação (**backlog**, decidido em 05/11: entra quando o engenheiro-apps confirmar o caminho do Perfil na seção Fila, junto
com o §4.2): quando `naFila > 0`, um `Botao` **secundário** (44) **`Ver fila`**, ícone `sync`, logo abaixo do Banner. Ele abre o
Perfil na seção "Fila do aparelho" (rota do shell: o engenheiro-apps confirma o caminho). O principal da tela continua sendo
o Check-in. Com `naFila = 0` não há botão, porque não há o que fazer no aparelho.

O vendedor **não refaz** a pesquisa nem reabre a visita.

### 1.3 Notificação do alerta (depois de `checkout_pendencia_alerta_h`, padrão 24 h)
Caixa `core.notificacao` → tela Notificações (`modules/core/app/telas/notificacoes.tsx`), sem mudar a tela:
- `tipo: 'sistema'` (selo "Aviso do sistema"), `prioridade: 'normal'` (barra laranja de não lida, não vermelha).
- `link`: `/m/cliente?id=<cliente_id>`, que abre a ficha do §1.2.
- **Título**: `Etapa pendente na visita a <nome fantasia do cliente>`
- **Corpo**: `<rotulo> · visita de <dd/mm> · confira a fila do aparelho ou fale com seu supervisor`
  - ex.: `Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · confira a fila do aparelho ou fale com seu supervisor`

Se a pendência já tiver sido resolvida quando a pessoa tocar, a ficha abre sem o Banner. Não precisa de texto extra.

## 2. App Gestão (supervisor e gerente)

### 2.1 Notificação do alerta
Mesma tela e mesmas regras do §1.3. O destinatário é o supervisor da equipe:
- **Título**: `Etapa pendente na visita de <primeiro nome do vendedor> a <nome fantasia do cliente>`
- **Corpo**: `<rotulo> · visita de <dd/mm> · não chegou em <prazo> h`
  - ex.: `Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · não chegou em 24 h`
- `link`: `/m/cliente?id=<cliente_id>`. A ficha do cliente já existe no Gestão (`apps: ['campo','gestao']`).

### 2.2 Ficha do cliente no Gestão (**backlog**, 05/11)
Hoje o estado do Core no aparelho só traz as visitas do próprio usuário (`rota-local.ts`, filtro por `usuario_id`), então
no Gestão o Banner do §1.2 não aparece e o texto do vendedor não vaza para o supervisor. A notificação do §2.1 já leva
etapa, data e prazo. Quando entrar:
Mesmo `Banner` do §1.2, com outro texto, se a visita estiver no aparelho pelo pull da equipe:
- Linha 1: `Uma etapa da visita de <primeiro nome> em <dd/mm> ainda não chegou ao Macuxi` (N: `2 etapas … ainda não chegaram …`)
- Linha 2: `Peça a <primeiro nome> para abrir a fila do aparelho e sincronizar`
- Sem botão: a fila do supervisor não tem nada a ver com isso.

### 2.3 Lista da equipe
O Gestão não tem lista de visitas da equipe. Nesta tarefa o supervisor chega à visita **pela notificação**. Não criamos
tela nova. Se a pendência entrar na aba Alertas, veja o §4.3.

## 3. BKO (`modules/core/web/components/visitas/visitas-page.tsx`)

### 3.1 Lista de visitas
- **Filtro** novo na `FilterBar`, depois de "Raio": `SelectField` rótulo **`Etapas`**, opções **`Todas`** ·
  **`Com etapa pendente`** · **`Sem pendência`** (na URL, como os outros filtros; ex.: `pendente=true|false`).
- **Coluna "Sinais"**: com `etapas_pendentes > 0`, um `Badge tone="warning"` **`Etapa pendente`** (1) ou
  **`2 etapas pendentes`** (N), junto dos outros sinais. A cor vem sempre com a palavra.
- O Badge fica dentro de um `<button>` com a mesma moldura do "Ver foto" (altura 44, `rounded-xl border`), com
  `aria-label="Ver etapas da visita a <cliente>"`, e abre o diálogo do §3.2.
- **CSV**: coluna nova **`Etapas pendentes`** (número; 0 quando não houver).

### 3.2 Diálogo "Etapas da visita"
`Dialog` com título **`Etapas · <cliente> · <dd/mm hh:mm do check-in>`** e uma tabela (`th`/`td` do kit):

| Etapa | Situação | Desde | Alerta enviado |
|---|---|---|---|
| `rotulo` | `Badge`: `Concluída` (success) · `Dispensada` (neutral) · `Pendente` (warning) | `pendente_desde` (fuso do tenant) ou `—` | `alertada_em` ou `—` |

- Abaixo da tabela, só se houver pendente: texto `text-ink-2` **`A visita conta como concluída. A pendência some sozinha quando a resposta chegar`**
- Rodapé: `Button` secundário **`Fechar`**. Não há ação de "resolver" à mão.
- **Dispensar** (acrescentado em 05/11, regra do desenho T-0039 §2.5a aprovada pelo gerente; só com `visita.dispensar_etapa`):
  coluna **`Ação`** com botão neutro **`Dispensar`** (44 px) na linha pendente; abre, abaixo da tabela, o bloco
  **`Justificativa para dispensar "<rótulo>"`**, ajuda **`Fica registrada na auditoria, com o seu nome. De 3 a 300 caracteres`**,
  `textarea` com foco ao abrir e contador `N de 300` perto do limite; botões **`Dispensar etapa`** (principal) e **`Cancelar`**.
  Fora da faixa: **`Escreva a justificativa com 3 a 300 caracteres`** (no campo). Erro da API: `Notice tone="danger"` acima do
  bloco, não no campo. Sucesso: `Notice tone="success"` **`Etapa dispensada. A visita segue como concluída`**.
- Carregando: `LoadingBlock label="Carregando as etapas…"`. Erro: `ErrorBlock` com `onRetry`.
- Dados: o diálogo precisa da lista de `visita_etapa` da visita (rótulo, situação, desde, alertada em). O modulo-core
  decide se ela vem na lista ou numa rota de detalhe.

### 3.3 Cliente 360 no BKO (`cliente360-page.tsx`, painel "Últimas visitas")
Na visita com `etapas_pendentes > 0`, o mesmo `Badge tone="warning"` do §3.1 ao lado dos sinais, sem diálogo.

### 3.4 Prazo do alerta (parâmetro do Core)
Na tela de parâmetros do Core, campo numérico **`Prazo para avisar etapa pendente (horas)`**, com a ajuda
**`De 1 a 168. Depois desse prazo, o vendedor e o supervisor recebem um aviso`**. Fora da faixa:
**`Use um número de 1 a 168`**.

## 4. Pendências para os donos

### 4.1 modulo-core: textos da notificação (`textoAlertaPendencia`)
O texto atual tem três problemas:
- **Duplica a palavra**: o `rotulo` da consulta já é `Pesquisa obrigatória: "Gôndola do mês"`, e a função acrescenta
  "obrigatória da visita…", o que dá `Pesquisa obrigatória: "Gôndola do mês" obrigatória da visita a …`.
- Usa **"servidor"**, que não vai na tela do vendedor.
- Termina com **ponto final**.

Proposta: trocar por uma função pura que devolva `{ titulo, corpo }` por destinatário (`'vendedor' | 'supervisor'`),
com os textos exatos dos §1.3 e §2.1, a data em dd/mm no fuso do tenant e o prazo em horas. Testes com os exemplos acima.

### 4.2 modulo-core / engenheiro-apps: "Descartar" na fila
Se a resposta da pesquisa estiver com falha na fila, o vendedor pode tocar em "Descartar" no Perfil, e aí a pendência
fica para sempre. Nesta tarefa não mudamos isso: o texto do §1.2 manda falar com o supervisor. Fica registrado para
uma revisão da tela da fila.

### 4.3 modulo-gestor (opcional, fora desta tarefa)
Levar a pendência para a aba **Alertas** (Gestão) e para "Alertas da equipe" (BKO) seria um tipo novo em `TIPOS_ALERTA`,
alimentado por um evento ou consulta do Core (fronteira: o Gestor não lê `core.visita_etapa`). Se entrar, use o rótulo
**`Etapa pendente na visita`** e o tom âmbar. Até lá, a notificação cobre o alerta.

### 4.4 Uma notificação por pendência
O desenho manda uma notificação **por pendência**. Hoje só a pesquisa gera etapa, então dá uma por visita. Se um dia
houver duas etapas pendentes na mesma visita, prefira **uma notificação por visita e destinatário**, com o corpo
`<rotulo> e mais 1 etapa · visita de <dd/mm> · …`.

## 5. Acessibilidade e checklist
- Chip e Badge sempre com texto. Tons do kit: `aviso` tem `#7A4F00` sobre `#FFF1D6`, que passa de 4,5:1
  (`tokens.test.ts`). Nenhuma cor solta.
- Alvos: `Ver fila` com 44 e `hitSlop` até 48. Botão do Badge no BKO com 44. A linha da rota já tem 44 ou mais.
- Leitor de tela: o chip lê `Visita feita com etapa pendente`. O Banner lê as duas linhas em ordem. Na tela Notificações,
  vale o pedido de incluir o corpo no `accessibilityLabel` (hoje é só título + "Lida/Não lida").
- Sem movimento novo. Banner e chip aparecem e somem com o pull, sem animação.
- Sem sinal: tudo sai do que está no aparelho. O `SyncStamp` da tela diz de quando é a informação.
- Um só principal por tela: nada aqui é principal.

## 6. Componentes usados (nenhum novo)
Mobile: `ChipEstado` (pequeno, aviso, ícone `clock`), `Banner` (warning, `clock`), `Botao` secundário, `useSincronizacao`,
a tela Notificações que já existe. Web: `FilterBar`, `SelectField`, `Badge` (warning, success, neutral), `Dialog`, `Button`,
`th`/`td`, `LoadingBlock`, `ErrorBlock`.
O kit não tem espaço de ação dentro do `Banner`; por isso o botão fica logo abaixo dele. Se esse arranjo se repetir em
outras telas, o designer-ux acrescenta ao kit um `Banner` com `acao` (sem dependência nova).
