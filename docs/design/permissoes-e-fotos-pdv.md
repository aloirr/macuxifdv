# Permissões obrigatórias (T-0145) e Fotos do PDV na ficha (T-0147)

> 2026-11-10 · designer-ux. Pedidos: R-20261110-062232 (permissões) e R-20261110-062234 (fotos do PDV). **Imagens para aprovação**
> (fonte: o `.html` de mesmo nome): `telas/T-0145-permissoes.png` e `telas/T-0147-fotos-pdv.png`. Vale a imagem aprovada.
> **2026-11-20 · §1 refeita** (R-20261120-052422-alexandre): pedido nativo ao abrir, tela só com o que falta, sem o link da
> localização. Imagem nova: `telas/T-0145-permissoes-v1017.png` (aguarda aprovação do Alexandre); o `.png` de 10/11 mostra o fluxo antigo.
> Permissões: engenheiro-apps (shell, variantes campo e gestão). Ficha: modulo-core; galeria e compressão: engenheiro-apps.

## 1. Permissões (antes do login e da sincronização; conferidas a cada abertura)

### 1.1 Ao abrir o app: pedido nativo, sem tela antes
- A cada abertura o app confere as permissões exigidas (Campo: as 4 da tabela; Gestão: notificações e, no cargo rastreado,
  a localização). As que faltam são pedidas **direto pelas janelas do Android**, uma após a outra, na ordem da tabela, sem a
  tela "Permissões" antes e sem texto do app por cima.
- Localização: primeiro a janela "Durante o uso"; concedida, o app pede "o tempo todo" (Android 11+: o sistema abre a página
  de localização do app, onde se marca **Permitir o tempo todo**).
- Permissão que o Android não pergunta mais (2 recusas) não abre janela: vai direto para a tela.
- Todas concedidas: o app segue (login, ou o Início se já entrou).

### 1.2 Tela "Permissões": só se faltar alguma
- Fundo `ground`, sem barra de abas. Marca 14/700 `accentInk` ("Macuxi Campo" / "Macuxi Gestão"), título **"Permissões"**
  (22/700), subtítulo 16 `ink2`: **"Sem ela o app não funciona."** com 1 item na lista; **"Sem elas o app não funciona."** com 2 ou mais.
- Lista (cartão branco, linhas de 68 dp) **só com as que faltam**, na ordem da tabela: ícone 20 num círculo `neutralBg` de 40 ·
  nome 16/600 · motivo 14 `ink2`. Situação à direita só na negada: **Negada** 14/600 (`danger`); sem "Falta" nem "Permitida".

| Permissão | Motivo (texto final) | App |
|---|---|---|
| Notificações | "Pedidos, aprovações e recados." (Gestão: "Pedidos para aprovar e recados.") | Campo e Gestão |
| Localização o tempo todo | "Check-in e trajeto no horário de trabalho." | Campo (Gestão: cargo rastreado) |
| Câmera | "Fotos do PDV e da gôndola." | Campo |
| Fotos e galeria | "Anexar fotos já tiradas." | Campo |

- **Um botão** (principal 52, no pé): **Permitir** abre a janela do Android da primeira da lista. Quando o Android não pergunta
  mais (2 recusas) ou falta o passo 2 da localização, o botão vira **Abrir configurações** (ícone `config`).
- **Localização, passo 2** (Android 11+): abaixo da lista, cartão com 2 passos: ✓ "Durante o uso" (`ink2`) e
  "2 · Em **Permissões › Localização**, marque **Permitir o tempo todo**."
- **Negada**: o motivo da linha vira a ação: "Em Permissões › Câmera, marque Permitir."
- Concedida, a linha sai da lista; lista vazia, o app segue sozinho. Volta das configurações: a tela se atualiza.
- Voltar do Android fecha o app; não há "Agora não".

## 2. Fotos do PDV na ficha do cliente
- Linha de ações: **Ligar · WhatsApp · Mapa · Foto do PDV** (4 botões iguais de 64 dp, ícone 20 + rótulo 12/600; TalkBack
  "Ver foto do PDV"). Sem fachada no Macuxi: o botão fica desligado (`neutralBg`, texto `#5B6673`, 4,8:1).
- Seção **"FOTOS DO PDV"** (logo abaixo das ações), cartão com uma linha de 52 dp por tipo do BKO (obrigatórios primeiro):
  - tem: "✓ Tem" `success`; tipo sensível (CNH, contrato) com cadeado 16 à direita: o vendedor não reabre;
  - falta, obrigatório: "Falta" `danger` + botão **Adicionar** (secundário 44); falta, opcional: "Opcional" `ink2` + Adicionar;
  - tirada sem sinal: "Na fila" `warning` com ícone `nuvem`; conta como tem.
  - A linha Fachada não abre nada (o botão "Foto do PDV" abre).
- **Adicionar** abre a `Folha` com o nome do tipo: **Tirar foto** · **Escolher da galeria** · Voltar.
- **Foto do PDV**: tela escura com ✕, o nome do cliente, "Fachada · dd/mm/aaaa" e ⋮ (Trocar foto). Abre sem sinal (cópia no aparelho).
- Sem tipo cadastrado no BKO: a seção não aparece.
