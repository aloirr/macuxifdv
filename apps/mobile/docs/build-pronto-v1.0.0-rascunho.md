# Rascunho — recado "BUILD PRONTO Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 (<sha>)"

> Dono: engenheiro-apps. Preencher os campos `<…>` depois do build e enviar com
> `node scripts/coord.mjs enviar --de engenheiro-apps --para alexandre --cc gerente-projetos --tipo entrega --tarefa T-0094 --assunto "BUILD PRONTO Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 (<sha curto>)" --arquivo <este texto preenchido, fora do repo>`
> (responde ao R-20261107-163525). Só gerar o build com o lote no main, o CI verde no sha exato e a demo publicada.

---

## Contexto
Build único pedido no R-20261107-163525 (item 4), com o nome do R-20261107-151653. Condições confirmadas pelo
gerente-projetos: T-0093 e T-0094 no main; CI do main verde no commit exato `<sha completo>` (run `<id>`, ci-ok);
"demo — publicar" verde nesse commit (run `<id>`).
- Os APKs saíram de um checkout limpo do `<sha curto>` (C:\macuxifdv-check, `pnpm install --frozen-lockfile` ok), não do
  working tree local.
- Antes do envio, o bundle das variantes campo e gestao ficou verde (`<n>` módulos).
- Gerados com `pnpm eas:build ambos demo` (perfis campo-preview e gestao-preview). A Expo registrou o commit
  `<sha curto>` nos dois builds.
- Nativo: `<igual ao d1e0d2a | mudou: …>` (package.json, app.config.ts, eas.json e lock desde o d1e0d2a).
- versionCode: Campo `<2>`, Gestão `<2>` (antes, 1 em todos os previews). Instala por cima.

## Links
- Campo-Demo-v1.0.0 (campo-preview), FINISHED em `<n>` min
  - APK: `<link>`
  - Página: `<link>`
- Gestao-Demo-v1.0.0 (gestao-preview), FINISHED em `<n>` min
  - APK: `<link>`
  - Página: `<link>`
- `<opcional: link temporário do bucket (72 h), se publicado com baixar-apk.mjs --publicar>`

## Base da demo
**Recrie antes de testar**: GitHub → Actions → "demo — recriar base demo" → Run workflow → `RECRIAR`. Entraram as
migrações 0039 a 0045 e o seed novo. A senha da demo continua `demo-macuxi`. Recrie antes do item A do roteiro.

## Roteiro
Roteiro único desde o e9a65286: `apps/mobile/docs/roteiro-campo-demo-v1.0.0.md` (itens 0 e A a J).
Resumo: 0 recriar a base e desinstalar; A passagem para o SQLite (5a1848a9 → fila offline → v1.0.0 por cima);
B login novo, "Crie sua senha" e "Esqueci a senha"; C perfis e multiperfil; D lista por linha, "Mostrar mais" e
miniatura; E Pedidos; F Novo pedido; G pedido em nome só da carteira (RN-VEN-35); H aviso da etapa pendente no Gestão
`<ou: fora deste build, motivo>`; I versão no Perfil; J medição com 20 mil (opcional).

## Pronto quando
Você devolver cada item (ok ou o passo que falhou, com o aparelho), as linhas do Diagnóstico do item A e, se rodar, o
relatório do item J. Eu encaminho cada falha ao dono da tela.
