# Backlog

> Dono: gerente-projetos. Itens fora do escopo da sprint atual.

## Sprint 1 (abertas no quadro)
- [T-0007](../.coord/tarefas/T-0007.md) — Produto no dono definitivo (ADR-0005)
- [T-0008](../.coord/tarefas/T-0008.md) — Adaptador SQLite no aparelho
- [T-0009](../.coord/tarefas/T-0009.md) — Integração: domínio e contratos do Hub (em revisão)
- [T-0010](../.coord/tarefas/T-0010.md) — Promotor: domínio de trade marketing (em revisão)

## Regra (R-20261107-164646)
Só fica neste arquivo o que o dono do produto autorizou por escrito. **Autorizado hoje:** a revisão de segurança do login (TOTP do time Macuxi e link de definição de senha no lugar de senha por e-mail), que ele revisa quando tudo estiver rodando.

**Autorizado em 09/11 (R-20261109-125750, "Backlog (autorizo)"):** todo o **Telegram** do repositório de recados — aviso de recado, resumo de hora em hora e resposta pelo Telegram (incluindo o intervalo do passo 4a e o `telegram-recado.yml`), sem data. Estado ao sair da esteira: o Telegram recusa com HTTP 403 (bot sem permissão no chat: falta `/start` ou o `TELEGRAM_CHAT_ID` está errado); a correção do aviso (mensagem de erro clara, 429 com nova tentativa, carga em lote numa mensagem) está pronta em `docs/desenho/T-0139-repo-recados/` e não foi publicada. Não mexer nos workflows de Telegram até ele tirar do backlog.

**Trazidos para a esteira em 07/11 17h** (tarefas com dono e ordem no quadro):
- **Itens da lista "Futuro":**
  - T-0095: ERP, guarda de ordem e reativação;
  - T-0096: faixa aberta de ano;
  - T-0097: miniatura;
  - T-0098: download do Conector;
  - T-0099: ordem divergente e "nulo: limpa" no Conector;
  - T-0100: modelos CSV e carga self-service ao admin;
  - T-0101: triagem do Vendedor e acabamento visual;
  - T-0102: itens do Core;
  - T-0103: aplicar-lote e aviso de marca;
  - T-0104: kit Tabs/Progress/ButtonLink e cartões do portal;
  - T-0105: plataforma e CI;
  - T-0106: Treinamento;
  - T-0107: carga com 20 mil SKUs e onboarding;
  - T-0110: conferência dos itens antigos (Sprints 0 a 2).
- **Pedidos do R-20261107-164452:** T-0108 (kit do TI) e T-0109 (nome e versão dos builds).
- **🟢 de segurança do portal:** os da área de transferência do TOTP e do nome do secret caem com a T-0093, e os do hosts-bko e do limite atrás do rewrite entram na revisão R da T-0093.
- **Decididos pelo dono do produto em 07/11 (R-20261107-173950), todos na esteira:**
  - seletor da RN-VEN-35: T-0101;
  - marcas no Catálogo: T-0113;
  - multiperfil: T-0112;
  - cancelamento devolvido ao ERP: T-0114;
  - canal no cliente: T-0115;
  - Conector v2: T-0116.
- **Autorizado a ficar fora da fila (R-20261107-173950 d):** adaptadores do Conector para **Firebird e MySQL, sob demanda do 1º cliente que usar**.

## Futuro (histórico; cada item acima já tem tarefa)
- **Portal config., 🟢 de segurança (T-0087 P, revisões de 07/11; registrado pelo gerente):**
  - o segredo do TOTP fica no histórico da área de transferência;
  - o nome do secret aparece nas páginas públicas;
  - a regex do `hosts-bko.test.ts` não cobre host com porta;
  - o limite por IP do openapi.json atrás do rewrite do Next (engenheiro-software).
- **Portal, 🟢 14 e 15 (T-0087 P):**
  - os cartões das bases recolhidos, com a última carga lida do servidor, precisam de uma rota de lotes por entidade;
  - Tabs, Progress e ButtonLink no kit ficam com o designer-ux.
