# Parecer de marca · T-0181 · segunda revisão dos heads finais (tela de carga com as 30 frases e portal `config.`)

> 2026-11-15, 9h40 de Manaus · design-de-marca · sessão de revisão do gerente-projetos.
> **Base:** tarefa `.coord/tarefas/T-0181.md` no `nuvem/carga-frases-gerente-projetos` (`58ef0542`); heads finais
> `nuvem/carga-frases-designer-ux-kit3` (`5e94cd33`), `-engenheiro-apps-3` (`d5d83250`), `-engenheiro-software-3` (`dad7179a`),
> `-banco-dados-3` (`d9905ae7`); spec aprovada `docs/design/carga-aviso-frases/` no `74f6160` (`nuvem/carga-frases-designer-ux`);
> contra `docs/marca/manual.md` v1 (§3 paleta, §4 tipografia, §6 aplicações) e `decisoes.md`.
> **Pareceres anteriores (não repetidos aqui):** `pareceres/2026-11-15-carga-frases.md` (`nuvem/carga-frases-design-de-marca`),
> `2026-11-15-T-0174-implementacao.md` (`-2`) e `2026-11-15-T-0181-implementacao.md` com o reteste (`-3`, `aca1e1ab`).
> **Recados:** `node scripts/coord.mjs caixa design-de-marca` deu HTTP 403 (sem acesso ao repositório de recados nesta sessão).
> A coordenação fica neste parecer. **Numeração:** MC-0110 a MC-0119 (reservada para esta revisão).

## Veredito: **liberado com ajustes.** App (Campo e Gestão), kit e portal liberados; a MC-0110 (doc, designer-ux) fica aberta
O código de produção que a marca validou no reteste continua igual nos heads finais. O único ponto novo é documental: a spec
aprovada, com a fonte de cada frase, não está em nenhum dos branches do lote.

## O que mudou desde o reteste (aca1e1ab)
| Head | Mudança | Efeito na marca |
|---|---|---|
| `-engenheiro-apps-3` (`d5d83250`) × `-2` (`5de0ca38`) | só testes: `aviso-carga.test.tsx`, `frase-carga.test.tsx`, `tela-carga.test.tsx`, `login-tela.test.tsx` (lacunas L1 a L3) | nenhum: `git diff -2..-3` não toca código de tela. Os 13 prints do reteste valem para o head final, por isso não renderizei de novo |
| `-designer-ux-kit3` (`5e94cd33`) | o mesmo SHA do reteste | nenhum |

## Conferência nos heads finais
| Item | Resultado | Conferido |
|---|---|---|
| MC-0087 (links do portal) | **fechada, confirmada** | `tela-frases-carga.tsx:164` e `:173`: `className="font-semibold"`, sem `text-ink`; vale o `text-accent-ink` (Azul noite `#1E3350`) do kit |
| Cor e tokens | **ok** | Nenhum hex solto nos componentes novos (`aviso-carga.tsx`, `frase-carga.tsx`, `tela-frases-carga.tsx`); tudo vem de `temaDaEntrada` (`texto`, `textoClaro`, `preenchimento`) e das classes do kit (`text-ink-2`, `text-danger`, `Badge`, `Button`). Nenhum token novo; `avisoBorda`/`avisoFundo` não existem no kit3 (MC-0078 caiu com o ajuste do dono do produto) |
| Pares de contraste | **ok** | `paresDaEntrada` (kit3) ganhou os quatro pares do bloco: "Você sabia?" em `texto`, frase e aviso em `textoClaro` (texto, mínimo 4,5:1) e a lâmpada em `preenchimento` (gráfico, mínimo 3:1). Testados em `entrada.test.ts` |
| Tipografia | **ok** | `MEDIDAS_FRASE_CARGA`: título Plex SemiBold 13/18, frase Plex Regular 14/20 (até 280 dp, centralizada, sem aspas nem itálico), aviso Plex Regular 13/18 à esquerda. Sem negrito no aviso |
| Lâmpada | **ok** | `icon.tsx`: os três traços da spec §1, na grade 24 com o traço da família; decorativa no leitor de tela |
| Animação | **ok** | Sem movimento novo (spec §1.1, "sem movimento novo"). A frase é sorteada uma vez por montagem e não troca durante a carga; o bloco só fica visível depois de medido (opacidade 0 → 1, sem transição) e sai inteiro quando não cabe, sem reticências. A área de baixo segue com o esmaecer de 240 ms que já existia, e "reduzir movimento" continua respeitado |
| Layout e respiro | **ok** | Prioridade logo, "Olá", aviso e barra (`cabeFrase`/`cabeLista` com a escala de fonte); o aviso fica 10 dp acima da barra e nunca é cortado; o título nunca aparece sozinho; a área de proteção do logo não muda |
| Tom de voz das 30 frases | **ok** | As 30 do `FRASES_CARGA_INICIAIS` (SDK `-3`) são idênticas, letra por letra, às do `frases.md` do `74f6160` (comparação automática, 30 de 30), e as 30 estão no seed da `0081` (`-banco-dados-3`). Todas com 56 a 78 caracteres (limite 90). Mantêm as regras MC-0081 a MC-0085: povo com maiúscula, "Segundo a tradição {povo}," nas narrativas, sem "mito" nem "índio", povo no presente, nada sagrado ou ritual como curiosidade, nenhuma ligação com venda e "Makunaimã" numa grafia só |
| Texto do aviso | **ok** | "Baixando os dados do servidor. Não desligue." (literal do ajuste R-20261115-080500) |
| Fonte da frase na tela | **ok** | Não aparece, e o contrato do app (`FraseCargaAppSchema`: `id`, `texto`, `ordem`) nem a recebe |
| Portal `config.` | **ok** | "Frases da carga" depois de "Diagnósticos" em `MENU_TIME_MACUXI`; "Incluir frase" e "Salvar" em `variant="primary"`; selos pelo `Badge` do kit; erro em `danger` e contador em `ink-2`; nenhuma cor fora do kit |

