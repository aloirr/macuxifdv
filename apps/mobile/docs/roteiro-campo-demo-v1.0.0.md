# Roteiro único de teste — Campo-Demo-v1.0.0 e Gestao-Demo-v1.0.0 (714d0d1b)

> **Histórico.** A demo foi desligada (ADR 0051) e os perfis de preview saíram do `eas.json`: este roteiro não se aplica
> mais a builds novos. Os endereços `*-demo.macuxifdv.com.br` citados aqui não existem mais.

> Para o Alexandre. Cobre tudo o que mudou no app desde o build do **e9a65286** (07/11, 02h): o **d1e0d2a** (que você
> não testou) e o lote 01 inteiro (commit **714d0d1b**, 08/11), juntos.
> Pedidos: R-20261107-163525 (item 4), R-20261107-151653 (nome), R-20261107-092152 (build único) e R-20261108-175721
> (build às 20h). Dono: engenheiro-apps. Os links dos APKs vêm no recado
> "BUILD PRONTO Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 (714d0d1b)".

## 0. Antes de começar (nesta ordem)
1. **Recrie a base da demo. Quem roda é você:** GitHub → Actions → **"demo — recriar base demo"**
   (workflow `demo-recriar-base`) → Run workflow → digite `RECRIAR`. Espere ficar verde.
   - Por quê: entraram as migrações 0039 a 0049 (senha e e-mail, ciclo de senha, perfis de acesso, cancelamento no ERP,
     XP do Treinamento, marcas concorrentes, portal com vários perfis) e o seed novo. A publicação aplica as migrações,
     mas o seed só roda quando a base é recriada.
   - A senha de todos **continua `demo-macuxi`**.
   - Recrie **antes** do item A. Se recriar depois de montar a fila do item A, o servidor perde o que já foi enviado.
   - Fotos de produto: depois que a base estiver recriada, avise o gerente-projetos. Ele carrega as fotos de
     demonstração (item D.5). Recriar a base apaga as fotos carregadas antes.
2. Celular com o app que você usa hoje: abra, sincronize (puxe a tela para baixo) e confira no Perfil que a fila está
   vazia. Depois **desinstale** o Macuxi Campo e o Macuxi Gestão. Os builds e9a65286 e d1e0d2a já usam o SQLite;
   instalar o APK antigo por cima deles não testaria a passagem.

## Dados da demo
- Código da empresa: **demo**. Senha de todos: **demo-macuxi**.
- Usuários (todos `@exemplo.com.br`):
  - Campo: `vendedor` (Lucas), `vendedor2` (Camila), `promotor` (Joana).
  - Gestão: `supervisor` (Renata), `gerente` (Marcelo).
  - Backoffice: `admin` (Sérgio), `analista` (Paulo), `gerente` (Marcelo).
- Backoffice: https://bko-demo.macuxifdv.com.br
- Os e-mails `@exemplo.com.br` não existem, e a demo não manda e-mail de verdade (não tem SMTP). Onde o roteiro fala de
  e-mail, ele diz o que você vê no lugar.

## A. Passagem para o SQLite (fila offline instalada por cima)
Faça no Campo e depois repita no Gestão.
1. Instale o APK do **5a1848a9** (o último que ainda guarda os dados no formato antigo):
   - Campo: https://expo.dev/artifacts/eas/4PftetZlTx_pEzZD7sYTnoMLPzJYtvJxPCWZKY1gFOo.apk
   - Gestão: https://expo.dev/artifacts/eas/zZF0vjz7BCAAonGa8GSapEouNQFlsyHoN7Q65wnoHTc.apk
2. Entre com `vendedor` (no Gestão, com `supervisor`). Espere a 1ª sincronização terminar.
3. Ligue o **modo avião**. Faça 3 pedidos e 1 visita. Deixe 1 pedido como rascunho, sem enviar. No Gestão, registre o
   que a supervisora pode fazer.
