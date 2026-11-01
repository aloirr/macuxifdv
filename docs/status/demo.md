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
- No fim, o script imprime o endereço `https://<nome>.trycloudflare.com`.
- Opções: `-Manter` (não apaga o ensaio), `-Reiniciar` (derruba e sobe de novo; o endereço muda), `-SemTunel`, `-SemWorker`, `-Portatil`, `-Porta`.

## No celular
1. Tela de login → Servidor → digite o endereço https → Testar e salvar.
2. Código da empresa `demo`, senha `demo-macuxi`.
   - Campo: vendedor@exemplo.com.br (Lucas, rota de hoje com 6 paradas), vendedor2@exemplo.com.br (Camila, 4 paradas), promotor@exemplo.com.br (Joana, 4 paradas, não faz pedido).
   - Gestão: supervisor@exemplo.com.br (Renata, Equipe Manaus, 2 pedidos para aprovar).
   - Outros: analista@ e admin@exemplo.com.br.
- Licenciados no tenant demo: core, catálogo, vendedor e promotor (gestor não).

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
