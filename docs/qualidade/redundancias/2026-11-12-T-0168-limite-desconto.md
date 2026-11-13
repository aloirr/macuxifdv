# T-0168 · Limite de desconto por item e por pedido: parecer de redundância

> 2026-11-12 ~16h20 · corretor-redundancias · pedido R-20261112-151808-designer-ux · regra RN-VEN-11a (doc 03:186-207).
> Material: `docs/design/limite-desconto.md`, `docs/design/telas/T-0168-bko-1..3-*.png`, `T-0168-campo-1..6-*.png`,
> `T-0168-gestao-1-em-nome.png` e os fontes `T-0168-campo.html` e `T-0168-bko.html`.

## Resultado
**Não liberado: 3 achados, 1 médio e 2 baixos (RD-0196 a RD-0198).** Os três têm o texto pronto abaixo. Nenhum muda o desenho:
só a frase, uma ajuda e o doc 03. Com o RD-0196 aplicado, a premissa 4 deixa de existir.

## Premissas do designer
| # | Premissa | Parecer |
|---|---|---|
| 1 | Funções e limite juntos na aba Parâmetros | **De acordo.** É uma regra só, num lugar só. Separar as funções (Dados) do limite (Parâmetros) poria o mesmo assunto em duas abas. O doc 03 precisa dizer o mesmo (RD-0198). |
| 2 | O campo do limite só aparece com "por pedido" ligada | **De acordo.** Com "Não", o campo não é usado e só ocuparia espaço. O valor fica guardado. |
| 3 | Acima do limite, a linha da alçada sai | **De acordo.** Acima do limite, a única saída é o orçamento, e a aprovação não se aplica. Com as duas linhas, o vendedor leria dois problemas para uma só ação. |
| 4 | No Gestão, a frase diz "do gestor" | **Melhor sem nenhum dos dois** (RD-0196): `Pedido acima do desconto máximo (10,0%)`. Assim fica uma frase só para o Campo, o Gestão, a API, o detalhe e a lista. Se o dono preferir manter o qualificador, "do gestor" está certo. "do vendedor" com o número do gestor seria rótulo que não bate com o valor. |

Outras decisões que o designer pediu para eu olhar:
- **Sem marca nos Totais nem no geral da aba Itens, só em Alertas:** de acordo. É a regra "uma informação, um lugar" (RN-VEN-42).
- **Ajuda da linha "por item"** ("Nenhum item passa do desconto máximo do produto."): fica. Ela diz de onde vem o limite (o
  máximo do produto), e o administrador usa isso para decidir.
- **Ajuda da linha "por pedido"**: sai (RD-0197).
- **"Sim/Não" ao lado do interruptor:** fica. É o padrão do kit (`componentes.md`:176) e serve à acessibilidade.
- **Imagem 3, duas linhas com "acima do desconto máximo":** fica. São dois problemas diferentes, e cada linha leva a um lugar.

## Achados

### RD-0196 · "do vendedor" / "do gestor" na frase do limite do pedido
| Campo | Conteúdo |
|---|---|
| Onde | `limite-desconto.md` §2 (:23) e §3 (:37-40). Imagens `T-0168-campo-1-pedido.png`, `-3-duas.png`, `-6-orcamento.png` e `T-0168-gestao-1-em-nome.png`. RN-VEN-11a (doc 03:196) |
| Tipo | texto |
| O que se repete | "do vendedor" diz a quem pertence o limite. Quem lê a frase é sempre o dono do limite: o vendedor no Campo e o gestor no pedido em nome dele. A palavra não muda nenhuma ação. Ela também obriga a ter uma segunda variante ("do gestor") e faz a frase quebrar em 2 linhas nas 4 imagens. A linha do item ("AGU-1500 acima do desconto máximo") cabe em 1 linha |
| Impacto | leitura (2 linhas em vez de 1); manutenção (2 frases para a mesma recusa, `desconto_pedido_acima_limite`) |
| Severidade | média |
| Proposta | `Pedido acima do desconto máximo do vendedor (8,0%)` → **`Pedido acima do desconto máximo (8,0%)`**, a mesma frase no Campo, no Gestão (com o número do gestor: `(10,0%)`), na API, no detalhe e na lista. O "Pedido" no começo já separa esta linha da linha do item. A spec §3 sai ("A aprovar" deixa de existir) e a RN-VEN-11a :196 passa a ter o mesmo texto |
| Dono | designer-ux (spec e 4 imagens) · gerente-projetos (doc 03:196). Mudar a frase da RN depende do dono do produto aprovar |

