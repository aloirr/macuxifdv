# Supervisor em campo no app Gestão (simulação, T-0187)

Versão v1.0.16. Pedido do dono do produto: recado de 19/11/2026, 05h50 de Manaus (T-0187). É uma simulação, sem código: o rito
é a aprovação do dono do produto, depois o desenho do `engenheiro-software` (o que reaproveita do Campo e as permissões) e só
então os donos dos módulos.

Pranchas desta pasta (gere com `node docs/design/supervisor-campo/gerar.mjs`, a partir da raiz do repositório):

| Prancha | O que mostra |
|---|---|
| `01-rota.png` | Rota do supervisor: A (própria) e B (acompanha a de um vendedor), em visita, checkout e depois do checkout |
| `02-ficha-cliente.png` | Ficha do cliente (Cliente 360 v2) com o rodapé Check-in · Pesquisa · Novo pedido, o check-in, o estado em visita e o rodapé sem a licença de Pesquisa |
| `03-novo-pedido-venda.png` | Aba Venda com "Em nome de" preenchido com o vendedor da carteira, a lista aberta com a equipe, a troca e o efeito no Resumo |
| `04-resumo-e-envio.png` | Resumo com "Em nome de Carla Lima", desconto dentro da alçada do supervisor, envio para aprovação, desconto acima da alçada e o detalhe do pedido |

Aparelhos em 360×760 dp, com `deviceScaleFactor` 2. O gerador falha nestes casos: a nota cobre um aparelho; um texto é cortado
ou fica a menos de 4 px da borda; um elemento sai do aparelho; um bloco fixo (status, faixa, abas, rodapé, barra, folha,
diálogo, aviso, menu da lista) estoura; dois itens da mesma linha se sobrepõem. `docs/design/_comum` não existe no `main` de
19/11: a abertura do Chromium e o laço ficam no próprio `gerar.mjs`, como em `docs/design/menu-parametros/gerar.mjs`. Os ícones
são lidos de `packages/ui/src/mobile/icon.tsx`. A sessão não tem Roboto: o PNG usa Inter, um pouco mais larga; no Android, com a
fonte do sistema, tudo cabe com folga.

Dados de exemplo, iguais em todas as pranchas (quinta, 19/11/2026, fuso de Manaus):
- supervisor Marcos Dias; equipe com os vendedores Carla Lima, João Melo e Paulo Reis; gerente Rui Matos;
- cliente Mercado Bom Preço, C5007, Centro, Boa Vista/RR, da carteira de Carla Lima; limite R$ 8.000,00, saldo disponível
  R$ 1.880,00 e uma NF em atraso (a mesma do Cliente 360 v2), por isso o pedido mostra "Título vencido";
- pedido 000022, 3 itens: 1.290,00 + 320,00 + 144,00 = R$ 1.754,00 de tabela. Com 8,0% de desconto geral:
  1.186,80 + 294,40 + 132,48 = R$ 1.613,68 (desconto R$ 140,32). Com 12,0%: 1.135,20 + 281,60 + 126,72 = R$ 1.543,52
  (desconto R$ 210,48). Na rota, "Pedido R$ 1.614" é o mesmo valor arredondado, como no Campo (`formatBRL0`).

## 1. O que muda

| Hoje | Na v1.0.16 |
|---|---|
| A Rota é só do Campo (`modules/core/app/index.ts`, `apps: ['campo']`) | A Rota entra no Gestão, com a mesma tela, o mesmo check-in único e o mesmo checkout (RN-CORE-13) |
| Barra do Gestão: Início · Equipe · Aprovações · Clientes · Alertas (5 posições) | Início · Equipe · **Rota** · Aprovações · Clientes · Alertas (6 posições, como o Campo na T-0170; ponto P6) |
| Ficha do Gestão sem rodapé (Cliente 360 v2, P13 = A) | Ficha com o rodapé do Campo: **Check-in · Pesquisa · Novo pedido**. Muda o P13 do Cliente 360 v2 por pedido do dono do produto |
| Pedido em nome: sai da ficha da vendedora (Equipe › Carla Lima › "Fazer pedido em nome") e o seletor mostra só a carteira dela (RN-VEN-35) | Também sai da ficha do cliente. O vendedor vem preenchido com o da carteira e pode ser trocado por outro vendedor da equipe no campo "Em nome de" da aba Venda |
| Resumo do pedido: bloco "Condição de pagamento" (Forma, Prazo) | No pedido em nome, o bloco se chama "Venda" e começa com a linha "Em nome de" |

