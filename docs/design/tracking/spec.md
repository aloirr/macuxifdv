# Tracking no expediente — termo, pausa, "Meu trajeto" e notificação fixa (Campo) · T-0156

- **Autor**: designer-ux, 19/11/2026 (Manaus). Item 5 do §11 de [`docs/desenho/tracking.md`](../../desenho/tracking.md); ADR 0061.
- **Base**: desenho §3.1 (notificação), §4.3 (pausa), §6 (termo), §7 (quem vê), §9 (privacidade); modelo do termo em
  [`T-0156-legal-termo-de-ciencia.md`](../../desenho/T-0156-legal-termo-de-ciencia.md) (rascunho para advogado).
- **Simulação**: `node docs/design/tracking/gerar.mjs` gera `01-termo`, `02-perfil-pausa`, `03-meu-trajeto` e `04-notificacao`
  (HTML e PNG, aparelho 360×760, escala 2). O gerador falha se legenda ou nota cobrir o aparelho, se algo sair dele ou ficar cortado.
- **Marca**: Azul noite #1E3350 na faixa, na ação e no traço do trajeto; fundo Pérola; laranja nenhum (não há gráfico); fonte do
  sistema, escala 12 · 14 · 16 · 18 · 22 · 28. Validação do design-de-marca pendente.
- **Quem implementa**: telas do termo, do Perfil (seção) e "Meu trajeto": modulo-core (§11 item 2); notificação e canal:
  engenheiro-apps (item 3). Componentes já existentes no kit (`packages/ui/src/mobile`); nenhum componente novo.
- Valores entre [colchetes] vêm dos parâmetros do tenant. Os dados da empresa nas pranchas ("Distribuidora Norte") são exemplo.

## 1. Tela do termo (prancha 01)

**Quando abre**: depois do login e da carga, se o tracking está ligado e falta o aceite da versão vigente (desenho §6). Volta a cada
abertura do app até o aceite. Versão nova publicada: abre de novo na próxima abertura.

| Ordem | Bloco | Texto | Componente |
|---|---|---|---|
| 1 | Cabeçalho (faixa), sem voltar | título `Localização no expediente`; subtítulo `Termo de ciência · versão [n] · [dd/mm/aaaa]` (data da publicação) | `Screen` com `cabecalho` (sem `voltar`) |
| 2 | Texto do termo, com rolagem | o texto publicado pela empresa, como veio do pull: 1 parágrafo + lista; negrito onde o modelo tem negrito | `Text` 16/24 (`t.body`), lista com marcador |
| 3 | Rodapé fixo | `Li e estou ciente` · `Agora não` | `Botao nivel="principal"` (52) · `Botao nivel="neutro"` (44) |

- **Li e estou ciente**: grava o aceite no aparelho (funciona sem sinal; vai no próximo envio, antes dos pontos), fecha a tela e
  volta para onde o app ia. Sem aviso de confirmação: a seção Localização do Perfil passa a aparecer.
- **Agora não** e o voltar do sistema: fecham a tela; o app segue usável; nada é gravado.
- O botão principal fica habilitado desde a abertura (P3).
- O texto do termo é o documento legal da empresa: o app não corta, não resume e não reescreve. A regra "só o que o usuário usa
  para agir" não se aplica a ele (o texto é revisado pelo advogado).

**Só leitura (Perfil › Termo de ciência)**: mesma tela, com `voltar` `Perfil`, subtítulo `Versão [n] · ciente em [dd/mm/aaaa hh:mm]`
e sem rodapé. As palavras `Meu trajeto` do texto viram link (`LinkTexto`, Azul noite, sublinhado) para a tela do §3.

**Estados**

| Estado | O que muda |
|---|---|
| Sem sinal | nada: o texto veio no pull e o aceite fica no aparelho |
| Tracking desligado pela empresa | a tela não abre; a seção do Perfil some |
| Versão nova | a tela volta; até o aceite, o Perfil mostra o alerta do §2 e não mostra a seção |

