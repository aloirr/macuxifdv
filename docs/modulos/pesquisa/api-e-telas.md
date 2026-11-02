# Pesquisa — API, sync e telas (T-0057)

Fatia vertical do módulo sobre o domain da T-0012 (`regras.md`): rotas `/v1/pesquisa`, sync do aparelho, telas do app
(Campo e Gestão) e páginas do BKO. Regra de negócio só no `domain` (teste antes, citando RN); a API revalida tudo.

## Dados: repositório em memória até a migração 0016
As rotas e o sync falam só com `RepositorioPesquisa` (`modules/pesquisa/api/repositorio.ts`). Hoje a implementação é
`criarRepositorioEmMemoria()` (por tenant, `updated_at` crescente com microssegundos para o cursor do pull): **os dados
ficam no processo da API e somem ao reiniciar**. Quando a migração 0016 (schema `pesquisa`) chegar ao `main`, entra a
implementação SQL com os mesmos métodos (`db` do `ctx.comTenant`, RLS) e `moduloApi` passa a usá-la — sem mudar rota,
tela nem teste. O pedido ao banco-dados (tabelas, colunas, índices, consultas) está no recado da T-0057.

Eventos, auditoria e arquivos já são reais: `tx.publicar`, `tx.auditar` e `tx.registrarArquivo` gravam na transação do
tenant (`plataforma.*`).

## Rotas (`/v1/pesquisa`)
| Método e caminho | Permissão | Carteira | O que faz |
|---|---|---|---|
| `GET questionarios` | perfis supervisor, gerente, analista, admin | não se aplica | Lista com `?situacao=` e `?q=` (resumo da vigente; arquivado vence) |
| `GET questionarios/:id` | idem | não se aplica | Cabeçalho, versões e validação do rascunho aberto |
| `POST questionarios` | `questionario.criar` | não se aplica | Cria com a v1 em rascunho; mesmo `id` de novo devolve o existente; auditado |
| `PUT questionarios/:id/rascunho` | `questionario.editar` | não se aplica | Salva o rascunho; sem rascunho abre a próxima versão (`iniciarEdicao`); 422 `RASCUNHO_INVALIDO`/`QUESTIONARIO_ARQUIVADO` |
| `POST questionarios/:id/publicar` | `questionario.publicar` | não se aplica | `publicarVersao` + auditoria `questionario.publicar` (RN-AUD-01); 422 `VERSAO_INVALIDA` com `detalhes.problemas`; 409 `SEM_RASCUNHO` |
| `POST questionarios/:id/arquivar` | `questionario.arquivar` | não se aplica | Arquiva (idempotente, auditado); as versões descem de novo ao aparelho com `arquivado_em` |
| `GET questionarios/:id/resultado` | `resultado.ver` | filtrar no domínio | `?versao=` → apuração da versão; sem versão → consolidado entre versões (RN-PES-01). `?de=&ate=` (dia civil do fuso do tenant), `?equipes=a,b` |
| `GET questionarios/:id/respostas` | `resultado.ver` | filtrar no domínio | Até 500 respostas mais recentes (texto aberto e conferência) |
| `GET questionarios/:id/galeria` | `resultado.ver` | filtrar no domínio | Fotos (id, pergunta, cliente, hora); o binário é `GET /v1/arquivos/:id` (ADR 0010) |
| `GET questionarios/:id/exportar` | `resultado.exportar` | filtrar no domínio | `{ nome_arquivo, tipo: 'text/csv', conteudo }` — UTF-8 com BOM e `;`, uma coluna por pergunta (id estável), fórmulas neutralizadas |

Escopo dos resultados (RN-CORE-04): `respostasNoEscopo(respostas, ctx.usuariosVisiveis())` — supervisor/gerente veem só
os usuários visíveis (a equipe); analista/admin, o tenant. Erros do domain viram 422 com o código do domain e
`detalhes.rn`.

## Sync (ADR 0009)
| Entidade | Direção | Escopo | Linha |
|---|---|---|---|
| `questionario_versao` | pull | tenant | `QuestionarioVersaoSync`: só versões **publicadas**, com perguntas/regras/público aninhados e o `arquivado_em` do questionário |
| `resposta_pesquisa` | push + pull | carteira (+ as próprias) | Push: `RespostaEnvio` (só inserção). Pull: `RespostaPesquisaSync` (resumo, sem o conteúdo) para a frequência por cliente e o checkout |

