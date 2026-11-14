# Oficial (Campo-Oficial / Gestao-Oficial) · reteste final do corretor-redundancias

**Veredito: NÃO LIBERADO.**

- Os 20 RD do relatório anterior estão **fechados** no código.
- Abro **5 achados novos** em código de produção ou tela (RD-0254 a RD-0258). Todos são de gravidade baixa, mas nenhum está só em comentário, então os 5 seguram o build.
- Abro também o **RD-0259**, que está só em comentário. Ele não segura e entra no lote seguinte.

Corretor-redundancias, 14/11/2026, pedido R-20261114-043038 (alexandre → gerente-projetos, cc corretor). Li o código no **`main` 2fdad4d**.
A varredura cobriu o diff `b59e2f7^..2fdad4d`, com os PRs #167 a #184.
Vale a regra do Oficial: nenhum achado aberto, de qualquer gravidade. A única exceção é o achado baixo que está só em comentário ou em título de teste (R-20261110-062506, R-20261111-190159).

## 1. RD do relatório `2026-11-14-oficial.md`
| RD | Situação | Onde está resolvido (`main` 2fdad4d) |
|---|---|---|
| RD-0173 | fechado | `vendedor/app/lib/pagamento-pedido.ts`: saíram o `TEXTO_SEM_FORMAS` e a `pendenciaDoPagamento`; os testes usam `situacaoDoPagamento` |
| RD-0181 | fechado (código) | `core/app/lib/etapa-pendente.ts:27`: a função ficou sem `semSinal`; `cliente.tsx:80` também não passa mais `semSinal`. O comentário velho de :26 ficou, ver RD-0259 |
| RD-0182 | fechado | `core/app/components/visit-sheets.tsx`: o bloco `checkout-pendencias` ("Falta concluir: …") saiu; o `erro` ficou |
| RD-0183 | fechado | `core/app/components/cliente360.tsx:182`: "Nenhum endereço de entrega.", sem o "Sincronize…" |
| RD-0187 | fechado | `catalogo/app/lib/apresentacao.ts:57-58` agora têm `detalhe: ''`; `produto.tsx:109` esconde a linha quando ela fica vazia |
| RD-0199 | fechado | `core/domain/notificacao-pedido.ts:17-35`: o título vai sem o corpo repetido. Só a rejeição tem corpo, com `Motivo: …` |
| RD-0205 | fechado (código e spec) | `core/app/telas/rota.tsx:163-174`: um fato por linha, e a `hint` saiu. A spec `rota-catalogo-perfil.md` §1:25-31 foi reescrita |
| RD-0206 | fechado (código e spec) | `vendedor/app/screens/orders-screen.tsx:401-434`: a linha 2 tem um fato só (o Nº achado pela busca, ou o vendedor, ou a hora) e o selo. "No aparelho", a linha do motivo e o `orderNote` saíram. A spec é a `pedido-v4.md` §4:138-141 |
| RD-0211 | fechado | `core/app/telas/notificacoes.tsx:39-46`: saíram os chips `Leitura não enviada` e `Não lida`, e o corpo vazio não aparece |
| RD-0213 | fechado | `treinamento/app/screens/trilha-screen.tsx:143` mostra "Vídeo com quiz" |
| RD-0215 | fechado | `apps/mobile/src/app/profile.tsx`: o erro da carga ficou sem a cauda, o vazio diz "Nada pendente.", cada item tem uma linha de apoio e o `SeloDaFila` mostra `Na fila` ou `Não enviado` |
| RD-0217 | fechado | `vendedor/web/components/orders/approvals-panel.tsx:40-47`: o `Nº · vendedor · há` saiu; a linha 2 é o motivo, com a tag `há N` ao lado |
| RD-0218 | fechado | `core/web/components/routes/route-editor.tsx:357`: uma tag só (dias sem compra, senão `Curva A`); saíram a `Sugestão` e a frase |
| RD-0235 | fechado | `pendencias: 0` e as chamadas de `leituraDoSalvar` saíram do Vendedor, e a UF usa `falta` (`endereco-pedido.tsx:225`). O kit apagou `leituraDoSalvar` e a prop `erro` |
| RD-0236 | fechado | os comentários "Falta para salvar" saíram de `sair-do-pedido.ts`, `new-order-screen.tsx`, `textos-pedido.ts` e `novo-pedido.ts` |
| RD-0242 | fechado | `catalogo/app/telas/comum.tsx:61`: o cartão sem foto mostra a caixa `neutralBg` vazia; a `reserva` saiu da `miniatura.tsx` |
| RD-0250 | fechado | há um mapa só, `ROTULO_INDICADOR_META` + `rotuloDoIndicadorMeta` (`core/contracts/sync.ts:364-378`). O shell, as Metas, a Performance, o Plano de RV, o BKO e o Gestor usam esse mapa (`rotulos-indicadores.md`) |
| RD-0251 | fechado | `core/app/components/checkin-sheet.tsx`: saíram as duas frases depois do check-in |
| RD-0252 | fechado | `vendedor/app/state/use-vendedor.ts:567-648`: `TEXTO_SEM_SINAL_PARA_SALVAR`, `Modo sem sinal ligado: desligue no Perfil para salvar`, `Sem sinal para cancelar` e `Sem sinal para decidir`. O `PRECISA_SINAL` saiu |
| RD-0253 | fechado | `packages/ui/src/mobile/cartoes-pedido.tsx` ficou sem `CartaoCredito` e `ValorCredito`. `componentes.md:153` e `novo-pedido-itens.md:73,81` apontam para `pedido-v3.md` §A |