- **Conector, aviso de ordem divergente (T-0089 I2, revisão R-20261107-111409):** o `conector testar` deve avisar quando a ordem do banco do ERP para `external_id` diverge da do Conector, ou seja, quando a colação não é binária.
- **Conector, limpar campo pela view (T-0089 B2 e I2):** hoje o Conector omite nulos, e na v1 vale "365 = sem teto" e `'[]'` para limpar lista. Recomendação do engenheiro-software: um opt-in por campo no `conector.json` ("nulo: limpa").
- **Miniatura do produto no pull (pós-piloto, R-20261106-182000):** um campo de miniatura no contrato do pull do Catálogo, baixado sob demanda e fora do pacote offline obrigatório. Até lá, a lista por linha (T-0085 D) não reserva espaço para foto.
- **Modelos CSV e dicionário para o admin da empresa (R-20261106-182000):** na v1, ficam só para o super-admin, porque a implantação é assistida. Liberar ao admin da empresa quando o BKO tiver carga self-service: basta trocar para `superAdmin: 'aceita'` e declarar uma ação no manifesto.
- **Download do Conector (T-0087, R-20261106-182000, item 4):** bucket privado, com link temporário gerado pelo portal depois do login do super-admin. O portal mostra "em breve" até isso existir.
- **⏰ Até 31/12/2026: faixa aberta de ano no índice local (T-0084, 06/11):** uma aplicação "2018 em diante" não cobre o ano novo até o índice local do aparelho ser reindexado (`modules/catalogo/app/indice.ts`), e "civic 2027" não aparece. Precisa de um gancho de reindexação na virada do ano no platform-sdk (engenheiro-software) e da troca no Catálogo. Também falta um caso de desempenho com aplicação e ano na busca, que mediu de 1,6 a 1,8 vez mais lenta.
- **Aviso no monitor para marca concorrente desconhecida (T-0085, 06/11):** hoje o Catálogo descarta a referência e só registra no log. O aviso no monitor da integração depende de um retorno do consumidor para o Hub (modulo-integracao e modulo-catalogo). Também: referência sem marca ou com código fora do formato deve descartar só a referência, e não recusar a linha do produto (🟡 do engenheiro, R-20261106-032516).
- **Kit de UI depois do portal (T-0087, 06/11):** os componentes Tabs (já são 5 cópias), Progress e ButtonLink em `packages/ui` (designer-ux), mais os 🟡 e 🟢 restantes da revisão de UX do portal (R-20261106-023316).
- **Carga por arquivo, parâmetros do tenant no `aplicar-lote` (T-0087, 06/11):** o prazo da sessão já vem do tenant. Ainda usam o padrão fixo, e não o parâmetro do tenant, o `limitePct` e o `ttlConfirmacao` da inativação (modulo-integracao).
- **Seletor de clientes do pedido em nome (T-0084, 06/11):** filtrar pela carteira do vendedor dono, sugestão 🟢 do engenheiro-apps. A RN-VEN-35 não diz se é regra, e a decisão fica com o Alexandre.
- **Referência cruzada sem o Promotor (T-0085, 06/11):** um tenant ou usuário sem o Promotor fica sem marcas (riscos 1 e 2 da ADR 0027). O `marca_nome` da 0034 resolve a exibição. Para cadastrar referências sem o Promotor, a decisão fica com o Alexandre.
- **Etapa pendente — resto (T-0039, 05/11)**:
  - botão "Ver fila" no aviso da ficha, junto com o "Descartar" da fila (§4.2 de docs/design/checkout-pendencia.md); depende do caminho do shell até a seção Fila do Perfil;
  - aviso no app Gestão (§2.2), que hoje não guarda as visitas da equipe (a notificação do §2.1 já cobre);
  - selo no Cliente 360 do BKO (§3.3), quando o contrato da lista de visitas trouxer `etapas_pendentes`.
