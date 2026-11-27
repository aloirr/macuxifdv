# v1.0.40 · Perfis em tabela (ADR 0073, E5) — parecer do testes

Data: 27/11/2026 (horário de Manaus). Base: simulação aprovada `docs/design/simulacoes/2026-11-24/perfis-tabela.md` (e PNGs) e ADR 0073.

| PR | Dono | Branch | Head conferido |
|---|---|---|---|
| #853 (kit) | designer-ux | `nuvem/v1040-designer-ux-perfis` | `9da501535a84a67aa554d1637c7f96b6a47768e4` |
| #854 (tela, empilhado no #853) | modulo-core | `nuvem/v1040-modulo-core-perfis` | `908fc0c19965011ea2799fd0505bb99541bbaffd` |

## Parecer
- **#853 @ 9da50153: LIBERADO.** Nenhum achado no kit.
- **#854 @ 908fc0c1: NÃO LIBERADO.** Achado A1 (alta) segura; A2 e A3 (média) entram no mesmo lote.

A integração com a API real fica para a **E6**: a tela chama as rotas V2 (`rotasDePerfisV2`, `modules/core/api/perfis-v2.ts`), que ainda não estão montadas no servidor. Isso não conta como achado da tela.

## O que rodou (no head 908fc0c1, que contém o 9da50153)
| Pacote | Comando | Resultado |
|---|---|---|
| @macuxi/ui | `vitest run` | 59 arquivos, 661 testes, verdes |
| @macuxi/ui | `pnpm typecheck` (web e mobile) | limpo |
| @macuxi/core (web e domain) | `vitest run web domain` | 140 arquivos, 1907 testes, verdes (os `*.db.test.ts` não entram neste recorte) |
| @macuxi/core | `pnpm typecheck` (api, web, mobile) | limpo |
| BKO no navegador | `tests/e2e/bko/prints-perfis-v1040.ts` (Chromium, API simulada) | prints, valor × regra e checagens abaixo |

**As respostas da API nos prints e nas checagens do navegador são simuladas** (`page.route`). Elas saem das funções reais do domain (`montarCatalogoPorArea`, `montarDetalheV2`), com o catálogo dos 8 manifestos (`catalogoDePermissoes`, `AREAS_PERMISSAO`), os 7 modelos do SDK (`modelosDePerfil`) e o `FORA_DA_TELA` da API. Como na simulação aprovada, o Treinamento fica sem licença e o restante licenciado. O usuário logado usa o perfil `admin`.

## Critério → teste → resultado
| Critério | Teste | Resultado |
|---|---|---|
| Trava pelo cargo com o motivo, sem código de RN | `perfis-tabela.test.ts` (RN-CORE-33); navegador: motivos "Este cargo nunca entra no BKO nem no portal.", "O app Macuxi Gestão é só dos cargos Supervisor e Gerente."; nenhum "RN-" na página | ✅ |
| Cargo travado quando o perfil tem usuários | `perfis-tabela.test.ts`; print Vendedor (2 usuários): select desabilitado com cadeado e "Não muda enquanto houver usuários neste perfil."; o PUT não leva `cargo` | ✅ |
| Módulo sem licença desabilitado, guardando o valor | `perfis-tabela.test.ts` (RN-CORE-02: o PUT leva `treinamento.ver`); navegador: caixa do grupo `aria-disabled`, selo "Sem licença", "4 de 12 ligadas" (valores guardados); a API aceita o valor guardado (`antes` em `validarAcessoPeloCargo`) | ✅ |
| Aviso de autogestão uma vez só, no topo | print Admin: um aviso no topo; as 5 linhas com cadeado sem texto repetido | ✅ |
| Caixa do grupo com 3 estados, só nas livres | `tabela-permissoes.test.ts`; navegador: Clientes `mixed` 1 de 8 → `true` 8 de 8 ("7 mudanças não salvas"); Acesso com 3 travadas só mexe em "Entrar no app Campo"; Treinamento sem efeito | ✅ |
| Escopo acima do teto do cargo com cadeado | print Vendedor: Equipe, Equipes abaixo e Toda a empresa com cadeado e desabilitados | ✅ (ver A3: o motivo não aparece escrito) |
| RN-PRO-01: perfil promotor nunca cria nem altera pedido | navegador, perfil Promotor: `pedido.criar`, `editar`, `cancelar`, `excluir`, `aprovar`, `criar_em_nome` travados com "Perfil de promotor nunca cria, edita, cancela, exclui ou aprova pedido."; `pedido.ver` livre; o PUT não leva chave travada | ✅ |
| Só quem tem `perfil.gerir` edita | leitura: `PerfisConteudo` mostra o aviso sem `usePode('perfil.gerir')`; 403 no GET/PUT vira o mesmo aviso; as rotas V2 exigem `perfil.gerir` | ✅ (no navegador fica para a E6, com a API real) |
| Busca | `tabela-permissoes.test.ts` (sem acento); navegador: "transportadora" → só as 2 linhas de Pedidos; "zzz" → "Nenhuma permissão com esse nome." | ✅ |
| Salvar como único botão principal | navegador: os botões `bg-accent` da edição são só ["Salvar"] (Vendedor e Admin) | ✅ |
| Sem "Perfil base", "Restaurar padrão" e "Promotor vê pedidos" | busca de texto na página | ❌ **A1**: "Promotor vê pedidos" continua na página |

