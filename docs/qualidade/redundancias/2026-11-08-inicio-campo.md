# Redundâncias — Início do app Campo (vendedor) — 08/11/2026

**Tarefa:** T-0124 (Frente B) · **Auditor:** corretor-redundancias · **Achados:** RD-0002 a RD-0013
**Ponto de partida:** print do APK Campo demo de domingo 08/11 (vendedor Lucas, base de 06/11 6h28) e achados do dono do
produto (recado R-20261108-101838-gerente-projetos). **Escopo:** R-20261108-135658-gerente-projetos. Avaliei só excessos,
duplicidades e redundâncias. Defeito funcional foi encaminhado ao testes e não entrou como RD.

## 1. Como foi conferido
- **Código lido na versão atual da árvore**, já com a correção do RD-0001 feita pelo engenheiro-apps (R-20261108-154308):
  `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/lib/inicio.ts`, `apps/mobile/src/components/inicio.tsx`,
  `modules/vendedor/app/components/cards-inicio.tsx`, `modules/vendedor/app/lib/resumo-inicio.ts`,
  `modules/core/app/lib/inicio-local.ts`, `modules/core/domain/inicio.ts`, `modules/core/contracts/inicio.ts`,
  `packages/ui/src/mobile/sincronizacao.tsx`, `db/seeds/demo/demo.ts` e `docs/design/inicio.md`.
- **Donos** pela `node scripts/coord.mjs dono`. **Correção ao despacho:** quem desenha os blocos Boas-vindas, Recados e
  Meta (com Positivação, Visitas e Cobertura), e também o aviso de dado antigo, é o **shell** (`apps/mobile/**`, dono
  **engenheiro-apps**), não o Core. O Core (`modulo-core`) só entrega os dados prontos na `VisaoInicio` (`useInicio()`).
  Por isso a maior parte dos achados foi para o engenheiro-apps. O modulo-core recebeu o que exige dado ou contrato.
- **Duplicação de código:** jscpd 5.4.2 (`pnpm dlx`, mín. 50 tokens, mesma regra do `.jscpd.json`) em `apps/mobile/src`,
  `modules/core/app` e `modules/vendedor/app`. O `pnpm redundancia:codigo` ainda não roda porque o jscpd não está em
  `node_modules`: está no `package.json`, mas o `pnpm install` não rodou. Resultado: 29 clones em 265 arquivos (1,00%).
  **Nenhum** está nos arquivos do Início. O único que encosta no Início é o preparo de mock de
  `components/inicio-tela.test.tsx:19-27`, igual ao de `tela-carga.test.tsx:21-29`: 9 linhas de teste, que não valem um
  RD. Os outros 28 são de outras telas (Clientes, Rota, Login/Senha, PDF, dispositivo) e ficam para auditorias próprias.
  A leitura manual achou duas redundâncias de lógica que o jscpd não pega (RD-0012 e RD-0013).
- **knip** (`redundancia:mortos`) não rodou, pelo mesmo motivo do jscpd. O campo sem leitor do RD-0013 foi achado com grep.

## 2. Como a tela está hoje (domingo, código atual)
```
Domingo, 8 de novembro
Bom dia, Lucas
Nenhuma visita na rota de hoje
RECADOS DE HOJE                                 [1 novo]
● Prioridade de hoje
  Passe cedo no Mercadinho São Jorge: tem título vencido e o … · 09:15
Ver todos
META DO MÊS                                       mês 0%
R$ 553                                     de R$ 180.000
[barra]
Hoje não é dia útil · faltam R$ 179.447 no mês
Vendas até 06/11 às 6h28. Sincronize para atualizar.
Positivação                     1 cliente de 15 clientes
[barra]
Visitas                          0 visitas de 90 visitas
[barra]
Cobertura                                    0% meta 90%
[barra]
[ORÇAMENTOS 0 · R$ 0]   [A FATURAR 6 · R$ 3.989 · 1 aguardando aprovação]
[ Sincronizar ]
Última sincronização hh:mm · N na fila
```
Depois do RD-0001, o rótulo passou a "META DO MÊS" e o "no mês" saiu do "de R$ 180.000" e das linhas. Mesmo assim,
**todos os achados de RD-0002 a RD-0011 continuam valendo**, alguns com contagem menor. A contagem atual está em cada um.

