# Demonstração — app novo + API real (T-0026)

## Antes do dia
- Docker Desktop instalado; `pnpm install` na raiz.
- No celular, os APKs de preview:
  - Macuxi Campo: https://expo.dev/artifacts/eas/IpWfiRYTTQ2u68W1MYzn71XU5caWBsSXe5SdHmqdzTo.apk
  - Macuxi Gestão: https://expo.dev/artifacts/eas/0dWy-aQMgl1yGtn0B0sPMX4WSR4kiCdSde_6CVtKZUc.apk
- Recomendado: `MACUXI_JWT_SEGREDO` (32+ caracteres) no .env da raiz. Sem ele, cada subida usa um segredo temporário.

## Subir (uma janela só)
- Duplo clique em `_instalar\subir-demo.cmd` (ou `powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1`).
- Leva cerca de 1 minuto. Na primeira vez instala o cloudflared: o winget pede autorização do Windows; sem ela, baixa o portátil assinado.
- No fim, o script imprime o endereço completo da API, com `/v1`: `https://<nome>.trycloudflare.com/v1` (decisão do Alexandre: o endereço é sempre visível e completo, no script, no app e nos docs).
- Opções: `-Manter` (não apaga o ensaio), `-Reiniciar` (derruba e sobe de novo; o endereço muda), `-SemTunel`, `-SemWorker`, `-Portatil`, `-Porta`.

## No celular
1. Tela de login → Servidor → digite o endereço https com `/v1` → Testar e salvar. O app só aceita um servidor Macuxi verdadeiro (resposta de `/v1/saude` com `servico: macuxi-api`).
2. Código da empresa `demo`, senha `demo-macuxi`.
   - Campo: vendedor@exemplo.com.br (Lucas, rota de hoje com 6 paradas), vendedor2@exemplo.com.br (Camila, 4 paradas), promotor@exemplo.com.br (Joana, 4 paradas, não faz pedido).
   - Gestão: supervisor@exemplo.com.br (Renata, Equipe Manaus, 2 pedidos para aprovar).
   - Outros: analista@ e admin@exemplo.com.br.
- Licenciados no tenant demo: core, catálogo, vendedor e promotor (gestor não).

## Roteiro do pedido para apresentar (T-0029, APKs novos)
Alçadas da base: 5% vendedor, 10% supervisora, 15% gerente; acima disso, o analista.
1. **Campo (vendedor@)** → Clientes → um cliente do Varejo → **Novo pedido**: 2 produtos, desconto 3% → Enviar. O pedido aparece como **Aprovado** (dentro da alçada) com o próximo número.
2. Novo pedido com **8%** → o app avisa que vai para aprovação → **Aguardando aprovação**. Abra o pedido → **Exportar PDF → PDF do cliente → Compartilhar → WhatsApp**. O PDF do cliente não mostra nenhum %; o PDF interno mostra o desconto e a alçada.
3. **Gestão (supervisor@)** → aba **Pedidos** → chip **Para aprovar** → abra o de 8% → **Aprovar** (1 toque). No Campo, depois do Sincronizar, o pedido aparece Aprovado. Para rejeitar, é obrigatório informar um motivo, e o vendedor vê esse motivo.
4. **Offline**: com o celular em modo avião, faça um pedido de 3% no Campo. Ele fica "Na fila". Ao voltar o sinal, o pedido sobe uma vez só. No Gestão, aprovar exige internet.
5. **BKO no PC** (admin@ ou supervisor@) → **Pedidos**: o status novo aparece, com filtros e busca pelo número; abra um pedido → **PDF do cliente** → no diálogo de impressão, "Salvar como PDF".
- Extras: um pedido de 12% vai para o gerente (gerente@, Marcelo). No Supermercado Bom Preço, o açaí aparece "Sem preço para este cliente". O promotor@ não vê pedidos.
- Cada rodada do e2e automático deixa na base um pedido "e2e testes", primeiro aprovado e depois cancelado. Para começar limpo, use `-Reiniciar`.
- Roteiro completo, com o resultado esperado de cada passo: `tests/plano/demo-matriz.md` (M-D01 a M-D12b).

## Encerrar
`_instalar\derrubar-demo.cmd` (ou `scripts\demo\derrubar-demo.ps1`; `-PararBanco` também para o Postgres).

## Se der problema
- O endereço muda a cada subida.
- "Porta 8100 em uso": feche o `pnpm dev`.
- "Já há uma demonstração no ar": use `-Reiniciar` ou derrube antes.
- O túnel abriu mas não responde no PC: o DNS leva alguns segundos; teste `<endereço>/v1/saude` no navegador do celular.
- Logs em `.dados\demo\`.
- Segurança: o túnel expõe a API deste PC. Use só com a base de demo e derrube ao terminar.

Detalhes: scripts/demo/LEIA-ME.md
