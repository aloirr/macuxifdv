# Campo — pré-cadastro de cliente (v1.0.28)

Decisão do dono do produto (23/11/2026): o vendedor pré-cadastra o cliente no Campo; o ERP aprova (devolve o código) ou recusa (com motivo). Sem aprovação no BKO. A empresa escolhe em Parâmetros quais campos são obrigatórios; alguns são **sempre obrigatórios** (lista e contratos Zod do `modulo-core`, em `modules/core/contracts`). A tela não distingue os dois casos: para o vendedor, obrigatório é obrigatório.

Dono da tela: `modulo-core` (`modules/core/app`). Kit: `@macuxi/ui/mobile`. Regras de texto: só o que o vendedor usa para agir (R-20261110-192153); uma informação, um lugar; avisos só na área Alertas (RN-VEN-42).

## 1. Entrada
- Lista de clientes (`modules/core/app/telas/clientes.tsx`): botão `Botao` principal **Novo cliente** (ícone `plus`), o único principal da tela. Funciona sem internet.
- Ficha do cliente recusado: o botão **Corrigir e reenviar** (ver §5).

## 2. Tela "Novo cliente"
`CabecalhoTela` com voltar e o título **Novo cliente** (na correção: **Corrigir cliente**). Corpo rolável, campos em blocos com `RotuloSecao`, nesta ordem:

| Bloco | Campo (rótulo) | Componente | Teclado / máscara |
|---|---|---|---|
| — | CPF/CNPJ | `CampoTexto mascara="documento"` | numérico; CPF até 11 dígitos, CNPJ de 12 a 14 |
| — | Razão social (CPF: **Nome**) | `CampoTexto` | texto, `autoCapitalize="words"` |
| — | Nome fantasia | `CampoTexto` | texto, `words` |
| CONTATO | Telefone | `CampoTexto mascara="telefone"` | `phone-pad`; (00) 0000-0000 / (00) 00000-0000 |
| | E-mail | `CampoTexto` | `email-address`, `autoCapitalize="none"` |
| ENDEREÇO | CEP | `CampoTexto mascara="cep"` | numérico; 00000-000 |
| | Logradouro · Número · Bairro | `CampoTexto` (Número com `number-pad`, ao lado do Logradouro em 1/3 da largura) | texto |
| | Cidade | `CampoTexto` | texto, `words` |
| | UF | `CampoEscolha` com `UFS_BRASIL` (`@macuxi/comum/endereco`), com busca, placeholder **Escolher** | — |
| OUTROS | Inscrição estadual e os demais campos do parâmetro | `CampoTexto` | conforme o campo |

- Campo que a empresa **não** exige: `opcional` → rótulo "Nome fantasia (opcional)" em `ink3`. Obrigatório (pelo parâmetro ou sempre) não leva marca.
- Campo que a empresa não usa: não aparece.
- O documento (CPF/CNPJ) vai ao sync só com dígitos (`somenteDigitos`), como CEP e telefone; a máscara é só visual.
- Borda dos campos: `lineStrong` (#7A8593), 1 dp, raio `md`, 52 dp. "Próximo" do teclado leva ao campo seguinte; no último, fecha o teclado.

## 3. Falta por campo (padrão T-0166, `faltaVisivel`)
- Obrigatório vazio: normal até tocar em **Salvar**; aí `falta="Obrigatório"` (borda `danger` 2 dp + `TextoDaFalta`) e a tela rola até o primeiro campo com falta.
- Inválido: ao sair do campo — "CNPJ inválido", "CPF inválido", "CEP inválido", "Telefone inválido", "E-mail inválido". Validação no domain (`cnpjValido`, `cpfValido`, `cepValido`).
- CPF/CNPJ de cliente que já está na carteira: "Já é cliente" + link **Abrir** na mesma linha.
- Nada de resumo de erros no topo; o erro está no campo.

## 4. Salvar
- `Botao` principal **Salvar** no rodapé fixo, 52 dp, sempre ligado (o toque mostra as faltas).
- Salvou: volta à lista com o cliente no topo e o `AvisoRodape` **Cliente salvo** (sucesso). Sem internet, igual.
- Sair com dados digitados: `Folha` **Descartar o cadastro?** com **Descartar** (perigo) e **Continuar** (secundário).

## 5. Estados do cliente (lista e ficha)
Selo: `ChipEstado pequeno {...seloDoPreCadastro(situacao)}` no lugar do selo `pre_cadastro` atual.

| Situação | Selo | Ação |
|---|---|---|
| Aguardando ERP | `Aguardando ERP` (tom `aviso`, ícone `clock`) | pode abrir pedido conforme a regra do módulo; nenhum texto extra |
| Recusado pelo ERP | `Recusado pelo ERP` (tom `erro`, ícone `alert`) | na ficha, área **Alertas**: o motivo do ERP (texto literal, 1 a 3 linhas) e o botão secundário **Corrigir e reenviar** |
| Não enviado (envio que o servidor não aceitou) | `Não enviado` (tom `erro`, ícone `alert`) | na ficha, área **Alertas**: o motivo da recusa e o botão secundário **Corrigir e reenviar** |
| Aprovado (ERP devolveu o código) | sem selo | o código aparece onde o código do cliente já aparece |

- O motivo aparece na área Alertas da ficha e, na correção, só no topo do formulário, numa linha `danger` com ícone `alert`.
- Reenviar = **Salvar** no formulário de correção; o selo volta a **Aguardando ERP**.

## 6. Componentes do kit (`@macuxi/ui/mobile`)
- `CampoTexto` ganhou: `mascara?: 'documento' | 'cep' | 'telefone'` (`aoMudar` recebe o texto formatado), `opcional?: boolean`, `falta?: string | null`.
- `RotuloCampo` ganhou `opcional?: boolean`.
- Puros (`@macuxi/ui/mobile/puro`): `aplicarMascara`, `propsDeTecladoDaMascara`, `DIGITOS_DA_MASCARA`, `seloDoPreCadastro(situacao: 'aguardando_erp' | 'recusado_erp' | 'nao_enviado' | 'aprovado_erp')`, `ROTULO_AGUARDANDO_ERP`, `ROTULO_RECUSADO_ERP`, `ROTULO_NAO_ENVIADO`, `ACAO_CORRIGIR_E_REENVIAR`.
- Já existentes, reusar: `CampoEscolha` (UF), `ChipEstado`, `Botao`, `AvisoRodape`, `Folha`, `RotuloSecao`, `TextoDaFalta`.
