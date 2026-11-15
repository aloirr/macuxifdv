# Estoque diário, parte F (v1.0.13): botão Sincronizar, popup da completa e hora do estoque · parecer do corretor-redundancias

**Veredito: COM ACHADO (2 achados de gravidade baixa, em spec e simulação; seguram até a correção do designer-ux).**

Corretor-redundancias, 15/11/2026 (horário de Manaus). Base: `origin/nuvem/estoque-diario-designer-ux` 9d059d3.
Li `docs/design/sincronizacao-completa.md`, `docs/design/telas/T-estoque-diario-sincronizar.html` e o print `T-estoque-diario-sincronizar.png`, e comparei a linha da barra e os textos de erro com `apps/mobile/src/lib/entrada.ts` (tela de carga).
Regras: uma informação, um lugar; só o que o usuário usa para agir; aviso só em "Alertas" (RN-VEN-42, R-20261110-093124); rótulo e número batendo; palavra de contexto no máximo 1 vez por cartão.
Decisões do dono do produto que não conto como achado: R-20261115-100000-alexandre (toque = parcial; segurar 10 s = completa; popup com o texto literal e a barra igual à da tela de carga; "Atualizado às" = hora da carga diária) e R-20261115-121000-alexandre.

## 1. Achados
| ID | Onde | Tipo | O que se repete | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|
| RD-0323 | `sincronizacao-completa.md` §2.2 e simulação, print 4 ("Pronto") | texto | No estado Pronto, o popup mostra ao mesmo tempo "Realizando a sincronização completa, aguarde e não saia dessa tela" e "Pronto · 100%". A frase deixa de ser verdade, e a própria spec tira a frase no §2.3 por esse motivo. | baixa | §2.2: "O rótulo vira **Pronto** e **100%**" → "O texto do item 1 sai (deixou de ser verdade, como no 2.3); ficam **Pronto**, **100%** e a barra cheia por 600 ms." O print 4 fica sem a frase. O texto do Alexandre não muda; só deixa de aparecer depois que a completa terminou. | designer-ux |
| RD-0324 | `sincronizacao-completa.md` §3 (tabela e lista "Vai uma vez") na **ficha do produto** e no **popup do item** | texto | A hora fica embaixo do bloco de estoque, que já tem o título "Estoque · filial Centro" (print 6). Desatualizado, o bloco diria "Estoque" 2 vezes: "ESTOQUE · FILIAL CENTRO" e "Estoque desatualizado · ontem às 06:12". Sem carga, também 2 vezes: "Estoque sem informação". | baixa | Na ficha e no popup do item: "Estoque desatualizado · ontem às 06:12" → **"Desatualizado · ontem às 06:12"**, e "Estoque sem informação" → **"Sem informação"**. No Catálogo (faixa acima da lista) e no Alertas do Novo pedido, o texto fica com "Estoque", porque lá não há título que diga o contexto. A função pura do Catálogo recebe um parâmetro "com contexto/sem contexto", ou a tela tira a palavra. Na tabela do §3, uma coluna "na ficha" mostra a forma curta. | designer-ux (texto) · modulo-catalogo (função, depois da spec) |

## 2. Conferido sem achado
- **"Sincronização completa em N s" com a faixa:** são 2 representações do mesmo tempo (número e barra), o limite do checklist. Elas batem entre si: aos 4 s, "em 6 s" e 40 %. Aparecem só enquanto o dedo está no botão, e a linha de situação não muda nesse tempo (§1.2). Sem dica de "segure" em repouso. A dica e o anúncio do leitor de tela são redundância útil (acessibilidade).
- **Linha de situação × popup:** o "Pronto" não ganha aviso no rodapé (§2.2), e "Atualizado há instantes" fica só na linha de situação.
- **Erro (§2.3):** "Sem internet na etapa {n} de {N}" e "Parou na etapa {n} de {N}" são os mesmos textos de `textoDoErro` (`apps/mobile/src/lib/entrada.ts`). Não há texto de retomada nem detalhe técnico na tela. "Fechar" e o Voltar fazem o mesmo, e isso não aparece escrito.
- **Hora do estoque:** sai do cartão de lista (uma vez por tela). No Novo pedido fica só no Alertas (RN-VEN-42). No desatualizado, "Atualizado" sai. A faixa do Catálogo está fora do escopo da RN-VEN-42, que vale para o pedido.

## 3. Observações ao gerente (não seguram; são a decisão literal do Alexandre)
- **Progresso em 3 formas no popup:** "Etapa 3 de 5 · Catálogo e preços", "46%" e a barra. O checklist pede no máximo 2, e o nome da etapa não muda o que o vendedor faz, que é esperar. É a "barra igual à da tela de carga" que o Alexandre pediu (R-20261115-100000), com o mesmo `rotuloDaBarra` da carga. Fica `manter?`. Se ele quiser enxugar, o corte vale para os 2 lugares de uma vez: "Etapa 3 de 5" sem o nome, ou só a barra com o %.
- **"dessa tela"** no texto literal ("desta tela" na norma) e a frase de 3 linhas no popup de 312 dp: é texto dele e não mexo. Registro só para ele decidir.
