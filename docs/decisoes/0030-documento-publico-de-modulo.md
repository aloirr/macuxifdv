# ADR 0030 — Documento público de módulo (`RotaPublica.cache`), fora do core em `/<modulo>/v1`

- **Status**: aceita (2026-11-07)
- **Data**: 2026-11-07
- **Tarefa**: T-0092 (pendência do PR #99, T-0087 N2); decisão R-20261106-073936
- **Autor**: engenheiro-software
- **Base**: ADR 0006 item 4 (só o core tem rotas públicas; esta ADR abre uma exceção estreita), ADR 0013 (rotas de Conector
  em `/<modulo>/v1`), ADR 0029 e T-0091 (conexão do portal)

## Contexto
O TI do cliente precisa baixar o OpenAPI 3.1 do Hub (`GET /integracao/v1/openapi.json`) sem login. O documento é gerado
dos contratos v1 e não tem dado de tenant. Pela ADR 0006 item 4, só o core declara rotas sem token. Por isso o #99 serviu
o documento numa rota do BKO com JWT (`GET /v1/integracao/openapi`).

## Decisão
1. `RotaPublica` ganha o campo opcional `cache: { maxAgeSegundos }` (aditivo). Com ele a API responde
   `Cache-Control: public, max-age=N`, um `ETag` forte (SHA-256 do corpo, com memo) e 304 sem corpo quando o `If-None-Match`
   bate (lista, `W/` e `*`). O tipo é sempre `application/json; charset=utf-8`, com `nosniff`.
2. Uma rota com `cache` só pode ser `GET`, sem corpo, com status 200, sem `conexao` e com `maxAgeSegundos` inteiro de 1 a
   86400. Ela não recebe cabeçalhos (`ctx.cabecalhos` vem vazio). O `ctx.banco` é a conexão padrão, mas o `comTenant` lança.
   A resposta vai para cache compartilhado e não pode depender de quem chama.
3. Fora do core, só existe rota pública com `cache`. Ela é montada em `/<modulo>/v1/<caminho>`, o espaço do módulo,
   ao lado das rotas de Conector, e nunca em `/v1`. Não passa por licença nem por token. O limite por IP continua
   obrigatório (429 `MUITAS_TENTATIVAS`). Se repetir o método e o caminho de uma rota de Conector do módulo, a subida falha.
4. O core mantém as rotas de login, que seguem como antes em `/v1`, e também pode usar o `cache`.
5. As regras ficam em `problemasRotaPublica` (platform-sdk), que roda no `definirModuloApi` e no `createApp`.

## Alternativas
- **Pôr o documento no core**: o core passaria a importar o gerador da Integração, o que fere a fronteira.
- **Rota de Conector sem chave**: a ADR 0013 exige a chave em toda rota de Conector, e abrir exceção ali é mais arriscado.
- **Arquivo estático no proxy/CDN**: exige outra etapa de deploy, e o documento se descola da versão da API em execução.
- **ETag calculado pelo módulo**: cada módulo faria o seu. A plataforma faz uma vez e testa.

## Consequências
- O `GET /integracao/v1/openapi.json` vira declaração do módulo, sem código de plataforma específico.
- A rota autenticada `GET /v1/integracao/openapi` pode sair quando a pública entrar (é do modulo-integracao).
- Outro documento público (ex.: termos) só entra assim: dado de tenant em rota pública continua proibido.
- Testes: `packages/platform-sdk/src/rota-publica-cache.test.ts` e `apps/api/test/rota-publica-documento.test.ts`.
