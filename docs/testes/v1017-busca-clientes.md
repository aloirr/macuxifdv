# v1.0.17 — busca de clientes só por código, CNPJ, razão social e nome fantasia: matriz de cenários

> 2026-11-20 · testes · PR #537 (modulo-core) · R-20261120-062210 · sem cidade e sem bairro, no app e no BKO.

Ensaio: `tests/integracao/api/busca-clientes-v1017.test.ts` (API + Postgres). O esperado sai de um oráculo da regra escrito no
teste e é comparado, termo a termo, com cada lugar onde se busca cliente. Cinco clientes na carteira do vendedor-1: em X e Y, a cidade
e o bairro de um são o nome do outro; J1, J2 e J3 são as armadilhas das duas palavras (BC-04).

## Matriz

| # | Cenário | Termos | Onde |
|---|---|---|---|
| BC-01 | Positivo pelos 4 campos | código (`QX-7781`, `wk-0310`), CNPJ com e sem máscara e em parte, razão social, nome fantasia | todos abaixo |
| BC-02 | Negativo: termo que é cidade ou bairro de um cliente não o traz (traz só o outro, pelo nome) | `Xapurilandia`, `Ypsilonvale`, `Zafira`, `Quimera` | todos abaixo |
| BC-03 | O filtro de cidade segue separado da busca | `?cidade=Xapurilandia` | API |
| BC-04 | Duas palavras (v1.0.18, R-20261120-101755): todas precisam casar, cada uma num dos 4 campos, em qualquer ordem | `JOAO 0103`, `joão 0103`, `0103 JOAO`, `JOAO 222.333`; `JOAO 9999` (nada); `0103` só no bairro não casa | todos abaixo |

| Superfície | Código | Resultado em 20/11 (origin/main 54e6e4e) |
|---|---|---|
| API `GET /v1/core/clientes?q=` (Campo online; BKO Carteira e Documentos), vendedor e admin | `modules/core/api/clientes.ts` | verde |
| Campo offline, Clientes: `listarClientesLocais` sobre o pull `cliente` | `modules/core/app/lib/cliente360-local.ts` | verde |
| Campo, Novo Pedido (seletor de cliente): `filterCustomers` sobre `clienteResumo` | `modules/vendedor/app/lib/catalog.ts` | **vermelho** (defeito 1) |
| BKO, editor de rota: `searchWallet` sobre `GET /v1/core/usuarios/:id/clientes` → `clienteDaCarteira` | `modules/core/web/lib/routes.ts`, `rotas-api.ts` | **vermelho** (defeito 2) |

## Defeitos

1. **Novo Pedido do Campo (modulo-vendedor):** `filterCustomers` monta o texto com `district` e `city`; o CNPJ só casa sem máscara
   e inteiro na sequência. Textos ligados: placeholder "Nome, código ou bairro" (`new-order-screen.tsx`) e "Confira o nome, o
   código ou o bairro." (`seletor-em-nome.ts` e `new-order-screen.tsx`).
   Reproduzir: Novo Pedido → Cliente → buscar a cidade de um cliente: ele aparece.
2. **Editor de rota do BKO (modulo-core):** `searchWallet` usa `district` e `city`; `clienteDaCarteira` grava `erp_code` e `cnpj`
   vazios, e `GET /v1/core/usuarios/:id/clientes` não traz código nem documento. Placeholder "Nome, bairro ou código"
   (`route-editor.tsx`). Reproduzir: Rotas → editar → adicionar cliente → buscar o bairro: o cliente aparece; buscar o código: nada.

## Teste manual

1. Campo, Clientes: buscar pelo código, pelo CNPJ com e sem máscara, pela razão social e pelo nome fantasia → o cliente aparece; pela cidade e pelo bairro → nada.
2. O mesmo em Novo Pedido → Cliente, no BKO em Carteira, Documentos e no editor de rota.
