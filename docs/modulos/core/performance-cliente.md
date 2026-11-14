# Ficha do cliente: aba Performance e botão Pesquisa (RN-CORE-50 e RN-CORE-51)

Decisão do dono do produto (chat, 14/11/2026, 6h30): o botão "Visitado" sai de Clientes e é trocado por "Pesquisa"; a pesquisa fica só no botão; nova aba Performance.

## RN-CORE-50 — aba Performance (Campo e Gestão)
Abas: Resumo · Cadastro · Finanças · Compras · Perform. · Anexos (rótulos curtos: 6 abas de largura igual não cabem a 360 dp com "Financeiro" e "Performance").
Mostra, nesta ordem, só o que existe no aparelho (seção sem dado não aparece):
- **Visitas** (total) e **Última visita** (data e quem; "Você" ou o vendedor);
- **Prazo médio**: média arredondada, em dias, de `prazo_medio_dias` dos pedidos do cliente; rascunho, cancelado, rejeitado e apagado não entram;
- **Curvas** (RN-CORE-49): só aqui, saíram das tags do Resumo;
- **Últimos itens comprados**: até 20, um por produto (a última compra dele), do mais recente ao mais antigo, com quantidade + embalagem, data e último preço unitário;
- **Sugestão de mix**: extensão `cliente.abas` id `mix` (Vendedor), renderizada aqui; saiu do Resumo.
- Promotor sem `promotor_ve_pedidos` (RN-PRO-01): sem prazo médio e sem itens.

Domínio: `domain/performance-cliente.ts` (`prazoMedioDoCliente`, `itensDoPedidoVisiveis`, `ultimosItensComprados`, `resumoDeVisitas`). Dados: linhas `pedido`, `pedido_item` (contratos do Vendedor), `visita` e `cliente_ultima_visita` do aparelho.

Limites do dado: `visita` traz só as do usuário e da equipe em 40 dias, então "Visitas" é a contagem do que o aparelho tem; o nome de quem visitou só é conhecido pelo nome do vendedor nos pedidos do cliente (a linha de visita só tem `usuario_id`).

## RN-CORE-51 — rodapé da ficha
- O botão de visita (Check-in/Visitado) saiu do rodapé. O check-in segue por RN-CORE-13: Início/Rota abrem a ficha com `?checkin=1` e a `CheckinSheet`.
- Rodapé: **Checkout** (só com atendimento aberto neste cliente), **Pesquisa** e **+ Novo pedido**.
- **Pesquisa** só aparece se a extensão `cliente.abas` id `pesquisas` estiver presente (licença e ação já filtradas); abre numa folha o componente dela. A seção "Pesquisas" saiu do Resumo.
