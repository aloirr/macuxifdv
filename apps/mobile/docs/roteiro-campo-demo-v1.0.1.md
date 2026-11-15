# Roteiro de teste — Campo-Demo-v1.0.1 e Gestao-Demo-v1.0.1 (338e9976)

> **Histórico.** A demo foi desligada (ADR 0051) e os perfis de preview saíram do `eas.json`: este roteiro não se aplica
> mais a builds novos. Os endereços `*-demo.macuxifdv.com.br` citados aqui não existem mais.

> Para o Alexandre. Cobre o que mudou desde o **Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0** (714d0d1b, 08/11): o lote 02
> inteiro, commit **338e9976** do main (mesma árvore do retrato bc7c574, CI e stack verdes nos runs 42587137650 e
> 42587150490). Pedido: R-20261108-220117 (build às 4h30). Dono: engenheiro-apps. Os links dos APKs vêm no recado
> "BUILD PRONTO Campo-Demo-v1.0.1 / Gestao-Demo-v1.0.1 (338e9976)".
> O roteiro do v1.0.0 (`roteiro-campo-demo-v1.0.0.md`) continua valendo para o que não mudou.

## 0. Antes de começar (nesta ordem)
1. **Base da demo:** o gerente-projetos recria a base (GitHub → Actions → "demo — recriar base demo", `RECRIAR`) e
   **depois recarrega as fotos de produto**. Recriar a base apaga as fotos. Espere o aviso dele antes de testar.
   - A senha de todos continua `demo-macuxi`. O seed novo traz o recado do Início com link para a Rota (`/m/rota`).
2. **Não desinstale** o v1.0.0. O v1.0.1 (versionCode 3) instala **por cima** dele (versionCode 2), e o primeiro teste
   é justamente a atualização por cima.

## Dados da demo
- Código da empresa: **demo**. Senha de todos: **demo-macuxi**.
- Campo: `vendedor` (Lucas), `vendedor2` (Camila), `promotor` (Joana). Gestão: `supervisor` (Renata), `gerente`
  (Marcelo). Backoffice: `admin` (Sérgio), `analista` (Paulo), `gerente` (Marcelo). Todos `@exemplo.com.br`.
- Backoffice: https://bko-demo.macuxifdv.com.br

## A. T-0140: os 10 passos de aparelho (Campo, `vendedor`)
Fonte: `docs/testes/T-0140.md`, seção "Só o aparelho prova".
1. **Atualização (relatos 1 e 6).** Com sessão aberta no v1.0.0, instale o v1.0.1 por cima e **não abra** por 1 ou
   2 minutos (com internet). Abra: o app abre **uma vez** e fica aberto, sem "travando com frequência". Se fechar, abra de
   novo, vá a Perfil › Diagnóstico e copie a linha "Último erro do app" (data, "o app fechou", rota, mensagem). Sem essa
   linha, a queda é nativa: mande o `adb logcat -b crash` ou o relatório do Android.
2. **Carga inicial.** Login com sinal: a carga termina sem fechar o app e o Início mostra a Meta do mês. A permissão de
   notificação, se aparecer, vem uns segundos depois do Início.
3. **Novo pedido pela ficha.** Clientes › um cliente › Novo pedido. Aparece "Carregando" rápido e o editor abre na aba
   Venda. Nunca "Cliente não encontrado" piscando, nunca o app fechando. Repita em 3 clientes, com o app recém-aberto.
4. **Novo pedido pela Rota.** Rota › cliente › check-in › na folha "Check-in feito", Novo pedido. O editor abre com o
   cliente e o pedido fica ligado à visita.
5. **Novo pedido pelo Catálogo.** Catálogo › produto › Adicionar ao pedido. Sem pedido aberto, abre o seletor de
   cliente e, ao escolher, o editor com o produto. De dentro de um pedido (Itens › Catálogo), volta ao mesmo pedido com o
   item.
6. **Recado do Início.** Toque no recado da demo ("Visite…"): abre a Rota. No Gestão (`supervisor`), o mesmo recado abre
   a central de notificações, e não a tela "não disponível para o seu perfil".
7. **Faixa EM ATENDIMENTO.** Faça check-in no cliente A. Na ficha de A **não** aparece a faixa escura (o rodapé mostra o
   Checkout); na ficha de B a faixa aparece com A; no Início e na Rota a faixa aparece.
8. **PDF.** Pedido › PDF › escolha a via. (a) Espere: abre o compartilhar. (b) Toque e feche a folha antes de terminar:
   "Gerando…" some na hora e o compartilhar **não** abre depois. (c) Toque de novo: gera normal, sem ficar "gerando" para
   sempre. (d) Saia da tela durante a geração: nada abre depois.
9. **Tela de erro e Perfil › Diagnóstico.** No Diagnóstico, "Último erro do app" mostra "Nenhum erro registrado" ou o
   último erro, **sem** e-mail, CPF ou telefone. Se aparecer a tela "Esta tela teve um problema": "Tentar de novo" e
   "Ir para o Início" funcionam, e "Enviar o detalhe ao suporte" abre o compartilhar com "Macuxi Campo 1.0.1 · …".