- **Catálogo (T-0052, 05/11)**:
  - busca sem nenhum acerto acima de ~5 mil produtos devolve vazio, depois de o SDK separar "não buscou" de "não achou" (decisão do gerente);
  - 🟢6 (`codigoCompacto` único no ranking e no índice).
- **Plano de RV (T-0082, 05/11)**: fim da vigência por perfil; normalizar o gatilho com peso ou faixas; confirmação no "voltar" do navegador (o Next não oferece gancho estável).
- **Vendedor, triagem de 05/11 (R-20261105-164314)**:
  - pedido em nome do vendedor: o slot `pedido.criar_em_nome` e `vendedor_id`/`autor_id` no novo pedido (mexe em new-order-screen);
  - "Adicionar ao pedido" de `produto.acoes`, com o novo pedido recebendo o produto por parâmetro;
  - `useAtualizacaoAutomatica` e rodapé em orders-screen e order-detail-screen, e o `refreshing` sem `sync.running`;
  - "Gerando…" do PDF: reteste no APK (o limite de 20 s já existe);
  - número 000011 duplicado na base demo: o banco-dados avança a sequência no seed e renumera o duplicado;
  - teste de unidade do cliente bloqueado no receber; revalidar estoque na API antes de ligar `estoque_bloqueia`.
