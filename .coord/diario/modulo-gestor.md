# Diário — modulo-gestor

2026-10-31 — T-0001 — Fase C: esqueleto modules/gestor (manifesto, pastas, teste) entregue
2026-10-31 — T-0014 — ajuste com as 8 decisões do Alexandre (RN-GES-01..08): frequência + carência no alerta de visita, prazo em horas úteis, gerente decide item do supervisor com aviso, cobertura ≤ 100% + extras, vendido × faturado, analista/admin em leitura, comentário só na rejeição; 218 testes
2026-11-01 — T-0046 — (registrado pelo gerente; sessão da nuvem) PR #33 mesclado: espelhos de eventos alinhados aos donos (promotor, VisitaCheckoutSchema, MetaDefinidaSchema), precedência usuario > auto, filtro de nível no alerta, ciclo de superior_id e teste de conformidade com os publicadores
2026-11-02 — T-0064 — Gestão: useAtualizacaoAutomatica nas telas, BKO a 30 min, sem timer curto (RN-CORE-23)
2026-11-02 — T-0055 — repositório SQL do Gestor (projeção, alertas, regras, retenção 120d sob RLS) no lugar da memória; teste × Postgres com duas conexões
2026-11-04 — T-0073/T-0072 — Gestão: card Pedidos para aprovar (inicio.cards, ordem 10, alçada do usuário), regra de parado (RN-CORE-26, 60 min) na Equipe, telas no visual novo (Botao, Cartao, ChipEstado, AvisoRodape, EstadoVazio)
2026-11-04 — T-0077 — domain pedidos-equipe (filtro de vendedor da equipe, 5 testes); tela de Pedidos do Gestão é a do Vendedor, encaixe do seletor pedido por recado
2026-11-04 — T-0077 — removido pedidos-equipe (sem uso; seletor de vendedor é do Vendedor), G1 da revisão
2026-11-05 — T-0073 — Gestão usa inicio.parado_min do tenant (pull parametro do Core) com fallback do Gestor; teste RN-CORE-26
2026-11-05 — fix — tipo da linha parametro em use-gestor.ts (LinhaSync); mobile typecheck verde
2026-11-05 — T-0024 — Gestor troca as cópias de payload pelos schemas dos donos (tolerante), meta.definida@1 consumida, parado_min do Core
2026-11-05 — T-0072 — 4 🟡 do designer-ux: título da ficha com erro, tons parado/rota concluída, resumo 2x2, Banner sem sinal em Alertas
2026-11-05 — T-0072 — ficha do Gestão: ação 'Tentar de novo' no erro (botão principal único)
2026-11-05 — T-0039 — verificado: pendência de etapa no Gestão é do Core (ficha /m/cliente); Gestor sem alteração; §4.3 (Alertas) adiado
2026-11-05 — T-0039 — alerta de etapa pendente do checkout na aba Alertas do Gestão (tipo de aparelho, domain com teste, pedido de marcador ao Core)
2026-11-05 — T-0039 — alerta Etapa pendente: título único, toque abre /m/cliente, divisória da última pendência
2026-11-05 — T-0039 — Gestor: tipo do Core, janela de 30 dias, detecção por subtipo com reserva por título, 🟢 da revisão final
2026-11-05 — T-0039 — G1 (notificações só na aba Alertas) e 🟢 da revisão; interseção de subtipo removida
2026-11-05 — T-0071 — item 5: lista de orçamentos da equipe é do Vendedor (recado enviado); 4 testes de não-contagem de orçamento no Gestor (orcamento-equipe.test.ts)
2026-11-08 — T-0102 — AvisoEtapaEquipe registrado no slot cliente.avisos (teste); accentInk em Decidir/Em rota; histórico em tags não se aplica ao Gestor (detalhe do pedido é do Vendedor)
2026-11-08 — T-0124 — Gestor: typecheck do slot cliente.avisos, apuracao pela data de emissao (RN-CORE-21) e dias uteis pelo calendario do tenant (RN-CORE-26, param dias_uteis_semana); testes G2/G5 prontos para virar it
2026-11-08 — T-0124 — Gestor v1.0.1: dias úteis pelo calendário do Core (core.calendario_metas@1 + diasUteisDoPeriodo), apuração por emitido_em (G2), vendedor_nome na ficha; recados antigos encerrados
2026-11-08 — T-0124 — Ficha do Gestor: feriados [] = so a semana (RN-CORE-26) e necessidade diaria arredondada para cima, alinhado ao Core; testes do domain revistos
2026-11-09 — R-20261108-220117 — necessidadeDiaria do Core no painel.ts, comentário do calendário alinhado à RN-CORE-26, 5 pedidos antigos encerrados
2026-11-09 — T-0131 (RD-0034) — feriados do Gestor: removida a cópia provisória (feriados.ts e teste); RN-GES-03 usa feriadosNacionais do @macuxi/comum (Carnaval, Corpus Christi, 20/11 desde 2024); gestor 422 testes verdes e tests/modulos/feriados-gestor-comum-rnges03 verde
2026-11-08 — T-0102 — AvisoEtapaEquipe registrado no slot cliente.avisos (teste), accentInk em Decidir/Em rota; histórico em tags não se aplica ao Gestor (detalhe do pedido é do Vendedor)
2026-11-09 — T-0140 — RD-0034: ehDataCivil/somarDias do Gestor trocados por @macuxi/comum; testes verdes
2026-11-09 — T-0140 — RD-0045 aguardando fonte única arredondar/percentual no @macuxi/comum (não existe ainda); nada alterado
2026-11-09 — T-0140 — Data impossível (2026-02-30) nas rotas equipe, Ficha e ranking agora responde 422 DATA_INVALIDA em português (dataDoUsuario com exigirDataCivil na entrada, antes do banco); teste unitário em api/rotas.test.ts
2026-11-09 — T-0140 — RD-0045: arredondar e percentual reexportados do @macuxi/comum; teste duplicado removido