## 2. Achados novos
### RD-0254 · baixa · texto · modulo-gestor · **segura**
- **Onde:** `modules/gestor/app/state/use-gestor.ts:19` (`PRECISA_SINAL`, usado em :57) e `modules/gestor/app/screens/alertas-screen.tsx:17` (`SEM_SINAL`).
- **O que se repete:** o mesmo fato, Dispensar sem sinal, aparece na mesma tela com dois textos:
  - "Sem sinal. Precisa de internet.", em que a segunda frase repete a primeira;
  - "Sem conexão: esta ação precisa de internet. Tente de novo quando o sinal voltar.", que explica e repete. No Campo, o caso igual virou "Sem sinal para decidir" (RD-0252).
- **Correção:**
  - em `use-gestor.ts:19`, trocar por `export const SEM_SINAL_PARA_DISPENSAR = 'Sem sinal para dispensar';` e usar essa constante em :57;
  - em `alertas-screen.tsx`, apagar a :17 e importar `SEM_SINAL_PARA_DISPENSAR` de `../state/use-gestor` no `setAviso` da :86;
  - os testes que procuram os textos antigos mudam junto.

### RD-0255 · baixa · código · modulo-vendedor · **segura**
- **Onde:** `modules/vendedor/app/state/use-vendedor.ts:85`, nas linhas :480, :679, :686 e :694, e `modules/vendedor/app/screens/new-order-screen.tsx:175,607`.
- **O que sobra:** nenhuma tela mostra o `message` do resultado `queued`:
  - o Novo pedido mostra o `avisoSalvoNoAparelho` (:783-786) e o `avisoDoSalvar` (:603);
  - o `converter` do detalhe (`order-detail-screen.tsx:257-259`) só navega.

  Mesmo assim, o campo carrega 3 frases que explicam o sistema: "Modo sem sinal: o pedido será enviado quando o sinal voltar.", "Pedido recebido pelo servidor. O número e o status aparecem na próxima atualização." e "Sem conexão: o pedido será enviado quando o sinal voltar.".
- **Correção:**
  - `ResultadoEnvio` (:85) passa a ser `{ kind: 'sent'; order: OrderDetail } | { kind: 'queued'; id?: string }`;
  - :480 vira `return { kind: 'queued', id };`, e :679, :686 e :694 viram `{ kind: 'queued' }`;
  - em `new-order-screen.tsx`, o `Sent` (:175) perde o `message`, e a :607 vira `{ kind: 'queued', snapshot }`;
  - o import de `avisoDoSalvar` em `use-vendedor.ts:31` sai, se ficar sem uso;
  - em `salvar-na-fila-telas.test.ts:17`, a string esperada muda junto.

### RD-0256 · baixa · texto · engenheiro-apps · **segura**
- **Onde:** `apps/mobile/src/app/profile.tsx:201`.
- **O que se repete:** "Os itens abaixo marcados como “Não enviado” não chegaram ao servidor." diz por extenso o que o selo `Não enviado` da mesma tela já mostra (RD-0215). A consequência do botão continua necessária.
- **Correção:** a :201 vira `Ao confirmar, os itens “Não enviado” e os dados desse módulo são apagados deste aparelho.`

