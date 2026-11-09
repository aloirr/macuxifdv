# Consulta `core.calendario_metas@1` (T-0124; RN-CORE-26)

O Gestor (e qualquer módulo) lê a semana de dias úteis do tenant sem ler o parâmetro do Core.

| Item | Valor |
|---|---|
| Entrada | `{}` |
| Saída | `{ dias_uteis_semana: number[] (0 = domingo … 6 = sábado, padrão 1..6), feriados: string[] ('AAAA-MM-DD', vazia até existir o cadastro de feriados) }` |
| Fonte | `ctx.parametros()` do Core (`metas.dias_uteis_semana`), validado por `calendarioDoTenant`; ausente ou inválido = segunda a sábado |
| Declaração | `configuracaoDoTenant: true` (ADR 0025 §4.1): igual para qualquer usuário, vale também em rota de escrita |
| Contrato | `modules/core/contracts/inicio-parametros.ts` (`CONSULTA_CALENDARIO_METAS`); implementação em `modules/core/api/consultas.ts` |

Dias úteis: o Core usa `diasUteisDoPeriodo` / `ehDiaUtilDoTenant` de `@macuxi/comum` (meta do dia, Metas, Início e projeção da RV, RN-CORE-29). Sem lista de feriados do tenant só a semana conta; com a lista informada, os feriados nacionais contam junto com os do tenant (RN-CORE-26).