## 3. Proposta de tela (texto do dono do produto)
```
Domingo, 8 de novembro
Bom dia, Lucas
Sem rota hoje · não é dia útil
RECADOS                                    1 novo
Prioridade: passe cedo no Mercadinho São Jorge — título vencido e … (2 linhas)
META DO MÊS                                  0,3%
R$ 553 de R$ 180.000
[barra]
Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)
Positivação   1 de 15 clientes
Visitas       0 de 90
Cobertura     0% de 90%
Orçamentos  nenhum         A faturar  6 · R$ 3.989 (1 aguardando aprovação)
⟳ Dados de 06/11, 6h28 · Sincronizar
```
Em dia útil, a linha "Faltam … por dia útil" vira "Meta de hoje R$ X" (RN-CORE-26). O dono de cada trecho pode ajustar
o texto, desde que justifique no recado de entrega.
**Para o gerente decidir:** a proposta faz do cartão principal um cartão **do mês** também em dia útil. A referência
aprovada na T-0076 (`docs/design/inicio.md` §1.3) tem o "realizado de hoje" como número grande. Com a proposta, o
realizado do dia deixa de aparecer no Início. O designer-ux precisa atualizar o §1.3 junto com a mudança.

## 4. Achados

### RD-0002 — progresso do mês em 4 representações no mesmo cartão
| Campo | Conteúdo |
|---|---|
| Onde | Campo › Início › cartão Meta. `apps/mobile/src/lib/inicio.ts:211` ("mês N%"), `:219-224` (`dia_nao_util`: valor, "de", apoio) · `apps/mobile/src/components/inicio.tsx:127` (% à direita), `:138` (barra) |
| Tipo | indicador |
| O que se repete | No print: "mês 0%" + barra + "de R$ 180.000 no mês" + "faltam R$ 179.447 no mês", ou seja, 4 representações do mesmo progresso. Hoje: "mês 0%" + barra + "R$ 553 de R$ 180.000" + "faltam R$ 179.447 no mês", ainda 4 |
| Impacto | leitura: o vendedor lê o mesmo número 4 vezes e não acha a única informação que muda a decisão, quanto vender por dia |
| Severidade | alta |
| Proposta | Antes: `META DO MÊS · mês 0%` / `R$ 553 · de R$ 180.000` / barra / `Hoje não é dia útil · faltam R$ 179.447 no mês`. Depois: `META DO MÊS · 0,3%` / `R$ 553 de R$ 180.000` / barra / `Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)`. Em dia útil, a última linha vira `Meta de hoje R$ X`. O "faltam" só fica porque traz o valor por dia útil, que muda a decisão. Percentual com 1 casa abaixo de 1% ("0,3%"). O valor por dia útil é a necessidade diária da RN-CORE-22/26. Ela já existe no Core (`metas-formato.ts:42`, "Precisa de R$ X por dia útil (N restantes)") e deve vir pronta do Core (aditivo na `meta_hoje`), sem conta nova no shell. Assim o número fica igual entre Início e Metas. A contagem de dias úteis (seg–sex × seg–sáb) está com o testes (I3/I4) e não é avaliada aqui |
| Dono | engenheiro-apps (cartão) · modulo-core (número pronto) · designer-ux (`docs/design/inicio.md` §1.3) |

### RD-0003 — "hoje" repetido com a data já no cabeçalho
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:44` ("Nenhuma visita na rota de hoje") · `apps/mobile/src/components/inicio.tsx:64` ("Recados de hoje") · `db/seeds/demo/demo.ts:983` (título "Prioridade de hoje") · `apps/mobile/src/lib/inicio.ts:223` ("Hoje não é dia útil") · em dia útil, também `:231` ("Faltam R$ X hoje") |
| Tipo | texto |
| O que se repete | No print, 5 vezes ("rota de hoje", "RECADOS DE HOJE", "Prioridade de hoje", "META DE HOJE", "Hoje não é dia útil"). Hoje são 4 no domingo, e 4 em dia útil ("6 visitas hoje", "RECADOS DE HOJE", "META DE HOJE", "Faltam … hoje") |
| Impacto | leitura: o cabeçalho "Domingo, 8 de novembro" já fixa o dia |
| Severidade | média |
| Proposta | `RECADOS DE HOJE` → `RECADOS`: a lista não é só de hoje, são as 3 primeiras da caixa (`modules/core/domain/inicio.ts:122`). Título do seed `Prioridade de hoje` → `Prioridade`. `Nenhuma visita na rota de hoje` + `Hoje não é dia útil` → `Sem rota hoje · não é dia útil` (RD-0006). `Faltam R$ X hoje` sai com o RD-0002. Resultado: no máximo 1 "hoje" por cartão. Na Gestão vale o mesmo para `Meta de hoje da equipe` |
| Dono | engenheiro-apps · banco-dados (seed) · designer-ux (doc) |

### RD-0004 — "mês" repetido no cartão de meta
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:211` ("mês N%"), `:223` ("faltam … no mês"), rótulo `rotuloDaMeta` `:240-243` ("Meta do mês") |
| Tipo | texto |
| O que se repete | No print, 5 vezes ("mês 0%" e "no mês" ×4). Hoje, 3 vezes: "META DO MÊS", "mês 0%" e "faltam … no mês" |
| Impacto | leitura: o título já fixa o período |
| Severidade | média |
| Proposta | `mês 0%` → `0,3%` · `faltam R$ 179.447 no mês` → `Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)`. "Mês" só no título |
| Dono | engenheiro-apps |

