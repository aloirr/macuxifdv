# Portal `config.` — "Zerar dados" da empresa (v1.0.30)

**Situação:** spec do designer-ux a partir da implementação do engenheiro-apps (SHA `8e29949cc`). Revisão e textos finais: `docs/design/revisoes/v1030-zerar-dados.md`. Regra: RN-PLA-12, ADR 0068 e `docs/desenho/empresa-zerar.md`. Componentes de `@macuxi/ui/web`: `MenuAcoes`, `Dialog`, `Button`, `CampoSenha`, `LoadingBlock`, `ErrorBlock` e `Notice`.

## 1. Menu "⋯" da linha (lista de Empresas)
Ordem: Backup · Inativar/Reativar · divisor · **Zerar dados** · **Excluir**. Os dois últimos são itens de perigo. "Zerar dados" fica desligado, sem "(motivo)", com backup rodando, empresa em exclusão ou outro pedido da linha no ar. O motivo já aparece na própria linha.

## 2. Diálogo — confirmação
Título: **"Zerar dados de {empresa}?"**
1. Carregando: `LoadingBlock` "Contando os dados…". Erro: `ErrorBlock` com "Tentar de novo".
2. **Apaga:** lista por grupo, com o rótulo à esquerda e a contagem à direita (`tabular-nums`). Aparecem só os grupos com linhas, na ordem de `GRUPOS_ZERAR`.
3. **Mantém:** empresa, plano, usuários, perfis, parâmetros e conectores.
4. "Digite `CÓDIGO` para confirmar", com o campo em fonte mono.
5. "Sua senha" (`CampoSenha`).
6. Rodapé: **Cancelar** + **Zerar dados** (perigo, o único principal). O botão liga com o código conferindo e a senha preenchida. Enquanto envia, mostra "Zerando…".

Estados sem confirmação (sem campos, sem "Zerar dados", com o botão **Fechar**):
- **Vazio:** "Não há dados para zerar." Só este texto: o vazio vence o bloqueio.
- **Bloqueado:** só o `Notice` de aviso com a frase de `mensagemDoZerar`, sem prévia e sem "Mantém".
- **Erro na prévia:** `ErrorBlock` com "Tentar de novo".
- **Já em andamento** (`ZERAR_EM_ANDAMENTO`): o diálogo vai direto ao andamento.

## 3. Diálogo — depois do pedido
Título sem pergunta: **"Zerar dados de {empresa}"**. Rodapé: **Fechar**. Fechar não cancela o pedido.
- **Andamento:** `LoadingBlock` "Em andamento…".
- **Concluído:** `Notice` de sucesso "{n} linhas apagadas." (ou "1 linha apagada.").
- **Falha:** `Notice` de perigo com a frase de `mensagemDoZerar`.
- **Erro ao consultar:** `ErrorBlock` com "Tentar de novo".

## 4. Lote seguinte (recomendação)
Fechar o diálogo durante o andamento leva o acompanhamento para o fundo, como no Excluir. O aviso aparece no topo da lista: "Dados de {empresa} zerados." ou a frase da falha.
