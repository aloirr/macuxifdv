# Catálogo de achados de marca (MC-nnnn)

Um achado por linha, na ordem em que foi aberto. O parecer com o detalhe e a correção fica em `pareceres/`. Situação: aberto · corrigido · retestado.
Em 13/11/2026 o catálogo foi alinhado ao parecer final da v1.0.5 (o primeiro tinha outros IDs). Os dois itens que só estavam na primeira versão viraram a MC-0014 e a MC-0015.

| ID | Parecer | Onde | Gravidade | Dono | Situação |
|---|---|---|---|---|---|
| MC-0001 | `pareceres/2026-11-13-v1.0.5.md` | logo da splash e da entrada cortado no Android 12+ (`app.config.ts`, `src/lib/entrada.ts`) | média | engenheiro-apps | corrigido no código (fecha no print do build) |
| MC-0002 | `pareceres/2026-11-13-v1.0.5.md` | chip ativo em grafite (`packages/ui/src/mobile/ui.tsx:247,406`) | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0003 | `pareceres/2026-11-13-v1.0.5.md` | menu do BKO com cores quase iguais (`apps/web/app/globals.css:36-37`) | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0004 | `pareceres/2026-11-13-v1.0.5.md` | neutros de linha, campo e chip fora da paleta | baixa | design-de-marca → designer-ux | aberto (proposta de neutros ao Alexandre) |
| MC-0005 | `pareceres/2026-11-13-v1.0.5.md` | roxo no selo de orçamento (`tokens.ts:69-70`, `textos-pedido.ts:66`, `selo-lista.ts`) | baixa | modulo-vendedor · designer-ux | retestado e fechado (main 3d351190) |
| MC-0006 | `pareceres/2026-11-13-v1.0.5.md` | hex solto no estado do pedido (`order-status.ts:16-26`) | baixa | modulo-vendedor | retestado e fechado (main 3d351190) |
| MC-0007 | `pareceres/2026-11-13-v1.0.5.md` | pranchas T-0165 e T-0168 na paleta anterior | baixa | designer-ux | aberto em parte: falta a prancha do BKO (T-0168-bko-1/2/3) |
| MC-0008 | `pareceres/2026-11-13-v1.0.5.md` | subtítulo acima do título no Catálogo | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0009 | `pareceres/2026-11-13-v1.0.6.md` | sino do cabeçalho: botão branco e contador Azul noite na faixa (`apps/mobile/src/components/sino.tsx`) | média | engenheiro-apps | corrigido no código (fecha no print do build) |
| MC-0010 | `pareceres/2026-11-13-v1.0.6.md` | Performance: barra de meta e marcador em Azul noite e grafite (`tela-performance.tsx:159,189,190`) | média | modulo-core | retestado e fechado (main 3d351190) |
| MC-0011 | `pareceres/2026-11-13-v1.0.6.md` | números dos cards de Pedidos em Plex Medium (`cards-pedidos.tsx:17`) | baixa | modulo-vendedor | retestado e fechado (main 3d351190) |
| MC-0012 | `pareceres/2026-11-13-v1.0.6.md` | verde de sucesso como ícone do tipo "pedido" (`recados-e-tarefas/pecas.tsx:13`) | baixa | modulo-core | retestado e fechado (main 3d351190) |
| MC-0013 | `pareceres/2026-11-13-v1.0.6.md` | prancha T-0173 (subtítulo) e imagens finais da T-0170 no visual antigo | baixa | designer-ux | aberto em parte: T-0173 fechada; falta a prancha do Início implementado (T-0170) |
| MC-0014 | `pareceres/2026-11-13-v1.0.6.md` | cores fora da paleta nos gráficos do BKO (`modules/core/web/lib/routes.ts:134-135,160`) | baixa | modulo-core · design-de-marca | aberto em parte: STATUS_FILL fechado; séries esperam a proposta |
| MC-0015 | `pareceres/2026-11-13-v1.0.6.md` | `#F3F4F1` no e-mail (`platform-sdk/src/email/modelos.ts:129`) | baixa | engenheiro-software | retestado e fechado (main 3d351190) |
| MC-0016 | `pareceres/2026-11-13-v1.0.6.md` | Início do Campo: barra de meta em Azul noite e vermelho (`tela-inicio-campo.tsx`); recado R-20261113-202329 | média | modulo-core | retestado e fechado (main 3d351190) |
| MC-0017 | `pareceres/2026-11-13-v1.0.6.md` | Início do Campo: `valorIndicador` em Plex SemiBold (`tela-inicio-campo.tsx:168`) | baixa | modulo-core | retestado e fechado (main 3d351190) |
