# Gestor — API, telas do app Gestão e páginas do BKO (T-0055)

Regras de cálculo: `regras.md` (RN-GES-01..08). Este arquivo descreve **como** elas chegam ao usuário: rotas `/v1/gestor`, consumidores de eventos, persistência, telas do Macuxi Gestão e páginas do BKO.

## 1. Rotas (`modules/gestor/api/rotas.ts`)
O `createApp` aplica, em toda rota: login → **licença do Gestor** (403 `MODULO_INATIVO`, RN-CORE-02) → **perfil** (ação do manifesto ou `perfis`) → Zod. O **escopo** (RN-CORE-04) vem de `ctx.usuariosVisiveis()` (lista autoritativa da plataforma) e é aplicado pelo domain (`escopoDosVisiveis`): supervisor/gerente = usuários visíveis menos ele; analista/admin = tenant em **leitura** (RN-GES-07); demais perfis = vazio (falha fechada). Fora do escopo = **404 sem revelar**.

| Método e caminho | Acesso | Resposta (contracts) | Regra |
|---|---|---|---|
| `GET /v1/gestor/equipe?data=` | supervisor, gerente, analista, admin (`painel_equipe.ver` ∪ `painel_tenant.ver`) | `VisaoEquipe` (resumo, equipes abaixo + `gestores`, painel do dia de cada pessoa de campo) | RF-GES-01, RN-GES-05/06 |
| `GET /v1/gestor/equipe/:usuario_id?data=` | idem | `FichaMembro` (painel + disponibilidade do pedido em nome) | RF-GES-02/05/10 |
| `GET /v1/gestor/ranking?indicador=&periodo=&data=` | idem | `RankingEquipe` | RF-GES-03 |
| `GET /v1/gestor/aprovacoes` | idem (analista/admin com `pode_decidir = false`) | `FilaAprovacao` | RF-GES-04, RN-GES-03/04/07 |
| `GET /v1/gestor/alertas?status=` | idem | `ListaAlertas` (sem `status` = abertos e dispensados) | RF-GES-07 |
| `POST /v1/gestor/alertas/:id/dispensar` | `alerta_equipe.dispensar` (supervisor, gerente) — auditado | `Alerta` | RF-GES-07 |
| `GET /v1/gestor/alertas/regras` | `alerta_regra.gerenciar` (analista, admin) | `RegrasAlertaResposta` | RF-GES-07 |
| `PUT /v1/gestor/alertas/regras/:tipo` | `alerta_regra.gerenciar` — auditado; inválido = 422 `REGRA_ALERTA_INVALIDA` | `RegraAlerta` | RF-GES-07, RN-GES-01/03 |
| `GET /v1/gestor/pedido-em-nome/disponibilidade?vendedor_id=` | leitura (RN-PRO-01: caminho de pedido, promotor barrado) | `DisponibilidadeEmNome` | RF-GES-05, RN-VEN-35 |

Notas:
- **Decisão da aprovação mora no Vendedor** (ADR 0011, `pedido.aprovar`): o Gestor não tem rota de decidir. O app abre `/m/pedido?id=` e o BKO abre `/pedidos?status=pending_approval&seller_id=`; a alçada é revalidada lá (RN-VEN-10) e o aviso ao supervisor (RN-GES-04) também.
- **Alertas** são reconciliados na leitura (`reconciliarParaViewer`): avalia as condições em `ctx.agora()` e grava abrir/atualizar/encerrar só nos tipos cujo módulo está ativo para quem consulta (RN-CORE-03). Dispensado não reabre enquanto a condição persistir.
- **Nomes da equipe**: `core.cadastro_resumo@1` (ADR 0012, `usaConsultas`). Supervisor/gerente = usuários visíveis; tenant = usuários que aparecem na projeção (`usuariosDaProjecao`). Enquanto o Core não oferece a **hierarquia por consulta**, a equipe fica pendurada em quem consulta (`membrosDoCadastro`): o gerente vê o total e as pessoas, mas `equipes` (por supervisor) só aparece quando a árvore chegar.
- Parâmetros do tenant: `parametrosDoTenant(ctx.parametros(), ctx.fuso())` — só as chaves do Gestor; inválido volta ao padrão com aviso no log.

## 2. Consumidores (`api/consumidores.ts`)
Um por evento de `consome` do manifesto. Schema aberto no consumidor; quem valida é `aplicarEvento` (idempotente por `evento_id` e chave de negócio, indiferente à ordem). Payload fora do contrato vira aviso no log (sem payload) e **não trava** a fila do despachante. Tenant = o do envelope.

