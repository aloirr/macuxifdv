# ADR 0023 — Dependências do app fora da imagem da API (expo-sqlite × drizzle-orm)

- **Situação:** proposta (2026-11-05, engenheiro-software, T-0008; decisão do dono do produto no R-20261105-054146, item 1:
  "nem remendo, nem adiar")
- **Relacionadas:** ADR 0020 (imagem da API no GHCR), desenho T-0008 §3.1 (expo-sqlite com FTS no app), T-0074

## Contexto
A T-0008 precisa do `expo-sqlite` (~57.0.4) no `apps/mobile`. O `drizzle-orm` 0.45.4, dependência de produção do
`@macuxi/db` (lado servidor, driver `pg`), declara cerca de 30 peers **opcionais**, entre eles `expo-sqlite`.
O pnpm (12.11.2, `nodeLinker: hoisted`) liga um peer opcional à versão que existir em qualquer ponto do grafo do
workspace. Medido num lock gerado sem nenhuma correção: o snapshot virou
`drizzle-orm@0.45.4(@types/pg)(expo-sqlite@57.0.4(expo)(react-native)...)(pg)`, ou seja, o `@macuxi/db` passou a
depender de `expo-sqlite → expo → react-native`, e a imagem da API (`pnpm install --filter "api..." --filter "@macuxi/db..."`)
levaria o React Native.

Ao medir o fecho da imagem a partir do lock, apareceu um segundo vazamento, já existente no `main` antes do expo-sqlite:
o filtro instala também as **devDependencies** de todos os projetos selecionados, e os módulos (`modules/*`) declaram
`react-native`, `expo-router`, `next`, `react-native-svg` etc. como devDependencies (typecheck e testes das telas). O lock
do `main` (af6c368) já levava 991 pacotes à imagem, 97 deles `expo*`/`react-native*`/`@expo/*`/`@react-native/*`.
Com `--prod` o fecho cai para 180 pacotes, nenhum do app.

Primeira saída, de 05/11 madrugada: `.pnpmfile.cjs` com `readPackage` cortando todos os peers do drizzle exceto `pg`.
Funcionava, mas é código executado em toda instalação, muda o manifesto de um pacote de terceiro de forma invisível
no `package.json`/`pnpm-workspace.yaml` e esconde ~28 peers de uma vez.

## Decisão
1. **`overrides` no `pnpm-workspace.yaml`** (chave da plataforma, não é governança):
   ```yaml
   overrides:
     "drizzle-orm>expo-sqlite": "-"
   ```
   O `"-"` do pnpm retira a dependência (inclusive o peer) só daquele pai. Resultado no lock: o snapshot do drizzle volta a
   ser `drizzle-orm@0.45.4(@types/pg@8.23.1)(pg@8.23.1)`, igual ao do `main`; o `expo-sqlite` fica só no importer
   `apps/mobile`; a seção `overrides:` do lock registra a regra e o `--frozen-lockfile` a confere.
   O `.pnpmfile.cjs` foi **apagado**.
2. **Imagem da API com `--prod`** (`apps/api/Dockerfile`): `pnpm install --frozen-lockfile --prod --filter "api..." --filter "@macuxi/db..."`.
   O `tsx`, que roda API, worker e `db/scripts/banco.ts` na imagem (ADR 0020), passou de devDependency a dependency do
   `apps/api` (mesma versão, 4.23.15).
3. Regra para o futuro: pacote que roda no servidor e tem peer opcional de pacote do app (expo-*, react-native*,
   op-sqlite) ganha a linha `"<pacote>>{peer}": "-"` no mesmo bloco, com esta ADR citada; a imagem nunca instala
   devDependencies.

## Alternativas consideradas
- **`.pnpmfile.cjs` (`readPackage`)** — funciona, mas é hook imperativo, corta peers além do necessário e fica fora dos
  manifestos. Só seria aceitável se não houvesse saída declarativa; há.
- **`peerDependencyRules` (`ignoreMissing`, `allowAny`, `allowedVersions`)** — só silencia ou relaxa avisos de peer;
  não impede que o pnpm ligue o peer opcional. Não resolve.
- **`peerDependenciesMeta` / `packageExtensions`** — `packageExtensions` só acrescenta campos ao manifesto de terceiro,
  não retira; o peer já é opcional, marcá-lo de novo não muda nada.
- **`dependenciesMeta`** — só tem `injected` e opções de build; não atua em peers.
- **Isolar o app (lock próprio do `apps/mobile`, `sharedWorkspaceLockfile: false` ou workspace separado)** — resolve pela
  raiz, mas quebra o `workspace:*` do `@macuxi/ui`, dos módulos e do `@macuxi/platform-sdk` no app, duplica a árvore do
  React Native e exige mudar CI, EAS e o `nodeLinker`. Custo muito maior que o problema.
- **Isolar o drizzle da API (pacote à parte ou `pnpm deploy`)** — o drizzle já está só no `@macuxi/db`; o vazamento é da
  resolução de peer, não de quem importa. `pnpm deploy` geraria a mesma árvore com o mesmo lock.
- **Trocar o driver/ORM** (tirar o drizzle-orm do `@macuxi/db`, ficar só com `pg`) — o drizzle é usado hoje só no esquema
  `db/esquema/plataforma.ts` e no `drizzle-kit` de rascunho, então seria viável, mas é mudança de dono (banco-dados) e de
  ferramenta sem ganho além deste conflito, que o override resolve com uma linha. Fica registrada como saída se o drizzle
  passar a exigir algo que o override não cubra.

## Consequências
- Lock do `main` + T-0008: só entram `expo-sqlite@57.0.4` (app), `await-lock` (dependência dele), o bloco `overrides` e o
  `tsx` mudando de seção no `apps/api`. Nenhuma outra resolução mudou.
- Prova (lock e `pnpm why`, 05/11): `pnpm why expo-sqlite -r` → só `mobile`; `pnpm why drizzle-orm -r` → só `@macuxi/db`;
  `pnpm --filter api --filter @macuxi/db why expo --prod` e `... why react-native --prod` → vazios. Fecho de produção da
  imagem no lock: 209 pacotes, 0 do app. Instalação da imagem simulada fora do Docker (cópia do contexto de build,
  mesmo comando do Dockerfile): `node_modules` sem `expo*`, `react-native*`, `next` nem `vitest`, e todos os arquivos de
  entrada da API e dos seeds carregados com `node --import tsx` sem erro de módulo.
- A imagem fica menor e sem ferramentas de teste. Algo da API que dependa por engano de devDependency de módulo passa a
  falhar na subida da imagem, não em silêncio; o build da imagem roda no CI (`demo-publicar.yml`).
- Atualizar o drizzle-orm: conferir no lock se apareceu peer opcional novo do lado do app; o bloco `overrides` vale para
  qualquer versão.
