# Parecer de marca — Farol, opção A (implementação)

- Data: 25/11/2026 (Manaus)
- Escopo: `modules/core/web/components/farol/farol-page.tsx` e `modules/core/web/lib/farol.ts` (modulo-core), SHA `2e9d1d509fe21393557f5ee53edafeb47e005a5c`
- Base: simulação da opção A, validada com a condição "a mesma regra de selo nas duas tabelas: Verde neutro, Amarelo aviso, Vermelho erro"
- Evidência: print dos cartões e dos selos em 1366 px (HTML estático com o CSS do BKO) e leitura do código

## Resultado: **liberado** (sem achados)

| Item | Conferência | Situação |
|---|---|---|
| A. Cor por token | só tokens (`text-ink`, `text-ink-2`, `text-warning`, `text-danger`, `border-line`, `bg-surface`, `bg-accent-soft`, `outline-accent`); nenhum hex nem `style` solto | conforme |
| A. Papel da cor | `TOM_DA_COR`: verde → `neutral`, amarelo → `warning`, vermelho → `danger`, sem compra → `neutral`; verde de sucesso não vira decoração | conforme |
| Condição das duas tabelas | as duas tabelas (por vendedor e por cliente) usam o mesmo `<Cor>` → `Badge tone={tomDaCor(cor)}` (linhas 379 e 448); uma regra só | conforme |
| Contadores | `tomDoContador`: cor só em Vermelhos e Amarelos acima de zero; zero, Sem compra e Verdes em `text-ink` | conforme |
| Cartão de positivação | cor de aviso ou erro só abaixo do limite e sempre com texto ("abaixo de N%"); sem fonte, estado neutro com "—" | conforme |
| Contador ativo | `bg-accent-soft` + `aria-pressed`; foco `CLASSES_DESTAQUE.foco` (`outline-accent`), o mesmo do kit | conforme |
| C. Tipografia | números 32 px semibold `tabular-nums`, rótulos 13 px `text-ink-2`, iguais nos dois cartões | conforme |

Nota (não é achado): o print está um passo atrás no fundo do contador ativo e nas classes de foco; a conferência desses dois pontos foi feita no código do SHA acima.
