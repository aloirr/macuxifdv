# Metas e indicadores (RF-CORE-08; RN-CORE-20 a 22) — T-0020 fase 1

## O que existe
- **Domínio** (`modules/core/domain/metas.ts`): `indicadoresDoPeriodo`, `realizadoDaMeta`, `realizadoDosDiarios`, `necessidadeDiaria`, `painelDeMetas` e `painelDoUsuario` (entrada única: linhas no formato do sync).
- **Sync (pull, escopo `usuarios`)**: `meta` (periodo ≥ mês anterior) e `indicador_diario` (data ≥ 1º dia do mês anterior). `rota_parada` e `visita` já existiam (T-0018).
- **API**: `GET /v1/core/metas`, `PUT /v1/core/metas/:usuarioId/:periodo` (ação `meta.editar`: gerente, analista, admin; publica `core.meta.definida@1` só quando o valor ou o tipo muda, com `tipo` opcional `'pedido' | 'faturamento'` (T-0210, aditivo); audita), `GET /v1/core/indicadores`. Fora do escopo de equipe = 404.
- **App** (offline): bloco "Indicadores do mês" na aba Metas (`app/components/painel-metas.tsx`), conta em `app/lib/metas-local.ts` sobre as linhas do aparelho mais check-ins ainda na fila.
- **BKO**: página Indicadores (`/indicadores`): filtros de mês e pessoa na URL, tabela, exportar CSV, definir meta de venda (só quem tem `meta.editar`).
- **Mesmos números (critério 2)**: app e API chamam `painelDoUsuario`; os textos vêm de `app/lib/metas-formato.ts`, usados também pelo BKO.

## Premissas e o que fica para depois
- O Core não lê `vendedor.*`. O realizado vem do read-model `core.indicador_diario`, alimentado por um consumidor de `vendedor.pedido.*` (Sprint 4, com o despachante). Enquanto estiver vazio: realizado = R$ 0 e **positivação = "Aguardando pedidos"** (nulo), porque o diário não guarda cliente.
- A base das vendas vem do **tipo da meta** de venda (RN-CORE-21; T-0210), nunca do parâmetro `metas.base_apuracao` do tenant: meta de pedido = pedidos aprovados na emissão (`aprovado`), meta de faturamento = notas na data do faturamento (`faturado`); sem meta = pedido. `GET /indicadores` e `GET /metas/painel` devolvem `base_apuracao` pelos tipos das pessoas listadas (`misto` quando há os dois), e o realizado sai do mesmo tipo (`baseDoPainel`, `tipoDaMetaDeVenda` no domain).
- Feriados do tenant: ainda sem cadastro; dias úteis usam só fins de semana (`@macuxi/comum`).
- Meta e realizado de uma data só usam o mês corrente/anterior (janela do pull); mês mais antigo só no BKO.