4. Abra o Perfil: os itens têm de aparecer na fila. Anote quantos são.
5. Ainda no modo avião, instale o APK **novo** (Campo-Demo-v1.0.0) **por cima**. Não desinstale.
6. Abra com o mesmo usuário. Se a cópia levar mais de meio segundo, aparece uma vez a tela "Atualizando os dados do
   aparelho…", com barra. Se for rápida, ela nem aparece. Os dois casos estão certos.
7. Ainda sem sinal: os 3 pedidos e a visita continuam na fila, e o rascunho abre com os mesmos itens.
8. Perfil → Diagnóstico → mostrar. Tem de estar escrito "Armazenamento: SQLite (macuxi-u-h…-t-demo.db)" e "passagem do
   AsyncStorage: concluída em <data e hora>".
9. Desligue o modo avião e sincronize. Cada pedido e a visita chegam **uma vez só**, sem repetidos, na lista de Pedidos
   e no Backoffice.
10. Feche e abra o app. No Diagnóstico, a linha dos dados antigos passa para "removidos".

Se aparecer "AsyncStorage (reserva)" ou "SQLite com erro", copie as linhas do Diagnóstico e mande no recado. É defeito.

## B. Login e senha
Use um usuário **novo**, para não mexer nos usuários da demo. Uma senha trocada na demo só volta recriando a base.
1. **Criar o usuário:** Backoffice com `admin` → Usuários → Novo usuário. Perfil **Vendedor**, um e-mail seu ou
   inventado, e toque em "Gerar senha" (ou digite uma senha com 8 caracteres ou mais, com letra, número e caractere
   especial). Salve.
2. Como a demo não manda e-mail, o Backoffice mostra a senha inicial com o botão "Copiar senha". Anote. Na lista, o
   usuário aparece com "Troca de senha pendente · vence em <data e hora>" (72 h).
3. **Ciclo de senha, 1º uso:** no Campo, entre com esse e-mail e a senha inicial. O app vai direto para
   **"Crie sua senha"**. Nada mais abre antes.
4. Teste a tela:
   - repetir a senha inicial → "A senha nova precisa ser diferente da senha que você recebeu.";
   - senha fraca → a lista mostra o que falta;
   - item "As duas senhas iguais" na lista, desde o início: círculo vazio enquanto "Repita a senha" está vazio ou
     diferente; ✓ quando as duas conferem; ✕ ao tocar em "Salvar e entrar" com as duas diferentes;
   - modo avião → "Conecte-se à internet para criar a sua senha.".
5. Crie uma senha válida e toque em "Salvar e entrar". O app entra e mostra "Senha criada." no rodapé do Início.
6. Saia e entre de novo com a senha nova: entra direto. A senha inicial não vale mais.
7. **E-mail volta preenchido:** saia do app. No login, o código da empresa e o **e-mail** já vêm preenchidos; só falta a
   senha. O mesmo vale quando o app volta ao login depois da troca de senha ou do "Esqueci a senha".
8. **Esqueci a senha** (no login do Campo, logo abaixo de "Entrar"):
   - informe `demo` e o e-mail do usuário novo e toque em "Enviar senha temporária";
   - a resposta é sempre a mesma, com o e-mail existindo ou não (faça o teste também com um e-mail que não existe);
   - a demo não manda o e-mail. Confira só que a senha atual **continua valendo**: entre com ela;
   - peça várias vezes seguidas: a partir de alguns pedidos aparece "Muitos pedidos seguidos. Tente de novo em <n> minutos.".
9. **Redefinir pelo Backoffice:** com `admin`, em Usuários, use "Redefinir senha" no usuário novo. Entre no app com a
   senha mostrada: o app pede "Crie sua senha" de novo. Se ele estava logado em outro aparelho, a sessão de lá cai.
10. Repita os passos 3 a 6 no Backoffice: o login web também leva a "Crie sua senha".
11. **Portal (cliente da plataforma):** o portal só pede **e-mail e senha**, sem código da empresa. No cartão de
    administradores, quem também tem perfil de campo (por exemplo, admin + vendedor) aparece com a etiqueta
    **"Entra só pelo app"** (passe o mouse para ver a dica) e continua com o "Redefinir senha".

