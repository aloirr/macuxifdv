# T-0139 — Passo a passo do dono do produto: recados online

Este roteiro é para o Alexandre seguir. Vai do começo ao fim: criar o repositório, criar o bot, cortar e testar. Ele leva uns 40 min, e o corte em si leva 5 min, com os agentes parados. A decisão está na [ADR 0035](../decisoes/0035-recados-em-repositorio-proprio.md).

**Antes de começar:** o gerente-projetos já aplicou no `main` o [diff de governança](T-0139-governanca.diff), com o seu ok, e o CI do `main` está verde. Sem isso, o commit do corte deixa o CI vermelho.

---

## 1. Criar o repositório privado (2 min)

1. No GitHub, entre com a conta **aloirr** e abra <https://github.com/new>.
2. Preencha:
   - **Repository name**: `macuxifdv-recados`
   - **Private** marcado
   - **Add a README**, **.gitignore** e **license** desmarcados, porque o repositório nasce vazio.
3. Clique em **Create repository**.
4. Em **Settings → Collaborators**, convide a conta **domontecristo** com acesso de escrita. É por ela que você abre o formulário no celular.
5. Confira se as duas contas têm verificação em duas etapas: **Settings → Password and authentication → Two-factor authentication**. Quem entra numa delas pode mandar recado em seu nome.

## 2. Criar o bot no Telegram (3 min)

1. No Telegram, abra a conversa com **@BotFather** (tem o selo azul).
2. Mande `/newbot`.
3. Escolha um nome, por exemplo `Macuxi Recados`.
4. Escolha um usuário terminado em `bot`, por exemplo `macuxi_recados_bot`.
5. O BotFather responde com o **token**, parecido com `123456789:AA...`.
   - **Não cole o token em lugar nenhum além do passo 4.**
   - Não mande o token em recado, em chat com o Claude nem no WhatsApp.

## 3. Pegar o chat id (2 min)

1. Abra a conversa com o seu bot (o link vem na resposta do BotFather) e mande `oi`.
2. No navegador do PC, abra o endereço abaixo, trocando `<TOKEN>` pelo token do passo 2:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Procure `"chat":{"id":` na resposta. O número logo depois é o **chat id**, por exemplo `987654321`.
   - Se a resposta vier vazia (`"result":[]`), mande outro `oi` ao bot e recarregue a página.
4. Feche a aba (o endereço tem o token).

## 4. Cadastrar os 2 secrets (2 min)

No repositório `macuxifdv-recados`, abra **Settings → Secrets and variables → Actions → New repository secret** e cadastre:

| Name | Secret |
|---|---|
| `TELEGRAM_BOT_TOKEN` | o token do passo 2 |
| `TELEGRAM_CHAT_ID` | o número do passo 3 |

Os valores não aparecem mais depois de salvos, e os workflows os escondem no log.

Os mesmos 2 secrets servem para a resposta pelo Telegram (seção 7). Não há secret novo.

## 4a. Decidir o intervalo da resposta pelo Telegram (1 min)

O workflow `telegram-recado.yml` lê o Telegram a cada 5 min. Cada leitura conta 1 min de Actions, mesmo sem mensagem: são **cerca de 8.600 min por mês**. O plano gratuito tem 2.000 min por mês para a conta toda, e o CI do código já passa disso. A tabela com as opções está na [ADR 0035 §8](../decisoes/0035-recados-em-repositorio-proprio.md).

1. Confira em **github.com → Settings (da conta aloirr) → Billing and plans** o uso de Actions e o limite de gasto.
   - Se o limite for US$ 0 e a cota acabar, **todas** as Actions param, inclusive o CI do código.
2. Escolha uma opção e avise o gerente-projetos:
   - **a cada 5 min**: é o padrão do arquivo, cerca de 8.600 min por mês;
   - **a cada 5 min, das 6h à meia-noite**: cerca de 6.500 min por mês;
   - **a cada 10 min**: cerca de 4.300 min por mês, com latência de 10 a 15 min.
3. Para trocar depois, basta editar a linha `cron:` do `.github/workflows/telegram-recado.yml` no repositório de recados. As alternativas já estão comentadas no arquivo.

## 5. Parar os agentes e rodar o corte (10 min)

