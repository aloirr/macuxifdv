# Core — rotas e visitas reais (T-0018)

Desenho: `docs/desenho/T-0016.md` §2, §4 e §9; ADR 0009 (sync de escrita, escopo, D-2) e ADR 0010 (fotos).

## Sync
| Entidade | Direção | Escopo | Janela |
|---|---|---|---|
| `motivo` | pull | tenant | — |
| `rota`, `rota_parada` | pull | usuários visíveis (RN-CORE-04) | data ≥ hoje − 40 (sem limite superior: ADR 0009, adendo §5) |
| `visita` | ambos | usuários visíveis | `data_local` ≥ hoje − 40; push = check-in (id = id da visita) |
| `visita_checkout` | push | — | id = UUID do comando, gravado em `visita.checkout_id` |

## Regras que o servidor revalida (`modules/core/api/visita-push.ts`)
- RN-CORE-10: fora do raio (`core.checkin.raio_m`, padrão 200 m) exige justificativa → `rejeitado/RN-CORE-10`; com ela, `fora_do_raio` fica gravado; cliente sem coordenada → `sugere_coordenada` (aprovação no BKO grava a coordenada, audita e publica `core.cliente.atualizado@1`).
- RN-CORE-11: um atendimento aberto por usuário; o novo check-in fecha o anterior como `auto`/`nao_finalizado` (virada do dia no fuso do tenant); o checkout do usuário vence o fechamento automático.
- RN-CORE-12: com Vendedor efetivo, `sem_pedido` exige motivo; sem Vendedor o resultado é `atendido`. Etapas de outros módulos: o servidor só guarda (`visita_etapa`); a conferência por módulo entra com a primeira etapa real.
- RN-CORE-13: o GPS só chega no check-in e no checkout; sem GPS o atendimento segue marcado `sem_gps`. O app não usa mais a coordenada do cliente como reserva.
- RN-CORE-14: `cliente_fechado` exige motivo do tipo `cliente_fechado` + `foto_fachada_id` (`tx.registrarArquivo`; foto de outra visita = `ARQUIVO_JA_REFERENCIADO`). Motivos de sistema não se editam nem removem (422).
- Idempotência: reenviar o mesmo id é `aceito` sem duplicar; mesmo id de outro usuário = `ID_EM_USO`; visita de outro usuário ou inexistente = `VISITA_NAO_ENCONTRADA`; checkout diferente sobre visita já fechada pelo usuário = `conflito`.

## Rotas `/v1/core`
`GET rotas` · `GET rotas/:usuarioId/:data` · `PUT rotas/:usuarioId/:data` (`rota.editar`) · `POST rotas/:usuarioId/:data/copiar` · `POST rotas/gerar` (idempotente, semana = segunda-feira) · `GET usuarios/:id/clientes` (carteira vigente do usuário) · `GET visitas` · `GET coordenadas-sugeridas` e `PUT clientes/:id/coordenada` (`cliente.aprovar_coordenada`) · `GET motivos`, `PUT/DELETE motivos/:id` (`motivo.editar`).

## App
A folha de checkout aplica a RN-CORE-12 com `prepararCheckoutVisita` (domain, T-0037; detalhes em `telas-b2.md`). O estado (clientes, rota do dia, visitas) é montado só das linhas do aparelho ⊕ fila (`app/lib/rota-local.ts`); check-in e checkout entram na fila (`visita`, `visita_checkout`) e a foto da fachada na fila de arquivos depois do comando. Cargas REST da Fase M: só `metas` e `pedidos-da-visita` (saem na T-0020 e com o Vendedor).

## BKO
Rotas (editor herdado da Fase M sobre `/v1/core/rotas`: reordenar, adicionar da carteira, 2-opt, copiar dia), Visitas (filtros na URL, CSV, foto da fachada), Coordenadas sugeridas, Motivos, Carteira e Cliente 360 (T-0017).

## "Hoje" é o dia do fuso do tenant (C6, T-0042)

CLAUDE.md regra 4: datas gravadas em UTC; regra de dia no fuso do tenant. Entre 20:00 e 24:00 de Manaus a data UTC já é a do dia seguinte, então o Core **nunca** usa `current_date` do banco nem `toISOString().slice(0, 10)` para "hoje".
- API: `dataLocal(ctx.agora(), ctx.fuso())`. Vigência da carteira (`carteira.ts`, `rotas.ts` `usuarios/:id/clientes`) recebe a data como `$2::date`; as janelas do pull (`sync.ts`) usam o marcador `{{hoje}}`, trocado por `comHoje()` (data validada AAAA-MM-DD) em `sqlDoPull(..., hoje)` e no Cliente 360.
- `carteiraDoUsuario(usuario, banco, { agora?, fuso? })`: o serviço do SDK não passa o contexto, então o fuso vem de `plataforma.tenant` (uma consulta) e o relógio é o real; os testes injetam os dois. Pedido ao engenheiro-software: passar `ctx.fuso()`/`agora` ao serviço `carteira`, para dispensar a consulta.
- BKO: `useHojeDoTenant()` (`web/lib/queries.ts`) devolve o "hoje" no fuso da sessão (rotas, carteira para o editor, visitas, indicadores); o Cliente 360 usa o fuso da sessão.
- Teste: `api/hoje-fuso.db.test.ts` (21:00 e 23:59 de Manaus, tenant em São Paulo).

