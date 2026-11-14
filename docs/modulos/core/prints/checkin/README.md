# Check-in na ficha do cliente (T-0174)

Gerado por `gerar.mjs` (a `TelaCliente` real com react-native-web; dublês só de rota e de dados em `_src/mock-*`; fontes do app Archivo e IBM Plex Sans; 360×640 dp a 2x; barra de status 24 dp e navegação 24 dp; hora fixa 14/11/2026 09:47 em Boa Vista). Nomes e números são fictícios. O gerador falha se um texto esperado não estiver visível na tela ou se algum texto sair cortado (o endereço do cabeçalho termina em reticências por desenho, numa linha só).

Uso, na raiz: `MACUXI_CHROMIUM=/opt/pw-browsers/chromium node docs/modulos/core/prints/checkin/gerar.mjs` (o pacote temporário fica em `_src/_saida/`, fora do git).

| Print | Cenário |
|---|---|
| `ficha-checkin-pesquisa-pedido.png` | Campo, sem atendimento aberto: Check-in · Pesquisa · Novo pedido |
| `ficha-checkout-pesquisa-pedido.png` | Campo, atendimento aberto neste cliente desde 09:12: Checkout · Pesquisa · Novo pedido (na própria ficha a faixa "Em atendimento" some; fica o selo) |
| `ficha-checkin-bloqueado.png` | Campo, atendimento aberto em outro cliente: faixa "Em atendimento" (hora só no topo, "há 35 min" embaixo) e Check-in com cadeado |
| `folha-checkin-gps.png` | Folha do check-in com GPS: só "Check-in às 09:12" e "Continuar" |
| `folha-checkin-sem-gps.png` | Folha do check-in sem GPS: "Sem GPS neste check-in" |
| `aba-performance.png` | Aba Performance: Visitas e Última visita (com quem visitou) |
| `gestao-ficha-checkin-pesquisa.png` | Gestão (sem o Vendedor): Check-in · Pesquisa |