O que **não** muda: a ficha é o Cliente 360 v2 aprovado (`docs/design/cliente-360-v2/spec.md`, em `ef4dd56`), com as três abas
Resumo, Histórico e Documentação, a tabela Carteira e "Visitada por" do Gestão. Esta spec não repete aquele desenho. O Novo
pedido é o do Campo (`docs/design/pedido-v4.md`), com as mesmas abas, Alertas, tabelas e botões.

**Rastreamento:** é interno (R-20261119-0546). Nenhuma tela do Gestão mostra trajeto, pausa, "Meu trajeto", selo ou aviso de
rastreamento. Quem vê é o gerente autorizado, no lugar definido pela T-0156. Ver o ponto P7 (aviso do Android e base LGPD).

## 2. Rota (prancha 01)

Componente: a tela `modules/core/app/telas/rota.tsx`, a mesma do Campo, com `apps: ['campo', 'gestao']`.

- **Faixa:** "Rota de hoje"; subtítulo "5 visitas · 22 km · Centro-Norte" (A) ou o da rota do vendedor escolhido (B); sino.
- **Linha de cima:** o chip "1 feita" (`success`) e o botão de filtro, como no Campo.
- **Mapa** com as paradas e o botão "Ir para a parada N". Some com uma visita aberta, como no Campo.
- **Lista das paradas**, na ordem da rota:
  - o nome fantasia, em 16/600, quebrando em duas linhas quando não cabe;
  - a 2ª linha (12, `ink2`): na opção A, o horário e o vendedor da carteira ("09:00 · Carla Lima"). O supervisor visita clientes de vários vendedores e usa o nome para saber de quem é o cliente antes de entrar (e para ligar para o vendedor pela tabela Carteira da ficha). Na opção B, só o horário, como no Campo;
  - feita: o ✓ verde, o nome em `ink2` e o resultado ("Pedido R$ 1.614" ou "Sem pedido: Estoque cheio"). Na opção B, a visita feita pelo vendedor leva o nome dele ("Pedido R$ 640 · Carla Lima");
  - em visita: a linha em `accentTint`, o número em Azul noite, "Check-in 09:18" em Azul noite e o botão "Checkout";
  - com uma visita aberta, o "Check-in" das outras paradas fica neutro com o cadeado (rótulo acessível "Check-in bloqueado em <cliente>").
- **Opção B, só nela:** a `ListaSuspensa` "Rota de" no topo, com os vendedores da equipe (o mesmo menu da aba Venda, §4).
- **Checkout:** a mesma folha do Campo (`components/visit-sheets.tsx`): "Checkout", o nome do cliente, "Check-in desde 09:18 · duração 1 h 22 min", "Como terminou a visita?", "Com pedido" (com "Pedido 000022 · R$ 1.613,68 feito nesta visita"), "Sem pedido" (abre os motivos), "Concluir checkout" e "Continuar no atendimento".
- **Depois do checkout:** o aviso no rodapé "Checkout feito em Mercado Bom Preço. Check-in liberado para o próximo cliente.", o chip passa a "2 feitas" e a próxima parada fica em destaque.
- **Estados:** sem rota no dia, o `EstadoVazio` de hoje da Rota; sem internet, a rota que está no aparelho (último sync), com check-in e checkout na fila (§6).

## 3. Ficha do cliente (prancha 02)

Componente: a ficha do Core (`modules/core/app/telas/cliente.tsx`, Cliente 360 v2), com o rodapé `rodapeFicha` do Campo.

