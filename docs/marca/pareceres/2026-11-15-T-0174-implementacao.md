# Parecer de marca · T-0174 · implementação da tela de carga ("Você sabia?", frase e aviso) e das frases no `config.`

> 2026-11-15 · design-de-marca · tarefa T-0174 (ajuste do dono do produto R-20261115-080500-alexandre, que prevalece).
> **Base:** spec final `docs/design/carga-aviso-frases/spec.md` no commit `74f6160` (§1, §1.1 e §3) e `frases.md` no mesmo commit;
> kit no branch `nuvem/carga-frases-designer-ux-kit2` (`aa4192d2`: ícone `lampada` em `packages/ui/src/mobile/icon.tsx`,
> `MEDIDAS_FRASE_CARGA` e pares de contraste em `packages/ui/src/mobile/entrada.ts`); telas no `nuvem/carga-frases-engenheiro-apps`
> (`3f1acce6`: `aviso-carga.tsx`, `frase-carga.tsx`, `tela-frases-carga.tsx`); SDK `FRASES_CARGA_INICIAIS` no
> `nuvem/carga-frases-engenheiro-software-2`; parecer anterior `pareceres/2026-11-15-carga-frases.md` (branch
> `nuvem/carga-frases-design-de-marca`), contra `docs/marca/manual.md` v1.
> **Como:** leitura dos 9 prints da implementação (Campo e Gestão em 360 × 800, 800 com 48 dp de navegação e 640 com navegação;
> portal lista, editar e incluir com erro). As cores foram medidas no pixel dos prints, e o código foi lido nos branches acima.
> **Numeração:** MC-0087 (a última em uso nos branches da marca é MC-0086).

## Veredito: **liberado com ajustes.** A MC-0087 segura só o PR do engenheiro-apps até a correção (1 linha em 2 lugares)
O app (Campo e Gestão) está liberado. O kit (lâmpada e medidas) também está liberado. No portal, os links da tabela estão fora da cor do manual.

## Tela de carga (Campo e Gestão)
| Item | Resultado | Conferido |
|---|---|---|
| Sem cor nova | **ok** | Não há token novo: `avisoBorda` e `avisoFundo` não existem (a MC-0078 caiu com o ajuste). Todas as cores vêm do `temaDaEntrada` |
| "Você sabia?" em `texto` | **ok** | Medido: Campo `#FFFFFF` sobre `#1E3350` (12,77:1); Gestão `#1E3350` sobre Pérola `#F8F6F1` (11,8:1) |
| Frase e aviso em `textoClaro` | **ok** | Campo `#C9CED5` (8,07:1); Gestão `#4A5562` (7,0:1). Os dois passam dos 4,5:1 com folga |
| Lâmpada em `preenchimento` | **ok** | Campo Sol claro `#F59A52` (5,85:1); Gestão Sol laranja `#C2540A` (4,26:1). É gráfico, com mínimo de 3:1. O laranja fica só no gráfico, como manda o manual §3 |
| Título em laranja (a referência do Alexandre pinta o texto) | **decidido: fica em `texto`** | O manual §3 só deixa o sol como texto no título de grupo do menu e do painel do BKO. A lâmpada já leva a cor da marca ao bloco. Para pintar o texto, seria preciso uma exceção ao manual, e só o Alexandre aprova. A marca não recomenda: na Gestão, `#C2540A` em texto de 13 dp dá 4,26:1, abaixo dos 4,5:1 |
| Tipografia | **ok** | No código, título em `fonts.semibold` 13/18, frase em `fonts.body` 14/20 (até 280 dp, centralizada, sem itálico e sem aspas) e aviso em `fonts.body` 13/18 à esquerda, em 1 linha. No print, o título está em SemiBold e o aviso e a frase em Regular. Não há negrito no aviso |
| Lâmpada (desenho) | **ok** | São os três traços da spec §1 na grade 24, com traço 2 e pontas redondas, como o resto da família. Aos 16 dp dá para reconhecer nas duas variantes. No leitor de tela é decorativa |
| Respiro e área de proteção do logo | **ok** | O logo não se move entre 800 e 640. O espaço entre "FORÇA DE VENDAS" e o "Olá" (cerca de 34 dp) é maior que a altura do "M" (cerca de 27 dp). Em 800 com navegação sobram cerca de 73 dp entre a frase e o aviso (mínimo 24). Em 640 com navegação sobram cerca de 76 dp entre o "Olá" e o aviso, menos que os 88 dp do bloco com 1 linha. Por isso o bloco inteiro sai e o título não fica sozinho, como pede a §1.1 |
| Texto do aviso | **ok** | "Baixando os dados do servidor. Não desligue." é o texto literal do ajuste |
| Fonte da frase na tela | **ok** | Não aparece, e o contrato do app nem a recebe |

