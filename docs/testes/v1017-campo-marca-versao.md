# v1.0.17 (Campo) — ocultar a logomarca do Macuxi e versão publicada do app: matriz de cenários

> 2026-11-20 · testes · itens 15 e 19 do teste de campo do Campo v1.0.16 · desenho `docs/desenho/v1017-campo-versao-e-marca.md` ·
> migração 0091 (`banco-dados`) · RN-CORE-33 (só o super-admin grava).

## Matriz

| # | Cenário | Onde | Nível |
|---|---|---|---|
| OM-01 | Padrão `false` em A e B: coluna, `GET .../marca` (super-admin e admin do cliente) e parâmetro do Core `empresa_ocultar_marca_macuxi` no aparelho | `tests/integracao/api/ocultar-marca-macuxi-v1017.test.ts` | API + Postgres |
| OM-02 | Perfil errado: admin do cliente = 403 `PERFIL_SEM_ACESSO` (própria empresa e outra); sem sessão 401; token do app 401; nada muda, nada auditado | idem | API + Postgres |
| OM-03 | Super-admin grava `true`: resposta e `GET .../marca` com `true`, `private, no-store`, sem `chave`; valor × regra: o parâmetro do Core é a coluna do banco; `versao_licencas` muda | idem | API + Postgres |
| OM-04 | Tenant errado: gravar em A não muda B (coluna, marca, parâmetro e `versao_licencas` de B) | idem | API + Postgres |
| OM-05 | Reenvio do mesmo valor = 200 sem auditoria nova; tenant inexistente = 404 `TENANT_NAO_ENCONTRADO`; `false` volta a mostrar; auditoria `sa.empresa.ocultar_marca` do super-admin | idem | API + Postgres |
| AV-01 | `GET /v1/app/versao` sem `APP_<VARIANTE>_*` no ambiente = 404 `SEM_VERSAO` (400 e contrato: `apps/api/test/app-versao.test.ts`) | idem | API + Postgres |
| — | Marca do portal com `ocultar_marca_macuxi` (`CHAVES_MARCA` e LC-01) | `tests/integracao/api/logo-cliente-t0182.test.ts` | API + Postgres |
| — | A sa_* nova revisada em `DEFINER_REVISADAS_PORTAL` (38 no total; EXECUTE só ao `macuxi_portal`) | `tests/integracao/banco/conformidade.test.ts` | catálogo |
| — | Corpo inválido do PUT (400) | `apps/api/test/empresa-logo.test.ts` e SDK | unitário |
| — | Rota com fonte em memória, `versoesAppDoAmbiente`, `haVersaoNova` | `apps/api/test/*.test.ts`, `packages/platform-sdk/src/*.test.ts` (engenheiro-software) | unitário |
| — | 0091 (CHECK, 28000/42501/22023/P0002, auditoria, down) | `db/testes/tenant-ocultar-marca.db.test.ts` (banco-dados) | banco |

## Teste manual (aparelho real)

1. Portal `config.` (super-admin): ligar "ocultar a logomarca do Macuxi" na empresa A.
2. Campo e Gestão de A: sincronizar → carga, Mais e login sem a logomarca do Macuxi, só a do cliente. Sair e entrar sem rede: continua oculta.
3. Aparelho de B: a logomarca do Macuxi continua.
4. Desligar no portal → sincronizar em A → a logomarca do Macuxi volta.
5. "Verificar atualização" com o servidor sem versão publicada: "sem atualização"; com versão maior: ação de baixar o APK.