- **Voltar:** para a tela de origem ("‹ Rota", "‹ Clientes" ou "‹ Carla Lima").
- **Conteúdo:** o do Cliente 360 v2 no Gestão, sem mudança.
- **Rodapé**, nesta ordem, botões de 48 dp: "Check-in" (secundário) · "Pesquisa" (secundário) · "Novo pedido" (principal, o único da tela). O "+" de "Novo pedido" fica como no Campo; na prancha saiu porque a Inter é mais larga (a mesma nota do Cliente 360 v2).
- **Check-in:** a folha de hoje (`checkin-sheet.tsx`): "Check-in às 09:18" e "Continuar". Fora do raio, a justificativa de hoje (RN-CORE-10). Sem GPS, "Sem GPS neste check-in".
- **Em visita:** o chip "Em atendimento · desde 09:18" (`accent`) no topo do Resumo, como no Campo, e o rodapé troca "Check-in" por "Checkout".
- **Visita aberta em outro cliente:** a faixa de visita aberta e a folha "Fazer checkout de <cliente>" de hoje (`open-visit-bar.tsx`, `visit-sheets.tsx`).
- **O botão some quando não vale:** "Pesquisa" sem a licença do módulo Pesquisa ou sem a permissão do perfil; "Novo pedido" sem a licença do Vendedor ou sem a ação `pedido.criar_em_nome`. Com dois botões, eles dividem a largura (prancha 02, 4º aparelho). "Check-in" fica sempre que a Rota está liberada para o perfil.
- **Pesquisa:** abre a lista de pesquisas do cliente do módulo Pesquisa, a mesma do Campo (ponto P5).

## 4. Novo pedido, aba Venda (prancha 03)

Componente: `modules/vendedor/app/screens/new-order-screen.tsx`, com o pedido em nome que já existe (`emNome`, RN-VEN-35).

- **Ordem da aba:** Alertas (só se houver) · **"Em nome de"** · CLIENTE · Forma de pagamento e Prazo · CRÉDITO DO CLIENTE · Avançar.
- **"Em nome de"** (`ListaSuspensa`, `componentes.md` §4.1): rótulo "Em nome de", campo de 48 dp com o nome do vendedor em 16/600.
  - **Padrão:** o vendedor da carteira do cliente.
  - **Lista aberta:** menu ancorado logo abaixo do campo, opções de 48 dp, ✓ em Azul noite na marcada, fundo `accentSoft`. Só os vendedores **ativos** da equipe do supervisor (RN-CORE-04), em ordem alfabética. Quem tem o cliente na carteira leva a 2ª linha "Carteira deste cliente" (12, `ink2`). Rola acima de 5 nomes; com mais de 8, entra a busca do `CampoEscolha`.
  - **Fora da lista:** o próprio supervisor, promotores (o promotor nunca tem pedido, RN-PRO-01) e vendedores de outras equipes.
- **Efeito da troca:** muda só o dono do pedido. Forma, prazo, tabela de preço e crédito são do cliente e ficam iguais. A alçada e os limites de desconto continuam sendo os do supervisor (RN-VEN-10, RN-VEN-11a). Os itens já lançados ficam. O Resumo mostra o novo nome em "Em nome de". Não há aviso nem confirmação na troca: o campo mostra o escolhido.
- **Quando a troca vale:** até salvar. Depois de salvo, o pedido segue a RN-VEN-31 (editar volta a revalidar).
- **Estados:**
  - cliente com mais de um vendedor da equipe na carteira: o campo vem vazio, "Escolher" em `ink3`, e os dois levam "Carteira deste cliente"; sem escolha, "Obrigatório" no campo depois da tentativa e `Falta o vendedor · aba Venda` nos Alertas das outras abas, nunca na própria Venda (o padrão da `falta`, `pedido-v4.md` §0.1);
  - vendedor que saiu da equipe depois de o rascunho ser salvo: a opção aparece desligada com o motivo "Saiu da equipe" e o campo pede outro (o padrão de opção desabilitada da `ListaSuspensa`);
  - sem internet: a lista vem do aparelho (§6).

## 5. Resumo e envio (prancha 04)

