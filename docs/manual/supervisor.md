# Manual do supervisor — app Macuxi Gestão

Para o supervisor e o gerente. Login, senha, sincronização e uso sem sinal funcionam como no app Campo: veja `vendedor.md`, seções 1, 2, 9 e 10. Os itens marcados com "(conferir na v1.0.5)" ainda podem mudar nesta semana.

Na primeira abertura, a tela **Permissões** pede só **Notificações**. Sem ela o app não entra, porque é por ela que chega o pedido para aprovar.

O Gestão é instalado à parte do Campo. O rodapé do login mostra "Macuxi Gestão · supervisores e gerentes". Supervisor e gerente não entram no Backoffice.

Barra de baixo: **Início · Equipe · Aprovações · Alertas · Mais**. Clientes, Pedidos e Catálogo ficam em **Mais** (conferir na v1.0.5). O Perfil abre ao tocar na saudação do Início.

## 1. Início
1. Saudação com a equipe e as visitas somadas do dia.
2. **Recados**.
3. **Meta do mês da equipe** com a **Meta de hoje** da equipe e quantos já bateram o mês.
4. **Pedidos para aprovar**: toque para abrir Aprovações.
5. **Equipe agora**: uma linha por pessoa, com a situação ("Em visita · Atacado Boto Rosa", "Em rota", "Sem check-in há 1h40", "Sem check-in hoje", "Rota concluída") e visitas e vendas do dia.
6. **Sincronizar**.

O Gestão não fica consultando o servidor o tempo todo. Pedido para aprovar chega por notificação. Para ver o resto atualizado, toque em **Sincronizar**.

## 2. Equipe
1. **Equipe** mostra os vendedores e promotores abaixo de você, com os totais do dia: Em visita, Em rota, Parados, Sem check-in, Vendas hoje, Visitas e Cobertura.
2. **Ranking** ordena a equipe pelo indicador e pelo período escolhidos.
3. Toque numa pessoa para abrir a ficha:
   - **Visitas**: feitas × planejadas, check-ins fora do raio e sem GPS;
   - **Vendas do dia**;
   - **Mês**: meta × realizado, positivação, ticket médio e cobertura;
   - **Trade**, para o promotor: lojas, conformidade, share e ruptura.
4. **Alertas** avisa vendedor sem check-in, cliente sem visita, cliente sem compra e desconto fora do padrão. **Dispensar** tira o alerta da lista e precisa de sinal.

## 3. Aprovações
O pedido vem para você quando o desconto efetivo passa da alçada do vendedor (5%) e fica dentro da sua (10% para o supervisor, 15% para o gerente). Acima disso, vai para o analista.

1. Abra **Aprovações** (ou o cartão **Pedidos para aprovar** no Início).
2. Toque em **Decidir**. O detalhe mostra o cliente, o crédito, os itens, o desconto de cada item e o desconto efetivo.
3. **Aprovar**: um toque, sem comentário.
4. **Rejeitar**: abre **Rejeitar pedido**. O **motivo é obrigatório** (pelo menos 3 letras) e aparece para o vendedor no app.
5. Aprovar e rejeitar precisam de sinal.
6. O prazo para decidir é de 1 dia útil. Depois disso, o pedido vira alerta de aprovação parada.

O gerente também vê e pode decidir os pedidos do nível do supervisor. O supervisor é avisado.

## 4. Pedido em nome do vendedor
1. **Equipe** → toque no vendedor → **Fazer pedido em nome**.
2. Em **Para qual cliente?**, a lista mostra só os **Clientes da carteira de {vendedor}**.
3. Cliente de outra carteira aparece desligado, com "Cliente da carteira de {nome}". Para vender a ele, transfira o cliente antes, no Backoffice.
4. O pedido segue as mesmas abas do Campo (**Venda · Itens · Entrega · Resumo**): veja `vendedor.md`, seção 7.
5. A alçada usada é a sua. Dentro dela, o pedido vai direto ao ERP; acima, o app pergunta se quer enviar para aprovação.
6. O pedido conta na meta do vendedor e fica registrado com você como autor. O vendedor recebe uma notificação.
7. Rascunhos do pedido em nome ficam em **Pedidos → Rascunhos (n)** do Gestão.

## 5. Pedidos e clientes da equipe
- **Pedidos** mostra os pedidos da equipe, com o filtro **Vendedor** e a situação **Para aprovar**. O período funciona como no Campo. O detalhe traz a **Filial** do pedido.
- Você pode cancelar pedido da equipe antes de ele chegar ao ERP (menu ⋮ do detalhe).
- **Clientes** mostra a carteira da equipe inteira, com a mesma ficha do Campo.
