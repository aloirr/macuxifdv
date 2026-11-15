# Parecer de marca · Catálogo onda 1: trabalhar enquanto o catálogo carrega (ADR 0054, solução 5)

> 2026-11-15 · design-de-marca · pedido do gerente-projetos (sessão de revisão). Primeiro parecer de marca sobre este tema: não havia parecer anterior em `docs/marca/pareceres/` nem branch de marca `*onda1*` no remoto.
> **Base:** `origin/main` `5d744724`, contra `docs/marca/manual.md` v1 (com MC-0004 B, MC-0014 A e MC-0054 a MC-0056) e `decisoes.md`.
> **Branches revistos** (`git diff origin/main...<branch>`):
> - `nuvem/catalogo-onda1-modulo-core-v2` (`b207cb1c`): entrada antecipada e RN-CORE-48 revista;
> - `nuvem/catalogo-onda1-modulo-catalogo-v3` (`88122be7`): busca, ficha e consultas online enquanto carrega;
> - `nuvem/catalogo-onda1-designer-ux` (`b63e1e3b`): `IndicadorCargaFundo` e `CatalogoCarregando` (spec `docs/design/carga-em-segundo-plano.md` e kit);
> - `nuvem/catalogo-onda1-engenheiro-apps` (`e4636797`): shell mobile.
>
> **Como:** leitura do diff e dos tokens resolvidos (`packages/ui/src/comum/contraste.ts`, `mobile/tokens.ts`), e conferência visual das simulações do designer-ux (`docs/design/simulacoes/2026-11-15-catalogo-carregando-1..3.png`, 360 × 800). As telas reais do app (React Native) não rodam nesta sessão, sem aparelho nem emulador: o reteste é no print do aparelho.
> **Recados:** a CLI de recados não tem acesso ao GitHub nesta sessão (HTTP 403). Os recados ficam no fim deste parecer, com o texto pronto para envio.

## Veredito: **liberado com ajustes**
O kit do designer-ux e o shell estão conformes com o manual. O que o cliente vê no catálogo sem sinal, porém, não é o que a spec desenhou: é a faixa âmbar com "!" e outro texto (MC-0120, média). Há também dois achados baixos de coerência (MC-0121 e MC-0122).

**Para liberar:** a MC-0120 precisa estar corrigida e com o print do aparelho (catálogo e ficha sem sinal durante a carga) antes do build. A MC-0121 e a MC-0122 podem ir no lote seguinte, se o gerente registrar.

## O que está conforme
| Item | Onde | Conferência |
|---|---|---|
| Cor da linha | `packages/ui/src/mobile/carga-fundo-rn.tsx:83-87` | fundo `ground` = Pérola `#F8F6F1`; texto e ícone `ink2` = `#4A5562` (7,03:1 no Pérola, manual §3). Tudo por token, sem hex solto |
| Barra de progresso | idem | preenchimento `grafico` = Sol laranja `#C2540A` (papel de gráfico, como a barra de meta; 4,26:1 no Pérola, acima de 3:1) e trilho `lineSoft` = Névoa `#ECEEF1`. Nada de laranja em texto |
| Situação | spec §1 | não usa cor de aviso, fundo âmbar, "!" nem verde: é informação e não alerta (RN-VEN-42). Correto pelo manual §3, "sucesso, aviso e erro só para situação" |
| Tipografia | idem | IBM Plex Sans SemiBold 12, números tabulares (manual §5). Nenhuma família ou peso novo |
| Ícones | idem | `sync` e `wifiOff` do kit, 14 dp, os mesmos do botão Sincronizar e do selo "Sem sinal" |
| Animação | spec §1 | sem animação própria: só a largura muda a cada atualização. Nada pisca nem gira na barra de abas |
| Layout | spec §1, `apps/mobile/src/app/(tabs)/_layout.tsx` | colado em cima da barra de abas, fora da faixa Azul noite: preserva o cabeçalho Azul noite que começa na barra de status (manual §4). Não aparece em tela empilhada |
| Detalhe da carga | `apps/mobile/src/components/tela-carga.tsx` (`/sync?detalhe=1`) | o toque abre a tela de entrada aprovada em 12/11 (Azul noite, logo empilhado negativo, barra no Sol claro), sem desenho novo |
| Vazio do kit | `CatalogoCarregando` | `EstadoVazio` do kit com `wifiOff`, "Catálogo ainda carregando" e "Busque quando tiver sinal.". A voz é de quem está no campo ("sinal", como no selo "Sem sinal"), curta e sem jargão (manual §9) |
| Simulações | `docs/design/simulacoes/2026-11-15-catalogo-carregando*` | só cores da paleta e tokens existentes (`#16202A`, `#4A5562`, `#5B6673`, `#FFFFFF` e as variáveis do kit); fontes Archivo e IBM Plex Sans de `apps/web/app/fonts` |
| Core | `modules/core/domain/entrada-sync.ts` | só ordem das etapas e regra de liberação. Os nomes das etapas não mudam e não há nada visual |
| Gestão | shell | o mesmo indicador ("Aprovações 63%") no Pérola. Não mexe no ícone nem na splash do Gestão |

