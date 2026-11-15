# Parecer de marca · coluna Plano na lista de empresas do portal `config.` (PR #359, engenheiro-apps)

> 2026-11-15 · design-de-marca · implementação, antes do lote.
> **Base:** branch `nuvem/planos-coluna-engenheiro-apps` (diff contra `origin/main`: `apps/web/components/portal/tela-empresas.tsx`, `apps/web/lib/portal-falso.ts`, `apps/web/lib/portal-telas.test.ts`) e o print `coluna-plano-2.png` (1366 × 768, modo falso), contra a simulação aprovada `docs/design/planos-assinatura/01-empresas.png` (branch `nuvem/planos-assinatura-designer-ux`) e o parecer `2026-11-15-planos-assinatura.md`.
> **Escopo:** só a coluna Plano e o selo "teste".

## Parecer: liberado (sem achados)

## O que foi conferido
| Item | Manual | Resultado |
|---|---|---|
| Cabeçalho "Plano" | §5 | no lugar de "Módulos", entre CNPJ e Situação, como na simulação 01. Mesmo estilo (`th`) das outras colunas |
| Nome do plano | §5, §11 | "PME", "Light", "Enterprise" em IBM Plex Sans regular, no mesmo `td` das outras colunas. Nomes do §11 aprovado, sem variação de grafia. Sem plano: "—", como o CNPJ vazio |
| Selo "teste" | §3 | `<Badge tone="neutral">` do `packages/ui`, por token, sem hex solto. No pixel: fundo Névoa `#ECEEF1`, texto `#34404D`, 9,09:1. Mesmo selo neutro da simulação 01 e do "Inativa" da mesma tela. Nunca verde nem aviso |
| Posição do selo | §3 | ao lado do nome, `gap-1.5` (6 px), alinhado na linha, como na simulação 01. Só aparece com `em_teste` e plano preenchido |
| Cor nova | §3 | nenhuma |

## Fora do escopo (sem achado)
O topo branco do portal, a coluna Backup e os códigos em slug do modo falso já estão no `main` e não mudam neste PR; não entram neste parecer.

## Só o Alexandre aprova
Nada novo: a coluna e o selo seguem a simulação 01 e os nomes do §11.
