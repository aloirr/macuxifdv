# Atualização obrigatória do APK: sininho nas primeiras 24 h e tela de reinstalar (T-0195)

> 2026-11-24 · designer-ux · sessão I da v1.0.33 · pedido do Alexandre (R-20261123-200746-alexandre e R-20261123-201347-alexandre).
> Vale para o **Campo** e o **Gestão**. Decisões de comportamento no ADR 0070 (engenheiro-software). Esta spec diz o que aparece,
> em que ordem, os textos e os componentes de `packages/ui`. Não traz implementação.
> Telas: shell (`apps/mobile`, engenheiro-apps); notificação no sininho: `modules/core/app/telas/recados-e-tarefas` (modulo-core).

## 1. Regra que o desenho garante
Nada digitado se perde: orçamento, pedido, pré-cadastro e o resto da fila de envio. Por isso:
- o botão de baixar **só aparece com a fila vazia**. Com itens, a única ação é enviar;
- o texto pede para **instalar por cima, sem desinstalar** (no Android, desinstalar apaga os dados do app);
- o título literal do Alexandre ("reinstale") fica, e a linha logo abaixo diz como fazer sem desinstalar.

`X.Y.Z` nos textos é a versão publicada da variante (Campo ou Gestão), vinda da API ou, sem sinal, da última informação guardada.

## 2. Período de 24 h: notificação no sininho
Uma notificação por usuário e versão, na lista do balão e de "Recados e tarefas", no formato das outras linhas (título e corpo).
A bolinha do sino acende como para qualquer recado novo. Nenhum banner, faixa ou janela fora do sino (RN-VEN-42).

| Parte | Texto |
|---|---|
| Título | **Versão X.Y.Z disponível** |
| Corpo | Instale por cima da versão atual, sem desinstalar o app. |
| Ação (toque na linha) | abre a folha "Baixar a versão X.Y.Z" (§2.1) |

### 2.1 Folha "Baixar a versão X.Y.Z"
`Folha` com título **Baixar a versão X.Y.Z** e `fechar={{ rotulo: 'Fechar' }}`. O conteúdo é o **mesmo bloco de estado da tela de
bloqueio** (§3.2, linhas 3 a 6, com os mesmos textos e estados). A fila também tem de estar vazia antes de baixar. A folha não
repete o título da tela de bloqueio, porque o app segue liberado. Toque fora ou Voltar do Android fecham a folha. O envio
continua por trás, como hoje.

## 3. Depois de 24 h: tela de bloqueio

### 3.1 Quando aparece
- É a **única tela** do app: sem abas, sem cabeçalho na faixa, sem sino e sem menu. Aparece na abertura, no login e em qualquer
  rota, e também quando a API recusa a versão (erro próprio do ADR 0070) no meio do uso.
- Sem sinal, vale a última versão mínima que o app recebeu. A tela é a mesma.
- Voltar do Android fecha o app, como na raiz de qualquer pilha. Não existe "pular" nem "lembrar depois".
- A tela começa a enviar a fila sozinha quando abre e cada vez que o sinal volta. Quem toca não precisa fazer nada além disso.

### 3.2 Ordem (de cima para baixo, centralizado, fundo `ground`; mesmo esqueleto da `TelaDeErro`, docs/design/tela-de-erro.md §2)
1. **Ícone** `alert` 26 dp em `warning`, num círculo de 56 dp em `warningBg`. É decorativo e fica fora do leitor de tela.
2. **Título** 22/28, 700, `ink`, cabeçalho para o leitor de tela: **Versão desatualizada, reinstale para continuar.** (texto
   literal do Alexandre, com o ponto final).
3. **Texto** 16/22, `ink2`: o que fazer agora (muda com o estado, §3.3).
4. **Estado da fila**: `ChipEstado` (fila e envio) **ou** `Banner` (sem sinal e erros), nunca os dois. Fica vazio com a fila
   vazia e o sinal presente.
5. **Principal** `Botao nivel="principal"` 52 dp, o único da tela. O rótulo muda com o estado. Durante o envio ou a geração do
   link, usa `ocupado` (indicador e toque bloqueado).
6. **Neutro** `Botao nivel="neutro" icone="send"` "Enviar o detalhe ao suporte", só nos dois estados de erro. Abre o
   compartilhar do sistema, com o mesmo conteúdo e a mesma limpeza da `TelaDeErro` (§4 de tela-de-erro.md).

Conteúdo rolável com fonte grande. Respiro vertical de 48 dp, como na `TelaDeErro`.

### 3.3 Estados e textos finais
`N` é o total da fila de envio. Ele aparece **num lugar só** por estado.

