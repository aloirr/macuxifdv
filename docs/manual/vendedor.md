# Manual do vendedor — app Macuxi Campo

Para o vendedor de campo. Os itens marcados com "(conferir na v1.0.5)" ainda podem mudar nesta semana.

Barra de baixo: **Início · Rota · Clientes · Pedidos · Mais**. Metas e Catálogo ficam em **Mais**.

## 1. Primeira abertura e permissões
1. Instale o APK pelo link que a empresa mandou. Se o aparelho já tiver o app de demonstração, o novo instala por cima.
2. Abra o app. A tela **Permissões** vem antes de tudo. Sem as quatro, o app não faz login nem sincroniza:

| Permissão | Para quê |
|---|---|
| Notificações | aviso de pedido aprovado, rejeitado ou faturado e recados |
| Localização o tempo todo | check-in e trajeto no horário de trabalho |
| Câmera | fotos do PDV e foto da fachada |
| Fotos e galeria | anexar documento já fotografado |

3. Toque em **Permitir**. O app pede uma permissão de cada vez.
4. **Localização:** no diálogo do Android, escolha **Durante o uso do app**. Depois toque em **Abrir configurações**, entre em **Permissões › Localização**, marque **Permitir o tempo todo** e volte ao app.
5. Linha **Negada**: o Android parou de perguntar. Toque em **Abrir configurações** e libere por lá.

Se você retirar uma permissão depois, o app volta para a tela Permissões na próxima abertura.

## 2. Login e senha
1. Preencha **Código da empresa**, **E-mail** e **Senha** e toque em **Entrar**. O código da empresa fica salvo no aparelho.
2. **Primeiro acesso:** a senha que chegou por e-mail é temporária e vale 72 h. Na tela **Crie sua senha**, digite a nova duas vezes e toque em **Salvar e entrar**.
3. A senha precisa ter 8 caracteres ou mais, com pelo menos uma letra, um número e um caractere especial (`! @ # $`). Não pode ser igual ao e-mail.
4. **Esqueceu a senha:** toque em **Esqueci a senha**, informe o código da empresa e o e-mail e toque em **Enviar senha temporária**. Se não chegar, olhe o spam. Ao entrar com a temporária, o app pede uma senha nova.
5. Depois do primeiro login, o app baixa clientes, rota, produtos e preços. Deixe-o aberto até aparecer **Tudo pronto! Seus dados estão no aparelho.** Se ele fechar no meio, a carga continua de onde parou. Se aparecer **Parou**, confira o sinal e toque em **Tentar de novo** (conferir na v1.0.5).

## 3. Início
De cima para baixo:
1. **Saudação** com as visitas do dia ("6 visitas hoje · 3 feitas"). Tocar nela abre o **Perfil**.
2. **Recados** da empresa e do supervisor. Toque para ler; **Ver todos** abre a caixa completa.
3. **Meta do mês**: vendido × meta e a **Meta de hoje**, que é o que falta dividido pelos dias úteis restantes.
4. **Orçamentos** e **A faturar**: quantidade e valor. Tocar abre Pedidos já filtrado.
5. **Sincronizar**, com a linha "Última sincronização hh:mm · N na fila".

Se a linha mostrar uma data, como **Dados de 06/11, 6h28**, os números estão velhos: toque em **Sincronizar** com sinal.

## 4. Rota, check-in e checkout
### Check-in
1. Abra **Rota**. A lista mostra as paradas de hoje, na ordem, e o mapa.
2. Toque em **Check-in** na parada. A ficha do cliente abre e o app grava a hora e a localização.
3. **Longe do cliente** (acima de 200 m): o app pede uma justificativa de pelo menos 3 letras ("cliente atendeu no depósito ao lado"). Toque em **Registrar check-in**. A visita fica marcada "Fora do raio · justificado".
4. **Cliente fora da rota:** abra o cliente em **Clientes** e toque em **Check-in**. Conta como visita extra.
5. Só existe **um atendimento aberto por vez**. Se ficou um aberto, o app oferece **Fazer checkout de {cliente}** antes do novo check-in. Pedido para outro cliente continua liberado.