10. **Checkout recusado (relato 5).** Com sinal, faça o checkout de uma visita que o servidor recusa (por exemplo, com a
    etapa obrigatória pendente). A folha fecha com "Checkout feito" e em seguida o aviso laranja "O checkout não foi
    concluído. <motivo>" fica **cerca de 10 s**; a visita volta aberta; depois de corrigir, o checkout passa na 1ª
    tentativa.

Ainda no Diagnóstico ("Informações técnicas"), anote: `Build instalado: 1.0.1+3`, a linha `Última sincronização em
segundo plano` (logo depois da atualização: `não rodou: app atualizado, espera a 1ª abertura`, ou nenhuma linha) e, depois
de 20 a 30 min com o app fechado e com internet, `concluída · … · app fechado`.

## B. Frente M do pedido (Campo, Gestão e Backoffice)
1. **Detalhe com histórico em tags:** abra um pedido e um orçamento. O histórico aparece em etiquetas (criado, enviado,
   faturado, cancelado…), na mesma ordem no Campo, no Gestão e no Backoffice. As ações ficam no rodapé; Cancelar fica no ⋮.
2. **"Equivale a" no PDF:** gere o PDF de um pedido com produto que tem referência cruzada de concorrente. Na via
   interna, o item traz "Equivale a: <marca> <código>". Na via do cliente, só quando o parâmetro "referência no
   orçamento" do Vendedor estiver ligado.
3. **Cancelar pedido integrado:** o ⋮ › Cancelar de um pedido que já foi ao ERP só aparece quando o conector aceita
   cancelamento (Backoffice › Integração › Conectores, "· aceita cancelamento"). Na demo não há ERP de verdade: confira
   que o pedido mostra o cancelamento no histórico e que, se o ERP recusar, ele aparece em Integração › Pedidos com a
   etiqueta "Cancelamento recusado".
4. **Linha Salvo:** pedido guardado com "Apenas salvar" aparece na lista com a tag "Salvo" e o total.

## C. Início e indicadores
1. **"por dia útil":** em dia **não útil**, o cartão "META DO MÊS" termina em "Faltam R$ … · R$ … por dia útil (n dias)";
   em dia útil, "Meta de hoje R$ X". O Gestão mostra "Meta do mês da equipe" com a mesma estrutura.
2. **Aviso único de dado antigo:** com dados velhos (modo avião por um tempo), o aviso aparece **uma vez**, logo acima do
   Sincronizar, junto com a quantidade na fila. Não se repete em outro lugar da tela. O Promotor não tem esse aviso.
3. **Ficha do Gestor igual ao Início:** no Gestão, abra a ficha de um vendedor. Realizado, faltam e "por dia útil" são os
   mesmos números do Início desse vendedor (mesmo calendário e mesma necessidade diária, arredondada para cima).
4. **Pedidos a faturar:** o cartão e a lista usam o nome "Pedidos a faturar" em todos os lugares.

## D. Catálogo
1. **Miniatura de 320 px do servidor:** depois da recarga das fotos (item 0.1), a lista e a busca carregam a miniatura
   pequena (mais rápida no 4G). Ao abrir o produto, a ficha mostra a foto original. Modo avião: as já vistas continuam.

## E. Backoffice (`admin`)
1. **Carga por arquivo:** Integração › **Carga por arquivo**. Baixe o modelo (CSV), preencha poucas linhas no Excel e envie. Os erros
   aparecem linha a linha em Integração ERP. A carga
   aparece com as partes e o resultado; enviar o mesmo arquivo de novo não duplica (chave de idempotência).
2. **De-para da condição de pagamento:** Integração ERP › painel "De-para de códigos": ligue a condição de pagamento
   do Macuxi ao código do ERP e salve ("De-para salvo."). Pedido retido por falta de de-para segue para o ERP e a
   mensagem diz quantos.
3. **De-para do canal:** no mesmo painel, o tipo **"Canal do cliente"**. O canal que vem do ERP passa a ser gravado
   traduzido no cliente.
4. **Canal no público da Pesquisa:** no construtor do público-alvo da Pesquisa, escreva o canal. No app, a pesquisa só
   aparece para os clientes daquele canal, também no modo avião.

## F. Versão no Perfil
1. Campo: Perfil → no fim da tela, **Campo-Demo-v1.0.1**. Gestão: **Gestao-Demo-v1.0.1**.
2. Configurações do Android → Apps → versão **1.0.1**. Instala por cima do v1.0.0 (versionCode 2 → 3).

## Não entrou no v1.0.1 (fica para depois)
- Repetições restantes da auditoria do corretor-redundancias (RD-0016, RD-0019 reabertos, RD-0032, RD-0033, RD-0040).
- **T-0117** (sessão do BKO por cookie no Next): desenho pronto, implementação na próxima rodada.
- **T-0098** (download do Conector): o botão no portal fica atrás de campo opcional; falta a rota da Integração com link
  assinado.
- **zod 4**: a migração não entrou.
- **Devolução de pedido**: a tabela existe (0050), mas a função está desligada no app e no Backoffice.

## O que mandar de volta
- Para cada item (A a F): ok, ou o passo que falhou, o aparelho (Campo ou Gestão) e o que apareceu.
- As linhas do Diagnóstico do item A. Eu encaminho cada falha ao dono da tela.
