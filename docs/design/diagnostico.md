# Diagnóstico na nuvem: "Enviar diagnóstico" no app e Portal › Diagnósticos (T-0158)

- **Tarefa**: T-0158 (v1.0.4) · **Desenho técnico**: `docs/desenho/T-0158.md` §5 e §6 · **ADR** 0043
- **Imagens para aprovação**: `docs/design/telas/T-0158-diagnostico-app.png` e `docs/design/telas/T-0158-diagnosticos-portal.png` (+ `.html`)
- **Situação**: aguardando o parecer do corretor-redundancias e a aprovação do dono do produto.

## 1. App (Campo e Gestão): Perfil › Diagnóstico
Mesmo componente nos dois apps (`apps/mobile/src/components/enviar-diagnostico.tsx`, do engenheiro-apps).

**Ordem na seção Diagnóstico**
1. Cabeçalho `DIAGNÓSTICO` com `mostrar`/`ocultar` (como hoje; o detalhe técnico continua só ali).
2. Botão **secundário** `Enviar diagnóstico` (`Button variant="outlineDark"`, 44 dp, ícone `send`). Não é o principal do Perfil.
3. `ÚLTIMOS ENVIOS` (some sem envio): lista de até 10 linhas, do mais novo ao mais antigo, que não abre nada.
   - Linha: selo de situação com texto · `nº 0042` (Archivo 700, tabular) ou o motivo curto · data à direita (`Hoje, 14:32`).
   - Selos: `Enviado` (sucesso), `Na fila` + "sem sinal" ou "servidor indisponível" (aviso, `warningInk`; o 2º quando o servidor respondeu 404/405/501, 5xx, 401 ou 408), `Não enviado` + "limite da hora" ou "recusado" (perigo). Nunca "aguardando o servidor": "Na fila" já diz que aguarda (T-0158, parecer de 11/11).
   - 2ª linha só no envio automático (v1.0.5): `Queda do app · automático` ou `Erro de tela · automático`. O envio pelo botão não tem 2ª linha.
   - TalkBack: "Enviado, número 0042, hoje às 14:32".

**Folha `Enviar diagnóstico`** (`Folha` do kit, ✕ 48 dp, `evitarTeclado`)
1. Rótulo `O que aconteceu?` e campo de várias linhas (mín. 104 dp), exemplo `Ex.: o app fechou ao salvar o pedido.`
2. Ajuda embaixo, numa linha com o contador à direita: `Não escreva nome de cliente, telefone ou valores.` · `0/1000`.
3. Botão secundário `Anexar print (opcional)` (ícone `galeria`). Com print: linha com a miniatura, `Print anexado` / `Só a equipe Macuxi vê.` e o link `Remover` (perigo, 44 dp). Para trocar, remove e anexa outro.
4. `Vai junto: versão, aparelho, Android, tela, último erro e fila de envios.` Só os nomes, sem os valores: os valores ficam no `mostrar` do Diagnóstico (uma informação, um lugar). O bloco monoespaçado `resumoDoEnvio` sai da folha.
5. Botão principal `Enviar` (52 dp, ícone `send`), sempre ligado: texto e print são opcionais. Ao tocar, carregando e sem 2º toque.

**Confirmação** (a folha troca de conteúdo, sem abrir outra; anunciada ao aparecer)
| Situação | Ícone | Título (Archivo 800, 22) | Apoio |
|---|---|---|---|
| Aceito | `check` em `successBg` | `Enviado · nº 0042` | `Se falar com o suporte, diga este número.` (vibração leve) |
| Sem sinal | `wifiOff` em `warningBg` | `Na fila` | `Sem sinal. Não precisa enviar de novo.` |
| Servidor não aceitou ainda (404/405/501, 5xx, 401, 408) | `clock` em `warningBg` | `Na fila` | `Servidor indisponível. Não precisa enviar de novo.` |
| 429 | `alerta` em `dangerBg` | `Não enviado` | `Muitos envios nesta hora. Tente mais tarde.` |
| Outra recusa | `alerta` em `dangerBg` | `Não enviado` | `Não deu para enviar. Tente de novo.` |

