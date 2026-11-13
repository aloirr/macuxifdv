# Limite de desconto por item e por pedido (T-0168, RN-VEN-11a)

> 2026-11-12 · designer-ux. Simulação para o dono do produto aprovar antes de implementar (R-20261112-080845).
> Imagens (fonte: `telas/T-0168-campo.html` e `telas/T-0168-bko.html`): `telas/T-0168-bko-1..3-*.png`,
> `telas/T-0168-campo-1..6-*.png` e `telas/T-0168-gestao-1-em-nome.png`. Vale a imagem aprovada.
> BKO: modulo-core. Campo: modulo-vendedor. Gestão (pedido em nome): modulo-gestor.

## 1. BKO › Usuários › Editar usuário
- O `Dialog` ganha `Abas`: **Dados** (o formulário de hoje, sem mudança) e **Parâmetros**. Vale também em "Novo usuário".
- Aba **Parâmetros**, nesta ordem, linhas separadas por traço `line-2`:
  - **Limitar desconto por item** · ajuda 12 `ink-2` "Nenhum item passa do desconto máximo do produto." · `Interruptor` (Sim/Não).
  - **Limitar desconto por pedido** · sem ajuda (RD-0197) · `Interruptor`.
  - **Desconto máximo do pedido (%)**: campo de 160 px × 44, uma casa ("8,0"), de 0 a 100. **Só aparece com "por pedido" em Sim.**
    Ao desligar, o campo some e o valor fica guardado.
- Padrão de todo usuário: por item **Sim**, por pedido **Não** (imagem A).
- **Salvar** com "por pedido" em Sim e o campo vazio (imagem B): não salva, abre a aba Parâmetros e marca o campo (borda `danger`
  2 px + "Obrigatório"). Fora da faixa: "De 0 a 100". Mesma lógica da falta no campo do app (T-0166).

## 2. App (Campo e Gestão), Novo pedido
- **Uma linha nos Alertas** (pedido-v4 §0.1), em todas as abas: `Pedido acima do desconto máximo (8,0%)`, com o limite
  de quem faz o pedido, uma casa (RD-0196). Toque leva à aba Itens. Mesma frase no detalhe do orçamento, na recusa da API
  (`desconto_pedido_acima_limite`) e na lista.
- **Ordem** (§6.5): logo depois das linhas de item acima do máximo (imagem 3: o item antes do pedido).
- **Botões** iguais aos do item acima do máximo: **Salvar como orçamento** (principal) · **Apenas salvar** · Cancelar (imagens 1 a 3).
- **Sem marca em outro lugar**: o "Desconto (%)" dos Totais e o geral da aba Itens ficam em `ink`; o problema está só nos Alertas.
- **Alçada** (imagem 4): abaixo do limite, nada muda (`Desconto acima da sua alçada` e "Enviar para aprovação?"). Acima do limite,
  a linha da alçada sai: o pedido só sai como orçamento, a aprovação não se aplica.
- **"Por item" desligada** (imagem 5): a folha aceita o desconto sem o "Máx. X%" no campo e sem linha do item nos Alertas.
  Ligada, fica como hoje (T-0166, imagem 5).
- **Orçamento salvo** (imagem 6): a linha fica nos Alertas do detalhe; ação principal **Editar**, sem Transformar.
- **Acréscimo** nunca mostra a linha. Sem sinal, o app aplica com o limite do sync.

## 3. Gestão, pedido em nome do vendedor (imagem 7)
- Vale o limite **do gestor**, na mesma frase do Campo: `Pedido acima do desconto máximo (10,0%)` (RD-0196).

## 4. Decisões para o dono do produto aprovar
1. As duas funções e o limite juntos na aba Parâmetros (o pedido falava em funções no cadastro e o limite na aba).
2. O campo do limite só aparece com "por pedido" ligada.
3. Acima do limite do pedido, a linha da alçada sai.
4. A mesma frase no Campo e no Gestão, sem "do vendedor" nem "do gestor" (§2 e §3; o doc 03 acompanha, RD-0196).