## C. Perfis, multiperfil e Perfis de acesso
1. **Supervisor fora do Backoffice:** entre no Backoffice com `supervisor`. Aparece "O perfil supervisor não usa o
   backoffice (web). Entre pelo app Macuxi Gestão." e não abre menu nenhum.
2. O mesmo com `vendedor` e `promotor` no Backoffice: recusados, cada um com o app certo na mensagem.
3. `supervisor` no Campo: "O perfil supervisor não usa o app Macuxi Campo. Entre pelo app Macuxi Gestão.".
   `vendedor` no Gestão: recusado, indicando o Campo.
4. `gerente` continua entrando no Gestão **e** no Backoffice.
5. **Vendedor + promotor:** no Backoffice com `admin`, edite a Joana (`promotor`) e marque também o perfil **Vendedor**
   em "Perfis". Salve.
6. No Campo, entre com `promotor` (ou saia e entre de novo). Ela vê as abas do Promotor **e** as do Vendedor.
7. Pela parte de vendedor, ela **cria um pedido** normalmente. Um usuário só promotor continua sem criar pedido.
8. Com `promotor` no Backoffice: continua recusado. Basta um perfil sem Backoffice para fechar o acesso.
9. Ao terminar, tire o perfil Vendedor da Joana (ou recrie a base).
10. **Perfis de acesso:** Backoffice com `admin` → Administração → **Perfis de acesso**.
    - Crie um "Novo perfil" a partir de um perfil base. Sem nome: "Dê um nome ao perfil."; nome repetido: "Já existe um
      perfil com este nome.".
    - Ligue e desligue permissões e salve. Os perfis de campo mostram "Este perfil nunca entra no BKO nem no portal".
    - Desative o perfil ("Desativar este perfil?") e reative.
    - Dê o perfil novo ao usuário do item B e entre com ele: o que ele vê segue as permissões que você marcou.

## D. Catálogo: atalho, lista por linha e fotos
1. Aba Catálogo, com a busca vazia e fora de um pedido: aparece o atalho **"Ver por linha"** entre a busca e a trilha.
   Ele não aparece com algo digitado na busca, nem dentro do Novo pedido.
2. Toque nele. A lista **"Por linha"** abre em sistema › grupo › linha (na demo: Freios, Filtros, Suspensão…). Desça os
   níveis, abra um produto e volte. A lista volta no mesmo ponto, rápida.
3. Repita com um cliente escolhido e depois no modo avião: tudo abre sem sinal.
4. **"Mostrar mais (N restantes)"** só aparece quando um nível tem mais de 100 itens. Na demo nenhum nível passa de 100,
   então o botão não aparece. Isso é esperado.
5. **Fotos de produto:** depois da carga de fotos (item 0.1), 20 a 30 produtos da vitrine têm foto (um quadro com o nome
   e a cor da categoria, sem marca real). Confira:
   - na lista e na busca, a miniatura aparece à esquerda; os produtos sem foto ficam com o espaço vazio, do mesmo
     tamanho, e a lista não pula;
   - modo avião: as fotos já vistas continuam; as que nunca abriram ficam no espaço vazio, sem travar.
   - Sem a carga de fotos, todos os espaços ficam vazios. Isso não é defeito do app; avise no recado.

## E. Pedidos (lista)
1. Busque por parte do número (por exemplo, `12` acha o `000012`). O trecho achado fica em destaque, legível ao sol.
2. Busca por nome do cliente destaca o nome, e não o número.
3. Com a busca, aparecem a etiqueta e o resumo do vendedor.
4. O período não aparece mais dentro dos chips "A faturar" e "Em aberto".
5. Filtro ligado: o botão diz "Remover filtro <nome>".
6. Modo avião: o aviso sem sinal aparece com o ícone de wi-fi cortado; a lista vazia sem sinal mostra o texto novo.
7. Pedido guardado com "Apenas salvar" (item F) aparece na lista com a tag **"Salvo"**.

