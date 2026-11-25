# Ficha do cliente · aba Documentação · Fotos do PDV (Campo, v1.0.34)

Origem: R-20261124-093521 (teste de campo do APK v1.0.32), decisão do Alexandre. Tela: `modules/core/app/components/aba-documentacao.tsx` (dono `modulo-core`), aberta por `modules/core/app/telas/cliente.tsx`. Base: `docs/design/cliente-360-v2` (T-0186) e RN-CORE-38.

## 1. Regra de uso

- Cada tipo de foto do PDV (Fachada e os demais cadastrados) é uma linha com **dois botões de ícone**: ver (olho) e adicionar (câmera).
- A foto **nunca é excluída nem trocada**: adicionar grava uma foto nova e as anteriores ficam no histórico. Não há botão de apagar.
- Situação e data da linha são as da foto **mais recente**.

## 2. Linha

| Coluna | Conteúdo |
|---|---|
| Documento | Nome do tipo ("Fachada"); 2ª linha: situação (§3) |
| Data | Data da foto mais recente, `dd/mm/aaaa` no fuso do tenant (`dataBr` de `ficha-v2`); sem foto, "—" |
| Ações (96 px, centro) | `BotaoCelula` olho + `BotaoCelula` câmera, lado a lado, sem espaço extra entre eles |

Cabeçalho da coluna: "Ações" (antes 48 px; nos demais documentos, que só abrem, fica o `chevron` de hoje, alinhado à direita da célula).
Componentes: `TabelaDados`, `CelulaTexto`, `BotaoCelula` (`@macuxi/ui/mobile`). Ícones já existentes em `nomes-de-icone.ts`: `olho`, `camera`, `galeria`, `lock`. Nenhum ícone novo.

## 3. Situação (2ª linha)

| Caso | Texto | Cor |
|---|---|---|
| Sem foto, tipo obrigatório | Falta | perigo (`perigoSegunda`) |
| Sem foto, tipo opcional | Opcional | `ink2` |
| Com foto enviada | Enviada | `ink2` |
| Foto nova tirada sem internet, aguardando envio | Na fila | `ink2` |

Depois de adicionar: "Na fila" até subir, depois "Enviada". Cor sempre com texto.

## 4. Botões

| Botão | Ícone | Rótulo falado (Fachada) | Outros tipos | Ligado quando | Desligado |
|---|---|---|---|---|---|
| Ver | `olho` | "Ver foto da fachada" | "Ver foto: <Nome>" | há foto (enviada ou na fila) e o perfil vê o tipo | sem foto: ícone `ink3`, `accessibilityState.disabled`, não responde ao toque |
| Adicionar | `camera` | "Adicionar foto da fachada" | "Adicionar foto: <Nome>" | o perfil envia fotos do PDV | sem permissão de enviar: o botão não aparece; o olho fica à esquerda e a célula guarda o lugar da câmera |

- Alvo de toque: `TABELA_FICHA.botao.lado` = 48 px cada (≥ 44 px); ícone 20 px. Toque com escala 0,97 em 120 ms (o `BotaoCelula` já faz).
- Tipo que o perfil não pode ver (`fotoPdvTrancada`): no lugar do olho, `lock` desligado, rótulo "<Nome>: sem permissão para abrir" (como hoje).
- Ver abre o visualizador do shell com a foto mais recente do tipo. Hoje o visualizador só abre a Fachada (`verFotoPdv`); os outros tipos precisam que ele receba o `tipo_id` (`modulo-core` com o `engenheiro-apps`).
- Toque na linha inteira = Ver (quando ligado).

## 5. Adicionar: câmera ou galeria

Toque na câmera abre a `Folha` (de baixo para cima, 280 ms):
- Título: "Foto da fachada" (outros tipos: "Foto: <Nome>").
- `OpcaoFolha` icone `camera`, título "Tirar foto".
- `OpcaoFolha` icone `galeria`, título "Escolher da galeria".
- Fechar: "Cancelar".

Sem subtítulo nas opções e sem texto de explicação na folha. Ao confirmar a foto: sem aviso no rodapé e sem vibração; o retorno é a própria linha passar a "Na fila" (uma informação, um lugar).
Permissão negada aparece na folha, que reabre com a frase na opção negada ("Permita o acesso à câmera nos ajustes." / "Permita o acesso às fotos nos ajustes."; única exceção ao "sem subtítulo"), para o vendedor tentar a outra opção. Só a falha da câmera ou da galeria (erro) aparece no aviso da aba.

## 6. Fora desta tela

- Histórico das fotos (lista das anteriores): guardado no servidor; não aparece nesta linha. Tela própria, se o Alexandre pedir.
- Gravação sem sobrescrever (uma linha por foto, a mais recente por data de captura): `modulo-core` (API e domain, RN-CORE-38).