- **Ordem:** Alertas · CLIENTE (Razão social, CNPJ) · **VENDA** ("Em nome de" em 14/600, Forma, Prazo) · ITENS · ENTREGA · TOTAIS · botões. No pedido do próprio vendedor (Campo), o bloco continua "CONDIÇÃO DE PAGAMENTO", sem a linha "Em nome de".
- **Alçada:** a do supervisor (RN-VEN-10: o pedido feito pelo gestor usa a alçada do gestor). Com 8,0%, acima dos 5% da vendedora e dentro dos 10% do supervisor, não há linha de alçada. Com 12,0%, entra "Desconto acima da sua alçada" nos Alertas (RN-VEN-42) e o pedido vai ao gerente.
- **Aprovação:** "Salvar e enviar pedido" com motivo de aprovação abre "Enviar para aprovação?" (Voltar · Enviar), como no Campo. Aqui o motivo é o "Título vencido", e o pedido vai ao gerente (ponto P4).
- **Detalhe do pedido** (`pedido-v4.md` §2): a linha "Vendedor" (Carla Lima) na tabela do Gestão; no Histórico, o autor aparece na tag porque não é o vendedor (RN-VEN-30): "Enviado · Marcos Dias · 19/11 10:40". "Em aprovação · Inadimplente" em `accent`.
- O vendedor escolhido recebe a notificação do pedido em nome, como hoje (RN-VEN-35).

## 6. Offline

- **Rota, check-in e checkout:** iguais ao Campo. A rota do dia vem no sync; check-in e checkout gravam no aparelho, com o GPS do momento, e sobem pela fila (RN-CORE-13, RN-CORE-23). UUID gerado no aparelho.
- **Lista "Em nome de":** os vendedores da equipe e os vínculos de carteira vêm no sync (`modules/vendedor/app/lib/pull.ts` já baixa os vínculos para o pedido em nome). Sem internet, a lista é a do último sync.
- **Pedido:** salvo vai para `na_fila` e sobe quando houver rede (RN-VEN-30). A API revalida que o vendedor escolhido é da equipe do supervisor e ativo na hora do recebimento; se não for, o pedido volta recusado com "Vendedor fora da sua equipe" e fica como rascunho para escolher outro.
- **Crédito do cliente:** o "Atualizado hoje às 09:05" de hoje.
- **Pesquisa:** o comportamento offline do módulo Pesquisa, sem mudança.

## 7. Permissões

| Ação | Supervisor | Gerente | Vendedor (Campo) | Promotor |
|---|---|---|---|---|
| Ver a Rota no Gestão e fazer check-in e checkout | ✅ (clientes da equipe) | ✅ (equipes abaixo) | — (já tem no Campo) | — |
| Abrir a ficha do cliente | clientes da equipe (RN-CORE-04) | clientes das equipes abaixo | própria carteira | própria carteira |
| "Novo pedido" na ficha | ✅ com o Vendedor licenciado e `pedido.criar_em_nome` | ✅ | — (o dele, no Campo) | ❌ nunca (regra 7 do CLAUDE.md) |
| Vendedores em "Em nome de" | os da equipe dele | os das equipes abaixo, agrupados por equipe | — | — |
| "Pesquisa" na ficha | ✅ com a licença de Pesquisa | ✅ com a licença | como hoje | como hoje |

- Toda rota da API checa o perfil, o escopo da carteira e a licença do módulo (regra 6 do CLAUDE.md), e revalida o vendedor escolhido (critério 4 da T-0187).
- Multi-tenant: a lista e os clientes vêm só do tenant da sessão (RLS).
- O rastreamento segue a T-0156: interno, desligado de fábrica e visível só ao gerente autorizado.

## 8. Textos exatos

| Lugar | Texto |
|---|---|
| Faixa da Rota | "Rota de hoje"; "5 visitas · 22 km · Centro-Norte" |
| Chip | "1 feita", "2 feitas" |
| Parada (A) | "09:00 · Carla Lima" |
| Parada em visita | "Check-in 09:18"; botão "Checkout" |
| Opção B | "Rota de" |
| Rodapé da ficha | "Check-in" · "Pesquisa" · "Novo pedido"; em visita "Checkout" |
| Chip da ficha em visita | "Em atendimento · desde 09:18" |
| Aba Venda | "Em nome de"; "Carteira deste cliente"; vazio "Escolher"; falta `Falta o vendedor · aba Venda` |
| Resumo | título "Venda"; linha "Em nome de" |
| Alerta acima da alçada | "Desconto acima da sua alçada" |
| Detalhe | linha "Vendedor"; tag "Enviado · Marcos Dias · 19/11 10:40" |
| Recusa da API | "Vendedor fora da sua equipe" |

## 9. Pontos em aberto (A/B, com recomendação)