Na fila: a ajuda diz só a causa e a ação (não reenviar); "Vai sozinho quando…" e "O número aparece em Últimos envios" saíram por serem o que o sistema faz por trás (R-20261110-192153); a linha nova aparece no topo de Últimos envios ao fechar.

Botão único `Fechar` (secundário, 52 dp). Fechar volta ao Perfil com a linha nova no topo de Últimos envios.
Fechar sem enviar (✕, arrastar, Voltar) descarta o texto e o print, sem pergunta.

## 2. Portal › Diagnósticos (só super-admin)
Telas `apps/web/app/config/diagnosticos/page.tsx` e `[id]/page.tsx` (engenheiro-apps), na `MolduraPortal`.

- **Cabeçalho do portal**: novo menu `Empresas · Diagnósticos` ao lado da marca, só para o time Macuxi; item ativo com sublinhado `accent` de 3 px. O admin do cliente não vê o menu; no endereço direto, `Esta área é só do time Macuxi.` com o link para a empresa dele.
- **Lista**: título `Diagnósticos`, subtítulo `Enviados pelos aparelhos. Ficam 90 dias.`
  - Filtros numa linha (painel): Versão · Aparelho (busca por modelo) · Empresa · Motivo · Origem · Período (padrão: últimos 7 dias) · `Limpar filtros` (só com filtro ligado). Os filtros vão para o endereço.
  - Contagem `N diagnósticos`; tabela: Nº · Recebido (dd/mm hh:mm, Manaus) · Empresa · App (`Campo 1.0.4`) · Aparelho · Android · Origem · Motivo · Print (`Sim`/`—`). A linha inteira abre o detalhe.
  - Origem em selo com texto: `Botão` (neutro), `Queda` (perigo), `Erro de tela` (aviso). Motivo em português; o código só no detalhe: Falha nativa · `crash_nativo`; App travou (ANR) · `anr`; Sem memória · `memoria`; Encerrado pelo sistema · `encerrado`; erro de tela pela `OrigemDoErro`; botão = `—`.
  - `Mostrar mais 50` (cursor). Vazio: `Nenhum diagnóstico com estes filtros.` / `Nenhum diagnóstico recebido.` Carregando: `Buscando os diagnósticos…`.
- **Detalhe**: `← Diagnósticos`; título `Diagnóstico nº 0041` + selo da origem; linha `Campo 1.0.4 · Motorola moto g54 · Android 14 (API 34) · recebido 11/11 às 14:02`.
  - Coluna larga: `O QUE ACONTECEU?` (o relato, ou `Sem relato.` em todos os casos; o selo do título já diz a origem) · `SAÍDA DO ANDROID` e `ÚLTIMO ERRO DO APP` em bloco monoespaçado, com `Copiar` (copia o bloco inteiro) e `… mais N linhas` que abre no lugar.
  - Coluna de 360 px: `ORIGEM` (Ocorrido só no envio pelo botão, onde não há bloco com hora e ele difere do `recebido` quando o envio ficou na fila; Empresa + id, Usuário: perfil + id, Build, Tela, Fila) · `PRINT` (miniatura 72 × 128 + `Abrir em tamanho real`, ou `Não anexado.`) · `RECADO AUTOMÁTICO` (selo + data e destinatários + id do recado).
  - Selos do recado: Enviado (sucesso) · Pendente (aviso, "próxima tentativa hh:mm") · Agrupado (neutro, "no resumo de hh:mm") · Falhou (perigo, "8 tentativas") · Desligado (neutro, "servidor sem o token de recados").
  - Uma informação, um lugar: o modelo, o app e a versão ficam só na linha do título; a origem, só no selo.
