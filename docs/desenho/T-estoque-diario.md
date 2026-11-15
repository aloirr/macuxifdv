# Estoque carregado uma vez por dia no aparelho — proposta

Origem: R-20261115-084000-alexandre, texto literal: "Estoque é algo carregado apenas uma vez no dia. Para não pesar no FDV."
Autor: engenheiro-software, 15/11/2026 (Manaus). Situação: **proposta, sem código**. Se for aprovada, vira o ADR 0055 e as tarefas do §7.
Base lida: branch `nuvem/catalogo-pacote-engenheiro-software` (4e6fc2d), com o pacote da 1ª carga (ADR 0054, `docs/desenho/T-catalogo-pacote.md`).

## 0. Como funciona hoje
- O estoque chega ao aparelho em duas entidades do Catálogo: `deposito` e `estoque_saldo` (`modules/catalogo/api/sync.ts`, escopo
  `tenant` filtrado pelas filiais da carteira, RN-CORE-39). Elas entram em toda sincronização: na completa, nas **novidades**
  (RN-CORE-23 item 4: ao abrir, ao voltar ao primeiro plano depois de 30 min e a cada `sync_auto_min`) e no push silencioso.
  Cada lote de estoque do ERP (`integracao.estoque.atualizado@1` → `criarConsumidorEstoqueDoErp`) muda `updated_at` e faz o aparelho
  puxar de novo.
- O "Atualizado às hh:mm" (RN-CAT-07, `modules/catalogo/app/lib/apresentacao.ts` → `rotuloEstoque`) mostra o `atualizado_em` de cada
  saldo (= `atualizado_erp_em`, a hora do ERP), e "Estoque desatualizado" depois de [`estoque_defasado_horas` = 24] h.
- O Novo pedido (`modules/vendedor/app/state/use-vendedor.ts`, `comEstoqueDaFilial`) mostra e valida offline o disponível da
  filial do cliente = saldo local − reservas locais (RN-VEN-20). A API **revalida** com o saldo atual do servidor
  (`modules/vendedor/api/receber.ts` → `faltaDeEstoqueNaFilial` → `catalogo.estoque_filial@1`) e rejeita com `RN-VEN-20`.

## 1. Quando acontece a carga diária
- **Gatilho:** a **primeira sincronização do dia que tiver sinal** (abrir o app, voltar ao primeiro plano, automática, botão
  "Sincronizar" ou puxar para baixo), a partir da hora `estoque_carga_hora` [06:00] no **fuso do tenant**. Não há timer novo
  (RN-CORE-23 continua sem timer abaixo de 15 min); a carga vai junto da sincronização que já ia acontecer.
- **Regra (função pura):** `cargaDiariaDevida({ ultima, agora, fuso, hora })` = verdadeiro quando não houve carga ou quando a última
  aconteceu antes do instante "hoje às `hora`" no fuso do tenant e `agora` já passou desse instante. Antes da hora, vale a carga de
  ontem. A hora é parâmetro do tenant para casar com o lote noturno do ERP (ex.: ERP fecha às 5h → carga a partir das 6h).
- **O que é a carga:** o pull das entidades marcadas como diárias (`deposito` e `estoque_saldo`), a partir do cursor de cada uma, ou
  seja, só o que mudou desde ontem. Ela só conta como feita quando **todas** as diárias terminam; aí o motor grava
  `sync:carga_diaria_em` (ISO UTC, relógio do aparelho no fim da carga).
- **Fora da carga:** as novidades, o push silencioso e a sincronização completa **pulam** as entidades diárias. O botão
  "Sincronizar" não força uma segunda carga no mesmo dia (é o que o Alexandre pediu). O cursor de novidades continua andando
  normalmente: cada entidade tem cursor próprio, então o que for pulado chega na carga do dia seguinte (nada se perde).
- **Gestão:** a mesma regra vale no motor do Gestão (Aprovações mostra estoque).

## 2. Vendedor sem sinal no momento da carga
- O aparelho fica com o **estoque de ontem**; nada é apagado.
- "Atualizado às" passa a mostrar **a hora da última carga diária** (`carga_diaria_em`, no fuso do tenant), e não mais a hora do
  ERP de cada saldo. Se a carga não é de hoje, o texto leva o dia: "Atualizado ontem às 06:12" ou "Atualizado em 13/11 às 06:12"
  (texto final do designer-ux, parecer do corretor).
- "Estoque desatualizado" (RN-CAT-07) passa a contar a partir da carga: com a carga diária, 24 h deixa de servir (carga às 06:05
  ontem e às 07:00 hoje = 25 h, aviso no meio da manhã sem motivo). Proposta: **desatualizado = a última carga não é de hoje e a
  hora da carga de hoje já passou** (mesma função do §1), e o parâmetro `estoque_defasado_horas` sai do app (fica só no BKO, que lê o
  servidor).
