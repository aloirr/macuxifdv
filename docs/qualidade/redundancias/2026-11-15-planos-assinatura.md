# Parecer de redundâncias — simulação "Planos e assinatura" do portal `config.` (2026-11-15)

**Escopo:** branch `nuvem/planos-assinatura-designer-ux`, commit `4294af5`, `docs/design/planos-assinatura/` (`spec.md` e PNG 01 a 06, 1366 × 768), comparado com `docs/design/telas/portal-config-enxuto.md` §11 (aprovado em 14/11).
**Recados:** `node scripts/coord.mjs caixa corretor-redundancias` respondeu HTTP 403 nesta sessão; caixa não lida e recados aos donos não enviados. O gerente-projetos repassa os achados abaixo.
**Resultado:** 4 achados (2 médios, 2 baixos). Nenhum defeito funcional para o `testes`.

## Achados

| ID | Onde | Tipo | O que se repete | Impacto | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0323 | `06-trocar-abaixo-do-uso.png` (erro embaixo dos planos); texto vem de `packages/platform-sdk/src/planos.ts:291` e do §11.4 | texto | "O plano Light tem" 2× em duas linhas seguidas; "10 vendedores" e "1 gestor" já estão no cartão Light selecionado logo acima ("10 licenças de vendedor", "1 licença de gestor") | leitura; texto além do problema; a ação (quantos inativar) não aparece | média | "O plano Light tem 10 licenças de vendedor e a empresa usa 14." / "O plano Light tem 1 licença de gestor e a empresa usa 2." → **"Vendedores: 14 em uso. Inative 4 antes de trocar."** / **"Gestores: 2 em uso. Inative 1 antes de trocar."** (problema + ação; o limite fica só no cartão). Mensagem no contrato (engenheiro-software) e §11.4 (designer-ux) | engenheiro-software · designer-ux |
| RD-0324 | `portal-config-enxuto.md` §11.4 (cita `depois-06c`, `depois-06d`), §11.5 ("Sem simulação nova"), §13 "Simulações vigentes" × `planos-assinatura/spec.md` §2 | doc | duas séries de simulação para as mesmas 4 telas (aba Empresa, cliente, diálogo, Empresas), sem dizer qual vale; §11.5 diz que não há simulação e a spec traz a 01 | decisão (engenheiro-apps não sabe qual PNG seguir); manutenção | média | Depois da aprovação: §11.4, §11.5 e §13 apontam para `planos-assinatura/01..06` e marcam `depois-03b`, `depois-06b`, `depois-06c` e `depois-06d` como substituídos (uma linha no §14). Até lá, a spec diz numa linha: "Ao aprovar, estas substituem `depois-03b/06b/06c/06d`." | designer-ux |
| RD-0325 | `spec.md` §2, item "Tela 6 (nova)" | doc | "O erro fica embaixo dos planos, uma linha por item, e o principal desabilitado" repete a regra do §11.4 (que a própria spec diz não repetir) | manutenção (dois textos da mesma regra) | baixa | → "**Tela 6 (nova):** Light escolhido para a empresa da ficha (14 vendedores e 2 gestores em uso). O principal desabilitado usa o `.btn.off` do portal (MC-0041)." | designer-ux |
| RD-0326 | `spec.md` §1 ("Conclusão") × §1 tabela × §2 coluna "Depende de" × §3 | doc | a dependência do banco (3 funções, histórico, seed) dita 4 vezes; "RN-PLA-01..06 no doc 03" e "trava RN-PLA-04" ditas na tabela e de novo no §3 | leitura | baixa | Sai o parágrafo "Conclusão" (a coluna "Depende de" do §2 já diz que só a tela 1 sai com o `main` de hoje); saem as linhas "Regras (doc 03)" e "Trava no BKO" da tabela do §1 (ficam só no §3, itens 4 e 5) | designer-ux |

## Conferido sem achado
- Telas 1 a 5: título, valor, selo de teste, blocos "x de y" com selo "no limite" único (RD-a), "Atual" sem rádio extra, rodapé só com Total + 2 botões, selo "2 meses grátis" só no alternador. Nenhum texto sobre cobrança, funcionamento ou garantia.
- "Promotor Avulso" + "por licença/mês": "avulso" dito uma vez (mapa único §11.10).
- `spec.md` não copia textos de tela, tabela de preços nem testIDs do §11; §5 (premissas) e §4 (perguntas) não repetem o §11.7.

## Reteste 1 (15/11, commit `34908b1`, branch `nuvem/planos-assinatura-designer-ux`)

| ID | Resultado | Evidência |
|---|---|---|
| RD-0323 | **corrigido na simulação; aguarda aval do dono do produto para o SDK e o §11.4** | `06-trocar-abaixo-do-uso.png` e `.html` (`data-testid="empresa-plano.erro"`): "Vendedores: 14 em uso. Inative 4 antes de trocar." / "Gestores: 2 em uso. Inative 1 antes de trocar.". "O plano Light tem" saiu; o limite fica só no cartão Light. A troca do texto aprovado em 14/11 virou a pergunta 4 do `spec.md` §4. Segue o texto antigo em `packages/platform-sdk/src/planos.ts:291` e no §11.4 do `portal-config-enxuto.md`; só mudam se o dono do produto aprovar (aí, reteste do SDK e do §11.4). |
| RD-0324 | **corrigido** | `spec.md` §2: "Ao aprovar, estas substituem `depois-03b`, `depois-06b`, `depois-06c` e `depois-06d` do `portal-config-enxuto.md`, e as §11.4, §11.5 e §13 passam a apontar para cá." A troca no §11.4/§11.5/§13 é passo pós-aprovação. |
| RD-0325 | **corrigido** | `spec.md` §2, "Tela 6 (nova)": só o cenário e o `.btn.off` (MC-0041); a regra do erro não se repete. |
| RD-0326 | **corrigido** | `spec.md` §1: sem "Conclusão" e sem as linhas "Regras (doc 03)" e "Trava no BKO"; RN-PLA-01..06 e RN-PLA-04 ficam só no §3, itens 4 e 5. |

Sem achado novo no `spec.md` nem no PNG 06 (erro em 2 linhas, sem repetir o limite; rodapé só Total + 2 botões). Nenhum defeito funcional para o `testes`.
**Resultado:** nenhum achado em aberto na simulação. O RD-0323 volta a reteste no SDK e no §11.4 se o dono do produto aprovar a pergunta 4.