- **CI sem superusuário**: job do @macuxi/db com admin sem superusuário no `ci.yml` (proposta do banco-dados, apoiada pelo engenheiro-software); espera a autorização do Alexandre (governança).
- **RN-CORE-01 — exceção que acrescenta módulo**: hoje a exceção do usuário só remove (decisão de 2026-10-30).
- **RN-CORE-12 em função de domínio**: a regra está só na folha de checkout (B2 do core); falta a função pura com teste em `modules/core/domain`.
- **`canApprove` duplicado**: o vendedor/web tem cópia local até a permissão vir do platform-sdk (débito do desenho da T-0001).
- **Integração depois da T-0009**: schema `integracao` (banco-dados), rotas `/integracao/v1` e OpenAPI (RF-INT-01), Conector (RF-INT-02), carga por arquivo (RF-INT-03) e monitor no BKO (RF-INT-04).
- **Promotor — próximos passos após a T-0010**: schema `promotor` e migrações (banco-dados), API das coletas com RN-PRO-01/02 revalidadas, telas do app (Loja) e BKO de trade; payloads Zod dos eventos `promotor.*@1`; trocar `produto_id` pelo contrato de produto do Core quando a T-0007 publicar.
- **`packages/platform-sdk/src/ambiente.ts` ausente na main**: quebra o typecheck da raiz e os testes que importam o platform-sdk (ex.: `modules/promotor/manifest.test.ts`, `domain/rn-pro-01.test.ts`). Dono: engenheiro-software.
- **Índice da carteira do vendedor incluindo excluídos** (T-0002, EXPLAIN do sync): criar junto com a rota de sync (T-0004).
- **db sem dependência declarada do platform-sdk** (T-0002): `db/package.json` deve declarar `@macuxi/platform-sdk: workspace:*` (hoje resolve só pelo nodeLinker hoisted); o pnpm-lock é do engenheiro.
- **🟢 6 e 7 da revisão da T-0002**: entram na próxima migração da plataforma.
- **Demo web da Fase M (S0-008)**: confirmada só pela premissa "pasta inalterada"; falta o roteiro manual M-01 com o Alexandre.
- **ADR 0003, linhas 66-67**: ainda citam a ponte do vendedor; o engenheiro edita quando a T-0008 (nuvem) destravar a ADR.
- **Cancelamento por integração — para ERPs que aceitam** (sem data): evento `vendedor.pedido.cancelado@1` consumido pelo Hub e cancelamento devolvido ao ERP (opção (a) da decisão de 2026-10-31; no Essencial vale a (b)).
- **Schema `vendedor` (pedido, pedido_item…)**: o vendedor pediu `vendedor.pedido` ao banco-dados para a rota de cancelamento (T-0009); entra com o pedido ponta a ponta (Sprints 4–5), não na Sprint 0.
- **Campo "canal" no cliente do Core**: necessário para o público-alvo da Pesquisa (RN-PES-05); hoje fica fora.
- **Persistir visita com motivo de cliente fechado e foto da fachada** (RN-CORE-14): tabelas core.visita/visita_etapa e armazenamento de foto entram com rotas e visitas reais (Sprint 1).
- **Pesquisa: colunas suspeita, motivos_suspeita, largura_px e altura_px** (RN-PES-04/06): pedir ao banco-dados junto com a API da pesquisa.
- **Aparelho bloqueado por tenant e erro 23503 no criarSessao** (T-0003): decidir se o bloqueio de aparelho vale para todos os usuários do tenant; tratar aparelho de outro tenant como erro de cliente. Sugestão do banco-dados ao core.
- **Job de limpeza de sessões expiradas** (core.sessao).
- **Telas que ainda chamam rotas da Fase M** (/me, /customers): ficam vazias com a API real; migrar para as rotas novas na Sprint 1.
- **Antes do primeiro deploy (obrigatório)**: refresh do BKO em cookie httpOnly (hoje localStorage) e trustProxy no Fastify.
- **Treinamento — 🟡 da revisão final**: unificar `PedidoFaturadoLido` (domain/desafio.ts × contracts/pedido-lido.ts) e os 3 🟢 (xp.ts:109, fuso em dois lugares, arredondamento por evento).
- **Tabela de lançamento de XP** (banco-dados): `referencia_id` com ≥ 128 caracteres e chave única do lançamento; a API processa o XP de um vendedor por vez (tenant + usuário).
- **O-4**: p95 da carga S0-110 em 1–2 s na máquina local (meta 300 ms) — linha de base para a Sprint 9.
- **Conector v2**: atualização automática (v1 = pacote assinado + aviso de versão no monitor).
- **Conector: adaptadores Firebird** (depois do Oracle) e **MySQL** (sob demanda).
- **Testes do Conector intermitentes sob carga** (T-0013 → correção na T-0023, nuvem): até o merge, a raiz pode falhar no @macuxi/conector; o gerente roda de novo antes do push.
- **Migração para zod ≥ 4.6.6** (Sprint 2): o alerta afeta o push sem login; mitigado na API (teto de elementos com 413, máximo de 50 erros na resposta, login antes da validação).
- **Feriados do tenant no calendário de dias úteis** (packages/comum): cadastro de feriados por tenant + nacionais, usado pelo prazo de aprovação do Gestor (RN-GES-03) — engenheiro, se o calendário ainda não tiver feriados.
- **Modo demonstração (mock-api) sem carteira, rota e visita do Core** (decisão do engenheiro na onda 3): a demo do app novo deixou de mostrar essas telas; a demo da Fase M continua na pasta original. Revisar antes da demonstração com o gestor externo.
- **API do Catálogo (Sprint 3)**: variacaoEscopo no sync (engenheiro), incremento atômico da cota de IA e timeout real do provedor em api/ia/ com AbortSignal.timeout (T-0021 🟡3/🟢6).
- **Realizado de venda e positivação reais** (T-0020): consumidor de vendedor.pedido.* alimentando core.indicador_diario, quando o Vendedor publicar os eventos de pedido (Sprints 4–5).
- **SDK (🟡 da revisão final da Sprint 1)**: poda local das entidades com janela; push enviado depois do commit (aposConfirmar) — Sprint 2.
- **Job de desempenho no CI** (Sprint 9): rodar à parte MACUXI_PERF=1 (busca do SQLite, meta 300 ms) e MACUXI_CARGA_MEDIR=1 (S0-110); no pnpm test normal esses tempos só são impressos ou têm limite folgado.
- **BKO do core na API nova (Sprint 2)**: Clientes com farol da carteira, Metas por equipe e Plano de RV — hoje 'em construção' (T-0030); precisam de rotas v1 novas no core.