### RD-0257 · baixa · código · engenheiro-software · **segura**
- **Onde:** `packages/platform-sdk/src/motor-sync.ts:501-520` (`ROTULO_SITUACAO`, `rotuloDoItem`, `rotuloDoArquivo`).
- **O que sobra:** desde o RD-0215, nenhum código de produção usa esses três. Só os testes usam (`motor-sync.test.ts:306-307`, `motor-sync.arquivos.test.ts:91,111,209` e `tests/integracao/api/sync-app.test.ts:318`). Eles ainda carregam os textos antigos ("não enviado — módulo desativado", "na fila — aguardando o registro chegar ao servidor"), que divergem do selo da tela.
- **Correção:**
  - apagar `ROTULO_SITUACAO`, `rotuloDoItem` e `rotuloDoArquivo` de `motor-sync.ts`, e o re-export no índice do SDK, se houver;
  - nos testes, trocar as asserções de rótulo pelas de estado: `situacao` e `codigo` do item ou do arquivo (inclusive em `tests/integracao/api/sync-app.test.ts:318`, que é do testes: o engenheiro-software avisa por recado);
  - em `profile.tsx:4`, o comentário já fala do selo e não muda.

### RD-0258 · baixa · código · modulo-gestor · **segura**
- **Onde:** `modules/gestor/domain/ranking.ts:24` e `:33-40` (o campo `rotulo` de `DefinicaoIndicador`), e `modules/gestor/app/lib/apresentacao.ts:53-62` (`INDICADOR_ROTULO`).
- **O que se repete:** há dois mapas de nome para o mesmo indicador do ranking, e eles divergem: "Clientes positivados" × "Positivados", "Atingimento da meta (mensal)" × "Meta" e "Conformidade de gôndola" × "Gôndola". O `rotulo` do domain não é lido em lugar nenhum (`rankingDaEquipe` usa só `sentido`, `perfis` e `modulo`). As telas usam só o `INDICADOR_ROTULO`.
- **Correção:** apagar `rotulo: string` (:24) e os 8 `rotulo:` (:33-40) de `ranking.ts`, com o import de `ROTULO_INDICADOR_META` (:12), que fica sem uso. O nome exibido fica só em `INDICADOR_ROTULO`. Os testes que leem `INDICADORES[x].rotulo` mudam junto.

### RD-0259 · baixa · comentário · modulo-core · **não segura** (lote seguinte)
- `modules/core/app/lib/etapa-pendente.ts:26`: o comentário diz "a segunda linha depende da fila e do sinal", mas a segunda linha agora é fixa ("Fale com seu supervisor"). O PR apagou o comentário do RD-0181, que estava certo, e deixou este. Correção: `/** Texto do Banner da ficha do cliente (§1.2); com etapa na fila não há aviso (RD-0181). */`.
- `modules/core/web/lib/metas.ts:4`: o comentário diz que os textos vêm de `app/lib/metas-formato`, mas os rótulos agora vêm de `ROTULO_INDICADOR_META` (contrato). Correção: `… Os rótulos vêm de ROTULO_INDICADOR_META (contrato) e o formato de app/lib/metas-formato, os mesmos do app.`

## 3. Para o testes (sem RD)
- `core/app/telas/rota.tsx:167` gera "Sem pedido: preço alto" (com `toLowerCase`), mas a spec `rota-catalogo-perfil.md:26` pede o motivo como está cadastrado ("Sem pedido: Preço alto"). A correção que propus no RD-0205 trazia o `toLowerCase`: vale a spec, e o código deve ficar sem o `toLowerCase`.
- `apps/mobile/src/app/profile.tsx:265`: o botão `Enviar agora` continua na tela, mas a spec §4:99 diz que ele sai. Já foi informado no relatório anterior.

## 4. Por dono
| Dono | RD que seguram | Não segura |
|---|---|---|
| modulo-gestor | RD-0254, RD-0258 | — |
| modulo-vendedor | RD-0255 | — |
| engenheiro-apps | RD-0256 | — |
| engenheiro-software | RD-0257 | — |
| modulo-core | — | RD-0259 (comentário) |

Reteste: depois do merge das 5 correções, confiro de novo no `main`. O RD-0254 e o RD-0256 também precisam ser conferidos no print do aparelho do Oficial.