**Acessibilidade**: o título é `header`; a lista é lida item a item; o foco abre no título. Botões com o próprio texto como rótulo.

## 2. Perfil › seção "Localização no expediente" e pausa (prancha 02)

Posição: logo depois do nome (e de Alertas, quando há), antes de `Conta`. Aparece só com o tracking ligado pela empresa e o aceite
da versão vigente. O resto do Perfil não muda (`docs/design/rota-catalogo-perfil.md` §4).

| Ordem | Linha | Texto | Componente |
|---|---|---|---|
| 1 | Estado | ícone `pin` · `Localização` · linha de apoio (tabela abaixo) · chip de estado | `Cartao` com linha 56 dp, `ChipEstado` |
| 2 | Ação (quando cabe) | `Pausar por [60] min` ou `Retomar` | `Botao nivel="secundario"` (44), largura toda |
| 3 | Atalho | ícone `map` · `Meu trajeto` · `chevron` | `LinhaAtalho` (48 dp) |
| 4 | Atalho | ícone `file` · `Termo de ciência` · `chevron` | `LinhaAtalho` (48 dp) |

| Estado | Linha de apoio | Chip (`ChipEstado`) | Ação |
|---|---|---|---|
| Ativa (no expediente) | `Expediente hoje 08:00–18:00` (as faixas do dia; duas faixas: `08:00–12:00 e 14:00–18:00`) | `Ativa` (sucesso) | `Pausar por [60] min` |
| Pausada | `Volta em [42] min` (conta por minuto; abaixo de 1 min, `Volta em menos de 1 min`) | `Pausada` (aviso) | `Retomar` |
| Fora do expediente (antes ou depois da faixa) | `Expediente hoje 08:00–18:00` | `Fora do expediente` (neutro) | nenhuma |
| Sem expediente hoje (dia sem faixa, feriado ou ausência) | nenhuma | `Sem expediente hoje` (neutro) | nenhuma |
| Sem a permissão "o tempo todo" | — | — | o app já pede na abertura (RN-CORE-37); a seção segue o estado acima |

- **Pausar por [60] min**: um toque, sem confirmação. Vibração leve; `AvisoRodape` `Localização pausada` com `Desfazer` (desfaz a
  pausa, como se não tivesse havido). A pausa volta sozinha no fim do prazo.
- **Retomar**: um toque; `AvisoRodape` `Localização retomada` (sem ação).
- Pausa no fim do expediente: termina no fim do expediente; a linha mostra o menor dos dois prazos.
- Sem sinal: pausar e retomar funcionam igual (início e fim vão no próximo envio). Nada muda na tela.
- **Sem aceite** (ou versão nova sem aceite): a seção não aparece; em `Alertas`, uma linha `Termo de localização para confirmar`
  com a ação `Ler` (44 dp), que abre a tela do §1. É o único lugar do aviso (RN-VEN-42).
- O estado aparece só aqui. Hoje o Diagnóstico também mostra o estado (desenho §9); como o Diagnóstico é tabela técnica fechada por
  padrão e serve ao suporte, fica como está, mas sem frase: o mesmo rótulo do chip (pedido ao engenheiro-apps no §6).

**Acessibilidade**: a linha 1 é lida inteira: "Localização, ativa, expediente hoje das 8 às 18". O chip tem texto (a cor nunca fala
sozinha). `Pausar por 60 min` tem rótulo "Pausar a localização por 60 minutos". A contagem não é anunciada a cada minuto; o
`AvisoRodape` é `polite` (8 s com leitor de tela). Todos os alvos ≥ 44 dp; atalhos 48 dp.

## 3. "Meu trajeto" (prancha 03)

Só o dia do próprio vendedor ou promotor (`core.trajeto.ver_proprio`). Nunca mostra outra pessoa. Entrada: Perfil (atalho) e o link
no termo só leitura.