### Valor × regra: "n de m ligadas"
Regra (kit, `contagemDoGrupo`, igual à simulação): n = chaves concedidas da área (livres, travadas e sem licença), m = chaves da área no catálogo; o grupo Dados (só nível) não tem contagem. O script calcula o esperado pela resposta e compara com a tela em todos os grupos dos perfis Vendedor e Admin: **sem divergência** (ex.: Vendedor Acesso 1 de 4, Pedidos 5 de 12, Treinamento 4 de 12; Admin Acesso 2 de 4, Administração 39 de 43). Rótulo × valor: "ligadas" conta concessões gravadas, e o selo "Sem licença" fica ao lado no grupo sem licença. Esta tela não tem data, fuso nem dinheiro; dia útil e virada de mês não se aplicam.

## Achados
| Id | Gravidade | Dono | Onde | O que |
|---|---|---|---|---|
| A1 | alta | modulo-core | `modules/core/web/index.ts:82` (`PromotorPedidosPanel`, seção `acesso`) | O cartão "Promotor vê pedidos" continua na mesma página, abaixo de Módulos. A simulação ("Sai o cartão") e a ADR §2.4 trocam o cartão pela linha "Ver pedidos" do perfil, que já aparece na tabela: hoje a mesma informação está em dois lugares. Reproduzir: abrir `/parametros/acesso?editar_perfil=vendedor` e rolar até o fim (print). |
| A2 | média | modulo-core | `modules/core/web/lib/acesso.ts` (`ROTULO_DA_PERMISSAO` sem `dados.escopo`) | A linha de Dados mostra a descrição crua do catálogo, "Escopo de dados: carteira própria, equipe, equipes abaixo ou toda a empresa", que repete os 4 botões ao lado. A simulação aprovada usa "Quais clientes e números vê". |
| A3 | média | modulo-core | `perfis-page.tsx` (`doKit`, `descricao` da linha de escopo) | O motivo do teto ("O cargo Vendedor vai até "Carteira própria".") só aparece se o nível gravado passar do teto, o que não acontece. Fica só para o leitor de tela. A simulação mostra o motivo escrito sob o nome da linha. |
| A4 | baixa | modulo-core | `modules/core/domain/perfis-cargo.ts` (`ROTULO_AREA`, já no `main`) | Os títulos dos grupos não batem com a simulação: "Acesso" × "Onde entra", "Usuários" × "Usuários e perfis", "Trade marketing" × "Trade", "Pesquisas" × "Pesquisa", "Metas" × "Metas e RV", "Gestão" × "Gestão da equipe". |
| A5 | baixa (já no `main`) | modulo-core | `perfis-page.tsx`, barra fixa `md:left-[220px]` | O menu lateral do BKO tem 240 px (`app-shell.tsx`), e a barra do Salvar cobre os últimos 20 px do menu no rodapé (print). |

Observação, fora da E5: Clientes aparece com 8 chaves e a simulação mostra 15. Na ADR (anexo, marcadas com *), algumas ações do Core passam para Clientes, mas o catálogo do SDK ainda não as moveu (`areaDaAcao`, engenheiro-software). Não é defeito da tela.

## Prints (1366 px, deviceScaleFactor 2, API simulada)
- `docs/testes/prints/v1040-perfis/perfis-vendedor-1366.png`
- `docs/testes/prints/v1040-perfis/perfis-admin-1366.png`

Captura com a janela do tamanho da página, para a barra do Salvar ficar no rodapé, onde o usuário a vê. O selo do modo dev do Next está escondido.

## Para a E6 (API real), com roteiro manual
1. Com a API montada, entrar como Admin, abrir Vendedor, ligar uma caixa livre, Salvar e conferir o toast e "Nenhuma mudança".
2. Abrir em duas abas, salvar na primeira e depois na segunda: deve aparecer "Outra pessoa alterou este perfil…" com "Recarregar o perfil".
3. Entrar com um perfil sem `perfil.gerir` e conferir o aviso no lugar da tela, e o 403 nas rotas.
4. Desligar o Treinamento em Módulos, salvar um perfil e conferir que as concessões do Treinamento continuam gravadas.
