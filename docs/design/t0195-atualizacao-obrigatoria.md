# Atualização obrigatória do APK: sininho nas primeiras 24 h e tela de reinstalar (T-0195)

> 2026-11-24 · designer-ux · sessão I da v1.0.33 · pedido do Alexandre (R-20261123-200746-alexandre e R-20261123-201347-alexandre).
> Vale para o **Campo** e o **Gestão**. Decisões de comportamento no ADR 0070 (engenheiro-software). Esta spec diz o que aparece,
> em que ordem, os textos e os componentes de `packages/ui`. Não traz implementação.
> Telas: shell (`apps/mobile`, engenheiro-apps); notificação no sininho: `modules/core/app/telas/recados-e-tarefas` (modulo-core).

## 1. Regra que o desenho garante
Nada digitado se perde: orçamento, pedido, pré-cadastro e o resto da fila de envio. Por isso:
- o botão de baixar **só aparece com pendentes, "Não aceito" e rascunhos em zero** (ADR 0070, D8 (a)). Antes disso, a única ação é
  a que zera a contagem da vez (§5, textos fechados em §5.2);
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
| Ação (toque na linha) | abre a folha "Versão X.Y.Z disponível" (§2.1) |

### 2.1 Folha "Versão X.Y.Z disponível"
`Folha` com título **Versão X.Y.Z disponível** (igual à notificação) e `fechar={{ rotulo: 'Fechar' }}`. O conteúdo é o
**mesmo bloco de estado da tela de bloqueio** (§3.2, linhas 3 a 6, com os mesmos textos e estados de §3.3 e §5). A folha não
repete o título da tela de bloqueio, porque o app segue liberado. Toque fora ou Voltar do Android fecham a folha.

## 3. Depois de 24 h: tela de bloqueio

### 3.1 Quando aparece
- É a **única tela** do app: sem abas, sem cabeçalho na faixa, sem sino e sem menu. Aparece na abertura, no login e em qualquer
  rota, e também quando a API recusa a versão (erro próprio do ADR 0070) no meio do uso.
- Sem sinal, vale a última versão mínima que o app recebeu. A tela é a mesma.
- Voltar do Android fecha o app, como na raiz de qualquer pilha. Não existe "pular" nem "lembrar depois".
- A tela começa a enviar a fila sozinha quando abre e cada vez que o sinal volta.

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
| **Enviando** | igual ao anterior | `ChipEstado tom="aviso" icone="sync"`: **N na fila** (o botão ocupado é o único sinal de envio) | **Enviar agora**, `ocupado` |
| **Erro de envio** | igual ao anterior | `Banner tone="danger" icon="alert"`: **Não deu para enviar N itens.** | **Tentar de novo** (+ neutro do suporte) |
| **Sem sinal, com fila** | igual ao anterior | `Banner tone="warning"` (`wifiOff`): **Sem sinal. Conecte-se à internet para enviar N itens.** | **Enviar agora** (tenta e volta ao Banner se continuar sem sinal) |
| **Fila vazia, pronto para baixar** | Instale por cima desta versão, sem desinstalar o app. | (nada) | **Baixar a versão X.Y.Z** |
| **Gerando o link** | igual ao anterior | (nada) | **Baixar a versão X.Y.Z**, `ocupado` |
| **Erro do link** | igual ao anterior | `Banner tone="danger" icon="alert"`: **Não deu para preparar o download.** | **Tentar de novo** (+ neutro do suporte) |
| **Sem sinal, fila vazia** | igual ao anterior | `Banner tone="warning"` (`wifiOff`): **Sem sinal. Conecte-se à internet.** | **Baixar a versão X.Y.Z** (tenta e volta ao Banner se continuar sem sinal) |

Singular: "Não deu para enviar 1 item." e "…para enviar 1 item." O chip fica "1 na fila".

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
- O aviso de não desinstalar aparece uma vez por tela (linha 3). A notificação diz o mesmo no corpo, mas em outra superfície.

## 4. Componentes usados (nenhum novo em `packages/ui`)
`Icon` (`alert`, `clock`, `sync`, `wifiOff`, `send`), `ChipEstado` (tom `aviso`), `Banner` (`warning` e `danger`), `Botao`
(principal com `ocupado`; neutro), `Folha` (com `fechar`), e as cores e fontes do tema (`ground`, `ink`, `ink2`, `warning`,
`warningBg`). A `TelaDeErro` não serve como está: ela não tem o estado ocupado nem a linha de estado. A tela de bloqueio usa as
mesmas medidas, montada no shell com as peças acima. Se o engenheiro-apps preferir, eu acrescento à `TelaDeErro` uma prop
opcional `estado` (ReactNode entre o texto e os botões) e `ocupado` no principal, sem mudar o que já existe. O pedido vem por
recado.

