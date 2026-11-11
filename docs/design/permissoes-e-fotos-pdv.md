# Permissões obrigatórias (T-0145) e Fotos do PDV na ficha (T-0147)

> 2026-11-10 · designer-ux. Pedidos: R-20261110-062232 (permissões) e R-20261110-062234 (fotos do PDV). **Imagens para aprovação**
> (fonte: o `.html` de mesmo nome): `telas/T-0145-permissoes.png` e `telas/T-0147-fotos-pdv.png`. Vale a imagem aprovada.
> Tela de permissões: engenheiro-apps (shell, variantes campo e gestão). Ficha: modulo-core; galeria e compressão: engenheiro-apps.

## 1. Permissões (antes do login e da sincronização; conferidas a cada abertura)
- Fundo `ground`, sem barra de abas. Marca 14/800 `accentInk` ("Macuxi Campo" / "Macuxi Gestão"), título **"Permissões"**
  (Archivo 26/800), subtítulo 15 `ink2` **"Sem elas o app não funciona."** (Gestão: "Sem ela o app não funciona.").
- Lista (cartão branco, linhas de 68 dp): ícone 20 num círculo `neutralBg` de 40 · nome 15/600 · motivo 13 `ink2` · situação à
  direita 13/600: **Permitida** (✓, `success`), **Falta** (`ink2`), **Negada** (`danger`).

| Permissão | Motivo (texto final) | App |
|---|---|---|
| Notificações | "Pedidos, aprovações e recados." (Gestão: "Pedidos para aprovar e recados.") | Campo e Gestão |
| Localização o tempo todo | "Check-in e trajeto no horário de trabalho." | Campo |
| Câmera | "Fotos do PDV e da gôndola." | Campo |
| Fotos e galeria | "Anexar fotos já tiradas." | Campo |

- **Um botão** (principal 52, no pé): **Permitir** pede a próxima que falta, na ordem da tabela. Quando o Android não pergunta mais
  (2 recusas) ou falta o passo 2 da localização, o botão vira **Abrir configurações** (ícone `config`).
- **Localização, passo 2** (Android 11+): abaixo da lista, cartão com 2 passos: ✓ "Durante o uso" (`ink2`) e
  "2 · Em **Permissões › Localização**, marque **Permitir o tempo todo**."
- **Negada**: o motivo da linha vira a ação: "Em Permissões › Câmera, marque Permitir."
- Link `accentInk` 14/600 **"Como usamos a localização"** (só no Campo), abre o aviso da base LGPD do tracking (engenheiro-software).
- Volta das configurações: a tela se atualiza; com todas, segue sozinha. Voltar do Android fecha o app; não há "Agora não".

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
