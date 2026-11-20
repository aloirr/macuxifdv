# ADR 0064 — Dependência nativa de PDF no app: `react-native-pdf` e `react-native-blob-util`

- **Status**: aceita em 2026-11-20.
- **Data**: 2026-11-20 (Manaus)
- **Tarefa**: T-0186 (Cliente 360 v2), parte do PDF cortada da v1.0.15 e levada à v1.0.16.
- **Autor**: engenheiro-software
- **Origem**: T-0186, P15 ("a Documentação é só para visualizar, sem baixar nem guardar no aparelho") e P17 ("a NF não fica guardada; o app busca no servidor ao tocar"). Revisão final da v1.0.16: 🟡 por dependência nativa sem ADR.
- **Código**: branch `nuvem/v1016-pdf-engenheiro-apps` (engenheiro-apps); lock em `nuvem/v1016-pdf-lock-engenheiro-software`.

## Contexto
A ficha do cliente (Cliente 360 v2) lista o PDF da NF, no Histórico, e os documentos do cliente em PDF, na Documentação. O usuário precisa abrir esses PDFs dentro do app, sem que o arquivo fique guardado no aparelho (P15 e P17).

Na v1.0.15 o visor da ficha abriu só imagens. Abrir PDF exigia uma biblioteca nativa nova e mudança no lock, o que punha o prazo em risco, e o PDF foi para a v1.0.16. O Android não desenha PDF numa tela do React Native sem um módulo nativo. O shell roda Expo `~57.0.0`, React Native `0.86.3` e React `19.2.3`, só com a nova arquitetura.

## Decisão
1. **Dependências** em `apps/mobile/package.json`, com versão fixa:
   - `react-native-pdf` `7.0.5`: desenha as páginas do PDF a partir de um arquivo local, com rolagem e zoom;
   - `react-native-blob-util` `1.1.1`: dependência par (peer) obrigatória do `react-native-pdf`.

   No lock entram também `crypto-js` `4.2.0` e `deprecated-react-native-prop-types` `2.3.0`, transitivas do `react-native-pdf`.
2. **De onde vem o PDF:** a porta `abrirArquivo` do Core, com `formato: 'pdf'`, abre a rota `/pdf` do shell (`app/pdf.tsx`). A tela baixa os bytes por `GET /v1/arquivos/<id>` (`baixarArquivoDoVisor`, `services/foto-pdv.ts`):
   - o download é o mesmo do visor de foto: token da sessão no cabeçalho (`ApiClient.bytes`, renova no 401), `no-store`, teto de 20 MB (`MAX_BYTES_VISOR`) e tempo limite de 30 s;
   - não há URL com token nem base64 na fonte do componente; os bytes ficam em memória;
   - só abre o que começa com a assinatura `%PDF` (`bytesDoPdfAceitos`).
3. **Arquivo temporário:** o `react-native-pdf` só desenha arquivo do disco. Por isso os bytes vão para um temporário na pasta de cache do app (`Paths.cache/visor-pdf/`), com nome próprio por abertura (`nomePdfTemporario`), e são apagados assim:
   - ao fechar a tela, inclusive quando o download termina depois de a tela fechar (`abrirPdfNaTela`);
   - a pasta inteira na abertura do app, para a sobra de um app encerrado com o visor aberto (`limparPdfsTemporarios`, `state/plataforma.tsx`);
   - a pasta inteira no logout e no bloqueio do aparelho, este pelo `apagarFotosLocais` (RN-CORE-15).
4. **Política de cache:** nenhuma.
   - A fonte do componente é `{ uri, cache: false }` (`fonteDoPdf`), o que desliga o cache próprio do `react-native-pdf`.
   - Não há download pelo `react-native-blob-util`: a fonte é sempre `file://` local, e ele entra só porque o `react-native-pdf` exige.
   - Nenhum PDF fica na pasta de documentos, na galeria nem nos Downloads, e nada do arquivo vai para o log.
5. **Offline:** sem sinal, o visor mostra "Sem internet" e não abre nada. O PDF nunca está no aparelho para ser aberto offline, e é isso que a P15 e a P17 pedem.

## Alternativas consideradas
- **WebView com PDF.js:** sem módulo nativo novo, mas leva o PDF.js (vários MB) para dentro do APK, exige passar os bytes para a WebView e desenha pior em aparelho fraco, com zoom e rolagem menos fluidos. Recusada.
- **Abrir por Intent em app externo** (leitor de PDF do Android): o arquivo sai do app e fica no outro app ou nos Downloads. Contraria a P15 e a P17. Recusada.
- **`expo-print` / `expo-sharing`:** servem para gerar e compartilhar PDF, não para exibir dentro do app. O compartilhamento entrega o arquivo a outro app, como o Intent. Recusada.
- **Renderização no servidor como imagem** (uma imagem por página, no visor de foto que já existe): sem dependência nativa, mas exige rasterizador de PDF na API (dependência pesada no servidor), multiplica o tráfego no 3G/4G e perde a nitidez no zoom. Recusada.

## Riscos
- **Módulo nativo:** exige prebuild e build Android novos. Não funciona no Expo Go nem num APK antigo por atualização OTA. O APK da v1.0.16 tem de sair do zero pelo `android-build.yml`.
- **Compatibilidade:** o `react-native-pdf` 7.x e o `react-native-blob-util` 1.x precisam compilar com o RN 0.86.3, só com a nova arquitetura (sem a ponte antiga), e com o Expo 57. A compatibilidade com a nova arquitetura passa pela camada de interoperabilidade do RN. Uma falha aparece só no build nativo ou na primeira abertura do PDF, e não no typecheck nem nos testes.
- **Manutenção do `react-native-blob-util`:** é mantido pela comunidade, com histórico de atraso nas versões novas do RN. Uma atualização do RN ou do Expo pode ficar presa a ele. Como não usamos nada dele diretamente, trocar de visor no futuro não muda nenhuma tela além de `components/visor-pdf.tsx`.
- **Tamanho do APK:** o `react-native-pdf` traz o renderizador nativo (PdfiumAndroid) para cada ABI. O aumento será medido no APK da v1.0.16.

## Validação
O build Android com as duas dependências será validado no APK da v1.0.16, gerado no próprio rito pelo workflow `android-build.yml` (`apps/mobile/docs/build-android.md`). O roteiro do testes abre o PDF da NF e de um documento, fecha, abre sem sinal e confere que a pasta `visor-pdf/` fica vazia depois de fechar, de reabrir o app e do logout. Se o build ou a abertura falhar, o "Ver PDF" sai da v1.0.16, como na v1.0.15, e esta ADR volta à revisão.

## Consequências
- O shell mobile passa a ter uma dependência nativa de visualização de PDF. Outro uso dela (outro módulo, outro tipo de arquivo) precisa passar pela porta `abrirArquivo` e manter a regra de não guardar.
- Toda atualização do RN ou do Expo confere as duas bibliotecas antes do build.
- A limpeza do temporário faz parte do logout e do bloqueio do aparelho (RN-CORE-15); quem mexer nesses fluxos mantém a chamada a `limparPdfsTemporarios`.
