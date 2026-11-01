/**
 * Segredos (senha do banco do ERP, token do Hub) ficam FORA do arquivo de configuração e nunca vão para log.
 * Provedores:
 *  - `env`: variável de ambiente `MACUXI_CONECTOR_<NOME>` (ex.: MACUXI_CONECTOR_ERP_SENHA, MACUXI_CONECTOR_HUB_CHAVE);
 *  - `windows`: Windows Credential Manager (credencial genérica `Macuxi.Conector/<nome>`), lida e gravada por
 *    PowerShell com P/Invoke de advapi32 (CredRead/CredWrite). Sem módulo nativo do Node. A credencial é do USUÁRIO
 *    sob o qual o serviço roda; por isso o serviço deve rodar com a mesma conta que gravou o segredo;
 *  - `auto` (padrão): `env` primeiro; no Windows, depois o Credential Manager.
 * Todo segredo lido é registrado na máscara de log.
 */
import { spawn } from 'node:child_process';
import { registrarSegredo } from '../log/mascara';

/** `hub_chave` = chave de API deste Conector (uma por Conector, escopo só `/integracao/v1`; rotacionável com `conector trocar-chave`). */
export const NOMES_SEGREDO = ['erp_senha', 'hub_chave'] as const;
export type NomeSegredo = (typeof NOMES_SEGREDO)[number];

export interface ProvedorSegredos {
  readonly nome: string;
  obter(nome: string): Promise<string | undefined>;
  definir?(nome: string, valor: string): Promise<void>;
}

export const nomeVariavel = (nome: string, prefixo = 'MACUXI_CONECTOR_') => `${prefixo}${nome.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export class ProvedorEnv implements ProvedorSegredos {
  readonly nome = 'env';
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly prefixo = 'MACUXI_CONECTOR_') {}
  async obter(nome: string): Promise<string | undefined> {
    const v = this.env[nomeVariavel(nome, this.prefixo)];
    return v === undefined || v === '' ? undefined : v;
  }
}

/** Executa um script PowerShell (via -EncodedCommand) e devolve stdout; o valor sensível vai por stdin, nunca por argumento. */
export type ExecutarPowerShell = (script: string, entrada?: string) => Promise<{ codigo: number; saida: string; erro: string }>;

/** Tempo máximo de uma chamada ao PowerShell; passado disso o processo é encerrado e a leitura falha com mensagem clara. */
export const TIMEOUT_POWERSHELL_MS = 10_000;

export const executarPowerShellReal: ExecutarPowerShell = (script, entrada) =>
  new Promise((resolve, reject) => {
    const codificado = Buffer.from(script, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado], {
      windowsHide: true,
    });
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => {
      p.kill();
      reject(new Error(`O PowerShell não respondeu em ${TIMEOUT_POWERSHELL_MS / 1000} s ao acessar o Gerenciador de Credenciais do Windows. Use o provedor "env" (variável de ambiente) ou tente de novo.`));
    }, TIMEOUT_POWERSHELL_MS);
    p.stdout.on('data', (d: Buffer) => (saida += d.toString('utf8')));
    p.stderr.on('data', (d: Buffer) => (erro += d.toString('utf8')));
    p.on('error', (e) => {
      clearTimeout(relogio);
      reject(e);
    });
    p.on('close', (codigo) => {
      clearTimeout(relogio);
      resolve({ codigo: codigo ?? 1, saida, erro });
    });
    p.stdin.end(entrada ?? '');
  });

const PREFIXO_ALVO = 'Macuxi.Conector/';

const CABECALHO_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MacuxiCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL cred, uint flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Ler(string alvo) {
    IntPtr p;
    if (!CredRead(alvo, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
  public static void Gravar(string alvo, string valor) {
    byte[] b = Encoding.Unicode.GetBytes(valor);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = alvo; c.UserName = "macuxi-conector"; c.Persist = 2;
    c.CredentialBlobSize = (uint)b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length);
    Marshal.Copy(b, 0, c.CredentialBlob, b.Length);
    try { if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
}
"@
`;

const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function scriptLerCredencial(alvo: string): string {
  return `${CABECALHO_PS}\n$v = [MacuxiCred]::Ler(${aspas(alvo)})\nif ($null -eq $v) { exit 3 }\n[Console]::Out.Write($v)`;
}
export function scriptGravarCredencial(alvo: string): string {
  return `${CABECALHO_PS}\n$v = [Console]::In.ReadToEnd()\n[MacuxiCred]::Gravar(${aspas(alvo)}, $v.TrimEnd("\`r","\`n"))`;
}

export class ProvedorWindows implements ProvedorSegredos {
  readonly nome = 'windows';
  constructor(private readonly executar: ExecutarPowerShell = executarPowerShellReal) {}

  async obter(nome: string): Promise<string | undefined> {
    const r = await this.executar(scriptLerCredencial(PREFIXO_ALVO + nome));
    if (r.codigo === 3) return undefined;
    if (r.codigo !== 0) throw new Error(`Não foi possível ler a credencial "${nome}" do Gerenciador de Credenciais do Windows (código ${r.codigo}).`);
    return r.saida === '' ? undefined : r.saida;
  }

  async definir(nome: string, valor: string): Promise<void> {
    const r = await this.executar(scriptGravarCredencial(PREFIXO_ALVO + nome), valor);
    if (r.codigo !== 0) throw new Error(`Não foi possível gravar a credencial "${nome}" no Gerenciador de Credenciais do Windows (código ${r.codigo}).`);
  }
}

export type ModoProvedor = 'env' | 'windows' | 'auto';

export function criarProvedor(modo: ModoProvedor, opcoes: { env?: NodeJS.ProcessEnv; plataforma?: string; executar?: ExecutarPowerShell } = {}): ProvedorSegredos {
  const env = new ProvedorEnv(opcoes.env);
  const windows = new ProvedorWindows(opcoes.executar);
  const ehWindows = (opcoes.plataforma ?? process.platform) === 'win32';
  if (modo === 'env') return env;
  if (modo === 'windows') return windows;
  return {
    nome: 'auto',
    async obter(nome) {
      const v = await env.obter(nome);
      if (v !== undefined || !ehWindows) return v;
      return windows.obter(nome);
    },
    definir: (nome, valor) => (ehWindows ? windows.definir(nome, valor) : Promise.reject(new Error('Gravar segredo só é possível no Windows; em outros sistemas use variável de ambiente.'))),
  };
}

/** Lê o segredo (com cache curto: uma rotação de credencial vale sem reiniciar o serviço) e o registra na máscara de log. */
export class Segredos {
  private cache = new Map<string, { valor: string | undefined; ate: number }>();
  constructor(private readonly provedor: ProvedorSegredos, private readonly ttlMs = 60_000, private readonly agora: () => number = Date.now) {}

  async obter(nome: NomeSegredo): Promise<string | undefined> {
    const c = this.cache.get(nome);
    if (c && c.ate > this.agora()) return c.valor;
    const valor = await this.provedor.obter(nome);
    registrarSegredo(valor);
    this.cache.set(nome, { valor, ate: this.agora() + this.ttlMs });
    return valor;
  }

  async exigir(nome: NomeSegredo): Promise<string> {
    const v = await this.obter(nome);
    if (v === undefined) {
      throw new Error(
        `Segredo "${nome}" não encontrado. Defina a variável de ambiente ${nomeVariavel(nome)} ou grave no Gerenciador de Credenciais: conector segredo definir ${nome}.`,
      );
    }
    return v;
  }

  invalidar(): void {
    this.cache.clear();
  }
}
