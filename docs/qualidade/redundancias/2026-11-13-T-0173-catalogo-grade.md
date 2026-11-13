# T-0173 · Catálogo em grade (3 imagens e `catalogo-grade.md`)

> 2026-11-13 ~09h30 (Manaus) · corretor-redundancias · passada única da v1.0.5, pedido do gerente-projetos.
> Entrega R-20261113-104633. Regras de hoje (R-20261113-062739): só achado **médio ou alto** segura o demo; o **baixo** fica
> registrado e vai para o build seguinte.
> Outras tarefas da mesma passada: T-0166 (`2026-11-12-T-0166-alertas.md` §Reteste 4), T-0171
> (`2026-11-12-T-0171-listas.md` §6) e T-0172 (`2026-11-13-T-0172-marca-entrada.md`).

## Parecer
**Liberado para ir ao dono do produto.** As 3 imagens podem ir, com o RD-0242 (baixa) anotado para a v1.0.6.

## O que passa
O cartão: foto, nome, marca, preço e uma tag de estoque, sem código, sem hora e sem etiquetas (RD-0207 resolvido no desenho).
A contagem fica só na faixa. Saíram "Abra pela ficha…", "Atualizado às…", "40 produtos ativos" e Sistemas.

## Achados
### RD-0242 · baixa · layout · designer-ux
- **Onde:** `catalogo-grade.md` §2:43; as 3 imagens.
- **O que se repete:** sem foto, a inicial em 34 pt (`A`, `D`, `R`) num quadro de 112 dp repete a 1ª letra do nome logo abaixo.
- **Proposta:** ícone neutro de produto (`package`, 32 dp, `ink3`) sobre `neutralBg`, no mesmo quadro.