## 5. Sessão, modo sem sinal, "Não aceito" e rascunhos (ADR 0070, D8 (a)) — textos fechados
"Não aceito" e rascunhos não saem sozinhos: a tela mostra a contagem e abre só a tela que os resolve. Nada é descartado aqui.
Bloqueada, a tela continua recebendo dados, para que o "Não aceito" corrigido saia sem reinstalar antes.

### 5.1 Prioridade (um estado por vez, um só principal)
1. **Modo sem sinal ligado** (chave do Perfil, `fv:offline`): sem desligá-lo nada sai nem entra, e o Perfil não abre daqui.
2. **Sem sessão** (sem login não há envio nem link).
3. **Pendentes > 0**: os estados de fila de §3.3 (enviar primeiro, porque o envio pode gerar novos "Não aceito").
4. **Não aceito > 0**.
5. **Rascunhos > 0** (só existem no Campo; no Gestão a contagem é sempre zero).
6. **Tudo em zero**: os estados de download de §3.3.

Só a contagem do estado da vez aparece. As outras ficam para quando ele zerar: a tela volta e mostra a próxima.

### 5.2 Textos finais (literais; substituem os `pendentesDoDesenho` do shell)
| Estado | Texto (linha 3) | Linha 4 | Principal (linha 5) |
|---|---|---|---|
| **Modo sem sinal ligado** | Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app. | (nada) | **Desligar modo sem sinal** |
| **Sem sessão** | Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app. | (nada) | **Entrar** |
| **Não aceito** (N > 0) | Antes de reinstalar, corrija ou descarte N itens não aceitos. Não desinstale o app. | (nada) | **Abrir os não aceitos** |
| **Rascunhos** (N > 0) | Antes de reinstalar, envie ou descarte N rascunhos. Não desinstale o app. | (nada) | **Abrir os rascunhos** |

Nenhum destes estados tem secundário nem o neutro do suporte.

Singular (N = 1): texto "Antes de reinstalar, envie ou descarte o rascunho. Não desinstale o app." e "Antes de reinstalar,
corrija ou descarte o item não aceito. Não desinstale o app."; botão **Abrir o rascunho** e **Abrir o não aceito**.

"Abrir", e não "Corrigir": no destino a pessoa pode corrigir ou descartar. "Desligar modo sem sinal" é o mesmo rótulo da tela de
carga (`tela-carga.tsx`), para a pessoa reconhecer a ação.

Ações e destinos (shell, ADR 0070):
- **Desligar modo sem sinal**: desliga a chave e já começa o envio (vai direto ao estado Enviando de §3.3, ou ao próximo da
  prioridade). Usa `ocupado` enquanto desliga.
- **Entrar**: abre o login; depois dele a tela de bloqueio volta com a fila do usuário.
- **Abrir os não aceitos**: pedido ou orçamento recusado abre a lista de Pedidos; pré-cadastro recusado abre Clientes; qualquer
  outro item recusado, inclusive o de **módulo desativado** (`modulo_inativo`) e os arquivos (fotos), abre a **fila do aparelho
  no Perfil**, onde estão o motivo e o Descartar. Vale o primeiro "Não aceito" da fila.
- **Abrir os rascunhos**: lista de Rascunhos.
- Ao voltar de qualquer destino, a tela de bloqueio reaparece com a contagem nova.

Na folha (§2.1), o "Abrir…" fecha a folha e navega. Sem sessão não ocorre na
folha (o app está em uso). Com o modo sem sinal ligado, "Desligar modo sem sinal" desliga e fica na folha.

### 5.3 O que não entra
- Sem lista dos itens nem motivo da recusa nesta tela: o motivo está na tela de destino (uma informação, um lugar).
- Sem botão "Descartar" aqui: descartar é decisão na tela do item.
- Sem chip nos estados de §5.2: a contagem de não aceitos e rascunhos aparece uma vez, no texto (linha 3); o botão diz a ação.
- No modo sem sinal ligado não aparece o Banner "Sem sinal. Conecte-se…": o aparelho pode ter internet; o que falta é desligar
  o modo.

## 6. Critérios para a revisão
- Um só principal por estado. Alvo de toque ≥ 48 dp.
- Contraste: título 14,9:1 e texto 6,9:1 no `ground`, como na `TelaDeErro`. O `ChipEstado` aviso e os Banners seguem os tons já
  conferidos do kit.
- O botão de baixar nunca aparece com pendentes, "Não aceito" ou rascunhos acima de zero, nem sem sessão, em nenhuma superfície
  (tela e folha).
- Os textos são iguais nos dois apps. Só `X.Y.Z` muda por variante.
