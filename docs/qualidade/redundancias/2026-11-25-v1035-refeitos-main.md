# Parecer do corretor-redundancias: v1.0.35, branches refeitos a partir do main (3ee9539, com a 0103)

Data: 25/11/2026 (horário de Manaus). Sessão S11. Escopo: só excessos, duplicidades e redundâncias.
Base: `origin/main` @ 3ee9539c32a1cf18668a1aa8a37d94913230103e.

## A) `nuvem/v1035-web-modulo-core-2` @ 6531293604a391ccebb487a532bb7e1b3a149875
- 3 commits (e17a549, bc24b5c, 6531293); os 2 últimos tiram os `.js` emitidos por engano. Diff líquido contra o main: 4 arquivos
  (`modules/core/api/super-admin-repositorio.ts`, `super-admin.test.ts`, `super-admin.ts`, `modules/core/contracts/plataforma.ts`), nenhum `.js`.
- `git diff 0017f74 6531293` (e contra a9d9a6e) nesses 4 arquivos: 9 linhas, todas `0107` → `0103` em comentário JSDoc, comentário de código e título de teste. Nenhuma linha adicionada cita 0107.
- Resultado: **LIBERADO no SHA 6531293604a391ccebb487a532bb7e1b3a149875**.

## B) `nuvem/v1035-web-engenheiro-apps-senha-2` @ a6a67dd4283bce10494c7290b31eb82c8fbff4ee
- 1 commit; 10 arquivos em `apps/web`. `git diff e716ec5 a6a67dd` nos 10 arquivos: vazio (conteúdo idêntico ao liberado).
- Resultado: **LIBERADO no SHA a6a67dd4283bce10494c7290b31eb82c8fbff4ee**.

## C) `nuvem/v1035-web-testes-senha-2` @ 4f8be9f24576e1e648437350dd9f8627a07a72b3
- 1 commit; 2 arquivos (`tests/integracao/api/troca-senha-portal-v1034.test.ts`, `tests/e2e/web/portal-01b-04-api.spec.ts`).
- `git diff 726816e 4f8be9f`: o spec e2e é idêntico; no teste de integração, 6 linhas, todas `0107` → `0103` em comentário e título de `describe`.
- Resultado: **LIBERADO no SHA 4f8be9f24576e1e648437350dd9f8627a07a72b3**.

## Achados
Nenhum. Faixa reservada RD-3574 a RD-3599 não usada; catálogo sem alteração.
