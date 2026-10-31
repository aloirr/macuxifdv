# ADR 0008 — Erro HTTP de módulo, sessão real nos shells (com modo demonstração) e câmera no app

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0003 Fase 2 (pedido R-20261031-121740-modulo-core) e T-0004
- **Autor**: engenheiro-software

## Contexto
A Fase 2 do Core trouxe o login real (código da empresa + e-mail + senha, JWT de 15 min, refresh rotativo, bloqueio 423) e a
tela de licenças do BKO. Faltavam na plataforma: (1) um erro de módulo com status próprio — o SDK só tinha `ErroRegraNegocio`
(422) e `ErroNaoEncontrado` (404), então 401/423/503 do login saíam 422; (2) as dependências entre módulos no contexto da rota
para o aviso da RN-CORE-03 sem o Core importar manifesto alheio; (3) o shell usar o login real sem quebrar a demonstração com o
mock-api; (4) a câmera para a foto da fachada (RN-CORE-14) sem o módulo importar biblioteca de aparelho.

## Decisão
1. **`ErroHttpModulo(status, codigo, mensagem, detalhes?)`** no `@macuxi/platform-sdk`, com status restrito a
   401/403/404/409/410/422/423/503 (`StatusErroModulo`; outro status lança no construtor). `ErroRegraNegocio` (422) e
   `ErroNaoEncontrado` (404) viram subclasses — compatível com todo código existente. O `createApp` responde `erro.status`
   com `{ codigo, mensagem, detalhes? }` em rota autenticada e pública. 400 (Zod), 429 (limite) e 500 continuam só da
   plataforma. No push do sync, `ErroHttpModulo` 4xx rejeita os itens; 5xx faz o motor tentar de novo.
2. **`ContextoBase.dependencias`** (`DependenciasModulos`): módulo → `depende` de todos os manifestos instalados, montado uma
   vez no `createApp` (`dependenciasDosManifestos`). Só leitura.
3. **Segredo do JWT** (`MACUXI_JWT_SEGREDO`, ≥ 32 caracteres) conferido na subida (`apps/api/src/config.ts`): fora do ambiente
   local (NODE_ENV=production ou Postgres fora da máquina/container local) a API **não sobe** sem ele; no local sobe com aviso
   e o login responde 503.
4. **Shells com login real por padrão; demonstração atrás de configuração**: `EXPO_PUBLIC_API_MODO=demo` (app) e
   `NEXT_PUBLIC_API_MODO=demo` (BKO) voltam ao mock-api da Fase M (porta 8000, login fake, sync da Fase M). Sem a variável:
   API real (porta 8100), `TelaLogin`/`entrarComSenha` do Core no app, formulário equivalente no BKO, sync v1.
   - Perfil fora do app (ex.: promotor no BKO, supervisor no Campo — doc 03): a sessão recém-criada é encerrada no servidor e
     o usuário recebe o app certo (`mensagemPerfilForaDoApp` no SDK).
   - **App**: tokens no `expo-secure-store` (Keystore), nunca no AsyncStorage; 401 troca o acesso pelo refresh uma vez
     (troca única em voo) e repete; refresh recusado encerra a sessão sem apagar a fila; 401 no push é retentável (o item não
     é rejeitado por sessão vencida). UUID do aparelho gerado uma vez e enviado no login (bloqueio remoto de aparelho).
   - **BKO**: todas as chamadas da API real passam pelo proxy same-origin do Next (`/api-proxy`), sem CORS na API; o refresh
     fica no `localStorage` e renova o acesso num 401.
5. **Câmera**: o shell mobile registra `definirCapturaFoto` do Core com `expo-image-picker` (só câmera, sem galeria e sem
   microfone), reduz para 1600 px no maior lado e JPEG 80 (`expo-image-manipulator`, mesma regra da RN-PES-06) e grava em
   `<documentos>/fotos/<uuid>.jpg` (`expo-file-system`). O módulo recebe só o UUID. Bibliotecas oficiais do Expo SDK 57, leves.

## Alternativas consideradas
- **Status livre no erro de módulo** (`number`): permitiria 500/400 vindos do módulo, misturando erro de plataforma e de
  negócio; a lista fechada documenta o contrato.
- **`statusPretendido` no erro interino do Core**: resolvia só o Core e deixava cada módulo inventar o seu.
- **CORS (`@fastify/cors`) na API para o BKO**: nova dependência e lista de origens por ambiente; o proxy same-origin já
  existia no Next e também evita expor a API a outras origens.
- **Refresh em cookie httpOnly no BKO**: mais seguro contra XSS, mas exige rotas de cookie e CSRF na API — fica para a
  Sprint 1 (pendência registrada).
- **Remover o login de demonstração**: quebraria a demonstração com o Excel (Fase M) enquanto os módulos não têm rotas reais.

## Consequências
- Core troca o erro interino (`modules/core/api/erros.ts`) por `ErroHttpModulo` e o cast de `dependencias` por
  `ctx.dependencias`. Vendedor troca `PEDIDO_NAO_ENCONTRADO` de 422 para `ErroNaoEncontrado` (404).
- Quem roda a demonstração precisa da variável `*_API_MODO=demo`; quem roda a API real precisa de `MACUXI_JWT_SEGREDO` no
  `.env` (apontador em `db/.env.example`, a pedido do Alexandre).
- Telas de módulo que ainda chamam rotas da Fase M (`/me`, `/customers`…) ficam vazias/erro na API real até os módulos
  ganharem rotas v1 — a demonstração continua no modo demo.
- Pendências: refresh do BKO em cookie httpOnly; `trustProxy` no Fastify quando a API ficar atrás de proxy (o limite de login
  por IP passa a ver o IP real); envio das fotos ao servidor (Sprint 1).
