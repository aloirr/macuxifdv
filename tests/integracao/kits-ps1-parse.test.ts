/**
 * T-0174 — todo .ps1 dos kits de instalação (`modules/integracao/kit-*`, recursivo) tem de carregar no PowerShell.
 *
 * Origem: o `kit-thathyany/Instalar-Thathyany.ps1` 1.0.0 não rodava no Windows PowerShell 5.1 (erro de parse na linha
 * 243, `"Conector $versao: ..."`) e nenhum teste tinha carregado o script.
 *
 * Camada 1 (parser real): com `pwsh` no PATH (runner ubuntu-latest do GitHub), cada arquivo passa pelo
 * `[System.Management.Automation.Language.Parser]::ParseFile` e tem de dar zero erros. Sem pwsh, pula com aviso.
 * O pwsh do CI é o PowerShell 7; a gramática do parser é a mesma do 5.1 para estes erros, e a camada 2 cobre o caso
 * que motivou a tarefa mesmo sem pwsh.
 * Camada 2 (estática, roda sempre): `$nome:` inválido dentro de string de aspas duplas (tests/integracao/apoio/ps1-estatico.ts).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checarPs1 } from './apoio/ps1-estatico';

const RAIZ = join(__dirname, '..', '..');
const INTEGRACAO = join(RAIZ, 'modules', 'integracao');

function ps1DosKits(): string[] {
  const achados: string[] = [];
  const andar = (pasta: string): void => {
    for (const e of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') andar(caminho);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.ps1')) achados.push(caminho);
    }
  };
  for (const e of readdirSync(INTEGRACAO, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('kit-')) andar(join(INTEGRACAO, e.name));
  }
  return achados.sort();
}

const ARQUIVOS = ps1DosKits();
const rel = (f: string): string => relative(RAIZ, f).replaceAll('\\', '/');

const temPwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
  encoding: 'utf8',
}).status === 0;

// Lista de arquivos pela variável de ambiente (nunca interpolada no comando); saída: JSON com os erros de parse.
const SCRIPT_PARSE = `
$ErrorActionPreference = 'Stop'
$saida = foreach ($f in ($env:MACUXI_PS1_ARQUIVOS -split "\\n" | Where-Object { $_ })) {
  $erros = $null
  [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$erros) | Out-Null
  foreach ($e in $erros) {
    [pscustomobject]@{ arquivo = $f; linha = $e.Extent.StartLineNumber; coluna = $e.Extent.StartColumnNumber; mensagem = $e.Message }
  }
}
ConvertTo-Json -Compress -InputObject @($saida)
`;

interface ErroParse {
  arquivo: string;
  linha: number;
  coluna: number;
  mensagem: string;
}

describe('T-0174 — .ps1 dos kits (modules/integracao/kit-*) carregam no PowerShell', () => {
  it('descobre ao menos um .ps1 nos kits', () => {
    expect(ARQUIVOS.length, 'nenhum .ps1 achado em modules/integracao/kit-*/').toBeGreaterThan(0);
  });

  it.skipIf(!temPwsh)(
    `camada 1: parser real do PowerShell sem erros${temPwsh ? '' : ' (PULADO: pwsh não está no PATH; roda no CI ubuntu-latest)'}`,
    () => {
      const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_PARSE], {
        encoding: 'utf8',
        env: { ...process.env, MACUXI_PS1_ARQUIVOS: ARQUIVOS.join('\n') },
      });
      expect(r.status, `pwsh saiu com ${String(r.status)}: ${r.stderr}`).toBe(0);
      const erros = JSON.parse(r.stdout.trim() || '[]') as ErroParse[] | null;
      const lista = (erros ?? []).map((e) => `${rel(e.arquivo)}:${e.linha}:${e.coluna} — ${e.mensagem}`);
      expect(lista, `erros de parse:\n${lista.join('\n')}`).toEqual([]);
    },
  );

  it('camada 2: nenhum "$nome:" inválido em string de aspas duplas', () => {
    const lista = ARQUIVOS.flatMap((f) =>
      checarPs1(readFileSync(f, 'utf8')).map((a) => `${rel(f)}:${a.linha}:${a.coluna} — ${a.mensagem}`),
    );
    expect(lista, `achados:\n${lista.join('\n')}`).toEqual([]);
  });
});

describe('T-0174 — camada 2 com casos sintéticos', () => {
  it.each([
    ['"Versao $versao: ok"', 1],
    ['Aviso "Conector $versao: pede o 1.4.0"', 1],
    ['$t = @"\nlinha 1\nVersao $versao: ok\n"@', 1],
    ['"$(Get-Date) e $versao: ok"', 1],
    ['"fora $( "dentro $x: ruim" )"', 1],
    ['"$env: sem nome"', 1],
    ['"${versao}: ok"', 0],
    ['"$env:TEMP"', 0],
    ['"$script:Senha e $global:X e $using:Y"', 0],
    ['"$($x): ok"', 0],
    ["'$versao: ok'", 0],
    ["$t = @'\n$versao: ok\n'@", 0],
    ['"`$versao: ok"', 0],
    ['# "$versao: comentário"', 0],
    ['<# "$versao: bloco"\n "$a: b" #>', 0],
    ['"aspas ""$x"" ok" ; "$y"', 0],
    ['"C:\\temp\\$nome.txt"', 0],
  ])('%s → %i achado(s)', (fonte, esperados) => {
    expect(checarPs1(fonte)).toHaveLength(esperados);
  });

  it('acusa a linha certa', () => {
    const fonte = ['# cabeçalho', '$a = 1', 'Write-Host "ok $a"', 'Write-Host "Conector $versao: x"'].join('\r\n');
    expect(checarPs1(fonte)).toEqual([expect.objectContaining({ linha: 4, coluna: 22, trecho: '$versao:' })]);
  });
});
