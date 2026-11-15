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
| MC-0021 | `pareceres/2026-11-14-portal-config.md` | portal `config.`: `LinkBotao` principal em grafite e `hover:bg-[#0b1218]` ("Nova empresa", `apps/web/components/portal/base.tsx:61`) | média | engenheiro-apps | aberto; `bg-ink` → `bg-accent text-white hover:bg-accent/90` |
| MC-0022 | `pareceres/2026-11-14-portal-config.md` | logo da `MarcaNaFaixa` sem a área de proteção (folga de 10 a 14 px para um "M" de ~17 px; `apps/web/components/marca-faixa.tsx:8,12,21`), no portal e no login do BKO | média | engenheiro-apps | aberto; logo a 104 px e `p-3.5 gap-3.5` |
| MC-0023 | `pareceres/2026-11-14-portal-config.md` | cabeçalho do portal branco com o logo numa "pílula" Azul noite (`apps/web/components/portal/base.tsx:412,428-429,438,452,456`) | média | designer-ux (especificação) · engenheiro-apps | aberto; a barra inteira vira a faixa Azul noite (manual §4) |
| MC-0024 | `pareceres/2026-11-14-portal-config.md` | número dos passos das bases em grafite (`apps/web/components/portal/cartao-base.tsx:213`, `cartao-equipe.tsx:113`) | baixa | engenheiro-apps | aberto; `bg-ink` → `bg-accent` |
| MC-0025 | `pareceres/2026-11-14-prs-ponte.md` | avatar do Início do Campo fora da Névoa (`modules/core/app/telas/inicio/tela-inicio-campo.tsx:167`; PR #247) | baixa | modulo-core | retestado e fechado (main e5d3705) |
| MC-0026 | `pareceres/2026-11-14-prs-ponte.md` | "Fechar painel" do `Dialog` sem o foco Azul noite (`packages/ui/src/web/overlay.tsx:136`; PR #249) | baixa | designer-ux | retestado e fechado (main 7af3410) |
| MC-0027 | `pareceres/2026-11-14-prs-ponte.md` | hex solto `accent-[#1e3350]` (`modules/core/web/components/perfis/novo-perfil.tsx:53`, `usuarios/usuarios-page.tsx:425`; PR #250) | baixa | modulo-core | aberto; `accent-[#1e3350]` → `accent-accent` |
| MC-0028 | `pareceres/2026-11-14-prs-ponte.md` | "marcar todos" do Novo perfil: estado "parte" invisível e ✓ em `#3B3B3B`, fora da paleta (`novo-perfil.tsx:25-31`; PR #250) | média | modulo-core | aberto; caixa branca com ✓ e traço em Azul noite (`accent`) |
| MC-0029 | `pareceres/2026-11-14-prs-ponte.md` | foco dos campos do BKO fora do Azul noite (`packages/ui/src/web/ui.tsx:39`, `permissoes.tsx:340`; PR #253) e no `apps/web/app/globals.css` (linha a confirmar) | baixa | designer-ux (kit) · engenheiro-apps (`globals.css`) | aberto; foco `outline-accent` |
| MC-0030 | `pareceres/2026-11-14-prs-ponte.md` | prints do PR #251 com fonte serifada (`docs/modulos/vendedor/prints/gerar.mjs`; causa a confirmar no PR) | baixa | modulo-vendedor | aberto; gerar de novo em Archivo e IBM Plex Sans (manual §5) |
| MC-0031 | `pareceres/2026-11-14-prs-ponte.md` | maquete do PR #251 diferente do `AvisoRodape` e do `EstadoVazio` do kit (`gerar.mjs:30-32`) | baixa | modulo-vendedor | aberto; maquete com as medidas e as cores do kit |
| MC-0032 | `pareceres/2026-11-14-lote-tarde.md` | print do Início com a barra de abas imitada | baixa | modulo-core | fechado no PR #256 (merge `75a1051`) |
| MC-0033 | `pareceres/2026-11-14-lote-tarde.md` | print `apps/web/docs/prints/mc-0027-foco-busca.png` cobre o logo; e o comentário de `apps/web/app/globals.css` cita MC-0027 em vez de MC-0029 | baixa | engenheiro-apps | aberto; print sem cobrir o logo e comentário com MC-0029 |
| MC-0034 | `pareceres/2026-11-14-lote-tarde.md` | não usado (número provisório do #258; ver MC-0043 a MC-0045) | — | — | — |
| MC-0035 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: fontes | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0036 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: prints de registro | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0037 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: `.plano.on` | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0038 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: "2 meses grátis" | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0039 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: "Atual" | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0040 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: placeholder | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0041 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: `.btn.off` | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0042 | `pareceres/2026-11-14-lote-tarde.md` | simulação do `config.`: ícones dos adicionais | baixa | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0043 | `pareceres/2026-11-14-lote-tarde.md` | check-in (PR #258): tamanho único do rótulo (provisório MC-0032 no parecer do PR) | baixa | modulo-core | fechado no #258 (em revisão final) |
| MC-0044 | `pareceres/2026-11-14-lote-tarde.md` | check-in (PR #258): cadeado (provisório MC-0033) | baixa | modulo-core | fechado no #258 (em revisão final) |
| MC-0045 | `pareceres/2026-11-14-lote-tarde.md` | check-in (PR #258): Checkout secundário (provisório MC-0034) | baixa | modulo-core | fechado no #258 (em revisão final) |
| MC-0046 | `pareceres/2026-11-14-lote-tarde.md` | `config.`: altura das linhas dos adicionais | baixa | designer-ux | fechado |
| MC-0047 | `pareceres/2026-11-14-lote-tarde.md` | `config.`: seta dos selects | baixa | designer-ux | fechado |
| MC-0048 | `pareceres/2026-11-14-lote-tarde.md` | `config.`: ✓ de texto | baixa | designer-ux | fechado |
| MC-0049 | `pareceres/2026-11-14-lote-tarde.md` | `config.`: ✓ verde sem texto (campo validado) | média | designer-ux | fechado pela decisão A do Alexandre (R-20261114-172200; manual §3) |
| MC-0050 | `pareceres/2026-11-14-lote-tarde.md` | `config.`: alternador Anual no rodapé do diálogo de troca de plano | baixa | designer-ux | aberto; em correção pelo designer-ux |
| MC-0051 | `pareceres/2026-11-14-lote-tarde.md` | BKO: caixa marcada do `SeletorDePerfis` em grafite (`packages/ui/src/web/permissoes.tsx:341`) | baixa | designer-ux | aberto; caixa marcada em Azul noite (`accent`) |
| MC-0052 | `pareceres/2026-11-14-lote-tarde.md` | BKO: barra superior em Azul noite (manual §4) não aparece no shell | média | engenheiro-apps (shell) · designer-ux (especificação) | aberto; barra superior inteira na faixa Azul noite |
| MC-0054 | `manual.md` §3 | BKO: cor do título de grupo do menu lateral | baixa | designer-ux (especificação) · engenheiro-apps (shell) | decidido (A, R-20261114-184400); aplicar: título de grupo em Sol claro `#F59A52`, nunca em item, link ou botão |
| MC-0055 | `manual.md` §3 | BKO: tela atual, hover e divisória do menu lateral | baixa | designer-ux (especificação) · engenheiro-apps (shell) | decidido (A, R-20261114-184400); aplicar: `#2B3743` sobre o grafite `#16202A` |
| MC-0056 | `manual.md` §2.1 | BKO: logo do menu lateral | baixa | designer-ux (especificação) · engenheiro-apps (shell) | decidido (R-20261114-192700); aplicar: `macuxi-logo-negativo-grafite.svg` a ~28 px e o nome da distribuidora abaixo em `#C9CED5`, fora da área de proteção |
| MC-0120 | `pareceres/2026-11-15-catalogo-onda1.md` | Campo: catálogo e ficha sem sinal durante a carga com Banner âmbar e "!" e texto próprio, em vez do `CatalogoCarregando` do kit (`catalogo.tsx:140,145,221-228`, `produto.tsx:76`, `carga-online.ts:21`) | média | modulo-catalogo | aberto; usar `CatalogoCarregando` e os textos do kit |
| MC-0121 | `pareceres/2026-11-15-catalogo-onda1.md` | Indicador de carga nas abas: o shell passa o percentual da carga inteira e a spec pede o da etapa (`apps/mobile/src/lib/carga-fundo.ts:63`) | baixa | engenheiro-apps (cc designer-ux) | aberto; percentual da etapa nomeada, ou mudar o rótulo na spec |
| MC-0122 | `pareceres/2026-11-15-catalogo-onda1.md` | Novo pedido, aba Itens: busca sem sinal durante a carga sem `CatalogoCarregando` (spec §2) | baixa | modulo-vendedor | aberto; ligar o vazio do kit |
