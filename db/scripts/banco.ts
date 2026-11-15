/**
 * CLI do banco (dono: banco-dados). Rodar a partir da raiz:
 *   pnpm --filter @macuxi/db banco <comando> [opções]
 *
 * Comandos:
 *   subir                         sobe o Postgres da demo/dev (serviço postgres, 5432), cria o banco de dev e migra
 *   subir-testes                  sobe só o Postgres dos testes (serviço postgres-testes, 5434, tmpfs, fsync off)
 *   derrubar [--limpar]           para o container (--limpar também apaga o volume de dados)
 *   recriar                       derrubar --limpar + subir (banco de dev do zero, migrado e vazio)
 *   status                        conexão, bancos de teste esquecidos e migrações aplicadas
 *   papeis                        cria/corrige os papéis macuxi_app, macuxi_worker, macuxi_portal e macuxi_leitura (LOGIN, sem
 *                                 SUPERUSER/BYPASSRLS; macuxi_leitura com os ajustes de sessão só leitura, 0078)
 *   migrar up [--ate NNNN]        aplica migrações pendentes (antes, os papéis: criarBanco, db/src/banco-teste.ts)
 *   migrar down [--passos N|--tudo]  desfaz migrações (padrão: a última)
 *   seed fase-m                   carrega o seed de demonstração da Fase M
 *   seed demo [--recriar] [--hoje AAAA-MM-DD]  base de demo (tenant "demo"); --recriar apaga o tenant demo e recarrega
 *   fixture dois-tenants          carrega a fixture dos testes de RLS
 *   criar-teste [--fixture dois-tenants|fase-m|demo]  cria banco efêmero migrado no Postgres DOS TESTES e imprime o nome
 *   apagar-teste <nome> | --todos apaga banco(s) de teste do Postgres DOS TESTES (--todos: também os bancos modelo de
 *                                 outra chave de migrações, T-0033; o da chave atual fica)
 *   (sobras de teste no Postgres da demo: node db/scripts/limpar-bancos-teste.mjs [--apagar])
 * Opção comum: --banco <nome> (padrão MACUXI_PG_BANCO ou "macuxi").
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lerConfig, lerConfigTestes, type ConfigBanco } from '../src/config';
import { compose } from '../src/docker';
import { apagarBanco, comAdmin, criarBanco, criarBancoDeTeste, listarBancosDeTeste, postgresDisponivel } from '../src/banco-teste';
import { apagarModelosAntigos, listarModelos } from '../src/banco-modelo';
import { listarAplicadas, migrarDown, migrarUp } from '../src/migrador';
import { garantirLeitura, garantirPapelApp, garantirPapelPortal, garantirPapelWorker } from '../src/papeis';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';
import { carregarFaseM } from '../seeds/fase-m/fase-m';
import { carregarDemo, type ResultadoDemo } from '../seeds/demo/demo';

/** Resumo da base de demo: código da empresa e logins. A senha NUNCA é impressa (só de onde ela vem). */
function imprimirDemo(r: ResultadoDemo, banco: string, recriada: boolean): void {
  console.log(`[banco] base de demo ${recriada ? 'recriada' : 'carregada'} em ${banco} — hoje (America/Manaus): ${r.hoje}`);
  console.log(`[banco] código da empresa: ${r.codigo}`);
  for (const l of r.logins) console.log(`[banco]   ${l.perfil.padEnd(10)} ${l.email}  (${l.nome})`);
  console.log(`[banco] senha: ${process.env.MACUXI_SENHA_DEMO ? 'a de MACUXI_SENHA_DEMO' : 'a padrão da demo (docs/banco/README.md, "Base de demo")'}`);
  // T-0026: número de pedido que a carga trocou (repetido consertado); só id e números
  for (const t of r.numerosTrocados) console.log(`[banco] número do pedido ${t.id} (${t.origem}): ${t.de ?? '(sem número)'} -> ${t.para}`);
}

/** Sem MACUXI_PG_PORTAL_SENHA (portal.env da VM): o papel fica NOLOGIN e o portal do super-admin responde 503 (T-0091). */
export const AVISO_PORTAL_SEM_SENHA =
  '[banco] MACUXI_PG_PORTAL_SENHA não definida: macuxi_portal fica NOLOGIN (o portal do super-admin responde 503 até a senha existir).';

/**
 * Sem MACUXI_PG_LEITURA_SENHA (leitura.env da VM): o papel da consulta só leitura fica NOLOGIN e o workflow de consulta da
 * produção não conecta (ADR 0055).
 */
export const AVISO_LEITURA_SEM_SENHA =
  '[banco] MACUXI_PG_LEITURA_SENHA não definida: macuxi_leitura fica NOLOGIN (a consulta só leitura não conecta até a senha existir).';

