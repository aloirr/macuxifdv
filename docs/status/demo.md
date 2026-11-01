# Demonstração — app novo + API real (T-0026, T-0029 e T-0038)

## Antes do dia
- Docker Desktop instalado; `pnpm install` na raiz.
- No celular, os APKs de preview:
  - **APKs com domínio fixo (T-0038)**: ainda não gerados; os links entram aqui assim que saírem. Eles já vêm com `https://api-demo.macuxifdv.com.br/v1` e não pedem endereço.
  - APKs atuais, com o pedido completo e o campo Servidor (commit 8cf1021):
    - Macuxi Campo: https://expo.dev/artifacts/eas/anwJjMiIGmI7LStvx08GO99bXMmuLljTwqxQ9fjAxyg.apk
    - Macuxi Gestão: https://expo.dev/artifacts/eas/gjm--rEMuK31MOc1MRNEuuDNCGvczjRpPyc8o1Ms2xg.apk
    - Neles, digite `https://api-demo.macuxifdv.com.br/v1` em Servidor → Testar e salvar (ou o endereço do túnel rápido).
- Recomendado: `MACUXI_JWT_SEGREDO` (32+ caracteres) no .env da raiz. Sem ele, cada subida usa um segredo temporário.

## Uma vez só (por PC): domínio fixo
1. `cloudflared tunnel login` (o navegador abre; escolha **macuxifdv.com.br**). A autorização fica em `%USERPROFILE%\.cloudflared`, fora do repositório e fora do alcance dos agentes (doc 07).
2. `powershell -ExecutionPolicy Bypass -File scripts\demo\configurar-dominio.ps1`: cria o túnel `macuxi-demo`, aponta `api-demo` e `bko-demo` e grava o config. Pode rodar de novo sem duplicar nada. Se um nome já apontar para outro lugar, use `-SobrescreverDns`.

## Subir (uma janela só)
- Duplo clique em `_instalar\subir-demo.cmd` (ou `powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1`).
- Leva de 2 a 4 minutos; a parte longa é o build do BKO. O script sobe o banco, a base de demo, a API, o worker e o BKO, e abre o túnel do domínio fixo.
- Ele só diz "Pronto para a demonstração" depois de conferir a API (`/v1/saude`) e o BKO, no PC e pela internet.
- Endereços fixos:
  - app: `https://api-demo.macuxifdv.com.br/v1` (já vem nos APKs novos);
  - BKO: `https://bko-demo.macuxifdv.com.br`.
- Sem o "Uma vez só" feito neste PC, ou se o túnel nomeado não conectar, o script avisa em amarelo e usa o túnel rápido (trycloudflare), com endereço temporário. Os APKs de preview novos **não** conectam por ele; só o build de desenvolvimento conecta (login > Avançado > Servidor).
- Opções: `-Manter`, `-Reiniciar`, `-SemTunel`, `-SemWorker`, `-SemBko`, `-TunelRapido`, `-Portatil`, `-Porta`, `-PortaBko`.

## No celular
1. Abra o app (APK de preview novo). Não há endereço para digitar.
2. Código da empresa `demo`, senha `demo-macuxi`.
   - Campo: vendedor@exemplo.com.br (Lucas, rota de hoje com 6 paradas), vendedor2@exemplo.com.br (Camila, 4 paradas), promotor@exemplo.com.br (Joana, 4 paradas, não faz pedido).
   - Gestão: supervisor@exemplo.com.br (Renata, Equipe Manaus, 2 pedidos para aprovar).
   - Outros: analista@ e admin@exemplo.com.br (servem também para o BKO).
- "Servidor indisponível — tente mais tarde": a demo não está no ar ou o túnel caiu.
- Licenciados no tenant demo: core, catálogo, vendedor e promotor (gestor não).

## Roteiro do pedido para apresentar (T-0029)
Alçadas da base: 5% vendedor, 10% supervisora, 15% gerente; acima disso, o analista.
1. **Campo (vendedor@)** → Clientes → um cliente do Varejo → **Novo pedido**: 2 produtos, desconto 3% → Enviar. O pedido aparece como **Aprovado** (dentro da alçada) com o próximo número.
2. Novo pedido com **8%** → o app avisa que vai para aprovação → **Aguardando aprovação**. Abra o pedido → **Exportar PDF → PDF do cliente → Compartilhar → WhatsApp**. O PDF do cliente não mostra nenhum %; o PDF interno mostra o desconto e a alçada.
3. **Gestão (supervisor@)** → aba **Pedidos** → chip **Para aprovar** → abra o de 8% → **Aprovar** (1 toque). No Campo, depois do Sincronizar, o pedido aparece Aprovado. Para rejeitar, é obrigatório informar um motivo, e o vendedor vê esse motivo.
4. **Offline**: com o celular em modo avião, faça um pedido de 3% no Campo. Ele fica "Na fila". Ao voltar o sinal, o pedido sobe uma vez só. No Gestão, aprovar exige internet.
5. **BKO** em `https://bko-demo.macuxifdv.com.br` (admin@ ou supervisor@) → **Pedidos**: o status novo aparece, com filtros e busca pelo número. Abra um pedido → **PDF do cliente** → no diálogo de impressão, "Salvar como PDF".
- Extras: um pedido de 12% vai para o gerente (gerente@, Marcelo). No Supermercado Bom Preço, o açaí aparece "Sem preço para este cliente". O promotor@ não vê pedidos.
- Cada rodada do e2e automático deixa na base um pedido "e2e testes", primeiro aprovado e depois cancelado. Para começar limpo, use `-Reiniciar`.
- Roteiro completo, com o resultado esperado de cada passo: `tests/plano/demo-matriz.md` (M-D01 a M-D12b).

## Encerrar
`_instalar\derrubar-demo.cmd` (ou `scripts\demo\derrubar-demo.ps1`; `-PararBanco` também para o Postgres). O túnel nomeado e o DNS continuam configurados: na próxima vez é só subir.

## Se der problema
- "Porta 8100 (ou 3100) em uso": feche o `pnpm dev` (API ou BKO).
- "Já há uma demonstração no ar": use `-Reiniciar` ou derrube antes.
- "No ar, mas SEM confirmação pelo endereço público": teste `https://api-demo.macuxifdv.com.br/v1/saude` no navegador do celular.
- "O túnel nomeado não conectou": veja `.dados\demo\tunel.erro.log` (sem internet? PC sem o "Uma vez só"?).
- Logs em `.dados\demo\`.
- Segurança: o túnel expõe a API e o BKO deste PC. Use só com a base de demo e derrube ao terminar.

Detalhes: scripts/demo/LEIA-ME.md e docs/desenho/T-0038.md