## MC-0110 · spec aprovada e fontes das 30 frases fora do lote · média · designer-ux
| Campo | Conteúdo |
|---|---|
| Onde | `docs/design/carga-aviso-frases/` (`spec.md`, `frases.md`, `.html` e `.png`) existe só no `nuvem/carga-frases-designer-ux` (`74f6160`), que não está na lista de branches finais da T-0181; o `origin/main` não tem a pasta. Os heads finais citam a pasta em 25 arquivos, entre eles `docs/design/entrada-sync.md` (kit3, §2: "sorteio, respiro e cadastro em `docs/design/carga-aviso-frases/spec.md`") e o comentário de `FRASES_CARGA_INICIAIS` ("`frases.md`"). Depois do merge, as remissões ficam apontando para um arquivo que não existe |
| Tipo | grafismo e cultura · aplicação |
| Fere | checklist D ("conteúdo inspirado na cultura só com **origem registrada**") e manual §6 (a aplicação aprovada precisa da referência no repositório). A §6 da spec é o único registro da fonte de cada frase sobre os povos Macuxi, Ingarikó, Taurepang e Pemon (ISA, IBGE, ICMBio, SciELO e outras). Sem ela, o `main` publica 30 fatos culturais sem origem registrada. O contrato do gerente já pedia ao designer-ux que trouxesse a pasta |
| Correção | Levar a pasta `docs/design/carga-aviso-frases/` do `74f6160` para o lote (branch novo do designer-ux, um commit, por exemplo `nuvem/carga-frases-designer-ux-spec`; ou trocar o kit3 por um kit4 que a inclua). Na mesma passada, corrigir a pendência (b) da tarefa: `spec.md` linha 28 "Uma linha." → "1 linha na escala de fonte 1,0; com fonte grande quebra em 2, nunca é cortado." e linha 39 "**Aviso:** sempre em 1 linha e sem caixa" → "**Aviso:** sem caixa; 1 linha na escala 1,0, com fonte grande quebra em 2, nunca é cortado". Nenhuma mudança de cor, de texto de frase nem de código |
| Dono | designer-ux (`docs/design/`) |
| Gravidade | média: não aparece para o cliente, mas é a única origem registrada de conteúdo cultural indígena, e a falta dela fere a regra D do manual. Pela regra do dono do produto (achado em doc segura o lote), **segura o merge do lote até a pasta entrar**. O PR do kit e o do engenheiro-apps não precisam mudar |

## Outras observações (não são achados)
- `nuvem/carga-frases-designer-ux-tokens` (`80190da7`) ainda tem `avisoBorda`/`avisoFundo` (MC-0078, caída). Ele está na lista de
  abandonados e **não pode ir a merge**. Apagar o branch depois do lote, como a tarefa prevê.
- **Ponto para o dono do produto (continua aberto, não segura):** o título "Você sabia?" fica em `texto`, e não no laranja da
  referência dele. Pelo manual §3, o sol só vira texto no título de grupo do menu e do painel do BKO, e na Gestão o `#C2540A` em
  13 dp daria 4,26:1, abaixo de 4,5:1. Só ele aprova a exceção.
- **Situação inicial das 30:** todas ativas, por decisão do dono do produto (R-20261115-075500). Continua registrada a
  recomendação da marca de deixar 1, 2, 4, 7, 8 e 16 a 22 inativas até a validação por artista ou organização macuxi. A decisão é
  dele e não segura.

## Para quem
- **designer-ux:** MC-0110 (correção acima). Reteste: a pasta no branch novo e as duas linhas da spec.
- **gerente-projetos (cópia):** app, kit e portal liberados pela marca nos heads finais. O lote só fecha com a pasta da spec junto
  (MC-0110). Recados não gravados (HTTP 403): leve a MC-0110 ao designer-ux.