### Checkout
1. Na barra **EM ATENDIMENTO**, toque em **Fazer checkout**.
2. Em **Como terminou a visita?**, escolha **Com pedido** ou **Sem pedido**. Sem pedido, escolha o motivo.
3. **Cliente fechado:** escolha **Loja fechada** ou **Acesso negado** e toque em **Tirar foto da fachada**. A foto é obrigatória e sai só da câmera. Com ela, as outras etapas da visita ficam dispensadas.
4. Toque em **Concluir checkout**. Se faltar etapa (ex.: pesquisa obrigatória), o app mostra **Falta concluir:** e o botão só libera depois que ela for concluída.
5. Visita esquecida aberta fecha sozinha na virada do dia, como "não finalizada".

## 5. Ficha do cliente e fotos do PDV
Abra por **Clientes** (busca por nome, código, bairro ou CNPJ) ou pela parada da rota. Filtros rápidos: **Com título vencido**, **Sem compra 45+ dias**, **Bloqueados**.

Na ficha:
- **Ligar**, **WhatsApp**, **Mapa** e **Foto do PDV** num toque. Foto do PDV abre a fachada em tela cheia e fica desligada quando o cliente não tem fachada;
- no topo, média de compra por mês, última compra, ticket e frequência;
- **Financeiro**: limite disponível e títulos vencidos;
- **Contatos**, **Endereços de entrega**, **Sugestão de mix** e **Últimos pedidos**;
- no rodapé, **Check-in** e **Novo pedido**.

Etiqueta **Cadastro incompleto**: o cliente pode ser visitado normalmente, mas o pedido sai só como orçamento (seção 7, Alertas). As Observações dizem o que falta no cadastro do ERP.

### Fotos do PDV
O bloco **Fotos do PDV** lista os tipos que a empresa pede (Fachada, CNH do sócio, Contrato social…), cada um com **Tem**, **Falta**, **Opcional** ou **Na fila**.
1. Toque em **Adicionar** no tipo que falta.
2. Escolha **Tirar foto** ou **Escolher da galeria**.
3. A linha passa a **Na fila** e sobe sozinha quando houver sinal. Depois fica **Tem**.
4. Você abre só a fachada. Os outros tipos com foto aparecem com cadeado: o documento fica guardado para o escritório.

## 6. Catálogo
1. **Mais → Catálogo**. A tela abre pelos sistemas do ERP (sistema → grupo → linha → produtos). A trilha no topo volta a qualquer nível.
2. Para buscar, digite descrição, código, EAN ou o veículo/aplicação. **Com estoque** e a marca filtram a lista.
3. A ficha mostra **Preço para este cliente**, o **Estoque** com a hora da atualização, onde o produto serve e as equivalências.
4. Sem sinal, a busca continua com o que está no aparelho. Aparece "A busca inteligente volta quando houver internet."
5. Para incluir produto no pedido, use a busca da aba **Itens** do próprio pedido (seção 7). Assim você não sai do pedido.

Preço e estoque saem da **filial** do cliente. O mesmo produto pode ter preço e estoque diferentes em clientes de filiais diferentes.

## 7. Novo pedido
Abra pela ficha do cliente (**Novo pedido**) ou por **Pedidos → Novo → Para qual cliente?**. O pedido tem quatro abas: **Venda · Itens · Entrega · Resumo**. **Avançar** passa para a próxima aba.

### Alertas
Quando há problema no pedido, o título vermelho **ALERTAS** aparece no topo de todas as abas, uma linha por problema. Toque na linha para ir ao item ou à aba. Sem problema, a área não aparece.

| Alerta | O que acontece |
|---|---|
| Dado faltando (ex.: "Falta a transportadora · aba Entrega") | **Salvar e enviar pedido** fica desligado até corrigir; **Apenas salvar** continua |
| Cliente bloqueado, inativo ou com cadastro incompleto | o pedido só sai como orçamento: o botão principal vira **Salvar como orçamento**, com **Apenas salvar** ao lado |
| Item acima do desconto máximo; item sem estoque na filial | o mesmo: só como orçamento |
| Título vencido | só à vista ou com aprovação |
| Crédito estourado | o pedido segue para aprovação (padrão da empresa) |

