# Manual do vendedor — app Macuxi Campo

Para o vendedor de campo. O app funciona sem sinal depois da primeira sincronização. Os itens marcados com "(conferir na v1.0.5)" ainda podem mudar nesta semana.

Barra de baixo: **Início · Rota · Clientes · Pedidos · Mais**. Metas e Catálogo ficam em **Mais**.

## 1. Primeira abertura
1. Instale o APK pelo link que a empresa mandou. Se já houver o app de demonstração no aparelho, o novo instala por cima.
2. Abra o app e entre (seção 2).
3. A tela **Preparando o app** baixa seus clientes, rota, produtos e preços. Deixe o app aberto até aparecer **Tudo pronto! Seus dados estão no aparelho.** Se ele fechar no meio, a carga continua de onde parou.
4. Se aparecer **Parou**, confira o sinal e toque em **Tentar de novo**.

### Permissões
O app só pede cada permissão quando precisa dela:

| Permissão | Quando o app pede | Se você negar |
|---|---|---|
| Notificações | logo depois da primeira carga | você não recebe o aviso de pedido aprovado, rejeitado ou faturado |
| Localização | no primeiro check-in | o check-in é gravado com "sem GPS neste check-in" e o supervisor vê |
| Câmera | na primeira foto | não dá para fechar visita de cliente fechado (pede foto da fachada) |

Para liberar depois: Configurações do Android → Apps → Macuxi Campo → Permissões.

## 2. Login e senha
1. Preencha **Código da empresa**, **E-mail** e **Senha** e toque em **Entrar**. O código da empresa fica salvo no aparelho.
2. **Primeiro acesso:** a senha que chegou por e-mail é temporária. Na tela **Crie sua senha**, digite a nova duas vezes e toque em **Salvar e entrar**.
3. A senha precisa ter 8 caracteres ou mais, com pelo menos uma letra, um número e um caractere especial (`! @ # $`). Não pode ser igual ao e-mail.
4. **Esqueceu a senha:** toque em **Esqueci a senha**, informe o código da empresa e o e-mail e toque em **Enviar senha temporária**. Se não chegar, olhe o spam. Ao entrar com a temporária, o app pede uma senha nova.
5. Depois do primeiro login, o app abre sem sinal.

## 3. Início
De cima para baixo:
1. **Saudação** com as visitas do dia ("6 visitas hoje · 3 feitas"). Tocar nela abre o **Perfil**.
2. **Recados** da empresa e do supervisor. Toque para ler; **Ver todos** abre a caixa completa.
3. **Meta do mês**: vendido × meta e a **Meta de hoje**, que é o que falta dividido pelos dias úteis restantes.
4. **Orçamentos** e **Pedidos a faturar**: quantidade e valor. Tocar abre Pedidos já filtrado.
5. **Sincronizar**, com a linha "Última sincronização hh:mm · N na fila".

Se aparecer **"Dados de dd/mm, hh:mm"** no lugar da última sincronização, os números estão velhos: toque em **Sincronizar** com sinal.

## 4. Rota, check-in e checkout
### Check-in
1. Abra **Rota**. A lista mostra as paradas de hoje, na ordem, e o mapa.
2. Toque em **Check-in** na parada. A ficha do cliente abre e o app grava a hora e a localização.
3. **Longe do cliente** (acima de 200 m): o app pede uma justificativa de pelo menos 3 letras ("cliente atendeu no depósito ao lado"). Toque em **Registrar check-in**. A visita fica marcada "Fora do raio · justificado".
4. **Cliente fora da rota:** abra o cliente em **Clientes** e toque em **Check-in**. Conta como visita extra.
5. Só existe **um atendimento aberto por vez**. Se esqueceu um aberto, o app oferece **Fazer checkout de {cliente}** antes do novo check-in. Pedido para outro cliente continua liberado.

### Checkout
1. Na barra **EM ATENDIMENTO**, toque em **Fazer checkout**.
2. Em **Como terminou a visita?**, escolha **Com pedido** ou **Sem pedido**. Sem pedido, escolha o motivo.
3. **Cliente fechado:** escolha **Loja fechada** ou **Acesso negado** e toque em **Tirar foto da fachada**. A foto é obrigatória e sai só da câmera. Com ela, as outras etapas da visita ficam dispensadas.
4. Se faltar alguma etapa (por exemplo, uma pesquisa obrigatória), o app mostra **Falta concluir:**. Conclua e toque em **Concluir checkout**.
5. Visita esquecida aberta fecha sozinha na virada do dia, como "não finalizada".

