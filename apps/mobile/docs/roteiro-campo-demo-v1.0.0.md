# Roteiro único de teste — Campo-Demo-v1.0.0 e Gestao-Demo-v1.0.0

> Para o Alexandre. Cobre tudo o que mudou no app desde o build do **e9a65286** (07/11, 02h). Os builds **d1e0d2a**
> (que você não testou) e os deste lote entram aqui juntos.
> Pedido: R-20261107-163525 (item 4), R-20261107-151653 (nome) e R-20261107-092152 (build único). Dono: engenheiro-apps.
> Os links dos APKs vêm no recado "BUILD PRONTO Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 (<sha>)".

## Dados da demo
- Código da empresa: **demo**. Senha de todos: **demo-macuxi** (o seed grava a senha pronta; nada a trocar).
- Usuários (todos `@exemplo.com.br`):
  - Campo: `vendedor` (Lucas), `vendedor2` (Camila), `promotor` (Joana).
  - Gestão: `supervisor` (Renata), `gerente` (Marcelo).
  - Backoffice: `admin` (Sérgio), `analista` (Paulo), `gerente` (Marcelo).
- Backoffice: https://bko-demo.macuxifdv.com.br
- Os e-mails `@exemplo.com.br` não existem, e a demo ainda não manda e-mail de verdade (não tem SMTP). Onde o roteiro
  fala de e-mail, ele diz o que você vê no lugar.

## 0. Antes de começar (nesta ordem)
1. Espere o recado "BUILD PRONTO". Ele só sai com o lote no main, o CI verde e a demo publicada.
2. **Recrie a base da demo, sim.** Entram as migrações 0039 a 0045 (senha e e-mail, perfis de acesso, cancelamento no
   ERP, XP do Treinamento e marcas concorrentes) e o seed novo. A publicação aplica as migrações, mas o seed só roda
   quando a base é recriada. A senha continua `demo-macuxi`.
   - GitHub → Actions → "demo — recriar base demo" → Run workflow → digite `RECRIAR`. Espere ficar verde.
   - Recrie **antes** do passo A. Se recriar depois de montar a fila do passo A, o servidor perde o que já foi enviado.
3. Celular com o app que você usa hoje: abra, sincronize (puxe a tela para baixo) e confira no Perfil que a fila está
   vazia. Depois **desinstale** o Macuxi Campo e o Macuxi Gestão. Isso é preciso porque os builds e9a65286 e d1e0d2a já
   usam o SQLite; instalar o antigo por cima deles não testaria a passagem.

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

## B. Login novo, troca obrigatória no 1º uso e "Esqueci a senha"
Use um usuário **novo**, para não mexer nos usuários da demo. Uma senha trocada na demo só volta recriando a base.
1. Backoffice com `admin` → Usuários → Novo usuário. Perfil **Vendedor**, um e-mail seu ou inventado, e toque em
   "Gerar senha" (ou digite uma senha com 8 caracteres ou mais, com letra, número e caractere especial). Salve.
2. Como a demo não manda e-mail, o Backoffice mostra a senha inicial com o botão "Copiar senha". Anote. Na lista, o
   usuário aparece com "Troca de senha pendente · vence em <data e hora>" (72 h).
3. No Campo, entre com esse e-mail e a senha inicial. O app vai direto para **"Crie sua senha"**. Nada mais abre antes.
4. Teste a tela:
   - repetir a senha inicial → "A senha nova precisa ser diferente da senha que você recebeu.";
   - senha fraca → a lista mostra o que falta;
   - "Repita a senha" diferente → "As senhas não conferem.";
   - modo avião → "Conecte-se à internet para criar a sua senha.".
5. Crie uma senha válida e toque em "Salvar e entrar". O app entra e mostra "Senha criada." no rodapé do Início.
6. Saia e entre de novo com a senha nova: entra direto. A senha inicial não vale mais.
7. **Esqueci a senha** (no login do Campo, logo abaixo de "Entrar"):
   - informe `demo` e o e-mail do usuário novo e toque em "Enviar senha temporária";
   - a resposta é sempre a mesma, com o e-mail existindo ou não (faça o teste também com um e-mail que não existe);
   - a demo não manda o e-mail. Confira só que a senha atual **continua valendo**: entre com ela;
   - peça várias vezes seguidas: a partir de alguns pedidos aparece "Muitos pedidos seguidos. Tente de novo em <n> minutos.".
8. **Redefinir pelo Backoffice:** com `admin`, em Usuários, use "Redefinir senha" no usuário novo. Entre no app com a
   senha mostrada: o app pede "Crie sua senha" de novo. Se ele estava logado em outro aparelho, a sessão de lá cai.
9. Repita os passos 3 a 6 no Backoffice (o login web também leva a "Crie sua senha").

## C. Perfis e multiperfil
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

## D. Catálogo: atalho, lista por linha, "Mostrar mais" e miniatura
1. Aba Catálogo, com a busca vazia e fora de um pedido: aparece o atalho **"Ver por linha"** entre a busca e a trilha.
   Ele não aparece com algo digitado na busca, nem dentro do Novo pedido.
2. Toque nele. A lista **"Por linha"** abre em sistema › grupo › linha (na demo: Freios, Filtros, Suspensão…). Desça os
   níveis, abra um produto e volte. A lista volta no mesmo ponto, rápida.