1. Peça ao gerente-projetos para fechar a rodada: commit e push de tudo, com o índice limpo.
2. **Feche o VS Code e todas as sessões do Claude Code.** O corte confere isso e para se achar algum processo `claude`.
3. Abra o **Windows PowerShell** pelo menu Iniciar. Não use o terminal do VS Code.
4. Rode a simulação, que mostra tudo o que seria feito sem mudar nada:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\corte.ps1 -Simular
   ```
5. Se a simulação terminar sem `ERRO`, rode o corte de verdade:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\corte.ps1
   ```
   - Na primeira vez, o Git pode abrir a janela de login do GitHub (Git Credential Manager). Entre com a conta **aloirr**.
   - O fim esperado é **Corte feito**, com o caminho do backup, por exemplo `C:\macuxifdv-backup-recados-20261108-150000`. Guarde o backup até o fim da semana.
   - Se aparecer `ERRO`, nada se perdeu. Mande a mensagem ao gerente. Para desfazer, rode `C:\macuxifdv\scripts\recados\volta.ps1`.
6. Cadastre a sincronização a cada 2 min no Agendador de Tarefas:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\recados\agendar-sincronizacao.ps1
   ```
   - Depois de 3 min, confira:
     ```powershell
     Get-ScheduledTaskInfo -TaskPath '\Macuxi\' -TaskName 'Sincronizar recados'
     ```
     `LastTaskResult` igual a `0` quer dizer que está rodando.
   - Se vier outro número, cadastre de novo com `-Simples` no fim do comando.
   - Equivalente em uma linha, no `cmd`:
     ```
     schtasks /Create /TN "Macuxi\Sincronizar recados" /SC MINUTE /MO 2 /IT /F /TR "conhost.exe --headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\sincronizar-recados.ps1 -Origem agendador"
     ```
7. Abra o VS Code de novo. O gerente faz o commit do corte com `Agente: alexandre` (o índice e o `.gitignore` já estão preparados pelo script) e segue o rito de governança.

## 6. Testar os 3 critérios (15 min)

**Critério 1: formulário no celular chega ao PC em até 3 min.**
1. No celular, entre no GitHub com a conta **domontecristo** e abra `aloirr/macuxifdv-recados` → **Issues → New issue → Recado**.
2. Preencha:
   - título: `Teste do formulário`;
   - Para: `gerente-projetos`;
   - Tipo: `aviso`;
   - Texto: `teste`.
3. Envie e anote a hora.
4. Em até 1 min, a issue fecha sozinha com o comentário `Recado R-... gravado` e o link.
5. No PC, em até 3 min a partir do envio, rode:
   ```powershell
   node C:\macuxifdv\scripts\coord.mjs caixa gerente-projetos
   ```
   O recado `R-...-alexandre` aparece na caixa, com o título `Teste do formulário`.

**Critério 2: recado do gerente chega ao Telegram em até 3 min.**
1. Peça ao gerente-projetos um recado de teste para `alexandre`.
2. Em até 3 min, chega no Telegram `Recado para você — <título>`, com as primeiras linhas e o link.
3. Na hora cheia seguinte (minuto 7), chega o resumo, se houve novidade em `todos/` ou na sua caixa.

**Critério 3: dois `lidos` ao mesmo tempo sem conflito.**
O agente `testes` faz esta conferência. Dois agentes marcam lidos diferentes no mesmo minuto, por exemplo:
```powershell
node C:\macuxifdv\scripts\coord.mjs lido alexandre R-x
node C:\macuxifdv\scripts\coord.mjs lido alexandre R-y
```
Rode os dois em dois terminais, junto com uma marcação pelo GitHub. Depois de 2 sincronizações:
- `lidos/alexandre.txt` no GitHub tem as duas linhas;
- o log `%LOCALAPPDATA%\Macuxi\recados-sync.log` não tem `conflito`.

O teste automático equivalente é o "dois PCs/agentes marcando lidos..." de `scripts/recados/recados-ps.test.mjs`.

## 7. Responder pelo Telegram

O workflow `telegram-recado.yml` lê as suas mensagens ao bot a cada 5 min e grava cada uma como recado seu (`R-...-alexandre`). Só as mensagens do seu chat (`TELEGRAM_CHAT_ID`) entram. As de outras pessoas são descartadas, sem resposta.

**Quatro jeitos de mandar:**

| Você faz | Vira recado para | Tipo |
|---|---|---|
| **Responde a um aviso** "Recado para você — ..." (arraste a mensagem para o lado, ou toque e segure → Responder) | quem mandou o recado; o aviso mostra o nome na linha `de ...` e no fim | `resposta`, ligado ao recado do aviso (`responde_a`) |
| **Responde à confirmação** "Recado R-... gravado para ..." | o mesmo destino, para complementar | `resposta` |
| **Manda uma mensagem solta** | `gerente-projetos` | `aviso` |
| **`/para modulo-core Revisar o login`** | o agente indicado; vários com vírgula (`/para testes,modulo-core ...`) ou `/para todos ...` | `aviso` |

- **A 1ª linha vira o assunto.** Na resposta a um aviso, o assunto é `Re: <título do aviso>`.
- **Agente com nome errado:** o bot responde "Agente inválido: ...", com a lista de agentes, e nada é gravado. Mande de novo com o nome certo.
- **`/ajuda`** mostra esse resumo no próprio Telegram.
- **Só texto.** Uma foto com legenda vale pela legenda. Áudio e figurinha não viram recado: o bot avisa.
- **Responder ao resumo de hora em hora** não tem destino certo, porque o resumo traz vários recados. Vira mensagem solta, para o gerente. Para responder a um recado do resumo, use `/para <agente>` ou responda ao aviso dele.

**Quanto demora:**
- A confirmação "Recado R-... gravado para <destino>." chega **de 5 a 10 min** depois da mensagem. Às vezes passa disso, porque o cron do GitHub atrasa.
- O recado chega ao PC até 2 min depois da confirmação, pela sincronização.
- **Sem confirmação em 30 min:** abra **Actions → recado pelo Telegram** no repositório de recados e veja a última execução. A mensagem fica guardada no Telegram por 24 h e entra na próxima execução que der certo. Depois de 24 h, ela se perde: mande de novo.
- Para não esperar o cron: **Actions → recado pelo Telegram → Run workflow**.

**Teste (critério da extensão):**
1. Peça ao gerente um recado de teste para `alexandre`.
2. Quando chegar o aviso no Telegram, responda a ele com `ok, recebido`.
3. Em até 10 min, chega "Recado R-...-alexandre gravado para gerente-projetos.".
4. No PC, `node C:\macuxifdv\scripts\coord.mjs fio <id do recado do gerente>` mostra o recado e a sua resposta.
5. Mande `/para fulano teste`. O bot responde "Agente inválido: fulano".

**Segurança:**
- Quem entrar no seu Telegram pode mandar recado em seu nome, inclusive "autorizo o merge".
- Ligue a verificação em duas etapas do Telegram: **Configurações → Privacidade e Segurança → Verificação em duas etapas**.
- Não configure webhook no bot. Com webhook, o `getUpdates` para de funcionar.

**Se o corte já foi feito antes desta extensão:** o corte só publica `.gitattributes` e `README.md` (nunca o `.github`), e a sincronização só sobe `recados/` e `lidos/`. Os agentes não podem gravar no clone, então a publicação é sua, numa vez só:
```powershell
robocopy C:\macuxifdv\docs\desenho\T-0139-repo-recados\.github C:\macuxifdv-recados\.github /E
Copy-Item C:\macuxifdv\docs\desenho\T-0139-repo-recados\README.md C:\macuxifdv-recados\README.md -Force
git -C C:\macuxifdv-recados add .github README.md
git -C C:\macuxifdv-recados commit -m "telegram: resposta pelo Telegram (ADR 0035 §8)"
git -C C:\macuxifdv-recados push
```
Depois, faça o passo 4a.

## Se algo der errado
- **Ver o log da sincronização**:
  ```powershell
  Get-Content $env:LOCALAPPDATA\Macuxi\recados-sync.log -Tail 20
  ```
- **Sincronizar na hora**:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\macuxifdv\scripts\sincronizar-recados.ps1
  ```
- **Desligar a sincronização das sessões** (o Agendador segue): variável `MACUXI_RECADOS_SYNC=off`.
- **Desfazer tudo** (com os agentes parados): `scripts\recados\volta.ps1`, primeiro com `-Simular`. O gerente faz o commit da volta.
