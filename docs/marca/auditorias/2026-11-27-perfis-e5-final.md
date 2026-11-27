# Parecer de marca: perfis, E5 final (v1.0.40, 27/11/2026)

> design-de-marca · 27/11/2026 (Manaus) · segue `2026-11-24-perfis-tabela.md` (simulação, VALIDADO) e
> `2026-11-25-perfis-tabela-implementacao.md` (branch `nuvem/v1037-perfis-design-de-marca`: kit VALIDADO, página com MC-E5-01).
> A — #853 kit (designer-ux): `nuvem/v1040-designer-ux-perfis` @ `75a3813bc7f25ac87795ac95819140486013ab9c`.
> B — #854 tela (modulo-core): `nuvem/v1040-modulo-core-perfis` @ `183638eb8990351d6795a44291002402b7147b77`.
> Base: `docs/marca/manual.md` §3 (paleta, papel das cores, contraste, só token).

**Prints:** não há print novo. `origin/nuvem/v1040-testes-perfis` continua em `cfa7e291` (cita #853 `9da50153` e #854
`908fc0c1`, anteriores aos heads). Este parecer avalia **pelo código** nos heads acima; as cores dos tokens são as mesmas
medidas nos prints de 25/11. Quando o testes publicar `perfis-vendedor-1366.png` e `perfis-admin-1366.png` sobre `183638eb`,
o design-de-marca confere o cadeado do Cargo no pixel.

## Parecer

| Entrega | SHA | Parecer |
|---|---|---|
| #853 — kit | `75a3813b` | **VALIDADO** |
| #854 — tela | `183638eb` | **VALIDADO** (MC-E5-01 resolvido no código) |

Só o dono do produto aprova a marca; este parecer diz se a implementação segue o manual e a simulação validada.

## A — kit (`packages/ui/src/web/tabela-permissoes.tsx`)

| Item | No código | Resultado |
|---|---|---|
| ✓ da caixa travada marcada | `travadaMarcada: 'border-field bg-field text-on-accent'` (linha 41) | ok: resolve a observação de 25/11 (`text-white` → `text-on-accent`, mesmo `#FFFFFF`, 3,75:1 sobre `field` `#7A8593`) |
| Caixa marcada | `border-accent bg-accent text-on-accent` | ok (12,77:1) |
| Vazia, travada vazia | `border-field bg-surface`; `border-line bg-line-2` | ok |
| Segmentado de escopo | `peer-checked:bg-accent peer-checked:text-on-accent`, travado `text-ink-2` | ok |
| Cabeçalho de grupo, motivo, contagem | `bg-ground`, `text-ink`, `text-ink-2` | ok |
| Aviso de autogestão | `Notice tone="info"` | ok |
| Hex cru em classe ou `style` | nenhum | ok |

## B — tela (`modules/core/web/components/perfis/*`)

| Item | No código | Resultado |
|---|---|---|
| MC-E5-01 — cadeado do Cargo | `cabecalho-perfil.tsx:99-102`: `span` `inline-flex items-center gap-1 ... text-ink-2` com `<IconLock size={13} className="shrink-0" />` e `MOTIVO_CARGO_TRAVADO` | **fechado**: sem emoji 🔒 em `modules/core/web/components/perfis` e `lib/perfis-tabela.ts`; cadeado na cor `ink-2` `#4A5562`, igual aos da tabela |
| Classes de cor da tela | só tokens: `text-ink`, `text-ink-2`, `text-accent-ink`, `text-danger`, `bg-surface`, `bg-ground`, `border-line`, `border-line-2`, `border-field` | ok, todos no `globals.css` e na paleta do §3 |
| Hex cru | nenhum em `perfis-page.tsx`, `cabecalho-perfil.tsx`, `novo-perfil.tsx`, `lib/perfis-tabela.ts` | ok |

## Achados

| ID | Onde | Tipo | Fere | Gravidade | Correção | Dono |
|---|---|---|---|---|---|---|
| MC-E5-01 | `modules/core/web/components/perfis/cabecalho-perfil.tsx:101` | cor · ícone | §3 | média | aplicada em `183638eb` | `modulo-core` — **fechado** (código; reteste no print quando houver) |
| MC-E5-02 | `packages/ui/src/web/tabela-permissoes.tsx:46` | cor | §3 (só token, nunca hex solto) | baixa — **lote seguinte**, não segura | `CORES_CAIXA` repete `#1E3350`, `#7A8593` e `#FFFFFF` em código de produção exportado só para o teste de contraste. Depois: ler os valores dos tokens `accent`, `field` e `on-accent` de uma fonte única (a mesma do `globals.css`) ou mover a constante para o próprio teste | `designer-ux` |

Fora desta entrega: MA-01 e MA-02 da revisão geral (menu lateral), com o engenheiro-apps.