3. Repita com um cliente escolhido e depois no modo avião: tudo abre sem sinal.
4. **"Mostrar mais (N restantes)"** só aparece quando um nível tem mais de 100 itens. Na demo nenhum nível passa de 100,
   então o botão não aparece, e isso é esperado. O desempenho com 20 mil produtos está na medição do item J.
5. **Miniatura:** cada produto da lista e da busca tem um espaço fixo à esquerda para a foto. A demo não tem foto de
   produto, então o espaço fica vazio. Confira só que a lista não pula nem trava, também no modo avião.

## E. Pedidos (lista)
1. Busque por parte do número (por exemplo, `12` acha o `000012`). O trecho achado fica em destaque, legível ao sol.
2. Busca por nome do cliente destaca o nome, e não o número.
3. Com a busca, aparecem a etiqueta e o resumo do vendedor.
4. O período não aparece mais dentro dos chips "A faturar" e "Em aberto".
5. Filtro ligado: o botão diz "Remover filtro <nome>".
6. Modo avião: o aviso sem sinal aparece com o ícone de wi-fi cortado; a lista vazia sem sinal mostra o texto novo.

## F. Novo pedido
1. Monte um pedido sem forma de pagamento. As pendências aparecem **acima do "Avançar"** e, no Resumo, acima de
   "Cancelar/Salvar". Tocar numa pendência leva à aba Detalhes.
2. Confira também o que já vinha do 5a1848a9: as formas e prazos no topo, o prazo médio do cliente no cabeçalho, o
   "No pedido" abaixo da busca e o botão "+" somando certo.

## G. Gestão: pedido em nome do vendedor só com a carteira dele (RN-VEN-35)
1. No Gestão, com `supervisor`: Equipe → Lucas → "Fazer pedido em nome de Lucas".
2. Sem busca, a lista de clientes mostra **só a carteira do Lucas**.
3. Busque um cliente da Camila. Ele aparece com "Cliente da carteira de Camila Freitas" e **não pode** ser escolhido.
4. Escolha um cliente do Lucas e envie. No Backoffice, o pedido aparece como do Lucas.

## H. Gestão: aviso da etapa pendente
O aviso aparece quando uma visita da equipe foi concluída no aparelho do vendedor, mas uma etapa dela (por exemplo, a
resposta da pesquisa obrigatória) ainda não chegou ao servidor.
1. No Campo, com `vendedor`, procure na rota uma parada feita com o selo **"Etapa pendente"**. Se não houver nenhuma, peça
   ao gerente-projetos para montar o caso na demo (é o jeito mais seguro; montar no aparelho depende da ordem da fila).
2. No Gestão, com `supervisor`, sincronize e abra a ficha desse cliente. No topo, um aviso amarelo com relógio:
   "Uma etapa da visita de Lucas em <dd/mm> ainda não chegou ao Macuxi" e, embaixo, "Peça a Lucas para abrir a fila do
   aparelho e sincronizar". Não tem botão.
3. Quando a etapa chegar ao servidor e o Gestão sincronizar, o aviso some, sem mensagem de "resolvido".

> Atenção: ver a nota da conferência no fim. Se o recado "BUILD PRONTO" disser que este item ficou fora do build, pule-o.

## I. Versão no Perfil
1. No Campo: Perfil → no fim da tela, a linha diz **Campo-Demo-v1.0.0**.
2. No Gestão: **Gestao-Demo-v1.0.0**.
3. Em Configurações do Android → Apps → Macuxi Campo, a versão é 1.0.0.

## J. Medição com 20 mil produtos (opcional, só no Campo)
1. Perfil → toque 7 vezes seguidas, rápido, na linha da versão. Abre "Diagnóstico de carga".
2. "Rodar medição". Leva alguns minutos; não saia da tela. Seus dados não são tocados.
3. Os dois p95 de busca têm de ficar abaixo de 300 ms. Toque em "Copiar ou compartilhar" e cole o relatório no recado.

## O que mandar de volta
- Para cada item (A a J): ok, ou o passo que falhou, o aparelho (Campo ou Gestão) e o que apareceu.
- As linhas do Diagnóstico do item A e, se rodou, o relatório do item J.
- Eu encaminho cada falha ao dono da tela.

---

## Nota da conferência (engenheiro-apps, 08/11, para o gerente — não é passo de teste)
- **Item H:** no main (8afb7404, #106) o aviso existe em `modules/gestor/app/components/aviso-etapa-equipe.tsx`, mas
  ainda **não está montado** em tela nenhuma: o próprio arquivo diz que a ficha do cliente do Core não tem ponto de
  montagem acima das abas. Sem esse ponto (Core) e o registro (Gestor) no lote, o item H não aparece no APK.
- **Item D.5:** a demo não tem foto de produto e o Backoffice não tem envio de foto. A miniatura com foto de verdade só
  dá para ver com uma foto carregada na base (seed ou carga) e com a versão de 320 px no servidor (T-0097 b).
- **versionCode:** os builds de preview do 5a1848a9, do e9a65286 e do d1e0d2a saíram todos com versionCode 1 (`eas
  build:view`; o `autoIncrement` só valia nos perfis de produção). O contador do EAS está em 1 nos dois pacotes
  (`eas build:version:get`, 08/11). Desde a T-0109 o `autoIncrement` está no `base` do eas.json: o próximo build sai
  com **2**, maior que o do d1e0d2a, e instala por cima.
