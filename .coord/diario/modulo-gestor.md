# Diário — modulo-gestor

2026-10-31 — T-0001 — Fase C: esqueleto modules/gestor (manifesto, pastas, teste) entregue
2026-10-31 — T-0014 — ajuste com as 8 decisões do Alexandre (RN-GES-01..08): frequência + carência no alerta de visita, prazo em horas úteis, gerente decide item do supervisor com aviso, cobertura ≤ 100% + extras, vendido × faturado, analista/admin em leitura, comentário só na rejeição; 218 testes
2026-11-01 — T-0046 — (registrado pelo gerente; sessão da nuvem) PR #33 mesclado: espelhos de eventos alinhados aos donos (promotor, VisitaCheckoutSchema, MetaDefinidaSchema), precedência usuario > auto, filtro de nível no alerta, ciclo de superior_id e teste de conformidade com os publicadores
2026-11-02 — T-0064 — Gestão: useAtualizacaoAutomatica nas telas, BKO a 30 min, sem timer curto (RN-CORE-23)
2026-11-02 — T-0055 — repositório SQL do Gestor (projeção, alertas, regras, retenção 120d sob RLS) no lugar da memória; teste × Postgres com duas conexões
2026-11-04 — T-0073/T-0072 — Gestão: card Pedidos para aprovar (inicio.cards, ordem 10, alçada do usuário), regra de parado (RN-CORE-26, 60 min) na Equipe, telas no visual novo (Botao, Cartao, ChipEstado, AvisoRodape, EstadoVazio)
2026-11-04 — T-0077 — domain pedidos-equipe (filtro de vendedor da equipe, 5 testes); tela de Pedidos do Gestão é a do Vendedor, encaixe do seletor pedido por recado
2026-11-04 — T-0077 — removido pedidos-equipe (sem uso; seletor de vendedor é do Vendedor), G1 da revisão