| # | Pergunta | A | B | Recomendação |
|---|---|---|---|---|
| P1 | A rota do supervisor é própria ou acompanha a de um vendedor? | Própria: montada no BKO (Operação › Rotas) como a do vendedor, com clientes de qualquer carteira da equipe | Acompanha a rota do dia de um vendedor escolhido em "Rota de" | **A.** O supervisor planeja as próprias visitas (cliente-chave, problema, treino) e o check-in único não se mistura com o do vendedor. Para acompanhar um vendedor no mesmo dia, a rota dele é montada com os mesmos clientes |
| P2 | O check-in do supervisor conta como visita do vendedor da carteira? | Não: é visita do supervisor. Aparece em "Visitada por" (Cliente 360 v2) e não entra na meta de visitas nem na cobertura de rota do vendedor (RN-GES-05) | Sim: conta para o vendedor da carteira | **A.** Contar para o vendedor inflaria a meta e a cobertura de quem não foi ao cliente |
| P3 | A meta e a comissão do pedido vão para quem? | Para o vendedor de "Em nome de" (o da carteira por padrão, ou o escolhido na troca) | Sempre para o vendedor da carteira, qualquer que seja o escolhido | **A.** A lista existe para dizer de quem é a venda: uma informação, um lugar. **Atenção:** com A, a RN-VEN-35 ("cliente de outra carteira não entra no pedido em nome") muda para "o vendedor pode ser qualquer um da equipe do supervisor" (texto do `modulo-vendedor`) |
| P4 | O supervisor aprova o próprio pedido? | Desconto dentro da alçada dele: sai aprovado na hora (RN-VEN-10, já vale). Crédito e título vencido: vão ao gerente; ninguém aprova o próprio pedido | Também aprova crédito e título vencido dentro da alçada, na hora | **A.** Evita a autoaprovação, fica na auditoria (RN-AUD-01) e segue a RN-GES-04 |
| P5 | Pesquisa respondida pelo supervisor | Vale como a resposta do cliente naquela pesquisa, com "Respondida por Marcos Dias"; o vendedor não precisa responder de novo | Resposta à parte (de conferência); a do vendedor continua pendente | **A,** salvo pesquisa marcada no BKO como "de conferência", que o `modulo-pesquisa` pode propor depois |
| P6 | Onde fica a Rota na barra do Gestão? | 6 posições, como o Campo da T-0170: Início · Equipe · Rota · Aprovações · Clientes · Alertas | 5 posições: Início · Equipe · Rota · Aprovações · Mais (Clientes e Alertas vão para o Mais) | **A.** O supervisor em campo usa Rota e Clientes o dia todo. Muda `MAX_ABAS_POR_VARIANTE.gestao` para 6 (`engenheiro-apps`). Equipe e Clientes usam hoje o mesmo ícone `users`; a troca de ícone fica com o `design-de-marca` |
| P7 | "O rastreamento não aparece em nenhuma tela" | Nenhuma tela do Macuxi mostra o rastreamento. Ficam só o mínimo legal e técnico: o termo de ciência da base LGPD (RN-CORE-13, T-0145) e a notificação fixa que o Android exige do serviço de localização em segundo plano | Nada: nem termo nem notificação | **A.** O Android não deixa esconder a notificação do serviço em primeiro plano, e a base LGPD pede aviso e termo. B depende de parecer jurídico e de outra solução técnica (`engenheiro-apps`) |

## 10. Quem faz o quê depois da aprovação

- `modulo-core`: Rota e ficha no Gestão (`apps`), rodapé na ficha do Gestão, visita do supervisor (P2).
- `modulo-vendedor`: "Em nome de" na aba Venda, lista da equipe, bloco "Venda" no Resumo, revalidação na API, texto da RN-VEN-35 (P3).
- `modulo-gestor`: escopo da equipe para a lista e a aprovação (P4).
- `modulo-pesquisa`: resposta do supervisor (P5).
- `engenheiro-apps`: barra de 6 posições no Gestão (P6), serviço de localização (P7).
- `engenheiro-software`: ações e permissões novas, desenho do reaproveitamento.
- `testes`, `corretor-redundancias` e `design-de-marca`: pareceres antes do lote.