Recebimento (`receberResposta` no domain + `api/sync.ts`), item a item, cada um na sua transação: `remover` → `SOMENTE_INSERCAO`;
perfil que não responde → `PERFIL_SEM_ACESSO`; cliente fora da carteira → `FORA_DA_CARTEIRA`; questionário inexistente no
tenant → `QUESTIONARIO_INEXISTENTE`; mesmo id e mesmo conteúdo → `aceito` sem evento novo; mesmo id e conteúdo diferente →
`conflito` (nunca sobrescreve); versão inexistente/rascunho, perfil fora do público da versão ou resposta inválida → rejeitado
com o código do domain; relógio adiantado ou fora da vigência → **aceita com suspeita** (RN-PES-04). Aceita: grava, liga cada
foto (`registrarArquivo`, finalidade `pesquisa_foto`) e publica `pesquisa.resposta.registrada@1` na mesma transação.

`questionario` e `pergunta` continuam no `sync` do manifesto sem provedor próprio (viajam dentro da linha da versão).

## App (Campo e Gestão; `modules/pesquisa/app`)
- **Aba "Pesquisas"** (`/m/pesquisas`, ação `pesquisa.responder`): avulsas aplicáveis agora (`ofertaDePesquisas`: público,
  vigência, frequência); as que pedem cliente ou já foram respondidas no período aparecem como indisponíveis, com a data
  em que voltam. Banner com as respostas na fila.
- **Responder** (`/m/responder-pesquisa?questionario=&cliente=&visita=`): os nove tipos, regras condicionais aplicadas na
  hora (`camposVisiveis`), rascunho salvo a cada toque em `mod:pesquisa:rascunho:<questionario>:<visita|cliente|avulsa>`,
  envio validado no aparelho (`prepararEnvio`) para a fila do motor; fotos vão para a fila de arquivos. A versão fica fixa
  enquanto o formulário está aberto (RN-PES-01).
- **Etapa do checkout** (`visita.etapas_checkout`, obrigatória): lista as obrigatórias da visita (pendente / respondida /
  dispensada). `concluida()` usa o retrato local em memória + a fila do motor (resposta offline já libera); **sem retrato
  carregado fica pendente** (falha fechada); cliente fechado dispensa (RN-CORE-14).
- **Ficha do cliente** (`cliente.abas`) e **card no Início** (`inicio.cards`, também aquece o retrato local).
- **Foto**: o módulo não tem câmera. O shell registra a captura com `definirCapturaFotoPesquisa` (exportado de
  `@macuxi/pesquisa/app`), devolvendo o UUID da foto gravada em `fotos/<uuid>.jpg` (1600 px, JPEG 80). Sem captura
  registrada, a pergunta de foto orienta a atualizar o app.

## BKO (`modules/pesquisa/web`)
- **Pesquisas** (`/pesquisas`, menu): lista com filtros na URL, criação (analista/admin), atalhos para construtor e resultados.
- **Questionário** (`/pesquisa?id=`): construtor do rascunho — configuração (título, descrição, modo, frequência, vigência
  em dias do fuso do tenant, fim inclusivo), público (perfis, segmentos, regiões, equipes e clientes por id), perguntas dos
  nove tipos com opções e limites, regras "mostrar/ocultar se…" só sobre perguntas anteriores; salvar, publicar, arquivar,
  "Editar" (abre a próxima versão) e histórico. Sem `questionario.editar`, tudo em leitura.
- **Resultados** (`/pesquisa-resultados?id=&de=&ate=&versao=`): indicadores (respostas, respondentes, taxa, suspeitas),
  gráfico por pergunta, textos, galeria (fotos pela API de arquivos com a sessão) e exportação CSV.

## Premissas da T-0057
1. **Equipe do usuário**: nem a API nem o aparelho recebem hoje a equipe do usuário. A resposta grava `equipe_id = null` e,
   no aparelho, `equipe_ids = []` — pesquisa com público por **equipe** não aparece para ninguém até o Core oferecer a
   consulta/linha (recado ao modulo-core). O filtro de equipe nos resultados fica pronto (`?equipes=`), sem efeito até lá.
2. **Região do cliente**: o `cliente` do Core não tem região; o público por região não casa no aparelho até o Core ter o campo.
3. **Taxa de resposta**: sem o universo do público (usuários/clientes) vindo do Core, a taxa sai `null` ("—" na tela).
4. **Repositório em memória** na API até a migração 0016 (dados somem ao reiniciar).
5. **Servidor revalida** perfil, versão e conteúdo; o público por equipe/segmento/região é checado só no aparelho (o
   servidor não tem esses dados ainda).
6. **Resultados no app de Gestão** ficam fora (RF-PES-06 é do BKO 🖥️); a Gestão responde pesquisas como o Campo.
7. Dependências de tela (`react`, `react-native`, `expo-router`, `@tanstack/react-query`, `@macuxi/ui`) resolvem pelo
   `node_modules` achatado (`nodeLinker: hoisted`); declarar no `package.json` do módulo depende do lockfile
   (engenheiro-software).