## 3. Persistência (`api/repositorio.ts`)
Interface `RepositorioGestor` (estado da projeção, alertas, ajustes das regras), por `{ db, tenant_id }` da transação. **Hoje: memória por processo** (`criarRepositorioEmMemoria`), porque a migração do schema `gestor` ainda não está no main. Reiniciar a API zera a projeção (eventos novos voltam a alimentar). Para ligar o banco: nova fábrica SQL com a mesma interface em `api/index.ts`.

O que a migração precisa ter (pedido ao banco-dados): ver o recado da T-0055 (tabelas `gestor.projecao_fato`, `gestor.evento_aplicado`, `gestor.alerta`, `gestor.alerta_regra`, RLS por `tenant_id`, colunas padrão).

## 4. App Macuxi Gestão (`app/`)
| Página | Caminho | Aba | Ação |
|---|---|---|---|
| Equipe | `/m/equipe` | Equipe (ordem 10) | `painel_equipe.ver` |
| Aprovações | `/m/aprovacoes` | Aprovações (ordem 20) | `fila_aprovacao.ver` |
| Alertas | `/m/alertas` | Alertas | `alerta_equipe.ver` |
| Ficha | `/m/equipe-membro?id=` | — | `painel_equipe.ver` |
| Ranking | `/m/equipe-ranking` | — | `ranking_equipe.ver` |

Offline-first: cache no armazenamento do módulo (`mod:gestor:`; apagado se o Gestor for desativado, RN-CORE-02), alimentado SÓ pela etapa de sync `gestor-equipe` do motor da plataforma; toda resposta é validada no contrato antes de gravar. **RN-CORE-23**: nenhuma tela tem timer, consulta periódica ou recarga ao focar a aba; a atualização leve é do motor (`sync_auto_min`, 30 min, mínimo 15; ao abrir o app; ao voltar ao primeiro plano após 30 min — agendamento do shell) e "puxar para baixo" = Sincronizar (`motor.sincronizar()`, com proteção de 30 s contra toques repetidos — `podeSincronizarAgora`, item 5). Ficha e ranking buscam a API só quando o usuário abre a tela (sob demanda). Guarda: `app/sem-consulta-periodica.test.ts`. Sem sinal: telas mostram o cache com aviso; dispensar alerta e decidir pedido pedem internet. A ficha offline vem do cache da visão (sem pedido em nome). Pedido em nome: botão só se a API permitir **e** o Vendedor registrar item no slot `pedido.criar_em_nome` (payload esperado `{ rotulo?, abrir({ vendedor_id, autor_id }) }`, contrato pedido ao Vendedor).

## 5. BKO (`web/`)
Menus do manifesto: Painel da equipe (`/equipe`), Ranking (`/ranking`), Aprovações (`/aprovacoes`), Alertas (`/alertas`) — leitura para supervisor, gerente, analista e admin — e Regras de alerta (`/regras-alerta`, `alerta_regra.gerenciar`). Filtros na URL (`data`, `indicador`, `periodo`, `status`), CSV na equipe e no ranking, dispensar só com `alerta_equipe.dispensar`. RN-CORE-23: sem consulta periódica curta; busca ao abrir a página, ao voltar à aba do navegador e no botão "Atualizar"; só o painel de aprovação atualiza sozinho, a cada `sync_auto_min` (`intervaloAutomaticoMs`: padrão 30 min, mínimo 15; o BKO ainda não expõe o parâmetro do tenant, então vale o padrão).

## 6. Pendências fora do módulo
- banco-dados: migração do schema `gestor` (seção 3) e **licença do Gestor no tenant demo** (seed `plataforma.tenant_modulo` e `perfil_modulo` de supervisor/gerente).
- modulo-core: consulta `core.hierarquia_equipe@1` (árvore com `superior_id`) e os campos de carteira no `core.cliente.atualizado@1` (RN-GES-01/02).
- modulo-vendedor: contrato e item do slot `pedido.criar_em_nome` (RN-VEN-35) e `credito`/`historico` no `vendedor.pedido.aprovacao_solicitada@1`.
- engenheiro-software: declarar no `package.json`/lockfile as dependências de tela do Gestor (react, react-native, expo-router, next, @macuxi/ui, @tanstack/react-query), hoje resolvidas pelo `node_modules` achatado.
- testes: e2e do fluxo (evento → painel → alerta → dispensa) e virar o caso D-G05 quando a licença da demo existir.
