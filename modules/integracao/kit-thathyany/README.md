# Kit da thathyany — notas de quem mantém o kit

O roteiro de instalação para a empresa é o `ROTEIRO.md`. Este arquivo explica os scripts do kit para o time (não vai no zip).

## Conversor dos CSVs 1.0.5 para o modelo atual

O kit 1.0.6 acrescentou ao `produto.csv` o código da marca de cada referência cruzada (`marca_referencia_codigo_1` a `_3`; R-20261115-094000-alexandre). O conversor leva os CSVs que a empresa preparou no modelo 1.0.5 para o modelo atual:

```
pnpm --filter @macuxi/integracao exec tsx kit-thathyany/scripts/migrar-csv-1.0.5.ts --entrada <pasta com os CSVs 1.0.5> --saida <pasta fora do repositório> [--zip]
```

- Cada `<entidade>.csv` sai em `<saida>/csv/` com o cabeçalho de `modelos/<entidade>.csv`. As colunas que existem nos dois modelos são copiadas sem mudança. Coluna nova sai vazia, e vazio quer dizer que o Macuxi não altera o campo.
- Se a entrada tiver uma coluna que o modelo atual não tem, ou um arquivo sem modelo, o conversor para com erro.
- Com `--zip`, gera também `macuxi-kit-thathyany-<versão>.zip` (o kit inteiro mais `csv/`) e o `.sha256`.
- O script mostra só contagens. Os CSVs têm dados da empresa e nunca entram no repositório.

### Código da marca da referência que a base não traz

A regra é `domain/marca-referencia-codigo.ts` (RN-CAT-09). Ela vale para cada referência que tem o nome da marca (`marca_referencia_N`) e não tem o código (`marca_referencia_codigo_N`):

1. **O ERP já tem o código dessa marca na base.** Pode estar no `marca_codigo` de um produto ou no código de outra referência com o mesmo nome. Nesse caso, a referência usa esse código. Se houver mais de um, usa o menor, e o resultado não depende da ordem das linhas.
2. **Nenhum código na base.** O código é gerado a partir do nome: `MXN-` mais os 8 primeiros caracteres hexadecimais, em maiúsculas, do SHA-256 do nome normalizado. O mesmo nome sempre gera o mesmo código.

O nome normalizado fica sem acentos, em maiúsculas e sem espaços nas pontas, e cada sequência de espaços vira um espaço só. Por isso "Marca Beta", " marca  beta " e "MARCA BETA" geram o mesmo código.

O prefixo `MXN-` separa o código gerado dos códigos do ERP. Se o ERP passar a mandar o código da marca, troque o `MXN-...` da marca pelo código do ERP no BKO (Catálogo → Marcas).

Uma referência sem o nome da marca fica só com o código dela.
