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
| `login.senha-olho` | Botão de olho: mostra/oculta a senha (rótulo "Mostrar senha"/"Ocultar senha") |
| `login.entrar` | Botão Entrar |
| `login.erro` | Mensagem de erro em português (credencial, bloqueio, limite, sem conexão/servidor não respondeu, servidor que não é Macuxi) |

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
| `cliente-enderecos` · `cliente-endereco-padrao` · `cliente-endereco` | endereços de entrega da ficha (app); o padrão vem destacado |
| `cliente-acoes-contato` · `cliente-ligar` · `cliente-whatsapp` · `cliente-mapa` | ligar, WhatsApp e mapa em 1 toque (48 dp) |

## T-0018 — rotas, visitas, motivos e coordenadas (BKO) · check-in e checkout (app)

| testID | Onde |
|---|---|
| `visitas.tela` · `visitas.exportar-csv` · `visitas.filtro-de` · `visitas.filtro-ate` · `visitas.filtro-usuario` · `visitas.filtro-fora` | página Visitas |
| `visitas.linha.<id>` · `visitas.justificativa.<id>` · `visitas.ver-foto.<id>` · `visitas.foto` · `visitas.fechar-foto` | linha, justificativa fora do raio, foto da fachada |
| `coordenadas.tela` · `coordenadas.sugestao.<visita_id>` · `coordenadas.aprovar.<visita_id>` | página Coordenadas sugeridas |
| `motivos.tela` · `motivos.novo` · `motivos.linha.<codigo>` · `motivos.editar.<codigo>` · `motivos.remover.<codigo>` · `motivos.descricao` · `motivos.ativo` · `motivos.salvar` | página Motivos |
| `carteira.tela` · `carteira.exportar-csv` · `carteira.filtro-usuario` · `carteira.busca` · `carteira.vincular.<cliente_id>` · `carteira.linha.<cliente_id>` · `carteira.frequencia.<cliente_id>` · `carteira.dia.<cliente_id>` · `carteira.desvincular.<cliente_id>` | página Carteira |
| `produtos.unidades.<sku>` | coluna Unidades de venda (UN, CX c/ fator; padrão marcada) da página Produtos (T-0061) |
| `cliente360.tela` · `cliente360.contato.<id>` · `cliente360.endereco.<id>` | página Cliente 360 (`/cliente?id=`) |
| `checkin-justificar` · `checkin-justificativa` · `checkin-confirmar-justificativa` · `checkin-cancelar` | folha do check-in fora do raio (RN-CORE-10) |
| `checkout-atendido` · `reason-<codigo>` · `checkout-erro` | folha do checkout (promotor "atendido"; chips de motivo vindos de `motivo`) |

## T-0019 — notificações (app) e recados (BKO)

| testID | Onde |
|---|---|
| `notificacoes.tela` · `notificacoes.resumo` · `notificacoes.vazio` · `notificacoes.item.<id>` | tela Notificações do app (`/m/notificacoes`, offline) |
| `inicio.card-notificacoes` | card "N avisos não lidos" no Início (slot `inicio.cards`) |
| `recados.tela` · `recados.titulo` · `recados.corpo` · `recados.prioridade` · `recados.destino.<usuario_id>` · `recados.enviar` · `recados.caixa` · `recados.item.<id>` · `recados.enviados` · `recados.enviado.<notificacao_id>` (por destinatário: lida/não lida e lida_em; só quem enviou ou tem escopo) | página Recados do BKO (ação `notificacao.enviar`) |

## Contratos e regras desta onda (O-5, RN-CORE-10, T-0019)

- **RN-CORE-15 (corte imediato)**: o JWT de acesso leva `did` (aparelho da sessão); `autenticar` consulta `core.dispositivo` pela chave primária a cada requisição e responde 423 `DISPOSITIVO_BLOQUEADO`. Sem cache: o bloqueio vale na próxima requisição. Sessão sem aparelho (login sem `dispositivo_id`) não tem `did`.
- **RN-CORE-10 (raio)**: fonte única `plataforma.parametro` (`core`/`checkin.raio_m`, padrão 200). O servidor lê em `raioDoTenant`; o app recebe pelo pull `parametro` (somente essa chave) e usa `estado.raioCheckinM`; antes do primeiro sync vale `RAIO_CHECKIN_PADRAO_M` do domínio.
- **T-0019**: pull `notificacao` (escopo `proprio`), push `notificacao_leitura` (`somente_insercao`), rotas `GET/POST notificacoes`, `POST notificacoes/:id/lida`, `PUT dispositivos/atual/push` (corpo com `dispositivo_id`), ação `notificacao.enviar`, evento `core.notificacao.criada@1` (sem título/corpo). Push real: `api/push.ts`, desligado até `MACUXI_PUSH_ATIVO=1` e o build EAS.

## BKO — opção do perfil Promotor (T-0061; tela Usuários e módulos, nível Perfil › Promotor)
| data-testid | Elemento |
|---|---|
| `promotor-pedidos.painel` | Painel "Opções do perfil Promotor" (só admin; some para os demais) |
| `promotor-pedidos.estado` | Estado atual: `data-estado="ligado"` ou `"desligado"` |
| `promotor-pedidos.toggle` | Botão role=switch liga/desliga "Promotor vê pedidos" (`aria-checked`) |

## BKO — tela Usuários (`/usuarios`, T-0067)
| data-testid | Elemento |
|---|---|
| `usuarios.tela` · `usuarios.novo` · `usuarios.exportar-csv` | página; botão "Novo usuário" (só admin, ausente para os demais); CSV |
| `usuarios.busca` · `usuarios.filtro-perfil` · `usuarios.filtro-equipe` · `usuarios.filtro-situacao` | filtros (ficam na URL: `q`, `perfil`, `equipe`, `situacao`) |
| `usuarios.linha.<id>` | linha do usuário |
| `usuarios.editar.<id>` · `usuarios.alternar.<id>` · `usuarios.senha.<id>` | Editar, Desativar/Reativar e Senha (só admin; ausentes para os demais) |
| `usuarios.campo-nome` · `-email` · `-perfil` · `-equipe` · `-external-id` · `-senha` | campos do formulário (senha só na criação) |
| `usuarios.superior` | texto do superior imediato resultante da equipe escolhida |
| `usuarios.salvar` · `usuarios.cancelar` · `usuarios.erro` | formulário e erro da API (ex.: e-mail duplicado) |
| `usuarios.ativo-confirmar` · `usuarios.ativo-cancelar` | diálogo de desativar/reativar |
| `usuarios.senha-campo` · `usuarios.senha-confirmar` · `usuarios.senha-cancelar` | diálogo de redefinir senha |
| `nav-core-usuarios` | item de menu do shell (supervisor, gerente e admin) |

## Metas e RV (BKO, T-0068)

| testID | Onde |
|---|---|
| `metas.tela` | raiz da página |
| `metas.filtro-mes` · `metas.filtro-equipe` · `metas.filtro-indicador` | filtros (URL: `mes`, `equipe`, `indicador`) |
| `metas.atualizar` · `metas.exportar-csv` · `metas.meta-equipe` · `metas.copiar-anterior` | ações do cabeçalho (as duas últimas só com `meta.editar`) |
| `metas.linha.<usuario_id>.<indicador>` · `metas.editar.<usuario_id>.<indicador>` | linha da tabela e botão Definir/Editar |
| `metas.valor` · `metas.tipo` · `metas.lote-equipe` · `metas.lote-indicador` | campos do diálogo (valor em R$, % ou contagem) |
| `metas.salvar` · `metas.cancelar` · `metas.erro` | rodapé e erro da API |