## F. Novo pedido v2 (Campo, `vendedor`)
1. **4 abas:** o Novo pedido abre em **Venda · Itens (n) · Entrega · Resumo**. O número em "Itens" acompanha o que
   você põe no pedido.
2. **Pendências só no Resumo:** monte um pedido sem forma de pagamento. Nas outras abas não aparece pendência. No Resumo,
   o bloco **"Falta para salvar"** lista o que falta; tocar numa pendência leva à aba certa.
3. **Resumo:** mostra cliente, venda, itens, entrega, observações, o desconto do pedido numa linha só, os totais e a
   alçada. Embaixo, **4 botões**:
   - **Salvar e enviar pedido** (principal, com o destino escrito);
   - **Apenas salvar** (guarda sem enviar; aceita pendências);
   - **Salvar como orçamento** (congela os preços);
   - **Cancelar** (abre a folha "Sair do pedido?").
4. **"Sair do pedido?" por todas as saídas:** com algo preenchido, tente sair pelo Cancelar do Resumo, pelo Voltar do
   Android, pela seta do topo e tocando em outra aba da barra de baixo. Todas abrem a mesma folha, com "Salvar e enviar
   pedido", "Apenas salvar", "Salvar como orçamento", "Descartar" e "Continuar editando". "Descartar" pede confirmação
   ("Descartar este pedido?"). Nada é apagado sem você escolher. Pedido vazio sai direto, sem folha.
5. **Salvar pela fila:** toque em "Salvar e enviar pedido". A tela fecha na hora, sem ficar "processando", e aparece
   **"Pedido salvo · enviando"**. No modo avião aparece "Pedido salvo · vai quando houver sinal", e o pedido vai sozinho
   quando o sinal voltar.
6. **Apenas salvar:** o pedido aparece na lista com a tag **"Salvo"** e reabre com tudo o que estava preenchido.
7. **Forma de pagamento sem troca silenciosa:** escolha um cliente inadimplente (na demo, os que mostram título
   vencido). Escolha Boleto com um prazo válido. A forma **não** volta sozinha para Pix / À vista: o pedido segue para
   aprovação. A forma que não pode ser usada aparece desabilitada, com o motivo escrito.
8. **Preço congelado no orçamento:** salve um orçamento. Depois abra o orçamento e toque em Editar: os preços dos itens
   continuam os do dia em que foi salvo (não são recalculados). Na edição, os botões são "Salvar orçamento",
   "Transformar em pedido" e "Cancelar".
9. **Validade do orçamento:** a data de validade é a mesma em todos os lugares da tela (Resumo, confirmação, lista
   "Orçamentos" e detalhe). Não pode aparecer 15/11 num lugar e 16/11 em outro.
10. Cliente bloqueado, inativo ou com cadastro incompleto: só aparecem "Apenas salvar" e "Salvar como orçamento", com a
    linha que explica (por exemplo, "Cliente bloqueado: só dá para salvar como orçamento").

## G. Gestão: pedido em nome do vendedor só com a carteira dele (RN-VEN-35)
1. No Gestão, com `supervisor`: Equipe → Lucas → "Fazer pedido em nome de Lucas".
2. Sem busca, a lista de clientes mostra **só a carteira do Lucas**.
3. Busque um cliente da Camila. Ele aparece com "Cliente da carteira de Camila Freitas" e **não pode** ser escolhido.
4. Escolha um cliente do Lucas e envie. No Backoffice, o pedido aparece como do Lucas. O Novo pedido do Gestão segue o
   mesmo v2 do item F.

## H. Gestão: aviso da etapa pendente
O aviso aparece quando uma visita da equipe foi concluída no aparelho do vendedor, mas uma etapa dela (por exemplo, a
resposta da pesquisa obrigatória) ainda não chegou ao servidor.
1. No Campo, com `vendedor`, procure na rota uma parada feita com o selo **"Etapa pendente"**. Se não houver nenhuma, peça
   ao gerente-projetos para montar o caso na demo (é o jeito mais seguro; montar no aparelho depende da ordem da fila).
