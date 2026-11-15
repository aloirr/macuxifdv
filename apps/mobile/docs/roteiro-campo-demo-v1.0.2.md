# Roteiro de teste — Campo-Demo-v1.0.2 e Gestao-Demo-v1.0.2 (7c9dafe8)

> **Histórico.** A demo foi desligada (ADR 0051) e os perfis de preview saíram do `eas.json`: este roteiro não se aplica
> mais a builds novos. Os endereços `*-demo.macuxifdv.com.br` citados aqui não existem mais.

> Para o Alexandre. Cobre o que mudou desde o **Campo-Demo-v1.0.1 / Gestao-Demo-v1.0.1** (338e9976): o pedido v3
> (T-0141), o Catálogo pelos sistemas (T-0142), o lote 03 (T-0140) e o login do Backoffice por cookie (T-0117), commit
> **7c9dafe8** do main. Dono: engenheiro-apps. Os links dos APKs vêm no recado "BUILD PRONTO Campo-Demo-v1.0.2 /
> Gestao-Demo-v1.0.2".
> Os roteiros do v1.0.0 e do v1.0.1 continuam valendo para o que não mudou.

## 0. Antes de começar (nesta ordem)
1. **Base da demo:** espere o aviso do gerente-projetos de que a base foi recriada e as fotos de produto recarregadas.
2. **Não desinstale** o v1.0.1. O v1.0.2 instala **por cima** dele (o versionCode sobe pela EAS).

## Dados da demo
- Código da empresa: **demo**. Senha de todos: **demo-macuxi**.
- Campo: `vendedor@exemplo.com.br`. Gestão: `supervisor@exemplo.com.br`. Backoffice: `analista@exemplo.com.br`.
- Backoffice: https://bko-demo.macuxifdv.com.br

## A. Pedido v3 (T-0141, Campo, `vendedor`)
1. **Crédito em tabela.** Clientes › um cliente › Novo pedido. Na aba Venda, o bloco "Crédito do cliente" aparece numa tabela (Limite,
   Disponível, Prazo médio), e não em frases soltas.
2. **Entrega sem as frases do frete.** Aba Entrega: o frete aparece sem as frases de explicação.
3. **Endereço deste pedido.** Na aba Entrega, toque em **Alterar** › **Editar endereço deste pedido**. Faça em modo
   avião: o formulário abre e salva sem sinal. Tente salvar sem Cidade ou sem UF: não deixa. Salve com as duas, envie o
   pedido e, com sinal, abra o detalhe: o endereço traz o selo **"Editado neste pedido"**. Gere o PDF: o selo aparece
   também. O cadastro do cliente **não** muda.
4. **Aba Itens sem Catálogo.** A aba Itens não tem mais o botão Catálogo; o produto entra pela busca da própria aba.
5. **Nenhuma saída perde o pedido.** Comece um pedido com 1 item e saia por cada caminho: Voltar do Android, seta do
   topo, outra aba de baixo, fechar o app. Em Pedidos, aparece no topo **"Rascunhos (n)"**; toque: o pedido abre na aba
   em que você parou. Um rascunho sem mexer some depois de **24 h**.
6. **Orçamento com "preço de dd/mm".** Salve um orçamento: ele mostra a etiqueta **"preço de dd/mm"** (o dia do preço).
   Um orçamento com mais de 7 dias e preço diferente, ao reabrir ou transformar em pedido, mostra a folha **"Preços de
   hoje"** com os itens que mudaram. O orçamento não expira mais.
7. **Motivo da recusa.** Envie um pedido que o servidor recusa (por exemplo, desconto acima do permitido): o aviso traz o
   **motivo dado pelo servidor**, e não uma mensagem genérica.
8. **Nome do PDF.** Gere o PDF de um orçamento e de um pedido. No compartilhar, o arquivo se chama
   `ORC-XXXX-DDMMAAAA.pdf` ou `PED-XXXX-DDMMAAAA.pdf` (número e data do documento).

## B. Catálogo pelos sistemas (T-0142, Campo)
1. **Mais › Catálogo** abre pelos sistemas: Alimentos, Bebidas, Limpeza e higiene, Automotivo.
2. Toque em Automotivo: aparecem Freios, Filtros, Suspensão. A **trilha** (Catálogo › Automotivo › Freios) e a **busca**
   ficam no topo; toque num nível da trilha para voltar a ele.
3. Num nível que tem produto ligado direto e também subníveis, os produtos soltos aparecem em **"Outros produtos"**.
   Nenhum produto some.
4. Em modo avião, a navegação continua com o que já foi baixado.

## C. Lote 03 (T-0140, Campo e Gestão)
1. **Sem meta.** Num vendedor sem meta do mês, o cartão do Início mostra **"Nenhuma meta cadastrada"**, e não R$ 0,00
   ou erro. No Gestão (`supervisor`), o mesmo na ficha do vendedor.
2. **Sincronizar sem travar.** Toque em Sincronizar várias vezes seguidas, com sinal e sem sinal: o botão não trava, a
   tela continua respondendo e a sincronização termina ou avisa a falta de sinal.
3. **Diagnóstico mascarado.** Perfil › Diagnóstico: e-mail, CPF/CNPJ e telefone aparecem mascarados (`[cpf]`, `[cnpj]`,
   `[telefone]`), também em "Último erro do app" e no "Enviar o detalhe ao suporte". Anote o `Build instalado: 1.0.2+…`.

## D. Backoffice (T-0117, `analista`)
1. **Login.** Entre no Backoffice. Na primeira vez depois da atualização, ele pode pedir para **entrar de novo uma
   vez** (a sessão passou para cookie). Depois disso, F5 e abrir outra aba mantêm a sessão.
2. **Sem rede.** Com o Backoffice aberto, desligue a rede do PC: aparece o aviso **"sem conexão"** com **"Tentar de
   novo"**, e **não** a tela de login. Religue: volta sozinho ou pelo Tentar de novo.
3. **Catálogo pela hierarquia.** Catálogo: navegue pelos níveis (Automotivo › Freios…). **Exportar CSV** com um nível
   aberto: o arquivo traz só aquele nível e os de baixo.

## E. Versão no Perfil
1. Campo: Perfil → no fim da tela, **Campo-Demo-v1.0.2**. Gestão: **Gestao-Demo-v1.0.2**.
2. Configurações do Android → Apps → versão **1.0.2**. Instala por cima do v1.0.1.

## O que ainda não tem (fica para depois)
- O aviso **"Pedido guardado em Rascunhos"** ao sair do pedido: o pedido vai para Rascunhos, mas sem o aviso na tela.
- Os **7 🟡 de UX** em aberto da revisão do designer-ux.
- A **resposta pelo Telegram**: o aviso chega, mas responder por lá ainda não vira recado.

## O que mandar de volta
- Para cada item (A a E): ok, ou o passo que falhou, o aparelho (Campo ou Gestão) e o que apareceu.
- A linha `Build instalado` do Diagnóstico. Eu encaminho cada falha ao dono da tela.
