# ADR 0019 — Consulta opcional sem aresta de dependência (`usaConsultasOpcionais`)

- **Status**: aceita (2026-11-03, pedido do gerente-projetos para o build das 07h30)
- **Data**: 2026-11-03
- **Tarefa**: T-0065 (RN-CORE-21, meta pelo tipo)
- **Autor**: engenheiro-software
- **Base**: ADR 0012 (consultas entre módulos), RN-CORE-02/03 (licença), RN-CORE-21

## Contexto
O Core apura a meta de venda pelo tipo (RN-CORE-21) com a consulta `vendedor.pedidos_da_meta@1`. Pela ADR 0012, quem usa uma
consulta precisa ter o dono em `depende` ou `opcionais` (`manifesto.ts`). Todo módulo depende do Core, então
`opcionais: ['vendedor']` no Core fecha o ciclo core → vendedor → core em `ordenarPorDependencia` e o `createApp` não sobe. O Core
tirou a consulta (commit 45049f5) e a apuração caiu no read-model `indicador_diario`.

A consulta é resolvida **na hora da chamada**, por nome, no registro montado com todos os módulos instalados; a ordem de carga
não importa para ela. A aresta de `opcionais` só serve à ordem de carga (e ao registro de extensões/sync), que a consulta não usa.

## Decisão
1. Campo novo no manifesto: **`usaConsultasOpcionais: ['<modulo>.<consulta>@vN']`** (padrão `[]`). O dono **não** entra em
   `depende`/`opcionais` e **não** pesa em `ordenarPorDependencia`: não há ciclo, e o dono pode subir depois do consumidor ou nem
   estar instalado.
2. Validação do manifesto: consulta do próprio módulo, consulta repetida em `usaConsultas` e dono que está em `depende` (sempre
   ativo: use `usaConsultas`) são recusados. Nome fora do padrão também.
3. Montagem (`validarConjunto`, `createApp`, `criarShell`): dono instalado que não oferece a consulta = a montagem recusa (como em
   `usaConsultas`). Dono ausente não é erro.
4. Execução (`tx.consultar` na API e no consumidor de eventos, `ambiente.consultar` no aparelho): aceita `usaConsultas` ∪
   `usaConsultasOpcionais` (`consultasDeclaradas(m)`). Dono não instalado, inativo para o usuário/tenant (licença) ou sem
   implementação no canal → **`ConsultaIndisponivel`** (503 `CONSULTA_INDISPONIVEL` se não tratada). Consulta fora das duas
   listas continua erro de programação.
5. O consumidor **sempre** trata `ConsultaIndisponivel` com um plano B (no Core: o `indicador_diario`).

## Alternativas consideradas
- **`opcionais` fora da ordenação quando fecham ciclo**: mágico (a ordem muda conforme o conjunto instalado), esconde ciclos
  reais de extensão/sync e dificulta o diagnóstico.
- **Tirar `opcionais` da ordenação de vez**: muda a ordem de carga de todos os módulos às vésperas do build; risco sem ganho.
- **Read-model no Core alimentado por eventos do Vendedor**: é o plano B atual; dado duplicado e eventual, sem o tipo da meta.
- **Inverter (Vendedor empurra para o Core)**: Core passaria a conhecer o formato do pedido; fere ADR 0011.

## Consequências
- platform-sdk: `usaConsultasOpcionais` no `ManifestoSchema`, `consultasDeclaradas`, `problemasDasConsultas` e o registro do
  aparelho leem as duas listas; testes em `packages/platform-sdk/src/consultas.test.ts` (ADR 0019).
- apps/api: `transacaoTenant().consultar` lê as duas listas; testes em `apps/api/test/app.test.ts` (ADR 0019).
- Core: volta a declarar `usaConsultasOpcionais: ['vendedor.pedidos_da_meta@1']` e mantém `opcionais` sem o Vendedor.
- Uso restrito a consultas **de leitura com plano B**; consulta sem a qual o módulo não funciona continua em `usaConsultas` com
  o dono em `depende`.
