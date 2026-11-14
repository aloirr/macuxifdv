# Ficha do cliente: aba Performance e botão Pesquisa (RN-CORE-50 e RN-CORE-51)

Decisão do dono do produto (chat, 14/11/2026, 6h30): o botão "Visitado" sai de Clientes e é trocado por "Pesquisa"; a pesquisa fica só no botão; nova aba Performance.

## RN-CORE-50 — aba Performance (Campo e Gestão)
Abas roláveis, com os nomes inteiros: Resumo · Cadastro · Financeiro · Compras · Performance · Anexos.
Mostra, nesta ordem, só o que existe no aparelho (seção sem dado não aparece):
- **Visitas** (total) e **Última visita** (data no fuso do tenant e quem; "Você" quando foi o próprio usuário, senão o nome);
- **Prazo médio**: média arredondada, em dias, de `prazo_medio_dias` dos pedidos do cliente; rascunho, cancelado, rejeitado e apagado não entram;
- **Curvas** (RN-CORE-49): só aqui, saíram das tags do Resumo;
- **Últimos itens comprados**: até 20, um por produto (a última compra dele), do mais recente ao mais antigo, com quantidade + embalagem, data e último preço unitário;
- **Sugestão de mix**: extensão `cliente.abas` id `mix` (Vendedor), renderizada aqui; saiu do Resumo.
- Promotor sem `promotor_ve_pedidos` (RN-PRO-01): sem prazo médio e sem itens.

Domínio: `domain/performance-cliente.ts` (`prazoMedioDoCliente`, `itensDoPedidoVisiveis`, `ultimosItensComprados`, `resumoDeVisitas`, `quemVisitouPorUltimo`). Dados: linhas `pedido`, `pedido_item` (contratos do Vendedor), `visita` e `cliente_visita_resumo` do aparelho (a lista de Clientes também lê a última visita do resumo).

### Total de visitas e quem visitou por último (decisão do dono do produto, chat, 14/11/2026, 7h28)
- Entidade de sync `cliente_visita_resumo@1` (`ClienteVisitaResumoSyncSchema`, só pull, `servidor_vence`): uma linha por cliente, `id` = `cliente_id`, com `total_visitas`, `ultima_visita_em` (UTC), `ultima_visita_usuario_id` e `ultima_visita_usuario_nome`. Lida da view `core.v_cliente_visita_resumo` (banco-dados), de **qualquer usuário** e **sem janela**; cursor `updated_at`.
- Escopo `carteira` (RN-CORE-04): o vendedor e o promotor recebem os clientes da carteira deles; supervisor e gerente, os da equipe. Perfil e licença do Core checados pela rota de sync, como nas outras entidades.
- **Com o resumo no aparelho:** "Visitas" = `total_visitas` + check-ins do aparelho posteriores a `ultima_visita_em` (ainda não chegaram ao servidor). "Última visita" = a mais recente entre o resumo e o aparelho; data no fuso do tenant; nome do resumo, ou "Você" quando `ultima_visita_usuario_id` é o próprio usuário.
- **Sem o resumo** (antes do primeiro sync ou servidor antigo): vale o cálculo local — contagem e última data das linhas `visita` do aparelho (usuário e equipe, 40 dias); o nome sai do `vendedor_nome` dos pedidos do cliente. A entidade `cliente_ultima_visita` foi retirada (RD-0260): a lista de Clientes e a Performance leem a mesma `ultima_visita_em` do resumo.
- Promotor: vê as visitas (não são pedido); sem `promotor_ve_pedidos` (RN-PRO-01) continua sem prazo médio e sem itens.
- Carga de entrada (RN-CORE-48): no Campo, a entidade conta na etapa "Clientes e rota"; na Gestão, que não tem essa etapa, em "Equipe" (onde carregam os clientes da equipe), para as etapas seguirem em sequência.

## RN-CORE-51 — rodapé da ficha
- Decisão do dono do produto (14/11/2026, 7h28): o botão de check-in fica **só na ficha do cliente e na Rota** (o Início não tem atalho de check-in; só leva à ficha ou à Rota).
- Rodapé: **Check-in** (sem atendimento aberto neste cliente, cliente não visitado hoje e check-in permitido pela RN-CORE-52) ou **Checkout** (com atendimento aberto neste cliente), **Pesquisa** e **+ Novo pedido**.
- Com atendimento aberto em outro cliente, o Check-in aparece bloqueado (RN-CORE-13); o pedido segue liberado.
- Os botões têm 48 dp de altura e o rótulo do kit (14 pt) em todos os estados; cada um ocupa a largura do rótulo e divide a sobra. Medido a 360 dp (Campo): Check-in 87,6 · Pesquisa 89,1 · Novo pedido 131,3 dp; com cadeado, 100,9 · 82,5 · 124,6 dp; nenhum rótulo é cortado (prints em `prints/checkin/`).
- **Folha do check-in** (decisão do dono do produto, 14/11/2026): depois do check-in a folha só confirma o horário e oferece "Continuar" (`checkin-abrir-ficha`). Ela não tem "Novo pedido": o único botão de novo pedido fica no rodapé da ficha.
- **Pesquisa** só aparece se a extensão `cliente.abas` id `pesquisas` estiver presente (licença e ação já filtradas); abre numa folha o componente dela. A seção "Pesquisas" saiu do Resumo.