2. No Gestão, com `supervisor`, sincronize e abra a ficha desse cliente. No topo, acima das abas, um aviso amarelo com
   relógio: "Uma etapa da visita de Lucas em <dd/mm> ainda não chegou ao Macuxi" e, embaixo, "Peça a Lucas para abrir a
   fila do aparelho e sincronizar". Não tem botão.
3. Quando a etapa chegar ao servidor e o Gestão sincronizar, o aviso some, sem mensagem de "resolvido".

## I. Início sem redundâncias (Campo, `vendedor`)
1. Abra o Início **hoje (domingo)** ou em qualquer dia sem expediente:
   - no topo, a data, "Bom dia, Lucas" e **"Sem rota hoje · não é dia útil"** (uma frase só, sem repetir o aviso);
   - o cartão principal é **"META DO MÊS"**, com o percentual, "R$ X de R$ Y", a barra e "Faltam R$ … · R$ … por dia
     útil (n dias)". Não aparece mais "META DE HOJE" mostrando o realizado do mês;
   - "mês", "hoje" e a unidade não se repetem na mesma linha; Positivação, Visitas e Cobertura no mesmo formato;
   - Recados: um selo só com a contagem ("1 novo", "3 novos"; nada quando tudo foi lido) e a prévia em até 2 linhas;
   - no fim, uma linha só com a hora dos dados e "Sincronizar" (não aparece "Sincronize" em dois lugares).
2. Em dia útil, a linha "Faltam … por dia útil" vira "Meta de hoje R$ X".
3. No Gestão, com `supervisor`, o Início segue a mesma estrutura, com o cartão "Meta do mês da equipe".

## J. Marcas concorrentes
1. Backoffice com `admin` → **Marcas concorrentes** (grupo Cadastros). É uma lista só do tenant, com ou sem o Promotor.
2. Cadastre uma marca nova, edite o nome, inative e reative. Nome vazio: "Informe o nome da marca e salve de novo.".
   Nome igual a outro (sem diferenciar maiúsculas e acentos) é recusado. Ao inativar uma marca usada, a confirmação diz
   quantas referências saem da busca. Marca não se apaga, só inativa.
3. No Catálogo do Backoffice, na referência cruzada de um produto, a marca do concorrente vem dessa lista.
4. Backoffice → Promotor → Cadastros: no lugar do antigo cadastro de concorrentes aparece só um aviso com o link para
   Marcas concorrentes do Catálogo (a lista é uma só).

## K. Cancelamento integrado devolvido ao ERP
Na demo não há ERP de verdade ligado; o que dá para ver é a parte do Backoffice.
1. Backoffice com `admin` → Integração → Conectores: o conector que aceita cancelamento mostra "· aceita cancelamento".
2. Integração → Pedidos: o quadro de retorno diz "Nenhum erro de retorno do ERP nem cancelamento recusado." Quando o ERP
   recusar um cancelamento, ele aparece ali com a etiqueta **"Cancelamento recusado"**.
3. O botão para cancelar no app um pedido que já foi ao ERP **não está neste build** (vai no v1.0.1, Frente M).

## L. Versão no Perfil
1. No Campo: Perfil → no fim da tela, a linha diz **Campo-Demo-v1.0.0**.
2. No Gestão: **Gestao-Demo-v1.0.0**.
3. Em Configurações do Android → Apps → Macuxi Campo, a versão é 1.0.0. Instala por cima do d1e0d2a (versionCode 2).

## M. Medição com 20 mil produtos (opcional, só no Campo)
1. Perfil → toque 7 vezes seguidas, rápido, na linha da versão. Abre "Diagnóstico de carga".
2. "Rodar medição". Leva alguns minutos; não saia da tela. Seus dados não são tocados.
3. Os dois p95 de busca **no aparelho** têm de ficar abaixo de 300 ms. Toque em "Copiar ou compartilhar" e cole o
   relatório no recado. (O p95 da busca **na API** com 20 mil ainda não está na meta; vai no v1.0.1.)

