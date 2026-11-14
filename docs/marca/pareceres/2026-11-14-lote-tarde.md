# Parecer de marca · lote da tarde de 14/11/2026 (#256, #258, `config.` enxuto e BKO)

> 2026-11-14 · design-de-marca · registro dos achados de marca dados no lote da tarde.
> **Base:** `main` `112a41e`, contra `docs/marca/manual.md` v1 (com MC-0004 B, MC-0014 A e a exceção do ✓ de campo validado) e `decisoes.md`.
> **Numeração:** os números provisórios MC-0032, MC-0033 e MC-0034 usados no parecer do PR #258 viraram, em definitivo, a **MC-0043**, a **MC-0044** e a **MC-0045**. A MC-0032 e a MC-0033 ficaram com outros achados (abaixo), e a **MC-0034 ficou sem uso**.
> **Recados:** os recados aos donos vão pelo gerente-projetos.

## Decisão registrada
- **R-20261114-172200, resposta "A"** (Alexandre, 14/11/2026): o ✓ de campo validado pode sair em verde `#1D6B4F` sem texto ao lado, sempre com rótulo de acessibilidade que diga o resultado (ex.: "CNPJ encontrado"). Registrado no manual, §3 ("Exceção ampliada"). Fecha a MC-0049.

## Situação
- **Fechadas:** MC-0032 (PR #256, merge `75a1051`); MC-0035 a MC-0042 e MC-0046 a MC-0048 (branch `nuvem/config-enxuto-designer-ux`); MC-0043 a MC-0045 (PR #258, em revisão final); MC-0049 (decisão A).
- **Abertas:** MC-0033, MC-0050, MC-0051 e MC-0052.
- **Segue aberta de antes:** MC-0018 (prancha T-0168 do BKO com o interruptor em grafite).

## Achados
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0032 | baixa | print do Início com a barra de abas imitada | §4 e §10: o print mostra o que o app mostra | print com a barra de abas real | modulo-core | fechado no PR #256 (`75a1051`) |
| MC-0033 | baixa | `apps/web/docs/prints/mc-0027-foco-busca.png` (cobre o logo); comentário de `apps/web/app/globals.css` cita MC-0027 | §2.3 (área de proteção) e registro do catálogo | print sem cobrir o logo; comentário com MC-0029 | engenheiro-apps | aberto |
| MC-0034 | — | não usado | — | — | — | — |
| MC-0035 a MC-0042 | baixa | simulações do `config.`: fontes; prints de registro; `.plano.on`; "2 meses grátis"; "Atual"; placeholder; `.btn.off`; ícones dos adicionais | §3 e §5 | corrigido na simulação | designer-ux | fechado (branch `nuvem/config-enxuto-designer-ux`) |
| MC-0043 a MC-0045 | baixa | check-in (PR #258): tamanho único do rótulo; cadeado; Checkout secundário (provisórios MC-0032 a MC-0034) | §3 e §5 | corrigido no PR | modulo-core | fechado no #258 (em revisão final) |
| MC-0046 | baixa | `config.`: altura das linhas dos adicionais | §5 (escala do kit) | linhas com a mesma altura | designer-ux | fechado |
| MC-0047 | baixa | `config.`: seta dos selects | §3 | seta nas cores da paleta | designer-ux | fechado |
| MC-0048 | baixa | `config.`: ✓ de texto | §3 | ✓ desenhado, nas cores da paleta | designer-ux | fechado |
| MC-0049 | média | `config.`: ✓ verde sem texto (campo validado) | §3 (verde só com texto) | decisão A: exceção registrada no §3 | designer-ux | fechado pela decisão A (R-20261114-172200) |
| MC-0050 | baixa | `config.`: alternador Anual no rodapé do diálogo de troca de plano | §4 (aplicação) | alternador fora do rodapé do diálogo | designer-ux | aberto; em correção |
| MC-0051 | baixa | BKO: caixa marcada do `SeletorDePerfis` em grafite (`packages/ui/src/web/permissoes.tsx:341`) | §3: Azul noite é a cor de ação | caixa marcada em Azul noite (`accent`, `#1E3350`) | designer-ux | aberto |
| MC-0052 | média | BKO: a barra superior em Azul noite não aparece no shell | §4: "a barra superior é Azul noite" | barra superior inteira na faixa Azul noite (`#1E3350`), logo negativo | engenheiro-apps (shell) · designer-ux (especificação) | aberto |

## Pendências citadas
- **MC-0018** (designer-ux): prancha T-0168 do BKO com o botão principal e o interruptor em grafite; trocar por Azul noite (`accent`).
- **MC-0051** (designer-ux): caixa marcada do `SeletorDePerfis` em Azul noite.
- **MC-0052** (engenheiro-apps e designer-ux): barra superior do BKO na faixa Azul noite, como manda o §4.
