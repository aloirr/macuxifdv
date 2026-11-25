# ADR 0074 — Link do APK do Campo e do Gestão vale 24 horas

- **Status**: proposta em 2026-11-24.
- **Data**: 2026-11-24 (Manaus)
- **Tarefa**: v1.0.34 web (sessão S8). Regra: RN-CORE-67 (a validade muda; o resto da regra fica).
- **Autor**: engenheiro-software
- **Origem**: R-20261124-090942-alexandre, item 04: "link temporário do APK com validade de 24 horas" (Campo e Gestão, card Apps da aba Empresa do portal).
- **Substitui**: o item 1 da ADR 0065 só na validade dos APKs. O Conector continua na ADR 0037 (300 s por padrão, de 60 a 900 s).

## Contexto
Desde a ADR 0065, o link dos APKs tem a mesma validade do Conector: 300 s por padrão, no máximo 900 s (`MACUXI_PACOTES_VALIDADE_S`).

Quem administra a empresa gera o link no portal e o manda ao vendedor ou ao supervisor, que o abre no aparelho. Com 5 a 15 minutos, o link vence antes de chegar e precisa ser gerado de novo. O dono do produto pediu 24 horas.

## Decisão
1. **Validade fixa de 24 h para os APKs.** A constante é `VALIDADE_LINK_APP_S = 86_400`, em `packages/platform-sdk/src/pacotes.ts`. A função `validadeDoLinkS(produto, validadeConectorS)` devolve 24 h para `campo` e `gestao` e a validade configurada para `conector`.
2. **O Conector não muda.** `MACUXI_PACOTES_VALIDADE_S` segue valendo só para o Conector. A variável não altera a validade dos APKs, e a API não ganha variável nova.
3. **Mesma porta e mesmo adaptador.** `criarPacotesS3` (`apps/api/src/pacotes.ts`) assina o GET com `validadeDoLinkS(produto, op.validadeS)`. O serviço em memória do SDK usa a mesma função, e os testes de módulo veem a mesma validade da API.
4. **O resto da RN-CORE-67 fica.** Quem pode gerar, a licença por variante, a auditoria sem dado pessoal e o bucket privado não mudam. O link segue fora de log e da auditoria.

## Premissa do armazenamento
O link SigV4 por query string só vale enquanto a credencial que o assinou vale. Na Macuxi, a credencial é **fixa**:
- `MACUXI_S3_CHAVE_ID` e `MACUXI_S3_SEGREDO` vêm dos segredos do GitHub (`PROD_S3_KEY_ID`, `PROD_S3_SECRET`) para o `segredos.env` da VM (`producao-publicar.yml`);
- o cliente S3 (`apps/api/src/armazenamento-s3.ts`) não envia `X-Amz-Security-Token`, ou seja, não há credencial temporária (STS).

Com credencial fixa, o link vale as 24 h inteiras. O teto do SigV4 é 7 dias (`preAssinarS3` recusa acima de 604 800 s), e 24 h cabem nele.

Dois casos derrubam o link antes das 24 h, e são aceitos:
- **troca da chave** do S3: os links abertos morrem; quem precisar gera outro;
- **credencial temporária** (STS ou papel de instância) no futuro: o link morre quando a credencial vence. Quem trocar para STS revê esta ADR.

## Alternativas
- **Subir o teto de `MACUXI_PACOTES_VALIDADE_S` para 24 h.** Recusada: o Conector também passaria a aceitar 24 h, e a ADR 0037 o quer curto.
- **Variável nova (`MACUXI_APPS_VALIDADE_S`).** Recusada: o pedido é um valor fixo, e mais uma variável é mais um ponto de erro na subida.
- **Página pública do APK.** Recusada pela ADR 0065: o APK só sai para quem administra a empresa.

## Consequências
- Um link vazado baixa o APK por até 24 h, e não mais por 15 min. O APK sozinho não dá acesso: o app exige login, licença e a versão vigente. A auditoria registra cada geração.
- A RN-CORE-67 ("válido por no máximo 15 minutos") passa a dizer 24 horas para os APKs. A mudança do texto vai por recado ao dono do doc 03.
- O texto do portal ("O link vale até HH:mm") passa a indicar o dia, porque o link vence amanhã no mesmo horário. A mudança é do `engenheiro-apps` (`apps/web/lib/conector-download.ts`, `textoDaValidade`).