## 5. Ficha do cliente e fotos do PDV
Abra por **Clientes** (busca por nome, código, bairro ou CNPJ) ou pela parada da rota. Filtros rápidos: **Com título vencido**, **Sem compra 45+ dias**, **Bloqueados**.

Na ficha:
- **Ligar**, **WhatsApp** e **Mapa** num toque;
- **Contatos** e **Endereços de entrega**;
- **Financeiro**: limite, saldo em aberto, crédito disponível e títulos vencidos;
- **Compras dos últimos 12 meses**, **Sugestão de mix** e **Últimos pedidos**;
- no rodapé, **Check-in** e **Novo pedido**.

Etiqueta **Cadastro incompleto**: o cliente pode ser visitado, mas o pedido sai só como orçamento até o cadastro ser completado no ERP. As Observações dizem o que falta.

**Fotos do PDV** (fachada, gôndola, área de venda): aparecem na ficha do cliente e são tiradas na hora pela câmera, sem galeria (conferir na v1.0.5).

## 6. Catálogo
1. **Mais → Catálogo**. A tela abre pelos sistemas do ERP (sistema → grupo → linha → produtos). A trilha no topo volta a qualquer nível.
2. Para buscar, digite descrição, código, EAN ou o veículo/aplicação. **Com estoque** e a marca filtram a lista.
3. A ficha mostra **Preço para este cliente**, o **Estoque** com a hora da atualização, onde o produto serve e as equivalências.
4. Sem sinal, a busca continua com o que está no aparelho. Aparece "A busca inteligente volta quando houver internet."
5. Para incluir produto no pedido, use a busca da aba **Itens** do próprio pedido (seção 7). Assim você não sai do pedido.

## 7. Novo pedido
Abra pela ficha do cliente (**Novo pedido**) ou por **Pedidos → Novo → Para qual cliente?**. O pedido tem quatro abas: **Venda · Itens · Entrega · Resumo**. **Avançar** passa para a próxima aba.

### Venda
1. Em **Alertas**, veja se o cliente está bloqueado, tem título vencido ou estourou o crédito. Sem alerta, aparece "Cliente liberado · sem título vencido".
2. Escolha a **Forma de pagamento** e depois o **Prazo**. Só ficam liberados os prazos que o cliente pode usar.
3. **Crédito do cliente** mostra o limite, o disponível e o prazo médio, com a hora da última atualização.

### Itens
1. Busque pelo código, pela descrição ou pelo veículo e toque em **+** no produto. O item vai para **No pedido**.
2. Ajuste a quantidade e a medida (UN ou a embalagem, como "CX c/ 12"). A quantidade segue o múltiplo de venda; item repetido soma.
3. **Desconto ou acréscimo no item:** escolha **Desc %**, **Desc R$**, **Acrésc %** ou **Acrésc R$**. O valor em R$ é por unidade. O app não deixa passar do desconto máximo do produto e mostra o limite.
4. No fim da aba: **Leve mais e pague menos** (próxima faixa de preço por quantidade) e **Combina com o pedido**.

### Entrega
1. O endereço principal vem marcado. **Alterar** mostra os outros endereços do cliente. **Editar endereço deste pedido** muda o endereço só neste pedido; o cadastro não muda.
2. **Frete:** CIF (a empresa paga, padrão) ou FOB (o cliente paga). No FOB, a **Transportadora** é obrigatória: escolha da lista ou toque em **Outra** e informe nome e CNPJ.
3. **Observações**, se precisar.

### Resumo, alçada e envio
1. Confira cliente, forma e prazo, itens, entrega e totais.
2. **Desconto do pedido** (opcional) vale sobre o total dos itens.
3. A **faixa da alçada** mostra o desconto efetivo e para onde o pedido vai: "dentro da alçada" (vai direto ao ERP), "vai para o supervisor" ou "vai para o gerente". Só conta o desconto do pedido inteiro, não o de um item.
4. Se aparecer **Falta para salvar**, cada linha diz o que falta e em qual aba. A aba com pendência ganha uma bolinha.
5. Escolha:
   - **Salvar e enviar pedido**: envia (direto ao ERP ou ao supervisor);
   - **Apenas salvar**: guarda como rascunho, mesmo com pendência;
   - **Salvar como orçamento**: guarda com os preços de hoje congelados;
   - **Cancelar**: abre a pergunta **Sair do pedido?**.
6. Ao salvar, o pedido entra na fila e a tela fecha. Ele sobe sozinho quando houver sinal.

Cliente bloqueado, inativo ou com cadastro incompleto: só **Apenas salvar** e **Salvar como orçamento**.

