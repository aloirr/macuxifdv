# Core — testID / data-testid estáveis (T-0003)

Pedido do `testes` (R-20261030-235542-testes). **Contrato estável**: o nome só muda com recado ao `testes`. App usa `testID` (React Native); BKO usa `data-testid` com o mesmo texto. `<modulo>` é o id do módulo (`core`, `catalogo`, `vendedor`, `promotor`, `gestor`, `pesquisa`, `treinamento`, `integracao`; no BKO também `teste` e `teste-dependente` nos fixtures); `<perfil>` é o id do perfil. Implementado na Fase 2 da T-0003 (app: `modules/core/app/telas/meus-modulos.tsx`; BKO: `modules/core/web/components/licencas/licencas-page.tsx`).

## App — tela "Meus módulos" (Campo e Gestão)
| testID | Elemento |
|---|---|
| `meus-modulos.tela` | Tela inteira |
| `meus-modulos.lista` | Lista dos módulos efetivos |
| `meus-modulos.item.<modulo>` | Uma linha por módulo efetivo (exatamente os de `GET /v1/me/modulos`, S0-051) |
| `meus-modulos.versao.<modulo>` | Versão do módulo na linha |
| `meus-modulos.vazio` | Aviso quando só o core está ativo |
| `meus-modulos.atualizar` | Botão "Atualizar agora" (dispara o sync) |
| `sync.item-nao-enviado.<id>` | Item da fila rejeitado por módulo desativado (rótulo "Não enviado — módulo desativado", RN-CORE-02) |
| `sync.confirmar-modulo-desativado.<modulo>` | Botão "Entendi" que libera apagar os dados locais do módulo |

## App — login real (código da empresa + e-mail + senha)
| testID | Elemento |
|---|---|
| `login.tela` | Tela inteira |
| `login.codigo-empresa` · `login.email` · `login.senha` | Campos |
| `login.entrar` | Botão Entrar |
| `login.erro` | Mensagem de erro em português (credencial, bloqueio, limite, sem conexão) |

## App — ações de pedido (RN-PRO-01; devem estar AUSENTES para o promotor, não só desabilitadas)
`pedido.acao.criar` · `pedido.acao.editar` · `pedido.acao.cancelar` · `pedido.acao.duplicar` · `pedido.acao.excluir` · `pedido.acao.criar-em-nome` · `pedido.aba.novo` (aba/atalho "Novo pedido") · `pedido.card.inicio` (card de pedido no Início) · `pedido.tela.bloqueio` (tela exibida ao abrir a rota de novo pedido como promotor; nada vai para a fila).
(Os componentes de pedido são do módulo Vendedor; o Core fixa os nomes para o teste e envia recado ao `modulo-vendedor` ao implementar.)

## BKO — tela de licenças (`/usuarios-e-modulos`)
| data-testid | Elemento |
|---|---|
| `licencas.tela` | Página |
| `licencas.nivel.tenant` · `licencas.nivel.perfil` · `licencas.nivel.usuario` | Abas/seções dos três níveis |
| `licencas.seletor-perfil` | Escolha do perfil (nível perfil) |
| `licencas.seletor-usuario` | Escolha do usuário (nível usuário) |
| `licencas.modulo.<nivel>.<modulo>` | Linha do módulo no nível (`tenant`, `perfil`, `usuario`) |
| `licencas.toggle.<nivel>.<modulo>` | Controle liga/desliga; no `core` vem desabilitado (`aria-disabled="true"`, S0-045) |
| `licencas.estado.<nivel>.<modulo>` | Estado atual: `ativo` ou `inativo` (atributo `data-estado`) |
| `licencas.efetivos` | Lista "Módulos efetivos do usuário" (reflete o resultado, RN-CORE-01) |
| `licencas.efetivo.<modulo>` | Item da lista de efetivos |
| `licencas.aviso-dependencia` | Aviso "este módulo também desliga: …" (RN-CORE-03) |
| `licencas.confirmar` · `licencas.cancelar` | Diálogo de confirmação |
| `licencas.exportar-csv` | Exportar CSV |
| `menu.item.usuarios-e-modulos` | Item de menu; ausente para quem não é admin (matriz §2, S0-050). O shell gera o testID `nav-core-usuarios-e-modulos` (padrão do SDK); alias `menu.item.usuarios-e-modulos` é do shell (pedido ao engenheiro) |

## Regras de UI associadas
- Item de menu e página só para `admin`; a API revalida (`modulo.gerir_licencas`).
- Desligar módulo com dependentes mostra `licencas.aviso-dependencia` antes de confirmar.
- Alvos de toque do app ≥ 48 dp.

## Tela Aparelhos do BKO (RN-CORE-15) e Cliente 360 do app (T-0017)
| testID | Onde |
|---|---|
| `aparelhos.tela` · `aparelhos.exportar-csv` · `aparelhos.filtro-situacao` · `aparelhos.busca` | página Aparelhos |
| `aparelhos.linha.<id>` · `aparelhos.alternar.<id>` | linha e botão Bloquear/Liberar |
| `aparelhos.confirmar` · `aparelhos.cancelar` | diálogo de confirmação |
| `clientes-locais` | lista de Clientes do app lida do aparelho |
| `filter-vencidos` · `filter-sem_compra` · `filter-bloqueados` | filtros da lista local |
| `cliente-360` · `cliente-financeiro` · `cliente-historico` | seções da ficha (app) |
| `cliente-acoes-contato` · `cliente-ligar` · `cliente-whatsapp` · `cliente-mapa` | ligar, WhatsApp e mapa em 1 toque (48 dp) |