| Estado | Texto (linha 3) | Linha 4 | Principal (linha 5) |
|---|---|---|---|
| **Fila com itens** (esperando o próximo envio) | Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app. | `ChipEstado tom="aviso" icone="clock"`: **N na fila** | **Enviar agora** |
| **Enviando** | igual ao anterior | `ChipEstado tom="aviso" icone="sync"`: **Enviando N…** | **Enviar agora**, `ocupado` |
| **Erro de envio** | igual ao anterior | `Banner tone="danger" icon="alert"`: **Não deu para enviar N itens. Tente de novo; se continuar, avise o suporte.** | **Tentar de novo** (+ neutro do suporte) |
| **Sem sinal, com fila** | igual ao anterior | `Banner tone="warning"` (`wifiOff`): **Sem sinal. Conecte-se à internet para enviar N itens.** | **Enviar agora** (tenta e volta ao Banner se continuar sem sinal) |
| **Fila vazia, pronto para baixar** | Baixe a versão X.Y.Z e instale por cima desta. Não desinstale o app. | (nada) | **Baixar a versão X.Y.Z** |
| **Gerando o link** | igual ao anterior | (nada) | **Baixar a versão X.Y.Z**, `ocupado` |
| **Erro do link** | igual ao anterior | `Banner tone="danger" icon="alert"`: **Não deu para preparar o download. Tente de novo; se continuar, avise o suporte.** | **Tentar de novo** (+ neutro do suporte) |
| **Sem sinal, fila vazia** | igual ao anterior | `Banner tone="warning"` (`wifiOff`): **Sem sinal. Conecte-se à internet para baixar a versão X.Y.Z.** | **Baixar a versão X.Y.Z** (tenta e volta ao Banner se continuar sem sinal) |

Singular: "Não deu para enviar 1 item." e "…para enviar 1 item." O chip fica "1 na fila" e "Enviando 1…".

Transições:
- Fila com itens → Enviando, sozinho ao abrir, ao voltar o sinal e no toque em "Enviar agora".
- Enviando → Fila vazia (tudo aceito), Erro de envio ou Sem sinal. Com parte enviada, o `N` diminui no lugar.
- Pronto → Gerando o link, no toque. O app pede o link temporário à API (ADR 0065) e abre o download do sistema. Depois o app
  volta ao estado Pronto. Se a pessoa voltar sem instalar, nada muda.
- Item novo na fila não acontece aqui, porque a tela não deixa digitar.

Leitor de tela: ao abrir, anuncia "título. texto". O `ChipEstado` e o `Banner` mudam com `accessibilityLiveRegion="polite"`, e o
`Banner` de erro usa `anunciar`.

### 3.4 O que não entra (regras do corretor)
- Nada de "o app guarda…", "seus dados estão seguros", "a equipe recebe…" nem explicação de por que a versão é obrigatória.
- Sem lista de itens por tipo, sem hora da última sincronização e sem `SyncStamp`. O número da fila aparece uma vez, no chip
  ou no Banner.
- Sem "Tudo enviado". O texto e o botão que mudam já dizem o estado.
- "Não desinstale o app." aparece uma vez por tela (linha 3). A notificação diz o mesmo no corpo, mas em outra superfície.

## 4. Componentes usados (nenhum novo em `packages/ui`)
`Icon` (`alert`, `clock`, `sync`, `wifiOff`, `send`), `ChipEstado` (tom `aviso`), `Banner` (`warning` e `danger`), `Botao`
(principal com `ocupado`; neutro), `Folha` (com `fechar`), e as cores e fontes do tema (`ground`, `ink`, `ink2`, `warning`,
`warningBg`). A `TelaDeErro` não serve como está: ela não tem o estado ocupado nem a linha de estado. A tela de bloqueio usa as
mesmas medidas, montada no shell com as peças acima. Se o engenheiro-apps preferir, eu acrescento à `TelaDeErro` uma prop
opcional `estado` (ReactNode entre o texto e os botões) e `ocupado` no principal, sem mudar o que já existe. O pedido vem por
recado.

## 5. Pendências para o ADR 0070 (fora do desenho)
- **Item recusado pela API** (regra de negócio, não falha de rede): ele não esvazia a fila e o botão de baixar nunca aparece. É
  preciso definir se a API aceita o item da versão antiga, se ele vai para revisão no BKO ou se sai da fila com um registro. O
  desenho pode receber um estado "N itens recusados" quando isso for decidido.
- **Sem sessão** (login expirado na tela de bloqueio): é preciso definir se o pedido do link temporário e o envio da fila exigem
  login. Se exigirem, a tela ganha o estado "Entre para enviar" antes do envio.
- Gestão: a fila tem outros tipos (aprovações, recados). Os textos acima já são genéricos ("itens") e valem para os dois apps.

## 6. Critérios para a revisão
- Um só principal por estado. Alvo de toque ≥ 48 dp.
- Contraste: título 14,9:1 e texto 6,9:1 no `ground`, como na `TelaDeErro`. O `ChipEstado` aviso e os Banners seguem os tons já
  conferidos do kit.
- O botão de baixar nunca aparece com `N > 0`, em nenhuma superfície (tela e folha).
- Os textos são iguais nos dois apps. Só `X.Y.Z` muda por variante.
