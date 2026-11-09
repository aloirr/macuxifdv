# Tela de erro e "Último erro do app" no Diagnóstico (T-0140)

> 2026-11-08 · designer-ux · origem: relato do dono do produto de 08/11 à noite (o Novo pedido fechava o app), branch da nuvem
> `claude/relaxed-johnson-w2afvp` (5441d06). Kit: `TelaDeErro` (`packages/ui/src/mobile/tela-de-erro-rn.tsx`) e textos
> `TEXTOS_TELA_DE_ERRO`, `cabecalhoDoUltimoErro`, `TEXTO_SEM_ERRO_REGISTRADO` (`tela-de-erro.ts`, também em `@macuxi/ui/mobile/puro`).
> Shell (engenheiro-apps): `apps/mobile/src/components/tela-de-erro.tsx`, `lib/erro-de-tela.ts`, `app/profile.tsx`.

## 1. Quando aparece
A tela de erro é o estado de quando uma tela **quebra ao ser desenhada** (erro de render). Ela não serve para o erro que a tela
prevê: falha de rede, recusa do servidor ou dado inválido continuam no `Banner tone="danger"` dentro da própria tela
(componentes.md §5).

| Alcance | Onde o shell liga | O que troca | Saída |
|---|---|---|---|
| `tela` | `ErrorBoundary` de `(tabs)/m/[...caminho].tsx` | só a tela do módulo; a barra de abas continua | Tentar de novo · Ir para o Início · abas |
| `app` | `ErrorBoundary` de `app/_layout.tsx` | o app inteiro (abertura, carga inicial, abas) | Tentar de novo; se repetir, fechar e abrir o app |

## 2. Ordem e hierarquia (de cima para baixo, centralizado, fundo `ground`)
1. **Ícone** `alert` 26 dp em `warning` (#7A4F00), num círculo de 56 dp em `warningBg`. Ele é decorativo e fica fora do leitor de tela.
   O vermelho fica reservado para a ação que destrói. Aqui nada foi perdido, e o tom é de aviso.
2. **Título**: Archivo 700, 20/26, `ink`, cabeçalho para o leitor de tela. Diz o que houve.
3. **Texto**: Plex 15/22, `ink2`. Diz o que continua guardado e o que fazer.
4. **Tentar de novo**: `Botao` principal de 52 dp, o único da tela. Chama o `retry` do ErrorBoundary.
5. **Ir para o Início**: secundário de 44 dp. Aparece só no alcance `tela`.
6. **Enviar o detalhe ao suporte**: neutro de 44 dp, com o ícone `send`. Abre o compartilhar do sistema com o detalhe técnico.
7. **Nota**: Plex 13/18, `ink2`. Diz onde o detalhe fica depois.

O conteúdo rola quando a fonte do sistema está grande. O respiro vertical de 48 dp evita a câmera e a barra do sistema, sem
depender da área segura.

## 3. Textos finais

| | Tela de módulo (`tela`) | App (`app`) |
|---|---|---|
| Título | **Não foi possível mostrar esta tela** | **Não foi possível mostrar o app** |
| Texto | O que você registrou continua guardado neste aparelho. Tente de novo; se continuar, avise o suporte. | O que você registrou continua guardado neste aparelho. Tente de novo; se continuar, feche e abra o app e avise o suporte. |
| Principal | Tentar de novo | Tentar de novo |
| Secundário | Ir para o Início | (nenhum) |
| Neutro | Enviar o detalhe ao suporte | Enviar o detalhe ao suporte |
| Nota | O detalhe do erro fica em Perfil › Diagnóstico. | O detalhe do erro fica em Perfil › Diagnóstico. |

Por que mudou em relação ao branch da nuvem:
- "Esta tela teve um problema" e "O app teve um problema" não diziam o que aconteceu. O app já usa "Não foi possível…"
  nos erros (login, check-in, armazenamento), e a tela de erro segue o mesmo padrão.
- "Nada do que já estava salvo no aparelho se perdeu" virou a frase afirmativa já usada na tela de erro do armazenamento.
- "Tente de novo; se continuar, avise o suporte" é o fecho do login e do BKO.
- Na raiz, o texto antigo mandava ao Perfil, mas lá o Perfil não abre. Agora manda fechar e abrir o app.
- "Perfil › Diagnóstico" saiu do texto principal e foi para a nota. O vendedor lê primeiro o que fazer; o caminho técnico vem
  por último.

**Leitor de tela**: quando a tela aparece, o leitor anuncia "título. texto" (`leituraDaTelaDeErro`). No Android, a troca de tela
não é lida sozinha.

## 4. Envio ao suporte
O botão neutro abre o compartilhar do sistema, com WhatsApp, e-mail ou copiar, sem dependência nova. Ele segue o mesmo padrão de
"Enviar o detalhe ao suporte" da tela de erro do armazenamento (T-0088). A mensagem leva:
- o nome e a versão do app (`textoDaVersao`);
- o título da tela de erro;
- a data e a hora, a rota, a mensagem técnica e o começo da pilha.

A mensagem nunca leva dado de cliente. Ela passa pela mesma limpeza de `mensagemParaSuporte`, que troca e-mail por `[e-mail]` e
número longo por `[número]`.

## 5. Diagnóstico do Perfil: linha "Último erro do app"
Ela fica no cartão do Diagnóstico, depois de "Última sincronização em segundo plano". O texto usa fonte mono, é selecionável e
segue o formato das linhas vizinhas:

```
Último erro do app: hoje 17:15 · mostrou a tela de erro · /m/novo-pedido
Rendered more hooks than during the previous render.
at OrderEditor (index.bundle:1:2)
```

- 1ª linha: `cabecalhoDoUltimoErro(origem, quando, onde)`. Primeiro vem a data no fuso do tenant. Depois vem o **efeito**, que
  é o que o suporte precisa saber:
  - "mostrou a tela de erro";
  - "mostrou a tela de erro do app";
  - "o app fechou";
  - "o app seguiu aberto".

  Por último vem a rota, quando se sabe qual é.
- Linhas seguintes: a mensagem técnica e até 6 linhas da pilha, como estão. É o único lugar do app onde o texto técnico
  aparece, e o cartão já avisa "Informações técnicas para o suporte".
- Sem registro: "Nenhum erro do app registrado neste aparelho." (`TEXTO_SEM_ERRO_REGISTRADO`).
- O efeito substitui os rótulos "(tela)", "(app)", "(fatal)" e "(em segundo plano)". "Fatal" era jargão, e o erro não fatal não
  acontece necessariamente em segundo plano.

## 6. Critérios para a revisão
- Um só principal ("Tentar de novo"). O alvo de toque é ≥ 48 dp, porque o neutro e o secundário têm a folga do `Botao`.
- Contraste: o título dá 14,9:1 no fundo e o texto e a nota dão 6,9:1. O ícone é gráfico e dá 6,4:1 no círculo. O teste
  `tela-de-erro.test.ts` confere os dois.
- A tela funciona fora dos provedores do shell: não usa área segura, roteador nem contexto. Sem as fontes, o Android usa a
  fonte do sistema.
- Nada de "problema", "fatal", "crash" ou "render" na tela. O jargão técnico fica só no Diagnóstico.