### Venda
1. Escolha a **Forma de pagamento** e depois o **Prazo**. Só ficam liberados os prazos que o cliente pode usar.
2. **Crédito do cliente** mostra o limite, o disponível e o prazo médio, com a hora da última atualização.

### Itens
1. Busque pelo código, pela descrição ou pelo veículo. Cada resultado mostra o **Estoque** da filial do cliente. O ícone de câmera abre a foto do produto.
2. Toque em **Adicionar**. Na folha que sobe, escolha a **Embalagem** (UN ou a do cadastro, como "CX c/ 12"), a **Quantidade** e o **Desc./Acrésc.** (% ou R$ por unidade). Confirme em **Adicionar ao pedido**.
3. Os itens ficam em **No pedido**, acima da busca. Com mais de 3, toque em **Ver itens**. Tocar num item reabre a folha com **Salvar item** e **Remover do pedido**.
4. Desconto acima do máximo (o campo fica vermelho) ou item sem estoque na filial: o item entra e aparece nos **Alertas**.
5. No fim da aba: **Leve mais e pague menos** (próxima faixa de preço por quantidade) e **Combina com o pedido**.

### Entrega
1. O endereço principal vem marcado. **Alterar** mostra os outros endereços do cliente. **Editar endereço deste pedido** muda o endereço só neste pedido; o cadastro não muda.
2. **Frete:** CIF (a empresa paga, padrão) ou FOB (o cliente paga). No FOB, a **Transportadora** é obrigatória: escolha da lista ou toque em **Outra** e informe nome e CNPJ.
3. **Observações**, se precisar.

### Resumo e envio
1. Confira as tabelas: Cliente, Venda, Itens (Produto · Qtd · Preço unit. · Desc./Acrésc. · Total), Entrega, Observações e Totais (Tabela, desconto ou acréscimo e Total).
2. **Desconto do pedido** (opcional) vale sobre o total dos itens.
3. Escolha:
   - **Salvar e enviar pedido**: envia ao ERP;
   - **Apenas salvar**: guarda como rascunho;
   - **Salvar como orçamento**: guarda com os preços congelados;
   - **Cancelar**: abre a pergunta **Sair do pedido?**.
4. **Desconto acima da sua alçada:** ao tocar em **Salvar e enviar pedido**, o app pergunta **"Desconto acima da sua alçada. Enviar para aprovação?"**. **Enviar para aprovação** manda ao supervisor; **Voltar** deixa ajustar. A alçada olha o desconto total sobre a tabela (itens e Desconto do pedido), nunca o de um item.
5. Ao salvar, o pedido entra na fila e a tela fecha. Ele sobe sozinho quando houver sinal.

### Orçamento
1. O orçamento não vence. A etiqueta mostra o dia do preço: **Orçamento · preço de 09/11**.
2. Por 7 dias (padrão da empresa), **Transformar em pedido** usa os preços do orçamento e confere só o estoque e o preço mínimo.
3. Depois desse prazo, o pedido entra pelos preços de hoje. Se o total mudar, a folha **Preços de hoje** mostra item a item; toque em **Transformar com os preços de hoje** ou **Voltar**.
4. Orçamento com alerta abre com **Editar** como botão principal: corrija o alerta antes de transformar.

### Rascunhos
1. Nenhuma saída perde o pedido: Voltar do Android, outra aba ou app fechado gravam um rascunho.
2. **Pedidos → Rascunhos (n)** lista cliente, total, itens e a hora da última alteração. Toque para continuar de onde parou.
3. O rascunho some 24 h depois da última alteração, a não ser que vire pedido ou orçamento.
4. Na pergunta **Sair do pedido?**, só **Descartar** apaga o pedido.

