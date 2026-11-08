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