function docker(args: string[]): void {
  compose(args, { herdarSaida: true });
}

async function exigirPostgres(cfg: ConfigBanco): Promise<void> {
  const d = await postgresDisponivel(cfg, 10_000); // 10 s: máquina carregada (02/11) estourava 3 s
  if (!d.ok) throw new Error(`Postgres indisponível em ${cfg.host}:${cfg.porta} (${d.motivo}). Rode "banco subir" antes.`);
}

/** Executa um comando do CLI (exportado para teste). */
export async function executar(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      banco: { type: 'string' },
      ate: { type: 'string' },
      passos: { type: 'string' },
      tudo: { type: 'boolean', default: false },
      limpar: { type: 'boolean', default: false },
      todos: { type: 'boolean', default: false },
      fixture: { type: 'string' },
      recriar: { type: 'boolean', default: false },
      hoje: { type: 'string' },
    },
  });
  const cfg = lerConfig();
  const banco = values.banco ?? cfg.banco;
  const exigir = () => exigirPostgres(cfg);
  const [comando, sub] = positionals;
  switch (comando) {
    case 'recriar':
    case 'subir': {
      // recriar = banco de dev do zero: apaga container e volume e sobe de novo (migrado, sem dados).
      if (comando === 'recriar') docker(['down', '-v']);
      // só o serviço da demo/dev: o dos testes (postgres-testes) sobe sob demanda (globalSetup ou subir-testes)
      docker(['up', '-d', '--wait', 'postgres']);
      await exigir();
      await criarBanco(banco, cfg);
      const r = await comAdmin(banco, (c) => migrarUp(c), cfg);
      console.log(`[banco] pronto: ${cfg.host}:${cfg.porta}/${banco} — migrações aplicadas agora: ${r.aplicadas.join(', ') || 'nenhuma (já estava em dia)'}`);
      return;
    }
    case 'subir-testes': {
      const t = lerConfigTestes();
      docker(['up', '-d', '--wait', 'postgres-testes']);
      await exigirPostgres(t);
      console.log(`[banco] Postgres dos testes pronto em ${t.host}:${t.porta} (sem dados persistentes: tmpfs, fsync off).`);
      return;
    }
    case 'derrubar':
      docker(values.limpar ? ['down', '-v'] : ['down']);
      console.log(values.limpar ? '[banco] container e volume removidos.' : '[banco] container parado (dados preservados no volume).');
      return;
    case 'status': {
      const d = await postgresDisponivel(cfg);
      if (!d.ok) {
        console.log(`[banco] indisponível em ${cfg.host}:${cfg.porta}: ${d.motivo}`);
        process.exitCode = 1;
        return;
      }
      console.log(`[banco] Postgres ${d.versao} em ${cfg.host}:${cfg.porta}`);
      const testes = await listarBancosDeTeste(cfg);
      console.log(`[banco] bancos de teste: ${testes.length ? testes.join(', ') : 'nenhum'}`);
      const modelos = await listarModelos(cfg);
      console.log(`[banco] bancos modelo (T-0033): ${modelos.length ? modelos.join(', ') : 'nenhum'}`);
      const existe = await comAdmin('postgres', (c) => c.query('select 1 from pg_database where datname = $1', [banco]), cfg);
      if (existe.rowCount === 0) {
        console.log(`[banco] banco "${banco}" não existe (rode "banco subir").`);
        return;
      }
      const aplicadas = await comAdmin(banco, (c) => listarAplicadas(c), cfg);
      console.log(`[banco] ${banco}: ${aplicadas.map((a) => `${a.versao}_${a.nome}`).join(', ') || 'sem migrações'}`);
      return;
    }
    case 'papeis':
      await exigir();
      await comAdmin('postgres', (c) => garantirPapelApp(c, cfg.appSenha), cfg);
      console.log('[banco] papel macuxi_app pronto (LOGIN, NOSUPERUSER, NOBYPASSRLS).');
      if (cfg.workerSenha) {
        await comAdmin('postgres', (c) => garantirPapelWorker(c, cfg.workerSenha), cfg);
        console.log('[banco] papel macuxi_worker pronto (LOGIN, NOSUPERUSER, NOBYPASSRLS).');
      } else {
        console.log('[banco] MACUXI_PG_WORKER_SENHA não definida: macuxi_worker fica NOLOGIN.');
      }
      if (cfg.portalSenha) {
        await comAdmin('postgres', (c) => garantirPapelPortal(c, cfg.portalSenha), cfg);
        console.log('[banco] papel macuxi_portal pronto (LOGIN, NOSUPERUSER, NOBYPASSRLS).');
      } else {
        console.log(AVISO_PORTAL_SEM_SENHA);
      }
      if ((await comAdmin('postgres', (c) => garantirLeitura(c, cfg.leituraSenha), cfg)) === 'login') {
        console.log('[banco] papel macuxi_leitura pronto (LOGIN, NOSUPERUSER, NOBYPASSRLS, sessão só leitura).');
      } else {
        console.log(AVISO_LEITURA_SEM_SENHA);
      }
      return;
    case 'migrar': {
      await exigir();
      // criarBanco garante macuxi_app, macuxi_worker (com senha), macuxi_portal (0038) e macuxi_leitura (0078, com os ajustes de
      // sessão): com senha = LOGIN pelo B0, sem = NOLOGIN
      await criarBanco(banco, cfg);
      if (!cfg.portalSenha) console.log(AVISO_PORTAL_SEM_SENHA);
      if (!cfg.leituraSenha) console.log(AVISO_LEITURA_SEM_SENHA);
      if (sub === 'up') {
        const r = await comAdmin(banco, (c) => migrarUp(c, values.ate ? { ate: values.ate } : {}), cfg);
        console.log(`[banco] up em ${banco}: ${r.aplicadas.join(', ') || 'nada pendente'}`);
      } else if (sub === 'down') {
        const passos = values.passos ? Number(values.passos) : 1;
        if (!Number.isInteger(passos) || passos < 1) throw new Error('--passos precisa ser inteiro >= 1');
        const r = await comAdmin(banco, (c) => migrarDown(c, values.tudo ? { tudo: true } : { passos }), cfg);
        console.log(`[banco] down em ${banco}: ${r.aplicadas.join(', ') || 'nada a desfazer'}`);
      } else {
        throw new Error('use: migrar up | migrar down');
      }
      return;
    }
    case 'seed':
      if (sub === 'demo') {
        if (values.hoje && !/^\d{4}-\d{2}-\d{2}$/.test(values.hoje)) throw new Error('--hoje: AAAA-MM-DD');
        await exigir();
        const r = await comAdmin(banco, (c) => carregarDemo(c, { recriar: values.recriar, hoje: values.hoje }), cfg);
        imprimirDemo(r, banco, values.recriar);
        return;
      }
      if (sub !== 'fase-m') throw new Error('use: seed fase-m | seed demo [--recriar]');
      await exigir();
      await comAdmin(banco, (c) => carregarFaseM(c), cfg);
      console.log(`[banco] seed Fase M carregado em ${banco}.`);
      return;
    case 'fixture':
      if (sub !== 'dois-tenants') throw new Error('use: fixture dois-tenants');
      await exigir();
      await comAdmin(banco, (c) => carregarDoisTenants(c), cfg);
      console.log(`[banco] fixture dois-tenants carregada em ${banco}.`);
      return;
    case 'criar-teste': {
      const cfgTestes = lerConfigTestes();
      await exigirPostgres(cfgTestes);
      const fixture = values.fixture;
      if (fixture && fixture !== 'dois-tenants' && fixture !== 'fase-m' && fixture !== 'demo') throw new Error('--fixture: dois-tenants | fase-m | demo');
      const t = await criarBancoDeTeste({
        cfg: cfgTestes,
        preparar: fixture
          ? async (c) => {
              if (fixture === 'dois-tenants') await carregarDoisTenants(c);
              else if (fixture === 'demo') await carregarDemo(c);
              else await carregarFaseM(c);
            }
          : undefined,
      });
      console.log(`[banco] banco de teste criado em ${cfgTestes.host}:${cfgTestes.porta}: ${t.nome}${fixture ? ` (fixture ${fixture})` : ''}`);
      console.log(`MACUXI_PG_BANCO=${t.nome}`);
      return;
    }
    case 'apagar-teste': {
      const cfgTestes = lerConfigTestes();
      await exigirPostgres(cfgTestes);
      const alvos = values.todos ? await listarBancosDeTeste(cfgTestes) : sub ? [sub] : [];
      if (alvos.length === 0) throw new Error('use: apagar-teste <nome> | apagar-teste --todos');
      for (const nome of alvos) {
        if (!nome.startsWith('macuxi_teste_')) throw new Error(`recusado: "${nome}" não é banco de teste`);
        await apagarBanco(nome, cfgTestes);
        console.log(`[banco] apagado: ${nome}`);
      }
      if (values.todos) for (const m of await apagarModelosAntigos(cfgTestes)) console.log(`[banco] modelo antigo apagado: ${m}`);
      return;
    }
    default:
      console.log('Comandos: subir | subir-testes | derrubar [--limpar] | recriar | status | papeis | migrar up|down | seed fase-m | seed demo [--recriar] | fixture dois-tenants | criar-teste | apagar-teste');
      if (comando) process.exitCode = 1;
  }
}

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  executar(process.argv.slice(2)).catch((e: unknown) => {
    console.error(`[banco] erro: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
