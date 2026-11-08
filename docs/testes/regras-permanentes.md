# Regras permanentes do plano de testes

Itens que entram em TODA matriz de `docs/testes/T-nnnn.md`, além dos cenários de sempre (caminho feliz, limites, perfil errado,
tenant errado, módulo desativado, offline e reconexão, reenvio duplicado, conflito de sync e dado inválido da integração).

## 1. Valor × regra e rótulo × valor (T-0124, desde 08/11/2026)

**Item obrigatório de toda tarefa com tela ou indicador.** Origem: RD-0001. No teste de campo de 08/11 o cartão "META DE HOJE"
mostrou R$ 553, que era o realizado do mês. O dono do produto decidiu que esse tipo de erro é do testes e não pode se repetir
(R-20261108-135639, R-20261108-135649).

Para cada número que aparece numa tela (app Campo, app Gestão, BKO) ou num indicador:

1. **Regra.** Diga qual RN define o número (ex.: RN-CORE-26 para a meta do dia, RN-GES-06 para "a faturar").
2. **Valor × regra.** Escreva um teste que confira o valor exibido contra a fórmula da RN. Se a tela não roda em Node, confira
   o valor que ela recebe da lib ou do domain.
   - O valor esperado sai de um **oráculo escrito no teste** a partir do texto da RN, nunca da função testada.
   - Cubra sempre os quatro casos: **dia útil**, **dia não útil**, **virada de mês** e **fuso do tenant** (Manaus, UTC−4,
     com o instante perto da meia-noite local).
3. **Rótulo × valor.** O rótulo da tela tem de dizer o que o número é. Exemplos:
   - "Meta de hoje" só mostra a meta do dia da RN-CORE-26. Realizado do mês com esse rótulo é defeito.
   - "A faturar" é vendido − faturado.
   - O % do mês é realizado ÷ meta do mês.
   Confira o texto renderizado, ou o texto que a lib monta, junto com o número.
4. **Mesmo número, mesma conta.** Quando o mesmo indicador aparece em mais de uma tela (Início × Metas × Ficha do vendedor ×
   BKO), o teste confere que os números batem: mesmo calendário, mesma data de apuração (RN-CORE-21) e mesmo fuso.
5. **Defeito.** Cada defeito vira pedido ao dono, com prioridade alta, arquivo:linha e valor esperado. O teste fica em
   `it.fails` (vermelho de verdade, com o motivo na mensagem) até a correção. No commit da correção, o testes volta o caso para
   `it`.

Referência: `tests/modulos/meta-de-hoje-rd0001-t0124.test.ts` (cartão renderizado com react-dom/server a partir da cadeia real)
e `tests/modulos/indicadores-valor-regra-t0124.test.ts` (varredura). Tabela indicador → RN → teste → resultado:
`docs/testes/T-0124.md`.