## 8. Pedidos
1. **Pedidos** abre no período **Este mês**, com o **Total R$** do período. **Filtrar** troca o período (Hoje, Ontem, Esta semana, Mês passado, Este ano ou um dia, mês ou ano escolhido). **Limpar** volta para Este mês.
2. Situações: **Todos · Aguardando · Aprovados · Rejeitados · Orçamentos · Na fila**.
3. O selo do cabeçalho diz o estado da lista: **↻ hh:mm** (última atualização), **Atualizando…**, **Sem sinal** ou **Sem resposta**.
4. Período anterior a 90 dias é buscado no servidor e precisa de sinal.
5. No detalhe: número e cliente, Alertas (se houver), Pagamento, Entrega e **Filial**, itens, totais e o **Histórico**, cuja última etapa é a situação atual (Enviado, Em aprovação, Aprovado, Rejeitado, Recebido no ERP, Faturado, Cancelado). As ações são:
   - **PDF** → **Para o cliente** (ou **Para o escritório**) → WhatsApp ou e-mail. O arquivo sai como `PED-0123-14112026.pdf` ou `ORC-0123-14112026.pdf`;
   - **Editar** e **Duplicar**;
   - **Corrigir pedido**, no rejeitado: mantém os preços salvos; só item novo entra pelo preço do dia;
   - **Cancelar pedido**, no menu ⋮, só antes de o pedido chegar ao ERP. Depois disso, o cancelamento é feito no ERP.
6. Pedido **Rejeitado** mostra o motivo do supervisor.

## 9. Sincronização e uso sem sinal
- Depois do primeiro login, o app funciona sem sinal.
- Pedido, visita, foto e pesquisa sobem sozinhos quando o sinal volta.
- **Sincronizar** (Início ou Perfil) envia a fila e baixa as novidades na hora. Puxar a lista para baixo faz o mesmo.
- O app também atualiza ao abrir, ao voltar depois de 30 min e a cada 30 min em uso.
- **Perfil → Fila do aparelho** mostra cada item pendente, as fotos pendentes e o botão **Enviar agora**.
- **Modo sem sinal** (Perfil) é para testes. Com ele ligado, nada sincroniza: desligue para enviar.

## 10. Quando algo dá errado
| O que aparece | O que fazer |
|---|---|
| Tela **Permissões** não sai | Uma permissão está em Falta ou Negada. Toque em **Abrir configurações** e libere. |
| "Código da empresa, e-mail ou senha incorretos" | Confira os três campos. Se continuar, use **Esqueci a senha**. |
| Senha temporária vencida (mais de 72 h) | Use **Esqueci a senha** para receber outra. |
| "Seu acesso está bloqueado" ou "Muitas tentativas seguidas" | Fale com o administrador da empresa. |
| "Este aparelho foi bloqueado pela sua empresa" | O administrador bloqueou o aparelho e os dados foram apagados. Fale com ele para liberar. |
| "Servidor indisponível — tente mais tarde" | O problema é no servidor, não no aparelho. Trabalhe sem sinal e tente depois. |
| Pedido volta com "Sem estoque na filial para um dos itens" | Outro pedido levou o saldo antes. Reduza a quantidade ou salve como orçamento. |
| Pedido recusado com outro motivo | A mensagem diz o que corrigir (desconto, crédito, cadastro). Corrija e envie de novo. |
| Item na fila com "não enviado — corrija ou descarte" | Abra o item, leia o motivo e corrija. Só descarte se o pedido não valer mais. |
| "não enviado — módulo desativado" | A empresa desligou o módulo. Toque em **Entendi, apagar do aparelho** e avise o supervisor. |
| "Uma etapa da visita ainda não chegou ao Macuxi" | A etapa sobe sozinha quando houver sinal. Se persistir, fale com o supervisor. |
| App fechou sozinho | Abra de novo: nada se perde. Se repetir, toque em **Perfil → Diagnóstico → Enviar diagnóstico**. Sem esse botão, mande ao suporte um print do Diagnóstico. |

Antes de **Sair / trocar usuário**, confira a fila: o que não foi enviado se perde.

Para o suporte, informe a versão que aparece no fim do **Perfil** (ex.: `Campo-Oficial-v1.0.5`).
