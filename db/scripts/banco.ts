/**
 * CLI do banco (dono: banco-dados). Rodar a partir da raiz:
 *   pnpm --filter @macuxi/db banco <comando> [opções]
 *
 * Comandos:
 *   subir                         sobe o Postgres (Docker, db/docker-compose.yml), cria o banco de dev e migra
 *   derrubar [--limpar]           para o container (--limpar também apaga o volume de dados)
 *   recriar                       derrubar --limpar + subir (banco de dev do zero, migrado e vazio)
 *   status                        conexão, bancos de teste esquecidos e migrações aplicadas
 *   papeis                        cria/corrige o papel macuxi_app (LOGIN, sem SUPERUSER/BYPASSRLS)
 *   migrar up [--ate NNNN]        aplica migrações pendentes
 *   migrar down [--passos N|--tudo]  desfaz migrações (padrão: a última)
 *   seed fase-m                   carrega o seed de demonstração da Fase M
 *   fixture dois-tenants          carrega a fixture dos testes de RLS
 *   criar-teste [--fixture dois-tenants|fase-m]  cria banco efêmero migrado e imprime o nome
 *   apagar-teste <nome> | --todos apaga banco(s) de teste
 * Opção comum: --banco <nome> (padrão MACUXI_PG_BANCO ou "macuxi").
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lerConfig, type ConfigBanco } from '../src/config';
import { compose } from '../src/docker';
import { apagarBanco, comAdmin, criarBanco, criarBancoDeTeste, listarBancosDeTeste, postgresDisponivel } from '../src/banco-teste';
import { listarAplicadas, migrarDown, migrarUp } from '../src/migrador';
import { garantirPapelApp } from '../src/papeis';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';
import { carregarFaseM } from '../seeds/fase-m/fase-m';

function docker(args: string[]): void {
  compose(args, { herdarSaida: true });
}

async function exigirPostgres(cfg: ConfigBanco): Promise<void> {
  const d = await postgresDisponivel(cfg, 3_000);
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
      docker(['up', '-d', '--wait']);
      await exigir();
      await criarBanco(banco, cfg);
      const r = await comAdmin(banco, (c) => migrarUp(c), cfg);
      console.log(`[banco] pronto: ${cfg.host}:${cfg.porta}/${banco} — migrações aplicadas agora: ${r.aplicadas.join(', ') || 'nenhuma (já estava em dia)'}`);
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
      return;
    case 'migrar': {
      await exigir();
      await criarBanco(banco, cfg);
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
      if (sub !== 'fase-m') throw new Error('use: seed fase-m');
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
      await exigir();
      const fixture = values.fixture;
      if (fixture && fixture !== 'dois-tenants' && fixture !== 'fase-m') throw new Error('--fixture: dois-tenants | fase-m');
      const t = await criarBancoDeTeste({
        cfg,
        preparar: fixture
          ? async (c) => {
              if (fixture === 'dois-tenants') await carregarDoisTenants(c);
              else await carregarFaseM(c);
            }
          : undefined,
      });
      console.log(`[banco] banco de teste criado: ${t.nome}${fixture ? ` (fixture ${fixture})` : ''}`);
      console.log(`MACUXI_PG_BANCO=${t.nome}`);
      return;
    }
    case 'apagar-teste': {
      await exigir();
      const alvos = values.todos ? await listarBancosDeTeste(cfg) : sub ? [sub] : [];
      if (alvos.length === 0) throw new Error('use: apagar-teste <nome> | apagar-teste --todos');
      for (const nome of alvos) {
        if (!nome.startsWith('macuxi_teste_')) throw new Error(`recusado: "${nome}" não é banco de teste`);
        await apagarBanco(nome, cfg);
        console.log(`[banco] apagado: ${nome}`);
      }
      return;
    }
    default:
      console.log('Comandos: subir | derrubar [--limpar] | recriar | status | papeis | migrar up|down | seed fase-m | fixture dois-tenants | criar-teste | apagar-teste');
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
