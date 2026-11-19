# Cliente 360 v2 (T-0186, RN-CORE-40) — domain, contratos e API

Spec e decisões: `docs/design/cliente-360-v2/spec.md` (branch `nuvem/v1016-cliente360-designer-ux`), P1 a P17.

- **Domain:** `domain/historico-nf.ts` (status da NF, "Em atraso" sem data, saldo disponível, cartão do Resumo, período e filtros), `domain/documentos-cliente.ts` (permissão por tipo, perfil e documento; abas da ficha) e `domain/resumo-cliente.ts` (Performance e dados cadastrais).
- **Status da NF (P3):** com saldo em parcela aberta, "Em atraso" (alguma vencida) ou "Em aberto" prevalece; sem saldo, "Devolvido", "Devolvido parcial" ou "Pago".
- **Contratos:** `contracts/cliente360-v2.ts`; `Cliente360Schema` ganha campos opcionais (`abas`, `dados_cadastrais`, `cartao_credito`, `performance`, `notas`). Sem alerta financeiro na ficha.
- **API:** `GET /v1/core/clientes/:id/notas` (lista online), `GET .../notas/:nota_id` (P17, ao tocar; nada guardado), `GET .../documentos` e `GET .../documentos/:documento_id` (P15, só ver; ação `documento.ver`), `GET|PUT /v1/core/documentos/permissoes` e `PUT .../documentos/excecoes` (ação `documento.permissoes`, só admin, auditado).
- **Promotor sem `promotor_ve_pedidos` (P12):** 403 `HISTORICO_SEM_ACESSO` nas notas; sem cartão de crédito, curvas e indicadores de compra no Cliente 360.
- **Banco (banco-dados, S5):** `core.nota_erp.forma_pagamento` e `nf_original_numero`; `core.titulo.nota_numero`, `nota_serie` e `forma_pagamento`; tabelas `core.documento_tipo`, `core.documento`, `core.documento_permissao` e `core.documento_excecao`.
