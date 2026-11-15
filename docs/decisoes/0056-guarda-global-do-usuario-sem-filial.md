# ADR 0056 — Guarda global do usuário sem filial de cadastro

- **Status**: proposta em 2026-11-15 (branch `nuvem/filial-usuario-engenheiro-software`).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: T-0176, RN-CORE-39 revista (R-20261115-093000 e R-20261115-094500): todo usuário, de qualquer perfil, tem 1 filial
  de cadastro obrigatória; sem ela fica BLOQUEADO.
- **Quem implementa**: engenheiro-software (`packages/platform-sdk`, `apps/api`, esta ADR); modulo-core (preencher o estado e
  marcar as exceções, §4).

## Contexto
- O modulo-core (`nuvem/filial-usuario-modulo-core`, d3ac6d8) bloqueia só as rotas `/v1/core` (`comGuardaDeFilial`, uma consulta
  a mais por requisição). Sync, Catálogo, Vendedor, Promotor, Gestor e os demais módulos ficam abertos ao usuário bloqueado.
- A plataforma não lê tabela do Core (fronteira). O `autenticar` do Core já lê `core.usuario` pela chave primária a cada
  requisição (ativo, bloqueio, `sessao_versao`, perfil; RN-CORE-15, sem cache).

## Decisão
1. **Estado da sessão, não claim nem consulta.** `UsuarioAutenticado.sem_filial?: boolean` (SDK). O `autenticar` do Core o
   preenche na MESMA leitura do usuário (`filial_cadastro_id is null`): custo zero por requisição e efeito imediato (bloquear pela
   carga ou destravar pelo BKO vale na próxima requisição, sem esperar o refresh). Descartados: claim no JWT (vale até 15 min
   depois da mudança e exige refresh para destravar) e `core.filiais_do_usuario@1` por requisição (2ª transação e 2 SQL por
   chamada, só para um booleano). `AcessoPortalAutenticado.empresa.sem_filial?` cobre o admin do cliente pelo portal (ADR 0031).
   Super-admin não tem filial e não é afetado. Ausente = não informado = livre (compatível com o Core atual).
2. **Onde.** No `preparar` da API (`apps/api/src/app.ts`), logo depois de autenticar e antes das licenças: `acessoSemFilial` (SDK,
   função pura) devolve `livre`, `restrito` ou `bloqueado`; bloqueado = 403 `USUARIO_SEM_FILIAL` (`CODIGO_USUARIO_SEM_FILIAL`,
   SDK). Vale para toda rota de módulo, `me/modulos`, arquivos, auditoria, diagnósticos e sync.
3. **Exceções.**
   - Rotas públicas (login, refresh, logout, saúde): não passam pelo `preparar`.
   - Rota de módulo com `liberadaSemFilial: true`: só o Core declara (`definirModuloApi` recusa nos outros). Uso: `GET|PUT
     /v1/core/eu/filial-cadastro`.
   - **Sync:** `novidades` e `pull` só das entidades com `ProvedorSync.liberadoSemFilial: true` (só Core, só com `puxar`): a
     entidade `usuario`, que já traz `sem_filial`, `filial_cadastro_id` e `filial_venda_ids`. Restrito = carteira vazia e equipe =
     só o próprio, para o pull do `usuario` trazer só a linha dele. O marcador `sem_filial` entra no escopo do cursor das
     novidades: ao destravar, o aparelho recebe todas as entidades elegíveis e puxa tudo. O **push** responde 403 ao lote
     inteiro: nada é gravado e o motor do app mantém a fila pendente (pedido feito offline não se perde nem vira "falhou").
     Assim o app aberto e já logado descobre o bloqueio e o fim dele pelo próprio ciclo do sync, sem rota nova.
4. **Core (pedido por recado):** preencher `sem_filial` no `autenticar` (e no `autenticarPortal`, se for barato); marcar
   `liberadaSemFilial` nas duas rotas `eu/filial-cadastro` e `liberadoSemFilial` no provedor `usuario`; usar
   `CODIGO_USUARIO_SEM_FILIAL`/`MENSAGEM_USUARIO_SEM_FILIAL` do SDK; **remover `comGuardaDeFilial`** e
   `CAMINHOS_LIBERADOS_SEM_FILIAL` (redundantes: a guarda global cobre o Core, sem a consulta a mais).

## Consequências
- Uma regra, um lugar: nenhum módulo repete a guarda. Módulo novo já nasce coberto.
- Ordem de merge: este PR entra sozinho (campos opcionais, nada muda enquanto o Core não preenche). O Core (`nuvem/filial-usuario-
  modulo-core`, depois da 0077) passa a preencher e marcar; até então, a guarda fica inerte e o `comGuardaDeFilial` do branch
  dele segue valendo no `/v1/core`.
- O app trata 403 `USUARIO_SEM_FILIAL` em `me/modulos` e no push como "bloqueado" (tela de bloqueio), não como erro de sessão
  (engenheiro-apps).
