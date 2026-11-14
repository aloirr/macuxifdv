# Ficha do cliente: aba Performance e botão Pesquisa (RN-CORE-50 e RN-CORE-51)

Decisão do dono do produto (chat, 14/11/2026, 6h30): o botão "Visitado" sai de Clientes e é trocado por "Pesquisa"; a pesquisa fica só no botão; nova aba Performance.

## RN-CORE-50 — aba Performance (Campo e Gestão)
Abas roláveis, com os nomes inteiros: Resumo · Cadastro · Financeiro · Compras · Performance · Anexos.
Mostra, nesta ordem, só o que existe no aparelho (seção sem dado não aparece):
- **Visitas** (total) e **Última visita** (data e quem; "Você" ou o vendedor);
- **Prazo médio**: média arredondada, em dias, de `prazo_medio_dias` dos pedidos do cliente; rascunho, cancelado, rejeitado e apagado não entram;
- **Curvas** (RN-CORE-49): só aqui, saíram das tags do Resumo;
- **Últimos itens comprados**: até 20, um por produto (a última compra dele), do mais recente ao mais antigo, com quantidade + embalagem, data e último preço unitário;
- **Sugestão de mix**: extensão `cliente.abas` id `mix` (Vendedor), renderizada aqui; saiu do Resumo.
- Promotor sem `promotor_ve_pedidos` (RN-PRO-01): sem prazo médio e sem itens.

Domínio: `domain/performance-cliente.ts` (`prazoMedioDias`, `itensDoPedidoVisiveis`, `ultimosItensComprados`, `resumoDeVisitas`). Dados: linhas `pedido`, `pedido_item` (contratos do Vendedor), `visita` e `cliente_ultima_visita` do aparelho.

Limites do dado: `visita` traz só as do usuário e da equipe em 40 dias, então "Visitas" é a contagem do que o aparelho tem; o nome de quem visitou só é conhecido pelo nome do vendedor nos pedidos do cliente (a linha de visita só tem `usuario_id`).

## RN-CORE-51 — rodapé da ficha
- Decisão do dono do produto (14/11/2026, 7h28): o botão de check-in fica **só na ficha do cliente e na Rota** (o Início não tem atalho de check-in; só leva à ficha ou à Rota).
- Rodapé: **Check-in** (sem atendimento aberto neste cliente, cliente não visitado hoje e check-in permitido pela RN-CORE-52) ou **Checkout** (com atendimento aberto neste cliente), **Pesquisa** e **+ Novo pedido**.
- Com atendimento aberto em outro cliente, o Check-in aparece bloqueado (RN-CORE-13); o pedido segue liberado.
- A 360 dp, com os três botões, a largura se divide em 1 : 1 : 1,5 e o rótulo cai de 15 para 14 pt (todos com 52 dp de altura).
- **Pesquisa** só aparece se a extensão `cliente.abas` id `pesquisas` estiver presente (licença e ação já filtradas); abre numa folha o componente dela. A seção "Pesquisas" saiu do Resumo.
