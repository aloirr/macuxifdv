# Parecer de redundâncias — PR #359, coluna Plano na lista de empresas do portal

> 15/11/2026 · corretor-redundancias · PR #359, branch `nuvem/planos-coluna-engenheiro-apps`, head `490b568`.
> Spec: `docs/design/telas/portal-config-enxuto.md` §11.5 e `docs/design/planos-assinatura/01-empresas.png` (branch `nuvem/planos-assinatura-designer-ux`).
> Print conferido: modo falso, lista Empresas com 6 empresas (coluna Plano: PME, Light, "Enterprise" + selo "teste", Light ×3).
> Escopo: só o que o PR muda (coluna Plano, selo "teste", "—" e modo falso). Subtítulo, sessão, código antigo e Backup ficam fora.

## 1. Conferido sem achado
| Item | Resultado |
|---|---|
| Coluna "Plano" no lugar de "Módulos" (`tela-empresas.tsx:120`, `:137-139`) | Uma coluna, um fato; a lista de módulos sai (não fica junto com o plano). Ordem Empresa · Código · CNPJ · Plano · Situação · Criada em igual ao §11.5 e ao 01-empresas.png. |
| Selo "teste" (`tela-empresas.tsx:47-55`) | Aparece só ao lado do nome do plano em teste; nenhum outro lugar da linha repete "teste" (nem "Teste até", nem cor). Igual ao print da spec. |
| "—" sem plano (`celulaDoPlano`, `:42-45`) | Mesmo "—" da coluna CNPJ (`:136`): um formato para vazio na tabela; sem "Sem plano" junto. |
| `ROTULO_MODULO` (pergunta do §11.8) | Sai só o import da lista; o mapa segue usado em `cartao-equipe.tsx:41`, `passo-empresa.tsx:435/502` e `tela-empresa.tsx:168`. Sem código morto. |
| Teste (`portal-telas.test.ts:148-154`) | 5 casos, cada um num ramo diferente (nome, nome + teste, `null`, ausente, só espaços). Sem repetição. |

## 2. Achado
| Campo | Conteúdo |
|---|---|
| ID | RD-0959 |
| Onde | `apps/web/lib/portal-falso.ts:72` (interface), `:117-119` e `:141` (dados) |
| Tipo | código |
| O que se repete | `teste_ate` gravado em 4 lugares (3 empresas do cliente e `empresaDoTime`) e declarado na interface `EmpresaFalsa`, mas **nenhum código do `apps/web` lê o campo** (a lista usa só `plano` e `em_teste`; `EmpresaResumo` não tem `teste_ate`). O fato "está em teste" fica em 2 campos (`teste_ate` e `em_teste`) que podem divergir. |
| Impacto | manutenção (dado fictício sem tela; duas fontes para o mesmo fato) |
| Severidade | baixa (código de produção do modo falso: segura o lote) |
| Proposta | antes: `plano?`, `teste_ate?`, `em_teste?` na interface e `teste_ate: …` nas 4 empresas → depois: só `plano?` e `em_teste?`; sai `teste_ate` da interface e das 4 linhas. Se a ficha da aba Empresa do modo falso for ler `teste_ate` no PR seguinte, o dono responde e o achado vira `manter`. |
| Dono | engenheiro-apps |

## 3. Encaminhado ao testes (defeito funcional, sem RD)
No head `490b568`, `EmpresaResumoSchema` (`packages/platform-sdk/src/plataforma.ts:144-155`) não tem `plano` nem `em_teste`, e o PR não muda o SDK. `tela-empresas.tsx:42` usa `Pick<EmpresaResumo, 'plano' | 'em_teste'>`: conferir o typecheck do `apps/web` e, com a API real, se o zod não tira os campos (a coluna ficaria sempre "—"; o modo falso mostra o plano porque não passa pelo schema). Conferir se o contrato vem de outro PR (planos v1.0.13) antes do merge.

## 4. Recados
A CLI de recados recusou o envio nesta sessão (HTTP 403 no `aloirr/macuxifdv-recados`). O pedido do RD-0959 ao engenheiro-apps e o aviso do §3 ao testes seguem pelo gerente-projetos, que recebe este parecer.

## Parecer
**1 achado em aberto (RD-0959, baixa, código de produção): o PR #359 não fecha até a correção ou o `manter`.**
