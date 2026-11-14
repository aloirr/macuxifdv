# Catálogo de achados de marca (MC-nnnn)

Um achado por linha, na ordem em que foi aberto. O parecer com o detalhe e a correção fica em `pareceres/`. Situação: aberto · corrigido · retestado.
Em 13/11/2026 o catálogo foi alinhado ao parecer final da v1.0.5 (o primeiro tinha outros IDs). Os dois itens que só estavam na primeira versão viraram a MC-0014 e a MC-0015.

| ID | Parecer | Onde | Gravidade | Dono | Situação |
|---|---|---|---|---|---|
| MC-0001 | `pareceres/2026-11-13-v1.0.5.md` | logo da splash e da entrada cortado no Android 12+ (`app.config.ts`, `src/lib/entrada.ts`) | média | engenheiro-apps | corrigido no código (fecha no print do build) |
| MC-0002 | `pareceres/2026-11-13-v1.0.5.md` | chip ativo em grafite (`packages/ui/src/mobile/ui.tsx:247,406`) | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0003 | `pareceres/2026-11-13-v1.0.5.md` | menu do BKO com cores quase iguais (`apps/web/app/globals.css:36-37`) | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0004 | `pareceres/2026-11-13-v1.0.5.md` | neutros de linha, campo e chip fora da paleta | baixa | designer-ux (tokens.ts) · engenheiro-apps (globals.css) · modulo-vendedor (pdf-pedido.ts) | decidido pelo Alexandre (B, 14/11/2026); aplicar: `#E1E4DE` → `#DFE2E6`; `#ECEEE9` e `#E6E9E2` → `#ECEEF1`; `#C9CEC6` e `#D6DAD1` → `#C9CED5`; `#E9ECE6` → `#ECEEF1` (manual §3) |
| MC-0005 | `pareceres/2026-11-13-v1.0.5.md` | roxo no selo de orçamento (`tokens.ts:69-70`, `textos-pedido.ts:66`, `selo-lista.ts`) | baixa | modulo-vendedor · designer-ux | retestado e fechado (main 3d351190) |
| MC-0006 | `pareceres/2026-11-13-v1.0.5.md` | hex solto no estado do pedido (`order-status.ts:16-26`) | baixa | modulo-vendedor | retestado e fechado (main 3d351190) |
| MC-0007 | `pareceres/2026-11-13-v1.0.5.md` | pranchas T-0165 e T-0168 na paleta anterior | baixa | designer-ux | retestado e fechado (main 2fdad4d) |
| MC-0008 | `pareceres/2026-11-13-v1.0.5.md` | subtítulo acima do título no Catálogo | baixa | designer-ux | retestado e fechado (main 3d351190) |
| MC-0009 | `pareceres/2026-11-13-v1.0.6.md` | sino do cabeçalho: botão branco e contador Azul noite na faixa (`apps/mobile/src/components/sino.tsx`) | média | engenheiro-apps | corrigido no código (fecha no print do build) |
| MC-0010 | `pareceres/2026-11-13-v1.0.6.md` | Performance: barra de meta e marcador em Azul noite e grafite (`tela-performance.tsx:159,189,190`) | média | modulo-core | retestado e fechado (main 3d351190) |
| MC-0011 | `pareceres/2026-11-13-v1.0.6.md` | números dos cards de Pedidos em Plex Medium (`cards-pedidos.tsx:17`) | baixa | modulo-vendedor | retestado e fechado (main 3d351190) |
| MC-0012 | `pareceres/2026-11-13-v1.0.6.md` | verde de sucesso como ícone do tipo "pedido" (`recados-e-tarefas/pecas.tsx:13`) | baixa | modulo-core | retestado e fechado (main 3d351190) |
| MC-0013 | `pareceres/2026-11-13-v1.0.6.md` | prancha T-0173 (subtítulo) e imagens finais da T-0170 no visual antigo | baixa | designer-ux | retestado e fechado (main 2fdad4d) |
| MC-0014 | `pareceres/2026-11-13-v1.0.6.md` | cores fora da paleta nos gráficos do BKO (`modules/core/web/lib/routes.ts:134-135,160`) | baixa | modulo-core | decidido pelo Alexandre (A, 14/11/2026); aplicar: `SERIES_COLORS` = `#1E3350`, `#C2540A`, `#4A5562`, `#5B7FA6`; `OTHER_COLOR` = `#8B96A3`; `WEEKDAY_COLORS` (índices 4, 6 e 7 deixam de existir) repete as cores com o rótulo do dia no marcador (manual §3) |
| MC-0015 | `pareceres/2026-11-13-v1.0.6.md` | `#F3F4F1` no e-mail (`platform-sdk/src/email/modelos.ts:129`) | baixa | engenheiro-software | retestado e fechado (main 3d351190) |
| MC-0016 | `pareceres/2026-11-13-v1.0.6.md` | Início do Campo: barra de meta em Azul noite e vermelho (`tela-inicio-campo.tsx`); recado R-20261113-202329 | média | modulo-core | retestado e fechado (main 3d351190) |
| MC-0017 | `pareceres/2026-11-13-v1.0.6.md` | Início do Campo: `valorIndicador` em Plex SemiBold (`tela-inicio-campo.tsx:168`) | baixa | modulo-core | retestado e fechado (main 3d351190) |
| MC-0018 | `pareceres/2026-11-14-oficial-final.md` | prancha T-0168 do BKO com o botão principal e o interruptor em grafite (`docs/design/telas/T-0168-bko.html:50,59`) | baixa | designer-ux | aberto |
| MC-0019 | `pareceres/2026-11-14-oficial-final.md` | `BotaoLink` principal em grafite e hex solto no hover (`packages/ui/src/web/botao-link.tsx:27,29`) | baixa | designer-ux | aberto |
| MC-0020 | `pareceres/2026-11-14-oficial-final.md` | `bg-[#e9ece6]` no carregamento do mapa (`modules/core/web/components/routes/routes-page.tsx:41`) | baixa | modulo-core | aberto; a cor certa agora é `bg-neutral-soft` (`#ECEEF1`, MC-0004 B) |
