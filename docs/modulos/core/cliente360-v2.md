# Cliente 360 v2 (T-0186, RN-CORE-40) — domain, contratos e API

Spec e decisões: `docs/design/cliente-360-v2/spec.md` (branch `nuvem/v1016-cliente360-designer-ux`), P1 a P17.

- **Domain:** `domain/historico-nf.ts` (status da NF, "Em atraso" sem data, saldo disponível, cartão do Resumo, período e filtros), `domain/documentos-cliente.ts` (permissão por tipo, perfil e documento; abas da ficha) e `domain/resumo-cliente.ts` (Performance e dados cadastrais).
- **Status da NF (P3):** com saldo em parcela aberta, "Em atraso" (alguma vencida) ou "Em aberto" prevalece; sem saldo, "Devolvido", "Devolvido parcial" ou "Pago".
- **Contratos:** `contracts/cliente360-v2.ts`; `Cliente360Schema` ganha campos opcionais (`abas`, `dados_cadastrais`, `cartao_credito`, `performance`, `notas`). Sem alerta financeiro na ficha.
- **API:** `GET /v1/core/clientes/:id/notas` (lista online), `GET .../notas/:nota_id` (P17, ao tocar; nada guardado), `GET .../documentos` e `GET .../documentos/:documento_id` (P15, só ver; ação `documento.ver`), `GET|PUT /v1/core/documentos/permissoes` e `PUT .../documentos/excecoes` (ação `documento.permissoes`, só admin, auditado).
- **Promotor sem `promotor_ve_pedidos` (P12):** 403 `HISTORICO_SEM_ACESSO` nas notas; sem cartão de crédito, curvas e indicadores de compra no Cliente 360.
- **Banco (migração 0090, banco-dados):** `core.nota_erp.forma_pagamento`, `nf_origem_numero` e `nf_origem_serie` (só devolução); `core.titulo.forma_pagamento`, `nf_numero` e `nf_serie`; tabelas `core.documento_tipo` (`origem` erp|escritorio|app; `permite_envio` = origem `app`), `core.documento_cliente` (`data_documento`, `valido_ate`, `arquivo_id` sem FK; o formato vem de `plataforma.arquivo.tipo`; documento sem arquivo aparece na lista e não abre), `core.documento_permissao` e `core.documento_excecao` (`perfil_id` = `plataforma.perfil.id`; a API converte para o código do perfil; nível `ve_envia` no banco = `ve_e_envia` no domain). Notas e documentos seguem a RLS por `tenant_id`; sem DELETE para o app (soft delete).
- **Consumidores do ERP:** `integracao.nota.atualizado@1` e `integracao.titulo.atualizado@1` gravam `forma_pagamento` (o código do ERP, `forma_pagamento_codigo`), a NF do título e a NF original da devolução; campo ausente não altera o valor guardado. Os campos novos do contrato do Hub só chegam depois do merge do PR da integração.

## App (Campo e Gestão; parte 2a)

- **Ficha** (`app/telas/cliente.tsx`): três abas fixas por `abasDaFicha` (`abasDoApp`); o promotor sem `promotor_ve_pedidos` fica sem o Histórico (P12). Sem nenhum alerta financeiro; os avisos que não são financeiros seguem no topo.
- **Resumo** (`components/aba-resumo.tsx`): Dados cadastrais, Limite · Saldo disponível · Prazo médio, Endereços, Contatos, Performance (três curvas, indicadores, visitas; "Visitada por" só no Gestão), Últimos itens comprados e Observações. Lê só do aparelho.
- **Histórico** (`components/aba-historico.tsx`): contagem e botão de filtro (Nº da NF dentro da folha, P14), tabela Data · Nº NF · Valor · Status, "Em atraso" sem data. O toque pede "Baixar a NF …?" e busca a NF no servidor (P17); fechar descarta. Sem internet: "Sem internet" e "Tentar de novo".
- **Documentação** (`components/aba-documentacao.tsx`): tabela Documento · Data · Abrir por grupo, só visualizar (P15). O shell registra o visualizador com `definirAbrirDocumento` (exportado por `modules/core/app`); "Ver PDF" e a seta ficam desligados sem ele. "Fotos do PDV" segue lendo as linhas do aparelho (RN-CORE-38).
- **Lógica pura** em `app/lib/ficha-v2.ts` (testes em `ficha-v2.test.ts`); consultas em `ficha-online.ts` e `usar-ficha-online.ts` (nada vai ao SQLite, à fila nem ao disco).
- **Pendências de contrato** (não são do app): sync das linhas de nota e de documento para a lista funcionar em modo avião; `created_at` do cliente no sync (hoje "Cliente desde" usa `customer_since`); vendedor da carteira para a tabela Carteira do Gestão.