### RD-0005 — unidade repetida na mesma linha
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:164-170` (`valorDe`) e `:253-256` (`desenhoDaLinha`: "valor de meta", com a unidade nos dois) |
| Tipo | texto |
| O que se repete | `1 cliente de 15 clientes` ("cliente" ×2) e `0 visitas de 90 visitas` ("visitas" ×2, ×3 com o rótulo "Visitas") |
| Impacto | leitura e largura da linha |
| Severidade | média |
| Proposta | `Positivação  1 de 15 clientes` · `Visitas  0 de 90` · `Cobertura  0% de 90%`. A unidade aparece uma vez, no fim, e só quando o rótulo não a diz |
| Dono | engenheiro-apps |

### RD-0006 — o mesmo fato dito 2 vezes ("sem rota" e "não é dia útil")
| Campo | Conteúdo |
|---|---|
| Onde | Boas-vindas `apps/mobile/src/lib/inicio.ts:44` · cartão Meta `:223` |
| Tipo | texto |
| O que se repete | `Nenhuma visita na rota de hoje` e `Hoje não é dia útil` explicam a mesma coisa em 2 lugares |
| Impacto | leitura |
| Severidade | média |
| Proposta | Boas-vindas: com `dia_util` falso, `Sem rota hoje · não é dia útil`. Em dia útil sem paradas, `Sem rota hoje`. Com paradas, sem mudança (`6 visitas hoje · 3 feitas`). O cartão Meta não repete o "não é dia útil". A `VisaoInicio` já traz `dia_util` (`modules/core/app/lib/inicio-local.ts:168`), então o Core não precisa mudar |
| Dono | engenheiro-apps |

### RD-0007 — formato diferente para o mesmo tipo de indicador
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:225-226` (`do_mes`: `valor` "0%", `de` "meta 90%") × `:223`/`:231` ("x de y") |
| Tipo | indicador |
| O que se repete | Positivação e Visitas aparecem como "x de y", e Cobertura como `0% meta 90%` |
| Impacto | leitura: 2 gramáticas na mesma lista |
| Severidade | média |
| Proposta | `Cobertura  0% de 90%`. **Positivação 1/15 com Cobertura 0%** é coerente (RN-CORE-20: positivação = pedido aprovado, cobertura = visitados ÷ planejados, e um pedido sem check-in positiva sem cobrir), então não é defeito. **`manter?`** Visitas (`0 de 90`) e Cobertura (`0% de 90%`) vêm do mesmo fato, o check-in. Cada uma tem meta própria (RN-CORE-21), e fundir as duas é decisão de produto, levada ao gerente. Como opção mínima, o rótulo `Cobertura da rota` diz o que o número mede. "de 15 clientes", sob o título META DO MÊS, se lê como meta, e isso basta |
| Dono | engenheiro-apps · gerente-projetos (decisão sobre fundir) |