## Portal `config.` · Frases da carga
| Item | Resultado | Conferido |
|---|---|---|
| Cabeçalho, logo e menu | **ok** | Faixa Azul noite com o logo negativo, área de proteção mantida e "Frases da carga" depois de "Diagnósticos" com a aba ativa marcada |
| "Incluir frase" e "Salvar" | **ok** | Botão principal em Azul noite `#1E3350` com texto branco |
| Selos | **ok** | "Ativa" no verde de sucesso e "Inativa" no neutro. É o papel certo do verde, um estado, e não enfeite |
| Erro do campo | **ok** | "Essa frase já está na lista." e a borda usam o token `danger` do kit, e o contador "n de 90" fica em `ink-2` |
| Links Editar / Desativar / Ativar | **MC-0087** | Os três têm o mesmo estilo entre si, mas estão na cor errada (veja abaixo). O sublinhado do "Ativar" na linha 30 é o hover do kit (`hover:underline`), e não um estilo diferente |

### MC-0087 · links da tabela em grafite, não em Azul noite · baixa (segura o PR do engenheiro-apps)
| Campo | Conteúdo |
|---|---|
| Onde | `apps/web/components/portal/tela-frases-carga.tsx` (branch `nuvem/carga-frases-engenheiro-apps`, `3f1acce6`), botões `variant="link"` de "Editar" (linha 165) e de "Desativar"/"Ativar" (linha 174). No print `portal-frases-lista.png` os links medem `#16202A` |
| Tipo | cor |
| Fere | manual §3: o Azul noite `#1E3350` é a cor do link. A spec §3 (`config-frases.html`, `.btn.link { color: var(--accent) }`) também pede Azul noite. O kit já aplica a cor certa (`text-accent-ink` no `variant="link"`, `packages/ui/src/web/ui.tsx:281`), e o `className="font-semibold text-ink"` sobrescreve |
| Correção | `className="font-semibold text-ink"` → `className="font-semibold"` nas linhas 165 e 174. Resultado: `#16202A` → `text-accent-ink` (`#1E3350`) |
| Dono | engenheiro-apps |
| Gravidade | baixa: só o time Macuxi vê o portal, e o contraste continua alto. Mesmo assim, a cor fere o manual aprovado e segura o PR do engenheiro-apps até a correção. Para o reteste basta o print da lista |

## Texto das frases (regras do parecer anterior)
- **As 30 do SDK (`FRASES_CARGA_INICIAIS`) são iguais, letra por letra, às do `frases.md` do `74f6160`**, e a lista do portal mostra o mesmo texto. Todas trazem as correções MC-0081 a MC-0085: nome de povo com maiúscula, "Segundo a tradição {povo}," nas narrativas, nenhum "mito" ou "índio", o povo no presente, nenhuma ligação com venda e "Makunaimã" numa grafia só.
- **Situação inicial:** as 30 entram ativas, pela decisão do Alexandre em R-20261115-075500-alexandre (coluna "Situação inicial" do `frases.md`). A marca recomendou deixar 1, 2, 4, 7, 8 e 16 a 22 inativas até a validação indígena, e a recomendação continua registrada. Como a decisão é do dono do produto, ela não segura a entrega. Para desativar qualquer uma, basta um clique no portal.
- A 30 inativa no print é só demonstração do estado: ela mantém a cor do texto das ativas e troca o link por "Ativar", como manda a spec §3.

## Para quem
- **engenheiro-apps:** MC-0087 (correção acima). Reteste pelo print da lista do portal.
- **gerente-projetos:** o app e o kit estão liberados pela marca. O PR do engenheiro-apps fica seguro só pela MC-0087. A marca segue para o Alexandre, que é quem aprova.
