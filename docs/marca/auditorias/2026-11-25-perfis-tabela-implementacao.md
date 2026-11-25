# Parecer de marca: tabela de permissões dos perfis, implementação E5 (25/11/2026)

> design-de-marca · 25/11/2026 (Manaus) · segue o parecer da simulação (`2026-11-24-perfis-tabela.md`, VALIDADO).
> A — kit do designer-ux: SHA `5037b7b7bdd8042b543956916c9547656a4418aa` (`packages/ui/src/web/tabela-permissoes.tsx`, `tabela-permissoes-estado.ts`), print `e5-kit-1366.png`.
> B — página do modulo-core: SHA `3a087090b3a00bffd9aa8d50bb599a321bfdb8ab` (`modules/core/web/components/perfis/perfis-page.tsx`), prints `e5-pagina-vendedor-1366.png` e `e5-pagina-admin-1366.png`.
> Base: `docs/marca/manual.md` §3 (paleta e contraste). Cores medidas nos pixels dos prints.

## Parecer

| Entrega | Parecer |
|---|---|
| A — kit (`5037b7b7`) | **VALIDADO** |
| B — página (`3a087090`) | **NÃO VALIDADO**: 1 ajuste (MC-E5-01) |

Só o dono do produto aprova a marca; este parecer diz se a implementação segue o manual e a simulação validada.

## A — kit: o que foi conferido

| Elemento | Medido no print | Token no código | Resultado |
|---|---|---|---|
| Caixa marcada (linha, grupo, "parte") | `#1E3350`, ✓ branco (12,77:1) | `bg-accent text-on-accent` | ok |
| Caixa travada marcada | `#7A8593`, ✓ branco (3,75:1) | `bg-field border-field` | ok: resolve a observação 1 de 24/11 (antes `#8B96A3`, 3,00:1) |
| Caixa vazia livre | borda `#7A8593` no branco | `border-field bg-surface` | ok |
| Caixa travada vazia | `#ECEEF1` | `bg-line-2 border-line` | ok |
| Rótulo e cadeado da linha travada | `#4A5562` (7,59:1) | `IconLock`, texto secundário | ok |
| Selo "Sem licença" | `#7A4F00` no `#FFF1D6` | `Badge tone="warning"` | ok (observação 3 de 24/11 atendida) |
| Aviso de autogestão | Névoa `#ECEEF1`, texto `#34404D` | `Notice` neutro | ok |
| Escopo ativo (Dados) | `#1E3350`, texto branco | Azul noite | ok |
| Cabeçalho de grupo | Pérola `#F8F6F1` | fundo | ok |

Observação (não segura): `CORES_CAIXA` repete os hex só para o teste de contraste; as classes usam os tokens. Se o token
`field` mudar no `globals.css`, o teste precisa acompanhar. O ✓ da travada usa `text-white` em vez de `text-on-accent`
(mesmo `#FFFFFF`); alinhar quando o kit for tocado de novo.

## B — página: o que foi conferido

Mesmas cores do kit nos dois prints: marcada `#1E3350`, travada marcada `#7A8593`, escopo ativo `#1E3350`, aviso Névoa
`#ECEEF1` com `#34404D`, "Salvar" e "Descartar" desabilitados em Névoa com `#5B6673`. Coerente com a simulação.

### Achado

| Campo | Conteúdo |
|---|---|
| ID | MC-E5-01 |
| Onde | BKO › Parâmetros › Acesso › perfil (Vendedor e Admin), linha embaixo de "Cargo"; `modules/core/web/components/perfis/perfis-page.tsx:382` |
| Tipo | cor · ícone |
| Fere | Manual §3 (só cores da paleta, pelo token): o emoji 🔒 desenha um cadeado amarelo (`#E2A610` medido), fora da paleta e diferente dos cadeados cinza da própria tabela |
| Gravidade | média (visível ao cliente) |
| Correção | `🔒 {MENSAGEM_CARGO_TRAVADO}` → `<IconLock size={13} className="shrink-0" /> {MENSAGEM_CARGO_TRAVADO}` (de `@macuxi/ui/web`), na cor do texto `text-ink-2` (`#4A5562`), com o `span` em `inline-flex items-center gap-1` |
| Dono | `modulo-core` |

Fora desta entrega: menu lateral em caixa alta e Sol claro (MA-01 e MA-02 da revisão geral), já com o engenheiro-apps.