| Ordem | Bloco | Texto | Componente |
|---|---|---|---|
| 1 | Cabeçalho | `‹ Perfil` · `Meu trajeto` | `Screen` com `cabecalho` |
| 2 | Dia | `‹` · `Hoje · qua 19/11` / `Ontem · ter 18/11` / `dom 16/11` · `›` | 2 botões de 48 dp + texto 16/600; `›` desabilitado em hoje; `‹` desabilitado no dia mais antigo guardado ([90] dias) |
| 3 | Mapa | trajeto desenhado no aparelho, 220 dp | o mesmo mapa em SVG da Rota de hoje (`modules/core/app/telas/rota.tsx`): fundo Névoa, ruas brancas, borda #C9CED5 (P2) |
| 4 | Resumo | `Km até agora` (hoje) ou `Km do dia` · `18,6 km`; linhas `Início 08:04`, `Pausa 09:12–09:40` (uma por pausa), `Último ponto 10:12` (hoje) ou `Fim 17:52` | `Cartao`; número 28/700 tabular; linhas 44 dp com o marcador do mapa à esquerda |
| 5 | Contestar (P1 A) | `Contestar este dia` | `Botao nivel="secundario"` (44) |

- **Marcadores** (os mesmos no mapa e na lista; a lista é a legenda): início = círculo vazado Azul noite; fim = círculo cheio Azul
  noite; último ponto de hoje = círculo cheio com halo Azul suave; pausa = trecho tracejado #5B6673 entre o último ponto antes e o
  primeiro depois da pausa. Traço do trajeto: Azul noite 3 dp.
- **Km**: `metrosDoTrajeto` dos pontos do dia (o mesmo número do `core.deslocamento_dia`); 1 casa decimal com vírgula (`42,3 km`);
  abaixo de 1 km, em metros (`850 m`). Hoje sem sinal: calculado com os pontos do aparelho.
- **Horas** no fuso do tenant.
- Pausa em curso hoje: `Pausa 09:59–agora`.
- O mapa enquadra o trajeto do dia com 16 dp de margem; sem arrastar nem zoom na v1.

**Estados**

| Estado | Tela |
|---|---|
| Dia com trajeto | blocos 1 a 5 (5 só em dia anterior; hoje sem `Contestar`) |
| Dia sem registro (fim de semana, feriado, ausência, sem aceite naquele dia) | blocos 1 e 2 + `EstadoVazio` ícone `pin`, `Nada registrado neste dia` |
| Carregando dia anterior | blocos 1 e 2 + `Loading` no lugar do mapa |
| Sem sinal, dia anterior | blocos 1 e 2 + `EstadoVazio` ícone `wifiOff`, `Sem sinal` / `Os dias anteriores aparecem com sinal. O de hoje está no aparelho.` |
| Sem sinal, hoje | normal (pontos do aparelho) |
| Erro do servidor | `EstadoVazio` do padrão de erro do kit (`tela-de-erro`), com `Tentar de novo` |

**Contestar (P1 A)**: `Folha` `Contestar 18/11` com fechar (48 dp), campo `O que não confere?` (texto livre, até [500] caracteres,
obrigatório) e `Enviar` (principal; desabilitado com o campo vazio). Enviado: a folha fecha e o `AvisoRodape` diz
`Contestação enviada`. Sem sinal, vai na fila do aparelho como os outros envios.

**Acessibilidade**: o mapa é um elemento só (`accessibilityRole="image"`) com o resumo falado: "Trajeto de hoje: 18,6 km até agora,
início 8:04, pausa de 9:12 a 9:40, último ponto 10:12". As setas do dia têm rótulo `Dia anterior` e `Próximo dia`; o dia é anunciado
ao trocar (`accessibilityLiveRegion`). Os marcadores da lista são decorativos (a linha é lida como "Início, 8:04").

## 4. Notificação fixa (prancha 04)

