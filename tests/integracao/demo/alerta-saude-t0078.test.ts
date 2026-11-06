/**
 * T-0078 critério 4 — o alerta simples da VM (scripts/deploy/demo/alerta-saude.sh) faz o que o desenho promete
 * (docs/desenho/T-0078.md §1): lê o `/v1/saude`, classifica em ok / alerta (com os códigos) / fora e só avisa (syslog e
 * webhook) quando o estado MUDA. O script roda de verdade no bash, contra um servidor HTTP local que faz o papel da API
 * e do webhook; nada vai à VM (a URL é sempre 127.0.0.1 de uma porta livre) e os arquivos de estado e de env ficam numa
 * pasta temporária. Sem bash no PATH (Windows sem Git Bash), o arquivo pula; no CI (ubuntu) roda sempre.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto.
 */
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/deploy/demo/alerta-saude.sh', import.meta.url)).replace(/\\/g, '/');
const temBash = spawnSync('bash', ['-c', 'command -v curl'], { encoding: 'utf8' }).status === 0;
/** Folga de execução (não é medida): no Windows carregado cada bash+curl leva segundos. */
const TETO_SCRIPT_MS = 120_000;
const TETO_CASO_MS = 600_000;

const SAUDE_OK = { ok: true, servico: 'macuxi-api', dependencias: { banco: 'ok', outbox: { pendentes: 0, parados: 0, mais_antigo_s: null } }, metricas: { janela_min: 15, requisicoes: 3, erros_4xx: 0, erros_5xx: 0 }, alertas: [] };
const SAUDE_5XX = { ...SAUDE_OK, metricas: { ...SAUDE_OK.metricas, erros_5xx: 7 }, alertas: ['ERROS_5XX'] };
const SAUDE_OUTBOX = { ...SAUDE_OK, dependencias: { banco: 'ok', outbox: { pendentes: 9, parados: 1, mais_antigo_s: 900 } }, alertas: ['OUTBOX_ATRASADA', 'OUTBOX_PARADA'] };

describe.skipIf(!temBash)('T-0078 critério 4 — alerta-saude.sh: estado ok/alerta/fora, aviso só na mudança', () => {
  let servidor: Server;
  let base: string;
  let pasta: string;
  /** O que a "API" responde agora (null = 503). */
  let saude: unknown = SAUDE_OK;
  const avisos: string[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/saude') {
        if (saude === null) {
          res.writeHead(503).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(saude));
        return;
      }
      if (req.method === 'POST' && req.url === '/webhook') {
        let corpo = '';
        req.on('data', (d) => (corpo += String(d)));
        req.on('end', () => {
          avisos.push(corpo);
          res.writeHead(200).end('ok');
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    pasta = mkdtempSync(join(tmpdir(), 'macuxi-alerta-')).replace(/\\/g, '/');
    writeFileSync(join(pasta, 'alerta.env'), `MACUXI_ALERTA_WEBHOOK=${base}/webhook\n`);
  }, TETO_CASO_MS);
  afterAll(async () => {
    await new Promise<void>((r) => servidor?.close(() => r()));
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  }, TETO_CASO_MS);

  /** Roda o script (assíncrono: o servidor HTTP está neste processo). */
  function rodar(args: string[] = []): Promise<{ codigo: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        'bash',
        [SCRIPT, ...args],
        { env: { ...process.env, MACUXI_SAUDE_URL: `${base}/v1/saude`, MACUXI_ALERTA_ESTADO: `${pasta}/estado`, MACUXI_ALERTA_ENV: `${pasta}/alerta.env` }, timeout: TETO_SCRIPT_MS },
        (erro, stdout, stderr) => resolve({ codigo: erro ? Number((erro as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: `${String(stderr)}${erro?.signal ? ` [sinal ${erro.signal}]` : ""}` }),
      );
    });
  }
  const estado = () => (existsSync(`${pasta}/estado`) ? readFileSync(`${pasta}/estado`, 'utf8') : null);

  it('--mostrar: imprime o estado e o corpo, sem gravar estado nem avisar', async () => {
    const r = await rodar(['--mostrar']);
    expect(r.codigo, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^estado=ok sem alertas/);
    expect(r.stdout).toContain('"alertas":[]');
    expect(estado()).toBeNull();
    expect(avisos).toEqual([]);
  }, TETO_CASO_MS);

  it('transições desconhecido→ok→alerta(5xx)→alerta(outbox)→fora→ok: um aviso por mudança, com os códigos; repetição não avisa', async () => {
    const passos: { saude: unknown; estado: string; avisa: RegExp | null }[] = [
      { saude: SAUDE_OK, estado: 'ok', avisa: /desconhecido -> ok \(sem alertas\)/ },
      { saude: SAUDE_OK, estado: 'ok', avisa: null },
      { saude: SAUDE_5XX, estado: 'alerta', avisa: /ok -> alerta \("alertas":\["ERROS_5XX"\]\)/ },
      { saude: SAUDE_5XX, estado: 'alerta', avisa: null },
      // mesmo estado "alerta" com outros códigos: o script compara só o estado (não repete a cada 5 min)
      { saude: SAUDE_OUTBOX, estado: 'alerta', avisa: null },
      // `n\S{0,3}o`: no Git Bash do Windows o curl recebe o argumento na página de código do sistema e o "ã" chega trocado
      { saude: null, estado: 'fora', avisa: /alerta -> fora \(a API n\S{0,3}o respondeu 200 em http:\/\/127\.0\.0\.1:\d+\/v1\/saude\)/ },
      { saude: SAUDE_OK, estado: 'ok', avisa: /fora -> ok \(sem alertas\)/ },
    ];
    for (const [i, p] of passos.entries()) {
      saude = p.saude;
      const antes = avisos.length;
      const r = await rodar();
      expect(r.codigo, `passo ${i}: ${r.stderr}`).toBe(0);
      expect(estado(), `passo ${i}`).toBe(p.estado);
      if (p.avisa) {
        expect(avisos.length, `passo ${i}`).toBe(antes + 1);
        expect(avisos.at(-1), `passo ${i}`).toMatch(p.avisa);
        expect(avisos.at(-1)).toMatch(/^Macuxi demo: .* em \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      } else {
        expect(avisos.length, `passo ${i}`).toBe(antes);
      }
    }
  }, TETO_CASO_MS);

  it('sem alerta.env: muda o estado e não chama webhook (só syslog/stderr)', async () => {
    rmSync(`${pasta}/alerta.env`);
    saude = SAUDE_5XX;
    const antes = avisos.length;
    const r = await rodar();
    expect(r.codigo, r.stderr).toBe(0);
    expect(estado()).toBe('alerta');
    expect(avisos.length).toBe(antes);
  }, TETO_CASO_MS);
});
