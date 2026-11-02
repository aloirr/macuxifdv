---
id: R-20261102-234040-gerente-projetos
de: gerente-projetos
para: [alexandre]
cc: []
tipo: entrega
prioridade: normal
tarefa: T-0063
responde_a: null
encerra: false
contrato: null
criado_em: 2026-11-02T23:40:40+00:00
---
# T-0063 medidas: PR #54 aberto (38d0d38) — aguardando 0017 e PAP-4 'UN' no main para o CI

## Contexto
Entregue: 0018_medidas (core.medida por tenant com a lista inicial, produto com medida da unidade e embalagem 2..9999, item do pedido com medida/quantidade da embalagem/quantidade em unidades por gatilho, RLS forçado), BKO Parâmetros → Produtos → Medidas, produto só aceita medida cadastrada e ativa, Hub com sigla desconhecida = referencia_ausente reprocessável (e sigla mal formada = erro não reprocessável). Revisão: 0 vermelho; amarelos 1–5 corrigidos.

## O que preciso / o que mudou
Como testar: 1) BKO → Parâmetros → Produtos → Medidas: ver as 11 siglas; 2) cadastrar 'SC' (Saco) e editar a descrição; 3) tentar apagar 'UN' (em uso) → recusado; inativar 'PCT' → ok; 4) editar um produto com embalagem CX 12; tentar medida inativa → 422; 5) mandar pelo Hub um produto com unidade 'ZZ' → linha referencia_ausente reprocessável; cadastrar ZZ e reenviar → aplicada.

## Pronto quando
Premissas: inativar em uso pode, apagar não; LT = Lata, TB = Tubo (pergunta R-20261102-232641); demo com UN, CX, FD, LT, BD ativas; item do pedido derivado de unidade/fator sem mexer no Vendedor. | Pendências: (a) 0017 no main, com renumeração dos UUID 0x70–0x73 (colidem com o Gestor); (b) PAP-4 'PC'→'UN' no demo.ts do main e, após o merge, a ligação do medidas.ts e o espelho Drizzle do pedido_item (R-20261102-233317, banco-dados local); (c) rota POST /lotes/{id}/reprocessar do Hub ainda não existe (backlog); (d) FK de catalogo.tabela_preco_item.unidade (modulo-catalogo, backlog).