| Item | Valor |
|---|---|
| Cabeçalho (sistema) | nome do app `Macuxi Campo` + hora; ícone pequeno `icone-notificacao-96.png` (branco e transparente, o sistema pinta) |
| Título | `Localização ativa no expediente` |
| Texto | nenhum (P4) |
| Cor (`color`) | Azul noite #1E3350 |
| Canal | id `macuxi-trajeto`, nome `Localização no expediente`, importância baixa (`IMPORTANCE_LOW`): sem som, sem vibração, sem aparecer por cima; fica em "Silenciosas" |
| Ações | nenhuma; não pode ser dispensada (serviço em primeiro plano) |
| Toque | abre o Campo no Perfil, na seção Localização (onde fica a pausa) |
| Quando some | pausa, fim do expediente, logout, termo novo sem aceite, tracking desligado pela empresa (desenho §3.2) |

O texto do §3.1 ("Macuxi Campo — localização ativa no expediente") fica dividido entre o nome do app, que o Android já mostra no
cabeçalho, e o título; assim o nome não aparece duas vezes.

## 5. Fica fora

- Mapa da equipe (Gestão e BKO, modulo-gestor) e Parâmetros › Rastreamento, termo e ausências no BKO (modulo-core).
- Visitas e clientes no mapa de "Meu trajeto"; velocidade, precisão e lista de pontos; exportação.
- Escolher a duração da pausa (é o parâmetro [60]); motivo da pausa (o desenho não guarda motivo).
- Tela de permissões e o aviso curto do Google Play (já existem, `apps/mobile/src/lib/permissoes.ts`).
- Gestão: o tracking é só do Campo.

## 6. Pedidos a outros donos (pelo gerente; esta sessão não envia recado)

- **modulo-core**: telas dos §1 a §3 com os componentes citados; entidade da contestação, se P1 = A.
- **engenheiro-apps**: canal e notificação do §4; toque abrindo o Perfil; no Diagnóstico, o estado com os rótulos do chip.
- **design-de-marca**: validar as pranchas (cor do traço, marcadores, ícone da notificação).

## 7. Pontos em aberto para o dono do produto

**P1 — Contestar um dia** (o termo promete: "Em 'Meu trajeto' você vê o seu trajeto e contesta um dia").
- **A** — botão `Contestar este dia` em "Meu trajeto" (dias anteriores), com folha de texto livre; a contestação chega ao supervisor
  na Gestão como alerta. Pede entidade nova no Core e o alerta no Gestor.
- **B** — sem botão na v1.0.15: o termo troca a frase por "fale com o seu supervisor" (texto novo para o advogado).
- **Recomendo A**: cumpre o que o termo já diz e dá ao vendedor o direito de correção (LGPD, art. 18, III) no mesmo lugar onde ele
  vê o dia. Se não couber na v1.0.15, B só até a próxima versão.

**P2 — Fundo do mapa.**
- **A** — o mapa em SVG da Rota de hoje (ruas desenhadas, sem provedor): funciona sem sinal, sem dependência nova e sem mandar a
  posição a ninguém.
- **B** — mapa real com ruas (biblioteca e provedor de mapa, chave de API): mais referência, mas dependência nova, custo e o
  provedor recebe a área do trajeto, o que o desenho §9 evita.
- **Recomendo A**, igual à Rota de hoje.

**P3 — `Li e estou ciente` habilitado desde a abertura.**
- **A** — habilitado sempre (é ciência, não consentimento; o texto cabe em pouco mais de uma tela).
- **B** — só depois de rolar até o fim.
- **Recomendo A**: B só atrasa quem já leu e não prova leitura.

**P4 — Segunda linha da notificação.**
- **A** — só o título `Localização ativa no expediente`.
- **B** — título + `Até 18:00` (fim da faixa).
- **Recomendo A**: a hora não muda nada do que o vendedor faz, e fica no Perfil.