## Achados
| ID | Onde | Tipo | Fere | Gravidade | Correção | Dono |
|---|---|---|---|---|---|---|
| MC-0120 | Campo · Catálogo sem sinal durante a carga: `modules/catalogo/app/telas/catalogo.tsx:140,145,221-228` (`Banner` com `iconeDoAviso` → `alert`); Ficha: `modules/catalogo/app/telas/produto.tsx:76` (`Empty` só com texto); texto em `modules/catalogo/app/lib/carga-online.ts:21` | aplicação · cor · voz | §3 (cor de aviso só para situação; aqui a spec diz "não é aviso") e §9 (voz de campo); spec `docs/design/carga-em-segundo-plano.md` §2 | média | **antes:** faixa âmbar `warningBg #FFF1D6` com "!" (`alert`) e "O catálogo ainda está carregando. Conecte-se à internet para buscar.". Na tela já há o selo âmbar "Sem sinal" no cabeçalho, então são dois âmbares e a causa aparece duas vezes. **Depois:** no catálogo, `<CatalogoCarregando />` do `@macuxi/ui/mobile` no lugar da grade, sem o `Banner` quando o aviso é o de carga. Na ficha, `<CatalogoCarregando />` no lugar do `<Empty text=…>`. No `ConsultaIndisponivel`, `TITULO_CATALOGO_CARREGANDO` do kit em vez do texto próprio, e sai a constante local `TEXTO_CATALOGO_CARREGANDO` | modulo-catalogo |
| MC-0121 | Campo e Gestão · indicador nas abas: `apps/mobile/src/lib/carga-fundo.ts:63` × spec §1 (prop `percentual`) | aplicação | coerência entre a spec e a implementação (rótulo e número batem) | baixa | A spec e o kit dizem "percentual da etapa", mas o shell passa o percentual da carga inteira (`percentualDaCarga(estado, 'carregando')`). Na tela, "Catálogo 63%" mostra o número da carga toda com o nome de uma etapa. **Recomendação:** passar o percentual da etapa nomeada, como pede a spec. Se o gerente preferir o número da carga toda, o designer-ux troca o rótulo da spec e o do kit para não nomear a etapa | engenheiro-apps (cc designer-ux) |
| MC-0122 | Campo · Novo pedido, aba Itens, busca sem sinal durante a carga | aplicação | spec §2, que lista três superfícies: catálogo, ficha e busca do Novo pedido | baixa | Nenhum branch deste lote liga `CatalogoCarregando` na busca do Novo pedido. Sem sinal, o `ConsultaIndisponivel` do catálogo leva o seletor para a busca local de reserva, que mostra o vazio comum da busca. **Depois:** com o catálogo pendente e sem sinal, mostrar `<CatalogoCarregando />` no lugar do vazio da busca da aba Itens | modulo-vendedor |

## Fora do meu escopo (encaminhado ao gerente)
- **Ícone `sync` duas vezes no Início** (o botão Sincronizar e a linha "Catálogo 63%"; simulação 1) e o botão "Sincronizar" ativo enquanto a carga segue: é repetição e decisão de UX. Fica com o corretor-redundancias e o designer-ux.
- **Arquivo `sim.tar` solto na raiz do worktree desta sessão:** foi criado por um `git archive` meu, para extrair as simulações, e não entra no commit. O guardião bloqueou a remoção porque o caminho é do engenheiro-software. É só um arquivo local, sem efeito no repositório.

## Reteste
Print do aparelho, Campo, com o catálogo pendente:
1. Início com sinal ("Catálogo n%") e sem sinal ("· parado");
2. Catálogo sem sinal;
3. Ficha sem sinal;
4. Novo pedido › Itens › busca sem sinal.

## Recados (texto pronto; CLI com HTTP 403 nesta sessão)
- **design-de-marca → modulo-catalogo** (cc gerente-projetos), pedido: "MC-0120 (média): catálogo e ficha sem sinal durante a carga usam o Banner âmbar com '!' e texto próprio. Troque pelo `CatalogoCarregando` do kit (spec carga-em-segundo-plano §2) e use os textos do kit no `ConsultaIndisponivel`. Detalhe em docs/marca/pareceres/2026-11-15-catalogo-onda1.md."
- **design-de-marca → engenheiro-apps** (cc designer-ux, gerente-projetos), pedido: "MC-0121 (baixa): o indicador recebe o percentual da carga inteira com o nome da etapa ('Catálogo 63%'), e a spec pede o da etapa. Alinhe com o designer-ux. Detalhe no parecer."
- **design-de-marca → modulo-vendedor** (cc gerente-projetos), pedido: "MC-0122 (baixa): a busca da aba Itens do Novo pedido, sem sinal durante a carga, deve mostrar `CatalogoCarregando` (spec §2). Detalhe no parecer."