### RD-0008 — aviso de dado antigo preso ao cartão e "Sincronize" em 2 lugares
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/app/(tabs)/index.tsx:45-46,74` → `apps/mobile/src/components/inicio.tsx:143-147` (texto `apps/mobile/src/lib/inicio.ts:264-267`) · Sincronizar no pé: `packages/ui/src/mobile/sincronizacao.tsx:48-78` |
| Tipo | layout |
| O que se repete | `Vendas até 06/11 às 6h28. Sincronize para atualizar.` (no cartão Meta) + botão `Sincronizar` com `Última sincronização hh:mm · N na fila` (RN-CORE-23). São 2 convites a sincronizar e 2 horas na mesma tela. O aviso vale também para A faturar e Positivação, mas aparece só na Meta |
| Impacto | leitura e decisão: o vendedor não sabe se o aviso cobre os outros cartões |
| Severidade | média |
| Proposta | Um aviso só, global, no bloco Sincronizar: `⟳ Dados de 06/11, 6h28 · Sincronizar` em `warningInk`, no lugar de `Última sincronização…` enquanto a base estiver defasada. O "N na fila" continua: o indicador de fila é redundância útil. `Sincronize para ver as vendas` (sem cópia) vai para o mesmo lugar. O cartão Meta perde a prop `aviso`. O `BotaoSincronizar` (kit) ganha uma prop opcional para o aviso, e o shell passa o texto. **Redundância útil preservada:** a data das vendas e a hora da sincronização são fatos diferentes, então o aviso fica, só que em um lugar. Se no celular de 6" o Sincronizar cair abaixo da dobra, o designer-ux pode subir o aviso global para logo abaixo das boas-vindas |
| Dono | designer-ux (`packages/ui`, doc) · engenheiro-apps (shell) |

### RD-0009 — Recados: selo + bolinha, "Ver todos" sem mais nada, prévia cortada
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/components/inicio.tsx:63-72` (selo), `:86` (bolinha), `:91-95` (apoio em 1 linha), `:100-102` ("Ver todos" sempre) · `apps/mobile/src/lib/inicio.ts:118` (apoio = corpo · hora) |
| Tipo | texto / layout |
| O que se repete | Selo `1 novo` + bolinha laranja no único item, ou seja, 2 marcadores do mesmo "novo". `Ver todos` com 1 recado só. Sobra espaço no cartão (a linha de 44 dp do "Ver todos"). O corpo cabe em 1 linha só e corta a ação: `tem título vencido e o …` |
| Impacto | toques e leitura: para entender a ação, o vendedor precisa abrir a central |
| Severidade | baixa |
| Proposta | `RECADOS                1 novo` / `Prioridade: passe cedo no Mercadinho São Jorge — título vencido e …` em **2 linhas** (título + corpo num texto só, hora à direita ou na linha de apoio). Com 1 item, sem bolinha. O leitor de tela continua dizendo ", novo", porque é rótulo de acessibilidade. Sem `Ver todos` quando o total ≤ itens mostrados: como o Core corta em 3, basta `itens.length < 3`. Para o caso de exatamente 3, um `recados_hoje.total` aditivo do Core resolve. O toque no topo do cartão abre a central |
| Dono | engenheiro-apps · modulo-core (opcional: `total`) |

### RD-0010 — estado zero duplicado
| Campo | Conteúdo |
|---|---|
| Onde | Orçamentos: `modules/vendedor/app/components/cards-inicio.tsx:16-17` + `modules/vendedor/app/lib/resumo-inicio.ts:49-52` · barras: `apps/mobile/src/components/inicio.tsx:138` e `:158` |
| Tipo | indicador |
| O que se repete | Orçamentos `0` e `R$ 0`, 2 zeros para "nenhum". Barras vazias seguidas: a principal em 0,3%, Visitas em 0 e Cobertura em 0. Cada linha secundária tem barra e "x de y" |
| Impacto | poluição visual |
| Severidade | baixa |
| Proposta | Orçamentos com 0 → `nenhum`, sem `R$ 0`. As linhas Positivação, Visitas e Cobertura ficam **sem barra**, como na proposta do dono do produto: o "x de y" já diz o progresso, e só o cartão principal tem barra |
| Dono | modulo-vendedor (Orçamentos) · engenheiro-apps (barras) |

### RD-0011 — Orçamentos e A faturar repetem a aba Pedidos (verificar)
| Campo | Conteúdo |
|---|---|
| Onde | `modules/vendedor/app/components/cards-inicio.tsx:12-35` · `modules/vendedor/app/lib/resumo-inicio.ts:55-58` |
| Tipo | layout |
| O que se repete | 2 cartões de 112 dp que repetem números da aba Pedidos. O "1 aguardando" não diz o quê |
| Impacto | espaço acima da dobra |
| Severidade | baixa |
| Proposta | **Conferido:** o toque abre Pedidos já filtrado (`irParaPedidosFiltrados('orcamentos' \| 'a_faturar')`), então os cartões **ficam**. O código já escreve `1 aguardando aprovação` desde 04/11. O "1 aguardando" do print é corte ou quebra no cartão de meia largura, a confirmar no APK. Depois: **um** cartão com 2 linhas tocáveis (≥ 48 dp) no lugar de 2 cartões de 112 dp: `Orçamentos   nenhum   ›` / `A faturar   6 · R$ 3.989 (1 aguardando aprovação)   ›`. Também: `plural(n, 'aguardando aprovação', 'aguardando aprovação')` (`resumo-inicio.ts:57`) passa o mesmo texto 2 vezes. Pode virar a string direta |
| Dono | modulo-vendedor · designer-ux (doc §1.4) |