## Não entrou no v1.0.0 (vai para o v1.0.1)
- **Frente M do Novo pedido v2** (T-0138): detalhe do orçamento/pedido com o histórico em tags (Campo, Gestão e
  Backoffice), "Equivale a" no PDF e o botão de cancelar no app um pedido já integrado.
- **p95 da busca da API com 20 mil produtos** (T-0119): a busca do aparelho já está na meta; a da API ainda não.
- **7 🟡 de calendário e corrida** apontados na revisão do lote.
- **RD-0014 a RD-0031** da auditoria de redundâncias do lote (`docs/qualidade/redundancias/`).

## No v1.0.1: app que abria e fechava depois de atualizar e na carga inicial (T-0140, relatos 1 e 6)
O que muda (sem causa confirmada em aparelho; são proteções contra a hipótese da tarefa em segundo plano acordando o app
sem tela logo depois da instalação por cima):
- A tarefa em segundo plano **não roda** com o app aberto, abrindo ou sincronizando, nem num build que ainda **não abriu
  com tela** depois da atualização: a 1ª abertura (passagem de dados, carga) é sempre do app, com você vendo.
- No fim dos 60 s a tarefa corta a passada na próxima página e espera ela parar antes de devolver ao Android.
- Erro da tarefa (ou da definição dela, na carga do app) vai ao Diagnóstico e não fecha o app.
- A carga inicial devolve a vez ao sistema entre as páginas; o pedido de permissão de notificação espera 4 s depois da carga.

Como conferir (Perfil › Diagnóstico, "Informações técnicas"):
1. Com sessão aberta no v1.0.0, instale o v1.0.1 por cima. **Não abra o app** por 1 ou 2 minutos (com internet).
2. Abra o app. Ele deve abrir **uma vez só**, sem "travando com frequência".
3. Perfil › Diagnóstico. Anote as linhas:
   - `Última sincronização em segundo plano: …` — logo depois da atualização, o esperado é
     `não rodou: app atualizado, espera a 1ª abertura`, ou nenhuma linha;
   - `Build instalado: 1.0.1+<n>` (versão + número do build);
   - `Último erro do app: …` — se o app fechou, aqui aparece "o app fechou" com a mensagem e a pilha.
4. Feche o app (tire dos recentes) e espere 20 a 30 minutos com internet. Volte ao Diagnóstico: a linha do segundo plano
   deve dizer `concluída · … · app fechado` (ou "não rodou" com o motivo).
5. Carga inicial (instalação nova, ou base da demo recriada): acompanhe a carga até o Início. O app não deve sair da
   tela; a permissão de notificação, se aparecer, vem uns segundos depois do Início.
6. Mande as 3 linhas do passo 3 (e a do passo 4) no recado. Se o app fechar e o Diagnóstico não mostrar erro, a queda é
   nativa: aí é preciso o `adb logcat -b crash` ou o relatório de travamento do Android.

## Como sai o próximo build (v1.0.1)
- **`EAS_SKIP_AUTO_FINGERPRINT=1`**: no v1.0.0 o cálculo automático do fingerprint do EAS levou ~20 min por build. O
  `node scripts/eas/build.mjs` já liga a variável sozinho (`ambienteDoEas` em `scripts/eas/comum.mjs`; o `--simular`
  mostra `EAS_SKIP_AUTO_FINGERPRINT=1 eas build …`). Rodando o `eas build` à mão no PowerShell, antes:
  `$env:EAS_SKIP_AUTO_FINGERPRINT=1`.
- `scripts/eas/versao.json` já está em `1.0.1` (Campo-Demo-v1.0.1 / Gestao-Demo-v1.0.1). Antes do build: checkout limpo,
  `pnpm install --frozen-lockfile` e os bundles do Campo e do Gestão verdes; só com a autorização do dono do produto.

## O que mandar de volta
- Para cada item (A a M): ok, ou o passo que falhou, o aparelho (Campo ou Gestão) e o que apareceu.
- As linhas do Diagnóstico do item A e, se rodou, o relatório do item M.
- Eu encaminho cada falha ao dono da tela.
