/**
 * Serviço Windows via WinSW (https://github.com/winsw/winsw).
 *
 * Por que WinSW e não node-windows: o WinSW é um executável único (.NET) que lê um XML; o Conector só GERA o XML e chama
 * `install`/`start`. Não há dependência nativa no pacote do Node, o XML fica versionável e auditável pelo técnico do cliente,
 * a política de reinício, a rotação do log do serviço e a conta de execução são configuração e não código, e a atualização
 * do Conector não exige recompilar módulo nativo. O node-windows embute o próprio WinSW e gera arquivos em `daemon/`, com
 * menos controle e uma dependência a mais para manter.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface OpcoesXml {
  id?: string;
  nome?: string;
  descricao?: string;
  /** Normalmente `process.execPath` (node.exe). */
  executavel: string;
  /** Argumentos já separados; são citados no XML. */
  argumentos: string[];
  diretorioTrabalho: string;
  pastaLogs: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const citar = (a: string) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function gerarXmlWinSW(o: OpcoesXml): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado por "conector instalar-servico". Pode ser editado; reinstale o serviço depois de mudar. Sem segredos neste arquivo. -->
<service>
  <id>${esc(o.id ?? 'MacuxiConector')}</id>
  <name>${esc(o.nome ?? 'Macuxi Conector')}</name>
  <description>${esc(o.descricao ?? 'Conector do Hub de Integração Macuxi: lê o ERP e envia os dados ao Hub (somente conexões de saída, HTTPS).')}</description>
  <executable>${esc(o.executavel)}</executable>
  <arguments>${esc(o.argumentos.map(citar).join(' '))}</arguments>
  <workingdirectory>${esc(o.diretorioTrabalho)}</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <priority>BelowNormal</priority>
  <stoptimeout>30 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <logpath>${esc(o.pastaLogs)}</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
</service>
`;
}

export type ExecutarComando = (cmd: string, args: string[]) => Promise<{ codigo: number; saida: string }>;

export const executarComandoReal: ExecutarComando = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let saida = '';
    p.stdout.on('data', (d: Buffer) => (saida += d.toString()));
    p.stderr.on('data', (d: Buffer) => (saida += d.toString()));
    p.on('error', reject);
    p.on('close', (c) => resolve({ codigo: c ?? 1, saida }));
  });

export interface OpcoesServico {
  /** Pasta onde ficam o WinSW e o XML (ex.: C:\ProgramData\Macuxi\Conector\servico). */
  pasta: string;
  /** WinSW-x64.exe baixado e conferido pelo técnico. */
  winsw?: string;
  caminhoConfig: string;
  /** Script do Conector (`process.argv[1]`). */
  script: string;
  executavel?: string;
  pastaLogs: string;
  plataforma?: string;
  somenteGerar?: boolean;
  executar?: ExecutarComando;
}

const NOME_EXE = 'macuxi-conector.exe';

export async function instalarServico(o: OpcoesServico): Promise<{ xml: string; exe: string; mensagens: string[] }> {
  const mensagens: string[] = [];
  const plataforma = o.plataforma ?? process.platform;
  mkdirSync(o.pasta, { recursive: true });
  const xmlTexto = gerarXmlWinSW({
    executavel: o.executavel ?? process.execPath,
    argumentos: [o.script, 'rodar', '--config', o.caminhoConfig],
    diretorioTrabalho: o.pasta,
    pastaLogs: o.pastaLogs,
  });
  const xml = join(o.pasta, 'macuxi-conector.xml');
  const exe = join(o.pasta, NOME_EXE);
  writeFileSync(xml, xmlTexto, 'utf8');
  mensagens.push(`XML do serviço gravado em ${xml}`);
  if (o.somenteGerar) return { xml, exe, mensagens };
  if (plataforma !== 'win32') throw new Error('Instalar o serviço só é possível no Windows. Use --somente-gerar para apenas gerar o XML.');
  if (!o.winsw || !existsSync(o.winsw)) throw new Error('Informe o executável do WinSW com --winsw <caminho> (veja docs/modulos/integracao/conector.md, passo "Serviço").');
  copyFileSync(o.winsw, exe);
  const exec = o.executar ?? executarComandoReal;
  for (const acao of ['install', 'start']) {
    const r = await exec(exe, [acao]);
    mensagens.push(`${NOME_EXE} ${acao}: ${r.codigo === 0 ? 'ok' : `falhou (código ${r.codigo}) ${r.saida.trim().slice(0, 200)}`}`);
    if (r.codigo !== 0 && acao === 'install') throw new Error(`WinSW install falhou: ${r.saida.trim().slice(0, 300)}`);
  }
  return { xml, exe, mensagens };
}

export async function desinstalarServico(o: { pasta: string; plataforma?: string; executar?: ExecutarComando }): Promise<string[]> {
  if ((o.plataforma ?? process.platform) !== 'win32') throw new Error('Desinstalar o serviço só é possível no Windows.');
  const exe = join(o.pasta, NOME_EXE);
  if (!existsSync(exe)) throw new Error(`Serviço não encontrado em ${o.pasta} (falta ${NOME_EXE}).`);
  const exec = o.executar ?? executarComandoReal;
  const saidas: string[] = [];
  for (const acao of ['stop', 'uninstall']) {
    const r = await exec(exe, [acao]);
    saidas.push(`${NOME_EXE} ${acao}: ${r.codigo === 0 ? 'ok' : `código ${r.codigo}`}`);
  }
  return saidas;
}
