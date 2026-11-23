# Portal `config.` — "Zerar dados" da empresa e por entidade (v1.0.31)

**Situação:** spec do designer-ux a partir da implementação do engenheiro-apps (rodada 1: SHA `8e29949cc`; rodada 2: SHA `ad16c5a86`; rodada 4: SHA `57a583107`). Revisão e textos finais: `docs/design/revisoes/v1031-zerar-dados.md`. Regras: RN-PLA-12, RN-INT-15, RN-INT-16, ADR 0068 e `docs/desenho/empresa-zerar.md` (§6.4 para a aba Integração). Componentes de `@macuxi/ui/web`: `MenuAcoes`, `TabelaDados` (prop `acoes`), `Panel`, `Badge`, `Dialog`, `Button`, `CampoSenha`, `LoadingBlock`, `ErrorBlock` e `Notice`.

## 1. Menu "⋯" da linha (lista de Empresas)
Ordem: Backup · Inativar/Reativar · divisor · **Zerar dados** · **Excluir**. Os dois últimos são de perigo.

"Zerar dados" fica desligado, sem "(motivo)", nestes casos:
- backup rodando;
- empresa em exclusão;
- outro pedido da linha no ar.

O motivo já aparece na própria linha.

## 2. Aba Integração — seção "Monitor" (só o time da Macuxi)
O título `Monitor` (h2) vem depois do conteúdo da aba. Os três quadros, nesta ordem:

**2.1 Conector** (`TabelaDados`):
| Coluna | Largura | Prioridade |
|---|---|---|
| Conector (mono) | sobra | 1 |
| Situação (selo com texto) | 170 px | 1 |
| Versão | 100 px | 2 |
| Último sinal | 150 px | 2 |
| Fila ("2 lotes · 380 linhas", "Vazia", "—") | 170 px | 2 |

**2.2 Painel do BKO** (`MonitorPainel` do módulo integracao, igual ao do BKO, sem ações do portal):
| Coluna | Largura | Prioridade |
|---|---|---|
| Entidade | sobra | 1 |
| Última carga | 300 px | 3 |
| Situação ("Com falha" / "Em dia") | 120 px | 1 |
| Linhas integradas | 150 px | 2 |

Menu "⋯" da linha: **Reprocessar** (só com falha; direto para `admin`, ou com a senha de quem autoriza, RN-INT-16) e **Histórico (n)**.

Recomendação para o lote seguinte: título visível `Cargas recentes`.

**2.3 Dados no Hub** (`TabelaDados`):
| Coluna | Largura | Prioridade |
|---|---|---|
| Entidade | 200 px | 1 |
| Registros ("1.180 ativos · 60 inativos" / "—") | 200 px | 2 |
| Última alteração (cursor do ERP, fuso da empresa) | 150 px | 2 |
| Corrigir no ERP ("3 · campo_obrigatorio" / "—") | sobra | 3 |

Menu "⋯" da linha: **Zerar dados** (perigo, vermelho), só na entidade com dados no Hub. Sem dados, a linha fica sem menu.

**Uma informação, um lugar:**
- **Só no painel:** situação e linhas do lote, Reprocessar e Histórico.
- **Só na "Dados no Hub":** registros, cursor, o que corrigir no ERP e "Zerar dados".

Os erros "a reprocessar" ficam só no painel, no selo "Com falha" e no Reprocessar.

**No celular:**
- Conector: Conector + Situação.
- Painel: Entidade + Situação + "⋯".
- "Dados no Hub": Entidade + "⋯".
- Nenhuma tabela passa da largura da tela.

## 3. Diálogo — confirmação
Título:
- empresa inteira: **"Zerar dados de {empresa}?"**;
- por entidade: **"Zerar {Entidades} de {empresa}?"**.

Conteúdo, nesta ordem:
1. Contando (a prévia é do worker; a tela pede e lê a cada `CONSULTA_PREVIA_ZERAR_MS`): `LoadingBlock` "Contando os dados…", sem campos, rodapé só com **Fechar**. Erro ao pedir ou prévia que falhou: `ErrorBlock` com a frase do SDK e "Tentar de novo" (pede uma prévia nova).
2. **Apaga:** lista por grupo, com o rótulo à esquerda e a contagem à direita (`tabular-nums`). Só os grupos com linhas, na ordem de `GRUPOS_ZERAR`. Na empresa inteira, e por entidade quando a entidade é `vendedor`, entra o grupo **"Usuários não administradores"**.
3. Por entidade, só quando a cascata leva outras: **"Leva junto: {entidades que não estão no título}"**.
4. Empresa inteira: **"Mantém: empresa, plano, administradores, perfis, parâmetros e conectores."** Por entidade, a linha não aparece: o "Apaga:" já diz o que sai, inclusive os usuários.
5. "Digite `CÓDIGO` para confirmar", com o campo em fonte mono.
6. "Sua senha" (`CampoSenha`).
7. Rodapé: **Cancelar** + **Zerar dados** (perigo, o único principal). O botão liga com o código conferindo e a senha preenchida. Enquanto envia, mostra "Zerando…".

Estados sem confirmação (sem campos e sem "Zerar dados"; o botão do rodapé é **Fechar**):
- **Vazio:** "Não há dados para zerar." Só este texto: o vazio vence o bloqueio.
- **Bloqueado:** só o `Notice` de aviso, com a frase de `mensagemDoZerar`.
- **Contando:** `LoadingBlock` "Contando os dados…".
- **Erro na prévia:** `ErrorBlock` com "Tentar de novo". Frase (R4-1): "Não foi possível contar os dados. Tente de novo."
- **Já em andamento** (`ZERAR_EM_ANDAMENTO`): o diálogo vai direto ao andamento.

## 4. Diálogo — depois do pedido
Título sem pergunta: **"Zerar dados de {empresa}"** ou **"Zerar {Entidades} de {empresa}"**. Rodapé: **Fechar**. Fechar não cancela o pedido.
- **Andamento:** `LoadingBlock` "Em andamento…".
- **Concluído:** mostra três coisas:
  - `Notice` de sucesso "{n} linhas apagadas." (ou "1 linha apagada.");
  - "Lote {lote}", em mono;
  - **"Rode no servidor do Conector:"**, com um `conector carga-completa <entidade>` por entidade afetada (`todas` quando são as 16).

  Ao terminar, o painel desta empresa recarrega.
- **Falha:** `Notice` de perigo com a frase de `mensagemDoZerar`.
- **Erro ao consultar:** `ErrorBlock` com "Tentar de novo".

## 5. Lote seguinte (recomendação)
- Fechar o diálogo durante o andamento leva o acompanhamento para o fundo, como no Excluir. O aviso aparece no topo da lista: "Dados de {empresa} zerados." ou a frase da falha.
- Botão de copiar ao lado de cada comando `conector carga-completa`.