## Tolerância no checkout: etapa pendente (T-0039 §2, RN-CORE-12 complemento)
- `visita_checkout` chama `<modulo>.etapas_checkout@1` dos módulos ativos (hoje `pesquisa.etapas_checkout@1`; desligado = sem etapa) e avalia com `avaliarCheckoutTolerante` (domain). Recusa (422) só o que é do Core: motivo fora da lista, resultado, foto da fachada. Etapa obrigatória de outro módulo não concluída = checkout aceito + linha `pendente` em `core.visita_etapa` (`rotulo`, `pendente_desde` = relógio do servidor) e `core.visita.etapas_pendentes` recalculado na mesma transação. Linha `concluida` nunca é rebaixada. Cliente fechado dispensa (`dispensada`).
- Baixa: consumidor de `pesquisa.resposta.registrada@1` (com `visita_id`) reconsulta e marca `concluida` + `resolvida_em` + `referencia_id = resposta_id`; idempotente; evento antes do checkout não faz nada (`api/etapas-pendencia.ts`).
- Alerta: `alertarPendenciasVencidas(ctx)` varre o tenant (parâmetro `checkout_pendencia_alerta_h`, 1..168, padrão 24; `GET|PUT /v1/core/parametros/checkout-pendencia`, ação `parametro.checkout_pendencia`, admin). Reconsulta antes; se segue pendente, notifica vendedor e supervisor da equipe (textos de `textoAlertaPendencia`, `envio_id` = id da linha) e grava `alertada_em`. Tarefa periódica `alerta_pendencia_checkout` (60 min, ADR 0022) registrada em `ModuloApi.tarefas`; o agendador liga com `plataforma.tenants_ativos()`. Se a licença da Pesquisa for retirada depois da pendência, a reconsulta fica indisponível e o alerta sai mesmo assim; a dispensa manual cobre.
- Dispensa manual (§2.5a): `POST /v1/core/visitas/:id/etapas/:modulo/:etapa/dispensa`, ação `visita.dispensar_etapa` (supervisor da equipe e admin), corpo `{ justificativa }` 3..300, auditada (RN-AUD-01); já não pendente = 200 com `alterada: false`; visita fora do escopo = 404.
- Pull da visita leva `etapas_pendentes` (aditivo, opcional no `VisitaSyncSchema`). A tela do BKO e os selos do app ficam para depois (`docs/design/checkout-pendencia.md`).

## T-0191 — Criar rota por proximidade, base do vendedor e Gerar coordenada (BKO, v1.0.19)
Regras: RN-CORE-75 (base), RN-CORE-76 (criar por proximidade) e RN-CORE-77 (gerar coordenada); spec em `docs/design/rotas-criar/spec.md`; desenho em `docs/desenho/T-0191.md`.

| Rota `/v1/core` | Ação | O que faz |
|---|---|---|
| `GET usuarios/:id/endereco` | `usuario.ver` | a casa do vendedor ou promotor |
| `PUT usuarios/:id/endereco` | `usuario.editar` | grava a casa (`{ endereco: null }` apaga); só vendedor e promotor (422 `USUARIO_SEM_ENDERECO`); auditada sem o endereço |
| `GET usuarios/:id/base` | `rota.editar` | a casa e a base resolvida, para o diálogo "Endereço base" |
| `PUT usuarios/:id/base` | `rota.editar` | `{ tipo: 'casa' }` (422 `BASE_SEM_PONTO` sem o ponto da casa) ou `{ tipo: 'outro', endereco }` com o ponto marcado; grava `base_alterada_em`; auditada (só o tipo) |
| `POST rotas/previa` | `rota.editar` | não grava; dias, totais, `fora_sem_coordenada`, `fora_limite`, `mantidas`, `feriados`, `substituidas`, base e limite |
| `POST rotas/lote` | `rota.editar` | idempotente pelo id de cada rota; revalida calendário, proteção e carteira; 422 `ROTA_PROTEGIDA`, `ROTA_EXISTENTE` ou `ROTA_DIA_INVALIDO` (dia passado, fora da semana útil ou feriado); origem `bko`; auditada |
| `POST clientes/:id/coordenada/gerar` | `cliente.aprovar_coordenada` | 200 `{ lat, lng, precisao }`; 422 `NAO_LOCALIZADO`, `JA_TENTADO` ou `JA_TEM_COORDENADA`; 503 `GEOCODIFICADOR_INDISPONIVEL` não grava a tentativa |
| `GET rotas` | (a atual) | passa a devolver `bases` (a base de cada vendedor da lista) e `calendario` (semana útil e feriados do tenant) |

- Escopo de carteira (RN-CORE-04): vendedor fora do escopo e cliente de outro tenant dão 404. Nenhum endereço vai para log nem para a auditoria.
- `coordenada_origem`: `erp` no consumidor do ERP, `checkin` na aprovação de Coordenadas sugeridas e `geocodificacao` no Gerar coordenada (RN-CORE-77).
- Limite do dia: `limiteVisitasPorDia` (meta `visitas_dia` em décimos; RN-CORE-76). Base e km: RN-CORE-75.