### Orçamento
1. O orçamento não vence. A etiqueta mostra o dia do preço: **Orçamento · preço de 09/11**.
2. Por 7 dias, **Transformar em pedido** usa os preços do orçamento e confere só o estoque e o preço mínimo.
3. Depois de 7 dias, o pedido entra pelos preços de hoje. Se o total mudar, a folha **Preços de hoje** mostra item a item; toque em **Transformar com os preços de hoje** ou **Voltar**.
4. Editar o orçamento depois dos 7 dias também atualiza os preços e a data do preço.

### Rascunhos
1. Nenhuma saída perde o pedido: Voltar do Android, outra aba ou app fechado gravam um rascunho.
2. **Pedidos → Rascunhos (n)** lista cliente, total, itens e a hora da última alteração. Toque para continuar de onde parou.
3. O rascunho some 24 h depois da última alteração, a não ser que vire pedido ou orçamento.
4. Na pergunta **Sair do pedido?**, só **Descartar** apaga o pedido.

## 8. Pedidos
1. **Pedidos** abre no período **Este mês**. **Filtrar** troca o período (Hoje, Ontem, Esta semana, Mês passado, Este ano ou um dia, mês ou ano escolhido). **Limpar** volta para Este mês.
2. Situações: **Todos · Aguardando · Aprovados · Rejeitados · Orçamentos · Na fila**.
3. Período anterior a 90 dias é buscado no servidor e precisa de sinal.
4. No detalhe: cabeçalho com número e situação, itens, total, histórico em etiquetas (Salvo, Na fila, Enviado, Em aprovação, Aprovado, Rejeitado, Recebido no ERP, Faturado, Cancelado) e as ações:
   - **PDF** abre o compartilhar (WhatsApp, e-mail). O arquivo sai como `PED-0123-14112026.pdf` ou `ORC-0123-14112026.pdf`;
   - **Editar** e **Duplicar**;
   - **Cancelar pedido**, no menu ⋮, só antes de o pedido chegar ao ERP. Depois disso, o cancelamento é feito no ERP.
5. Pedido **Rejeitado** mostra o motivo do supervisor. Corrija e envie de novo.

## 9. Sincronização e uso sem sinal
- Pedido, visita, foto e pesquisa sobem sozinhos quando o sinal volta. Não precisa tocar em nada.
- **Sincronizar** (Início ou Perfil) envia a fila e baixa as novidades na hora. Puxar a lista para baixo faz o mesmo.
- O app também atualiza ao abrir, ao voltar depois de 30 min e a cada 30 min em uso.
- O número na aba (ex.: Pedidos **2**) é o que está na fila do aparelho.
- **Perfil → Fila do aparelho** mostra cada item pendente, as fotos pendentes e o botão **Enviar agora**.
- **Modo sem sinal** (Perfil) é para testes. Com ele ligado, nada sincroniza: desligue para enviar.

## 10. Quando algo dá errado
| O que aparece | O que fazer |
|---|---|
| "Código da empresa, e-mail ou senha incorretos" | Confira os três campos. Se continuar, use **Esqueci a senha**. |
| "Seu acesso está bloqueado" ou "Muitas tentativas seguidas" | Fale com o administrador da empresa. |
| "Este aparelho foi bloqueado pela sua empresa" | O aparelho foi bloqueado pelo administrador e os dados foram apagados. Fale com ele para liberar. |
| "Servidor indisponível — tente mais tarde" | O problema é no servidor, não no aparelho. Trabalhe sem sinal e tente depois. |
| Item na fila com "não enviado — corrija ou descarte" | Abra o item, leia o motivo e corrija. Só descarte se o pedido não valer mais. |
| "não enviado — módulo desativado" | A empresa desligou o módulo. Toque em **Entendi, apagar do aparelho** e avise o supervisor. |
| Pedido recusado ao enviar | A mensagem diz o motivo (desconto acima do mínimo, crédito, estoque). Corrija o que ela pede e envie de novo. |
| "Uma etapa da visita ainda não chegou ao Macuxi" | A etapa sobe sozinha quando houver sinal. Se persistir, fale com o supervisor. |
| Números do Início parados | Toque em **Sincronizar** com sinal. |
| Erro ao abrir os dados do aparelho | Toque em **Tentar de novo**. Se repetir, toque em **Enviar o detalhe ao suporte**. |

Antes de **Sair / trocar usuário**, confira a fila: o que não foi enviado se perde.

Para o suporte, informe a versão que aparece no fim do **Perfil** (ex.: `Campo-Oficial-v1.0.5`).