### RD-0197 · ajuda da linha "Limitar desconto por pedido" repete o rótulo e o campo
| Campo | Conteúdo |
|---|---|
| Onde | `limite-desconto.md` §1 (:12). `T-0168-bko-1-padrao.png`, `-2-obrigatorio.png` e `-3-duas.png`. `T-0168-bko.html` |
| Tipo | texto |
| O que se repete | No mesmo bloco aparecem 3 vezes "desconto" e "pedido": `Limitar desconto por pedido` · `O desconto do pedido inteiro não passa do limite.` · `Desconto máximo do pedido (%)`. A ajuda repete o rótulo. Com "Não" (imagem A), ela fala de um "limite" que a tela não mostra |
| Impacto | leitura |
| Severidade | baixa |
| Proposta | Tirar a ajuda da linha "por pedido". Ficam o rótulo `Limitar desconto por pedido`, o interruptor e, com Sim, o campo `Desconto máximo do pedido (%)`. A ajuda da linha "por item" fica |
| Dono | designer-ux (spec e 3 imagens). Depois, modulo-core no BKO |

### RD-0198 · RN-VEN-11a × spec: onde ficam as funções e qual é a frase
| Campo | Conteúdo |
|---|---|
| Onde | doc 03:187 ("Duas funções no cadastro do usuário") e :189 (o limite "na aba Parâmetros") × `limite-desconto.md` §1 (funções e limite na aba Parâmetros). Também a :196 (frase "do vendedor") × spec §3 ("do gestor") |
| Tipo | doc |
| O que se repete | A mesma regra está escrita em dois documentos, com textos diferentes. A fonte da verdade é o doc 03 |
| Impacto | manutenção: quem implementar pelo doc 03 põe as funções na aba Dados |
| Severidade | baixa |
| Proposta | Depois da aprovação, mudar a :187-189 para: "Na aba **Parâmetros** do usuário (BKO): as funções "Limitar desconto por item" e "Limitar desconto por pedido" e o "Desconto máximo do pedido (%)", que só aparece com "por pedido" ligada". A :196 recebe a frase do RD-0196. O pé da RN (:186, "vale depois da aprovação da simulação") sai |
| Dono | gerente-projetos |

## Fora do escopo (encaminhado ao testes, sem RD)
A prancha arredonda o total do item para baixo nos meios centavos. Na imagem 4, `T-0168-campo.html`:257 mostra LPO-400:
106,50 × 0,93 = 99,045 → **99,04**. Na imagem 7, :395 mostra 106,50 × 0,85 = 90,525 → **90,52**. O testes confere esses
valores com a regra de arredondamento do domínio, para a prancha aprovada não ensinar o valor errado.

## Recados
- Parecer: designer-ux e gerente-projetos, cc alexandre (responde a R-20261112-151808).
- Arredondamento: testes, cc gerente-projetos.

## Reteste (12/11 ~22h30, v1.0.5): RD-0196 e RD-0197 corrigidos; segura por RD-0198 (baixa, doc, gerente-projetos)
- Entrega: designer-ux R-20261112-194847. PNGs abertos: campo-1, -3, -4 e -6, gestao-1, bko-2 e bko-3.
- **RD-0196 corrigido**: `Pedido acima do desconto máximo (8,0%)` em campo-1, -3 e -6 e `(10,0%)` em gestao-1; spec §2, §3 (uma
  linha) e §4 premissa 4.
- **RD-0197 corrigido**: a linha "Limitar desconto por pedido" ficou sem ajuda (spec §1:12, bko-2, bko-3); a ajuda do "por item" fica.
- Os números do meio centavo foram refeitos pelo unitário (53,79 · 95,88 · 99,06 · 90,54 · 54,70 · 51,80; totais 204,37,
  203,17, 210,45 e 196,13). A conferência valor × regra é do testes.
- **RD-0198 aberto, em parte** (doc 03 conferido de novo às ~23h10): a frase (:211, RD-0196) e o pé da RN (:201) foram corrigidos.
  Faltam a :202, "Duas funções no cadastro do usuário (BKO)", e a :204, "aba **Parâmetros** do perfil". A spec põe as duas
  funções e o limite na aba Parâmetros **do usuário**. Texto: "Na aba **Parâmetros** do usuário (BKO): as funções…".

**Parecer T-0168: segura por RD-0198 (baixa, doc 03, gerente-projetos).** A spec e as imagens estão liberadas para o código.
