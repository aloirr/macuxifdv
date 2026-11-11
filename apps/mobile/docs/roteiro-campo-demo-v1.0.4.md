# Roteiro de teste — Campo-Demo-v1.0.4 e Gestao-Demo-v1.0.4

> Para o Alexandre. Cobre só o que mudou desde o **Campo-Demo-v1.0.3 / Gestao-Demo-v1.0.3** (commit do lote: 92de23ca).
> Dono: engenheiro-apps. Os links dos APKs vêm no recado "BUILD PRONTO Campo-Demo-v1.0.4 / Gestao-Demo-v1.0.4".
> O roteiro do v1.0.3 continua valendo para o que não mudou (dados da demo, usuários e clientes estão lá).

## 0. Antes de começar
1. **Não desinstale** o v1.0.3. O v1.0.4 instala **por cima** dele.
2. Espere o aviso do gerente-projetos de que a API da demo foi publicada com a v1.0.4 (os itens B e E dependem dela).

## A. PDF do pedido, v3 horizontal (T-0159, Campo)
Compare com as imagens geradas pelo código:
`docs/design/telas/T-0159-pdf-v104-codigo-cliente.png` e `docs/design/telas/T-0159-pdf-v104-codigo-escritorio.png`.
1. **Gere os PDFs.** De um pedido enviado **com alerta**, gere o PDF **do cliente** e o **do escritório**. De um
   orçamento, gere os mesmos dois.
2. **Horizontal.** A página sai deitada, com o **logo** e o **cabeçalho verde**.
3. **Itens.** A primeira coluna é **Item** (1, 2, 3…), e as linhas vêm **em ordem de código**.
4. **Observações.** "Observação do pedido" e "Observação da entrega" ficam **abaixo dos itens**, à esquerda do Total,
   e aparecem **sempre**, mesmo vazias.
5. **Fichas.** As fichas do cabeçalho têm o **fundo cinza**.
6. **Total.** O **Total** fica numa caixa própria, no fim.
7. **Sem Alertas.** **Nenhum** dos 4 PDFs traz Alertas, nem o do escritório.

## B. Reserva por filial recusada também no servidor (T-0149, RN-VEN-20, Campo)
Na v1.0.3 só o aparelho conferia o saldo da filial. Agora a API também recusa.
1. Padaria Trigo Fino (Boa Vista) › Novo pedido › Itens: anote o **"Estoque n"** de um produto com estoque.
2. Acima de n, o aparelho deixa sair **só como orçamento** (como na v1.0.3).
3. **Dois aparelhos, mesmo vendedor.** No modo avião, faça em cada um um pedido de n unidades. Saia do modo avião e
   sincronize os dois: o primeiro passa; o segundo volta **recusado** com
   "Sem estoque na filial para um dos itens. Envie como orçamento ou reduza a quantidade."
4. **Orçamento nunca é recusado** por estoque. Envie o mesmo como orçamento: ele passa.
5. O **CAF-500** na Boa Vista (estoque 0) nunca usa o saldo de Manaus.

## C. Diagnóstico: textos (T-0158, Campo e Gestão)
Perfil › Diagnóstico › **Enviar diagnóstico** (só aparece com o envio ligado no servidor).
1. **Modo avião.** Envie: a linha fica **Na fila**, com "Sem sinal. Não precisa enviar de novo."
2. **Servidor fora do ar, com sinal:** a linha fica **Na fila**, com
   "Servidor indisponível. Não precisa enviar de novo." Em Últimos envios, o motivo diz **servidor indisponível**.
3. Com sinal e servidor no ar, a fila esvazia sozinha e a linha passa a **Enviado**, com o número.

## D. Motivos de saída do Android numa tabela só (RD-0124, Campo)
Perfil › Diagnóstico › **"Saídas do app (Android)"**: os textos dos motivos são os mesmos que o suporte vê no
Portal › Diagnósticos (Backoffice, super-admin). Confira uma linha nos dois lugares: o texto é igual.

## E. API sem travar (T-0119 e T-0118)
1. **20 mil produtos (T-0119).** Com a base grande, a busca do catálogo no Novo pedido responde sem travar e a
   carga inicial termina.
2. **Pool cheio (T-0118).** Com o servidor sobrecarregado, o envio não fica preso: em até **10 s** a API responde
   **503** (servidor ocupado), o app mantém o pedido na fila e o reenvia depois, sem duplicar.

## F. Versão no Perfil
1. Campo: no fim do Perfil, **Campo-Demo-v1.0.4**. Gestão: **Gestao-Demo-v1.0.4**.
2. Configurações do Android › Apps: versão **1.0.4**. Ela instala por cima do v1.0.3.

## O que mandar de volta
- Para cada item (A a F): ok, ou o passo que falhou, o aparelho (Campo ou Gestão, versão do Android) e o que apareceu.
