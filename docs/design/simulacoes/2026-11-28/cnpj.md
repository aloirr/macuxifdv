# CNPJ no cadastro de cliente: BKO e pré-cadastro do Campo (simulação T-0203)

> designer-ux · 28/11/2026 (Manaus) · T-0203, decisão 122 A (R-20261128-000314-alexandre); RF-CORE-10, RN-CORE-16, RN-CORE-17 e
> R-20261102-092329. É só uma simulação, com dados fictícios. O código (modulo-core) vem depois do "aprovo" do Alexandre.
> A tela do Campo parte da atual (`modules/core/app/telas/novo-cliente.tsx`, `docs/design/telas/campo-cliente-pre-cadastro.md`).
> Para gerar de novo: `node docs/design/simulacoes/2026-11-28/gerar-cnpj.mjs`.

## Telas
| PNG | Estado |
|---|---|
| `cnpj-campo-1-valido-390.png` | Campo, Novo cliente: CNPJ válido com máscara `00.000.000/0000-00`. Sem selo nem texto de "válido" |
| `cnpj-campo-2-invalido-390.png` | Campo: dígito verificador errado, borda vermelha e "CNPJ inválido" ao sair do campo |
| `cnpj-campo-3-vazio-incompleto-390.png` | Campo, ficha depois de salvar sem CNPJ: etiqueta "Cadastro incompleto" e a linha automática em Observações |
| `cnpj-bko-1-valido-1366.png` | BKO, Clientes › Novo cliente: o CNPJ é o 1º campo, e Cancelar e Salvar ficam juntos embaixo, à direita |
| `cnpj-bko-2-invalido-1366.png` | BKO: CNPJ inválido |
| `cnpj-bko-3-vazio-incompleto-1366.png` | BKO, cliente salvo sem CNPJ: etiqueta no título e a linha automática no topo de Observações, acima do texto digitado |

## Regras de tela de 27/11
- Um campo só, "CPF/CNPJ", o mesmo rótulo de hoje. A máscara segue o número de dígitos: até 11 é CPF, de 12 a 14 é CNPJ.
- O erro é só "CNPJ inválido", sem explicar o dígito.
- O estado válido não ganha marca. Só o erro aparece.
- No Campo há um botão só, Salvar, no rodapé. No BKO, Cancelar e Salvar ficam juntos embaixo.

## Para o Alexandre confirmar
1. **Texto da observação automática.** A simulação usa a linha que o sistema já escreve (RN-CORE-17): "Cadastro incompleto: falta
   CNPJ/CPF.". O pedido citava "sem CNPJ ou CPF não fatura". Essa frase explica o sistema, e foi uma frase assim que saiu na
   RD-0183. Ficamos com a linha de hoje?
2. **Pré-cadastro do app sem CNPJ.** Hoje a RN-CORE-79 exige o CNPJ/CPF no pré-cadastro: o Salvar mostra "Obrigatório" e não
   salva. A simulação 3 segue a T-0203: salva e entra como cadastro incompleto. Isso muda a RN-CORE-79 (modulo-core). Confirmar.
3. **CNPJ inválido.** Ele não salva, porque o erro está na tela. Pela RN-INT-14, o inválido vindo do ERP conta como ausente.