## Pendências da T-0029 (Sprint 2)
- ✅ (T-0035) Fronteira S0-014 no Vendedor: o fuso deixa de ser lido de `plataforma.tenant` (engenheiro expõe `ctx.fuso()` no platform-sdk; vendedor troca `fusoDoTenant`) e `pedido.db.test.ts` sem SQL em `core.*`; o testes retira as exceções temporárias.
- ✅ (T-0035) `GET /alcadas` sem acesso do promotor (hoje via `pedido.ver`), com teste 403 (modulo-vendedor).
- ✅ (T-0034) `apps/web/next-env.d.ts` no .gitignore e typecheck do web com `next typegen` (engenheiro; O-4).
- Integração: consumir `integracao.pedido.retorno_erp@1` e publicar `faturado@1` no Vendedor (fora do escopo da demo).
- **OpenAPI do Hub /integracao/v1** (RF-INT-01): fora da T-0032; gerar a partir dos contratos Zod.
- **Abas que faltam nos apps** (T-0034: o shell está pronto, faltam as telas dos módulos):
  - Catálogo no Campo: o `moduloApp` do Catálogo não tem `paginas` (modulo-catalogo; candidata à nuvem).
  - Loja do promotor: o `moduloApp` do Promotor exporta `{}`; precisa do schema promotor, da API das coletas e das telas (modulo-promotor + banco-dados).
  - Equipe e Aprovações no Gestão: o `moduloApp` do Gestor exporta `{}`, e o Gestor não está licenciado na demo (modulo-gestor; licença na demo é decisão do Alexandre).
  - Sugestão de `ordem` do engenheiro-apps: Equipe 10, Aprovações 20, Pedidos e Loja 40, Catálogo 60. A barra mostra no máximo 5 abas; as demais vão para "Mais".
