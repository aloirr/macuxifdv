# Catálogo do app: lista por linha e o atalho "Ver por linha" (T-0085, fatia D)

> 2026-11-06 · designer-ux · pedido R-20261106-062530 (gerente-projetos) · PR #95 (nuvem)
> Telas: `modules/catalogo/app/telas/lista-por-linha.tsx` (nova) e `modules/catalogo/app/telas/catalogo.tsx` (atalho).
> Vale igual no **Campo** e no **Gestão** (mesma tela, mesmos textos e tamanhos). Promotor vê a lista sem preço e estoque (RN-CAT-05).

## 1. Textos finais

| Lugar | Rótulo de trabalho | Texto final |
|---|---|---|
| Atalho na aba Catálogo: rótulo | "Por linha" | `Ver por linha` |
| Atalho: linha de apoio | (não havia) | `Sistema › grupo › linha` |
| Atalho: leitura no TalkBack | (não havia) | `Ver por linha. Sistema, grupo, linha` (o kit monta sozinho) |
| Título da tela (`t.h1`) | "Catálogo por linha" | `Por linha` |
| Volta do topo (`BackLink`) | "Catálogo" | `Catálogo` (fica) |
| Título da página no registro (`index.ts`, `titulo`) | "Catálogo por linha" | `Catálogo por linha` (fica: é o nome completo fora da tela) |
| Raiz da trilha | "Por linha" | `Sistemas` |
| Subtítulo na raiz | "Sistema › grupo › linha" | `Sistema › grupo › linha` (fica) |
| Subtítulo num nível | "{Sistema/Grupo/Linha} · n produtos" | fica (ex.: `Grupo · 12 produtos`, `Sem linha · 3 produtos`) |

Por quê:
- **Atalho com verbo** ("Ver por linha"): o guia pede ação no infinitivo (§7) e "Por linha" sozinho parece filtro (chip),
  não caminho para outra vista. O apoio diz o que a vista mostra, numa linha.
- **Título curto** ("Por linha"): o `BackLink` "Catálogo" já fica logo acima, então a tela lê "Catálogo › Por linha" sem
  repetir a palavra. "Catálogo por linha" em `t.h1` (Archivo 800, 26) ao lado do `SyncStamp` quebra em 2 linhas em
  360 dp; "Por linha" cabe em 1 linha mesmo com a fonte do sistema em 130%. O nome completo continua no registro da página.
- **Raiz da trilha "Sistemas"**: com o título "Por linha", repetir "Por linha" na trilha não ajuda; "Sistemas" diz para
  onde o toque leva (a lista dos sistemas).

## 2. Regra de tamanho (Campo e Gestão)
- Mesmo tamanho nas duas variantes; o Gestão não tem versão compacta desta tela.
- **Título da tela**: `t.h1` (Archivo 800, 26), no máximo **14 caracteres**, para caber em 1 linha ao lado do `SyncStamp` em
  360 dp. Sem `numberOfLines` no título: com fonte grande do sistema, pode quebrar, mas nunca cortar.
- **Atalho** (`LinhaAtalho`): rótulo até **24 caracteres** (15/600, `ink`), apoio até **32 caracteres** (13, `ink2`), ambos
  até 2 linhas; altura mínima 48 dp, 56 com apoio; largura total da tela (dentro do respiro de 20 do `Screen`).
- **Linhas de nível** (sistema, grupo, linha): altura mínima 48 dp, nome 15 até 2 linhas, contagem 12 à direita, seta.
- **Item de produto**: descrição em `t.title16` até 2 linhas; aplicação em `t.small` até 2 linhas (a ficha mostra o resto).

## 3. Padrão do kit para o atalho: `LinhaAtalho` (`@macuxi/ui/mobile`)
Linha tocável que leva a **outra vista da mesma aba**. Fundo laranja claro (`accentSoft`, sem borda, raio 12), ícone
à esquerda em `accentInk`, rótulo e apoio, seta em `accentInk`. O fundo a separa das linhas brancas de nível, que ficam logo
abaixo; não é botão (a aba não ganha um "principal") nem chip (chip filtra, o atalho muda de tela). Afunda 0,97 ao toque
(só esmaece com "reduzir movimento"). Contraste sobre `accentSoft`: `ink` 13,9:1, `ink2` 6,4:1, `accentInk` 6,3:1.

```tsx
import { LinhaAtalho } from '@macuxi/ui/mobile';

{!consulta && !dentroDoPedido && (niveis.length > 0 || trilha.length > 0) ? (
  <LinhaAtalho
    icone="arvore"
    rotulo="Ver por linha"
    apoio="Sistema › grupo › linha"
    onPress={() => irParaListaPorLinha(clienteId, noId)}
    testID="catalogo-atalho-por-linha"
  />
) : null}
```

Onde e quando aparece na aba Catálogo:
- logo **abaixo do campo de busca** e **acima da trilha e dos níveis** da árvore;
- só **sem busca** (`!consulta`): com texto buscado, a lista de resultados é o que importa;
- **fora do Novo pedido** (`!dentroDoPedido`): a lista por linha não adiciona item ao pedido, e no pedido ela tiraria a
  pessoa do caminho;
- só quando o aparelho **tem árvore** (há níveis ou trilha); sem árvore, a lista teria só "Sem linha";
- leva o nível atual (`noId`): quem está em "Freios" abre a lista já em "Freios"; leva o cliente (`clienteId`) para o preço.

## 4. Estados da tela "Por linha"
- **Carregando**: indicador laranja abaixo da trilha (como está).
- **Sem sincronização** (sem motor): `Empty` "O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e
  sincronize o aparelho." (como está).
- **Erro de leitura**: "Não foi possível abrir a lista agora. Puxe a tela para tentar de novo." (como está).
- **Vazio na raiz**: `EstadoVazio` título `Nenhum produto neste aparelho ainda`, apoio `Puxe a tela para sincronizar o
  catálogo.`, sem ação.
- **Vazio num nível**: título `Nenhum produto neste nível`, apoio `Volte um nível ou sincronize o aparelho para atualizar o
  catálogo.`, ação `Voltar um nível` (como está).
- **Nível removido**: título `Este nível não está mais no catálogo`, mesmo apoio e ação (como está).
- **Muitos itens**: `120 produtos · mostrando 100` (como está).
- **Sem sinal**: `SyncStamp` "sem sinal"; nada some da tela (tudo vem do aparelho).
- **Trilha**: escondida na raiz; dentro de um nível, `Sistemas › Freios › Pastilhas`, com o **atual não tocável** (sem
  `atualTocavel`: aqui a trilha é "onde você está"; `atualTocavel` é para trilha que leva a outra tela).

## 5. Conferir no APK (Campo e Gestão, 360 dp)
- aba Catálogo sem busca: o atalho aparece entre a busca e os níveis, em laranja claro, e abre "Por linha" no nível atual;
- com texto na busca ou dentro do Novo pedido: o atalho some;
- título "Por linha" em 1 linha ao lado do selo de sincronização, também com "sem sinal";
- TalkBack lê "Ver por linha. Sistema, grupo, linha, botão";
- promotor: a lista abre sem preço e estoque e sem ação de pedido.
