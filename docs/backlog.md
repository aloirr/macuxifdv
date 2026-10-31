# Backlog

> Dono: gerente-projetos. Itens fora do escopo da sprint atual.

## Sprint 1 (abertas no quadro)
- [T-0007](../.coord/tarefas/T-0007.md) — Produto no dono definitivo (ADR-0005)
- [T-0008](../.coord/tarefas/T-0008.md) — Adaptador SQLite no aparelho
- [T-0009](../.coord/tarefas/T-0009.md) — Integração: domínio e contratos do Hub (em revisão)
- [T-0010](../.coord/tarefas/T-0010.md) — Promotor: domínio de trade marketing (em revisão)

## Futuro
- **RN-CORE-01 — exceção que acrescenta módulo**: hoje a exceção do usuário só remove (decisão de 2026-10-30).
- **RN-CORE-12 em função de domínio**: a regra está só na folha de checkout (B2 do core); falta a função pura com teste em `modules/core/domain`.
- **`canApprove` duplicado**: o vendedor/web tem cópia local até a permissão vir do platform-sdk (débito do desenho da T-0001).
- **Alias do Vitest para `@macuxi/ui/mobile`** em core e vendedor: sai quando o engenheiro publicar o subcaminho puro.
- **Integração depois da T-0009**: schema `integracao` (banco-dados), rotas `/integracao/v1` e OpenAPI (RF-INT-01), Conector (RF-INT-02), carga por arquivo (RF-INT-03) e monitor no BKO (RF-INT-04).
- **Promotor — próximos passos após a T-0010**: schema `promotor` e migrações (banco-dados), API das coletas com RN-PRO-01/02 revalidadas, telas do app (Loja) e BKO de trade; payloads Zod dos eventos `promotor.*@1`; trocar `produto_id` pelo contrato de produto do Core quando a T-0007 publicar.
- **`packages/platform-sdk/src/ambiente.ts` ausente na main**: quebra o typecheck da raiz e os testes que importam o platform-sdk (ex.: `modules/promotor/manifest.test.ts`, `domain/rn-pro-01.test.ts`). Dono: engenheiro-software.