- **Revisão das telas da T-0029** (engenheiro-apps, R-20261101-155135): 16 🟡 e 12 🟢 ao modulo-vendedor, para a próxima passada dele.
- **Catálogo — cota de IA atômica** (T-0041): incremento condicional por tenant, usuário e dia no fuso do tenant (banco-dados); campo `ia_timeout_ms` em `ParametrosCatalogo` (engenheiro-software).
- **Lint `macuxi/hora-fixa-em-teste` vira ERRO em 2026-11-16** (T-0043, R-20261101-200740). Até lá, cada dono corrige os avisos dele: banco 15, engenheiro 10, integração 10, core 7, testes 6, vendedor 3. Tarefa de virar a chave no dia 16: engenheiro-software.
- **Job de CI com relógio deslocado** (23:59/01:30 de Manaus, fim de mês, virada de ano; `tests/scripts/relogio-deslocado.cjs`): local, governança (.github), depois da T-0049.
- **Riscos do guardião v5** (PR #31): proteger o merge feito pelo MCP do GitHub (hook ou proteção do `main`); o CI barrar recado de autorização vindo de PR da nuvem (fica na T-0049 b).
- **Guardião v5 e o PATH do gh**: o hook falha fechado se o `gh` não estiver no PATH do processo (C:\Program Files\GitHub CLI). Procurar o gh no caminho padrão ou documentar o PATH.
- **Guardião v7** (sem pressa): `gh api` de leitura com `$VAR` ou "merge" no --jq ainda é barrado; as ferramentas MCP que gravam direto no GitHub (push_files etc.) não passam por guardião (o CI da T-0049 detecta governança sem assinatura).
- **Antes do piloto real** (fora de 06/11): teste de carga com 20 mil SKUs, onboarding de tenant e o resto da Sprint 9 que não couber.
- **Guarda de ordem nos consumidores do ERP** (T-0066 🟡1, antes do 1º tenant real): versão antiga reentregue pela outbox não pode sobrescrever a nova (comparar alterado_em); banco-dados + modulo-core + modulo-catalogo.
- **ERP não reativa o que o admin desligou** (T-0066 🟢4/5): vendedor e tabela de preço desativados no BKO não voltam sozinhos com a próxima carga; rota do ERP aplica as paradas presentes e só notifica se as de hoje mudaram (🟢3).
- **Cortes da T-0061** (aceitos pelo Alexandre em 2026-11-02, R-20261102-204330): transportadora vinda do ERP (fica só o cadastro no BKO), preço próprio da CX na tabela (fica UN × fator), chip "campanha" na árvore do catálogo.
- **Depois da demo de 03/11** (Alexandre, 03/11 manhã): passo `pnpm timers` no `.github/workflows/ci.yml` (governança; a varredura já está limpa); `licencas.test` refeito sobre o main atual; espelho Drizzle do Promotor e do item do pedido; `gravarDemoMedidas` no `db/seeds/demo/demo.ts`; `core.medidas@1` declarado no Hub (`usaConsultas` da Integração; re-revisão T-0032 🟡); nota em `docs/desenho/T-0061.md` e contrato marcado como implementado; queda 57P01 do teste de carga; coordenação da T-0056; PR do medidas-api.
- **Ambiente Magalu (T-0074), depois do APK**:
  - grupo de segurança próprio por ambiente quando a produção for criada;
  - avaliar renomear o GitHub Environment `DEMO_SSH_KEY` para `demo`, o que exige recadastrar os secrets (o dono do produto faz quando o gerente pedir);
  - renovar a API Key `macuxi-demo-s3` do Object Storage antes de 31/12/2026 (**o gerente avisa o dono do produto em 15/12**; a duplicata já foi revogada em 04/11).
- **Positivação acumulada do mês no Início, depois do APK de 05/11** (dono do produto, 04/11; pendência do PR #84 da T-0073, decisão: opção 3): banco-dados. Hoje `core.indicador_diario.clientes_positivados` (0021) conta clientes distintos **no dia**, e somar os dias conta duas vezes o cliente que comprou em dois dias. O pedido é a contagem do mês com clientes distintos, sem repetir cliente entre dias, em `core.indicador_diario` ou numa consulta equivalente, para o Início funcionar com o Vendedor desligado.
- **App percebe a base recriada e apaga o que não existe mais no servidor, depois do APK de 05/11** (T-0026, R-20261104-163228 do dono do produto; diagnóstico do banco-dados R-20261104-195551): engenheiro-software (contrato) + modulo-core (motor de sync) + modulo-vendedor. O "000011 repetido" do teste de campo é um pedido que ficou só no aparelho depois que a base demo foi recriada (migração para a Magalu): o servidor não repete número (contador por tenant e `pedido_numero_uk` desde a 0009). Proposta do banco-dados (R-20261104-195513): o login ou o pull expõem `plataforma.tenant.created_at` (ou um id de geração da base); se mudar, o app limpa a cópia local (avisando antes de perder a fila). Já feito: o seed `--recriar` guarda o contador (db/seeds/demo/demo.ts). Até lá: desinstalar o APK antigo (ou limpar os dados do app) antes de instalar o novo.
- **Pedidos: consulta ao servidor fora da janela de 90 dias (T-0077, item 6), depois do APK de 05/11**: modulo-vendedor. Hoje a tela mostra "Disponível com conexão" sem sinal e, com sinal, que a consulta ainda não está disponível; conferir se a rota de listagem aceita período.
- **Acabamento visual de Início, Cliente 360 e Pedidos, depois do APK de 05/11** (revisões de UX R-20261104-200432, 200745 e 201427): modulo-vendedor e modulo-core. Pedidos: destaque no número buscado (Y11); seletor Vendedor do Gestão com ▾ separado, fundo accentTint quando ativo e lista numa Folha com linhas de 52 dp e ✓ (G1–G3); chip ativo com 0 fica no lugar dele em vez de ir para o fim; "Hoje" do calendário só como texto; bordas mais fortes para leitura ao sol. Cliente 360: "Frequência" / "11 dias" como na referência. Teste de render da tela de Pedidos e do Cliente 360 (hoje só o domain cobre).
- Depois da demo: subir-demo.ps1 espera a API por 180 s em vez de 90 s (com a máquina carregada a API levou ~2 min e o script desistiu; engenheiro-software, R-20261103-065034)