- **Nova tentativa:** toda sincronização seguinte (sinal voltando, abrir o app, primeiro plano, botão) reavalia `cargaDiariaDevida`;
  a primeira que conseguir faz a carga. Queda no meio = não grava `carga_diaria_em`; a próxima retoma do cursor de cada entidade
  (o que já entrou fica, a hora continua a de ontem até terminar).

## 3. Pedido, ruptura e validação no servidor (modulo-vendedor)
- **Servidor sem mudança:** a API continua revalidando RN-VEN-20 com o saldo **atual** do servidor (regra 2 do CLAUDE.md). O que o
  aparelho mostra é só ajuda; quem decide é a API.
- **Consequência:** durante o dia o app pode aceitar um item que a API rejeita (`422`, `codigo` RN-VEN-20, "Envie como orçamento ou
  reduza a quantidade"). O fluxo de rejeição já existe; vai acontecer mais.
- **Descompasso das reservas:** os pedidos continuam no sync contínuo. Quando um pedido é faturado no dia, a reserva sai (status
  muda no aparelho), mas o saldo do ERP que baixou só chega amanhã. Resultado: o app mostra **mais** disponível do que existe até a
  próxima carga. Opções para o Alexandre: (a) aceitar e deixar a API decidir; (b) o app continua descontando a reserva de pedido
  faturado depois da `carga_diaria_em` (regra no `domain` do Vendedor, `reserva-filial.ts`). Recomendo (b): é função pura e evita
  oferecer o que já saiu.
- **"Risco de ruptura"** do popup do item (`modules/vendedor/app/lib/item-popup.ts`) e os alertas de estoque do pedido (RN-VEN-42)
  passam a refletir a carga do dia; sem mudança de código além do item (b).
- **`alerta_ruptura`** (ruptura registrada pelo promotor, `promotor.ruptura.registrada@1`) **não** é estoque do ERP: continua no
  sync contínuo. A ruptura do promotor (gôndola/depósito da loja) não muda.
- **Promotor sem preço/estoque** (RN-CAT-05): não recebe as entidades; nada muda.

## 4. Hub de integração e servidor
- O Hub continua recebendo estoque **a qualquer hora** (`integracao.estoque.atualizado@1`, RN-INT-02/04) e o consumidor do Catálogo
  grava em `catalogo.estoque_saldo` na hora. Servidor, BKO, `catalogo.estoque_filial@1` e a validação do pedido ficam sempre atuais.
- Nada muda no `modulo-integracao` nem no banco. Só a ida ao aparelho é diária.
- Online, a busca do catálogo (`GET /v1/catalogo/busca`) traz o estoque atual do servidor. Para o app não mostrar dois estoques
  diferentes na mesma manhã, proposta: **com a carga diária já feita, o app mostra o estoque local também nos resultados online**
  (o Catálogo troca a disponibilidade da resposta pela local); só na 1ª carga, com o catálogo ainda pendente (solução 5), mostra o da
  API com a hora do ERP. Decisão do Alexandre (pergunta 1 do §8).

## 5. Pacote da 1ª carga (solução 4) e entrar enquanto carrega (solução 5)
- **Solução 4:** `deposito` e `estoque_saldo` já estão na partição `catalogo · filial:<uuid>` do pacote. Na 1ª carga o pacote entra
  como hoje e o pull incremental de depois completa; no fim, o motor grava `carga_diaria_em` (a 1ª carga **é** a carga do dia).
  Nenhuma mudança no formato nem no gerador (ADR 0054). Fica como possibilidade futura um pacote só de estoque para a carga diária,
  se o ERP regravar o estoque inteiro toda noite (ver risco 1).
- **Solução 5:** a entrada continua liberada depois de "Clientes e rota"; o estoque segue na etapa "Catálogo e preços" (a última).
  Enquanto ela não termina, não há `carga_diaria_em`; a busca online mostra o estoque da API (§4).
- **Troca de geração** (ADR 0021): apaga `carga_diaria_em` junto com os cursores; a carga seguinte refaz tudo.

## 6. RN afetadas (texto final pelo gerente no doc 03)
- **RN-CORE-23** item 4 e item 3: novidades e push silencioso não trazem as entidades de carga diária; nova alínea "Estoque: uma
  carga por dia, na primeira sincronização com sinal a partir de [`estoque_carga_hora` = 06:00] no fuso do tenant".
- **RN-CAT-07:** "atualizado às hh:mm" = hora da carga diária no aparelho (com o dia quando não é hoje); "desatualizado" = carga que
  não é de hoje depois da hora da carga. No BKO continua a hora do ERP e as [24] h.
- **RN-VEN-20:** nota de que o app valida com o saldo da carga do dia e a API com o saldo atual; item (b) do §3 se aprovado.
- **RN-CORE-48** e solução 5: sem mudança de ordem.
- Parâmetro novo na tabela do doc 03: `estoque_carga_hora` [06:00].

## 7. Divisão por dono (caminhos exclusivos; números T-nnnn pelo gerente)
| # | Dono | O que faz | Caminhos | Depende |
|---|---|---|---|---|
| A | engenheiro-software | `DefinicaoEntidadeSync.cadencia?: 'continua' \| 'diaria'` (aditivo); motor pula as diárias nas novidades, push silencioso e completa fora da carga; carga diária dentro da sincronização quando `cargaDiariaDevida` (injetada, como `essenciais`); `EstadoMotorSync.carga_diaria_em`; apaga na troca de geração; testes no simulado; ADR 0055 | `packages/platform-sdk/src/{sync,motor-sync}.ts` (+ testes), `docs/decisoes/0055-*`, `.coord/contratos/modulos.md` | — |
| B | modulo-core | `cargaDiariaDevida` e `cargaDeHoje` (funções puras, fuso do tenant, testes citando RN-CORE-23) | `modules/core/domain/carga-diaria.ts` (+ teste), `modules/core/contracts/` (export) | — |
| C | modulo-catalogo | `cadencia: 'diaria'` em `entidadeDeposito` e `entidadeEstoqueSaldo`; parâmetro `estoque_carga_hora`; `rotuloEstoque`/`estoqueVisivel` no app pela `carga_diaria_em` (desatualizado pela regra do §2); estoque local sobre a busca online (§4) | `modules/catalogo/contracts/**`, `modules/catalogo/domain/{estoque,parametros}.ts` (+ testes), `modules/catalogo/app/**` | A, B |
| D | modulo-vendedor | Só se o item (b) for aprovado: reserva de pedido faturado depois da carga continua descontada | `modules/vendedor/domain/reserva-filial.ts` (+ teste), `modules/vendedor/app/state/use-vendedor.ts` | A |
| E | engenheiro-apps | Shell: injeta `cargaDiariaDevida` com fuso e hora do tenant no motor; expõe `carga_diaria_em` no estado da plataforma para os módulos | `apps/mobile/src/services/motor-do-usuario.ts`, `apps/mobile/src/state/plataforma.tsx` (+ testes) | A, B |
| F | designer-ux | Textos "Atualizado ontem às…", "Atualizado em dd/mm às…" | `docs/design/**` | — |
| G | testes | Roteiro: abre às 05:50 (estoque de ontem), às 06:10 (carga), 2ª sincronização sem estoque, sem sinal na manhã, queda no meio, pedido rejeitado RN-VEN-20, troca de geração; valor × regra com o BKO | `tests/**`, `docs/testes/**` | todas |

- **Sem tarefa:** modulo-integracao, banco-dados (sem schema novo), modulo-promotor.
- **Gerente:** RN do §6 no doc 03 e quadro. **Corretor-redundancias:** textos do "Atualizado". **Design-de-marca:** só se o rótulo
  mudar de layout.
- Tudo aditivo: app antigo continua no sync contínuo; servidor não muda.

## 8. Riscos e perguntas
1. **ERP que regrava tudo toda noite:** se o consumidor atualiza `updated_at` mesmo sem mudar a quantidade, a carga diária vira o
   estoque inteiro (dezenas de milhares de linhas, páginas de 1.000). Mitigação: o modulo-catalogo confere no consumidor e não toca
   linha com a mesma quantidade (só `atualizado_erp_em`, sem `updated_at`); se não bastar, pacote só de estoque (ADR 0054).
2. **Mais rejeições RN-VEN-20** ao enviar (estoque do app mais velho). Mitigação: item (b) do §3; mensagem de rejeição já existe.
3. **Relógio do aparelho errado** decide a carga: usar a hora do servidor da última resposta quando disponível (o motor já tem o
   horizonte); fica no teste G.
4. **Vendedor que abre antes da hora e não sincroniza mais** fica com o de ontem o dia inteiro; o "Atualizado ontem às…" deixa claro.
5. **Pergunta 1 ao Alexandre:** na busca online, mostrar o estoque da carga do dia (recomendado, um estoque só) ou o atual da API?
6. **Pergunta 2:** hora da carga [06:00] por tenant está bom? O botão "Sincronizar" não força estoque fora da carga; confirmar.