### RD-0012 — o shell reimplementa regras do Core em contornos que não rodam
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:15-19` (`saudacao`, igual a `modules/core/domain/inicio.ts:100-105` `saudacaoDoDia`) · `:123-152` (contorno de `recadosDeHoje`) + `:62-70` (`quandoCurto`), que repetem `modules/core/domain/inicio.ts:122-129` · `apps/mobile/src/app/(tabs)/index.tsx:45` (`base.dia === null && pode('pedido.criar')`) · `apps/mobile/src/lib/inicio.ts:211` e `:230` (% do mês e "faltam" sem `pronto`, iguais a `modules/core/domain/meta-do-dia.ts:107-111`) |
| Tipo | código |
| O que se repete | 4 regras do Core copiadas no shell (horários da saudação, montagem dos recados, sem cópia de vendas, % do mês e quanto falta), como contorno para "cópias antigas". A única fonte da `VisaoInicio` é `montarInicio` (`modules/core/app/lib/inicio-local.ts:179,181,186,187`), que **sempre** preenche `saudacao`, `recados_hoje`, `meta_hoje` e `sem_realizado`. Por isso os contornos nunca rodam no app |
| Impacto | manutenção: regra de negócio fora do `domain`, em 2 versões que já divergem (o contorno mostra "ontem"/"seg", o Core só a hora) |
| Severidade | média |
| Proposta | Apagar `saudacao`, `quandoCurto` e o ramo de contorno de `recadosDeHoje`, e usar só `inicio.saudacao`, `inicio.recados_hoje`, `inicio.sem_realizado` e `meta_hoje`. No Core, tornar esses 4 campos obrigatórios na `VisaoInicio`. Ela é só visão local, sem payload de API, e o único produtor já os preenche |
| Dono | engenheiro-apps · modulo-core |

### RD-0013 — campo da visão sem leitor (duas fontes para "Última sincronização")
| Campo | Conteúdo |
|---|---|
| Onde | `modules/core/contracts/inicio.ts:193` (`sincronizacao`) · `modules/core/app/lib/inicio-local.ts:188` · teste `modules/core/app/lib/inicio-local.test.ts:230-231` |
| Tipo | código |
| O que se repete | `VisaoInicio.sincronizacao` (`ultima_em`, `hora`, `fila`) é calculado e testado, mas ninguém lê. O botão Sincronizar tira os mesmos dados do motor, pelo `SincronizacaoProvider` (`packages/ui/src/mobile/sincronizacao.tsx`). Depois do RD-0012, `notificacoes.ultimas` e `recado` ficam só com leitores de teste |
| Impacto | manutenção: 2 fontes do mesmo dado |
| Severidade | baixa |
| Proposta | Retirar `sincronizacao` da `VisaoInicio`. Depois do RD-0012, conferir com grep se `notificacoes.ultimas` e `recado` ainda têm leitor e retirar o que sobrar |
| Dono | modulo-core |

## 5. Encaminhado ao testes (defeito funcional, não é RD)
- **Recado antigo aparece com hora de hoje.** O "Recados de hoje" pega as 3 primeiras da **caixa**
  (`modules/core/domain/inicio.ts:122-129`), sem filtrar por data. O item traz só `hora` (`formatHHMM`), sem o dia.
  Um recado de 28/10 aparece como "09:15" sob o título "de hoje". O contorno antigo do shell (`quandoCurto`) mostrava
  "ontem/seg/28/10", mas não roda (RD-0012). Fica para o testes conferir valor × regra.

## 6. Recados enviados (cc gerente-projetos, tarefa T-0124)
| Para | Recado | Achados |
|---|---|---|
| engenheiro-apps | R-20261108-161014-corretor-redundancias | RD-0002 a RD-0010 (shell) e RD-0012 |
| modulo-core | R-20261108-161023-corretor-redundancias | RD-0002 (por dia útil pronto), RD-0009 (total), RD-0012 (campos obrigatórios) e RD-0013 |
| modulo-vendedor | R-20261108-161030-corretor-redundancias | RD-0010 (Orçamentos) e RD-0011 |
| designer-ux | R-20261108-161038-corretor-redundancias | RD-0008 (kit) e docs/design/inicio.md (RD-0002 a RD-0011) |
| banco-dados | R-20261108-161050-corretor-redundancias | RD-0003 (título do seed) |
| testes | R-20261108-161059-corretor-redundancias | defeito funcional do §5 (não é RD) |

**Reteste:** quando cada dono entregar, com print do APK antes e depois (domingo e dia útil). Os RD se fecham no catálogo.
