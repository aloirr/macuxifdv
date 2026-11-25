# Redundâncias — Perfis sem base com o motor desligado na v1.0.37 (S7, 25/11/2026, noite de Manaus)

Escopo (decisão 3 B do dono do produto: a v1.0.37 leva os perfis com o motor desligado):
- **A** — #771, `git diff 64a7396 3acce47db` (banco-dados): 0106 deriva e grava `catalogo_aplicado` em `legado`; `perfis_derivados(tenant)`; espelho da 0107 em `legado` sem apagar o modelo antigo; tenant novo nasce em `legado`; testes, fixture, diagnóstico e dicionário.
- **B** — #801, commit `e45cd9832` por cima do merge `f2db6ed8d` (banco-dados): 0108 aplica a v2 no tenant derivado, sem mudar a leitura; `catalogo-v2.db.test.ts` e dicionário.

**Parecer: LIBERADO em 3acce47db95d3ff42e32a3923d6de3c886b60674 e em e45cd9832f815e3d9fda1c9cc71d62f564338e14.** Os 2 achados são baixos e estão só em comentário e teste: não seguram (R-20261111-190159), entram no próximo lote.

## RD-3721 — comentário da fixture ainda fala do modelo ligado (doc, baixa, só comentário)
- `db/seeds/fixtures/dois-tenants.ts:1221` (3acce47db): "os dois tenants em 'concessao'" logo acima de `leitura: 'legado'`. **Já corrigido em e45cd9832** ("os dois tenants derivados em 'legado' ...").
- `db/seeds/fixtures/dois-tenants.ts:762` (nos dois heads): "o tenant nasce migrado" → "o tenant nasce derivado, em 'legado'" (o termo do resto do lote).

## RD-3722 — mesma chamada e mesma conferência duas vezes no teste de idempotência (teste, baixa)
- `db/testes/perfis-sem-base-migracao.db.test.ts:130` e `:135` (nos dois heads): `migrar_perfis_sem_base` → `'derivado'` seguido de `retratoConcessoes = antes`, duas vezes no mesmo laço; a segunda não acrescenta caso (o tenant já estava derivado na primeira).
- Correção: apagar as linhas 135 e 136 (segunda chamada e segundo retrato); fica a contagem de `achados` (134) para o ramo `ja_migrado`.

## Conferido sem achado
- `perfis_derivados` é a única condição do espelho (0107: `espelhar_perfil` e semeadura) e da 0108 (`aplicar_catalogo_v2`): a regra "tenant derivado" fica num lugar só, sem cópia de `leitura_de_perfis(...) = 'concessao'`.
- Docs: `plataforma.md` e o plano dizem "motor desligado na v1.0.37; quem liga é a 0109" uma vez por seção (0105–0107, 0108 e situação do plano), cada uma no próprio contexto; o comentário da migração não repete o dicionário além do cabeçalho da função.
- Testes: `perfis-derivados` conferido nos arquivos de migração, conflitos, semeadura e espelho, cada um num caso diferente (A/B, parado × derivado, tenant novo, espelho em `legado`); o "zero em 'concessao'" aparece em migração, up/down e catálogo v2, um por cenário (fixture, banco efêmero, v2). Teste novo do espelho (modelo antigo intocado) não repete outro.
- B: só troca `leitura = 'concessao'` por `perfis_derivados` e os textos; o teste do tenant parado passou a usar `para_tenant` (caso distinto do tenant derivado).
