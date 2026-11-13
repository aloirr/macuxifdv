# Catálogo de achados de marca (MC-nnnn)

Um achado por linha, na ordem em que foi aberto. O parecer com o detalhe e a correção fica em `pareceres/`. Situação: aberto · corrigido · retestado.
Em 13/11/2026 o catálogo foi alinhado ao parecer final da v1.0.5 (o primeiro tinha outros IDs). Os dois itens que só estavam na primeira versão viraram a MC-0014 e a MC-0015.

| ID | Parecer | Onde | Gravidade | Dono | Situação |
|---|---|---|---|---|---|
| MC-0001 | `pareceres/2026-11-13-v1.0.5.md` | logo da splash e da entrada cortado no Android 12+ (`app.config.ts`, `src/lib/entrada.ts`) | média | engenheiro-apps | corrigido (falta o print do build) |
| MC-0002 | `pareceres/2026-11-13-v1.0.5.md` | chip ativo em grafite (`packages/ui/src/mobile/ui.tsx:247,406`) | baixa | designer-ux | aberto |
| MC-0003 | `pareceres/2026-11-13-v1.0.5.md` | menu do BKO com cores quase iguais (`apps/web/app/globals.css:36-37`) | baixa | designer-ux | aberto |
| MC-0004 | `pareceres/2026-11-13-v1.0.5.md` | neutros de linha, campo e chip fora da paleta | baixa | design-de-marca → designer-ux | aberto |
| MC-0005 | `pareceres/2026-11-13-v1.0.5.md` | roxo no selo de orçamento (`tokens.ts:69-70`, `textos-pedido.ts:66`, `selo-lista.ts`) | baixa | modulo-vendedor · designer-ux | aberto |
| MC-0006 | `pareceres/2026-11-13-v1.0.5.md` | hex solto no estado do pedido (`order-status.ts:16-26`) | baixa | modulo-vendedor | aberto |
| MC-0007 | `pareceres/2026-11-13-v1.0.5.md` | pranchas T-0165 e T-0168 na paleta anterior | baixa | designer-ux | aberto |
| MC-0008 | `pareceres/2026-11-13-v1.0.5.md` | subtítulo acima do título no Catálogo | baixa | designer-ux | corrigido no código (prancha na MC-0013) |
| MC-0009 | `pareceres/2026-11-13-v1.0.6.md` | sino do cabeçalho: botão branco e contador Azul noite na faixa (`apps/mobile/src/components/sino.tsx`) | média | engenheiro-apps | aberto |
| MC-0010 | `pareceres/2026-11-13-v1.0.6.md` | Performance: barra de meta e marcador em Azul noite e grafite (`tela-performance.tsx:159,189,190`) | média | modulo-core | aberto |
| MC-0011 | `pareceres/2026-11-13-v1.0.6.md` | números dos cards de Pedidos em Plex Medium (`cards-pedidos.tsx:17`) | baixa | modulo-vendedor | aberto |
| MC-0012 | `pareceres/2026-11-13-v1.0.6.md` | verde de sucesso como ícone do tipo "pedido" (`recados-e-tarefas/pecas.tsx:13`) | baixa | modulo-core | aberto |
| MC-0013 | `pareceres/2026-11-13-v1.0.6.md` | prancha T-0173 (subtítulo) e imagens finais da T-0170 no visual antigo | baixa | designer-ux | aberto |
| MC-0014 | `pareceres/2026-11-13-v1.0.6.md` | cores fora da paleta nos gráficos do BKO (`modules/core/web/lib/routes.ts:134-135,160`) | baixa | modulo-core · design-de-marca | aberto |
| MC-0015 | `pareceres/2026-11-13-v1.0.6.md` | `#F3F4F1` no e-mail (`platform-sdk/src/email/modelos.ts:129`) | baixa | engenheiro-software | aberto |
