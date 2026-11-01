/**
 * T-0004 — shells montando módulos pelo manifesto (cenários S0-080, S0-082, S0-083, S0-085 e S0-087 do plano).
 *
 * C4.1 (configuração; o BUILD no EAS é manual e depende do login do Alexandre na Expo — roteiro M-02):
 *   `app.config.ts` avaliado nas duas variantes e `eas.json` com os perfis de desenvolvimento `campo`/`gestao` (APK).
 * C4.2: extensão só com o módulo ativo — o exemplo REAL (o "Novo pedido" do Vendedor no slot `cliente.acoes` do Core,
 *   lido do fonte de modules/vendedor/app/index.ts) e um card de exemplo no `inicio.cards`, no `criarShell` do SDK.
 * C4.3: os 8 módulos nos shells (web real importado; mobile pela lista pura `instalados.ts`) e o createApp com os 8.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarShell, modulosEfetivos, SaudeRespostaSchema, SERVICO_API_MACUXI, type Manifesto, type ModuloId, type ModuloShell } from '@macuxi/platform-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app';
import { MODULOS_API } from '../../apps/api/src/modulos';
import configExpo from '../../apps/mobile/app.config';
import { MANIFESTOS_INSTALADOS as INSTALADOS_MOBILE, modulosDaVariante } from '../../apps/mobile/src/lib/instalados';
import { MODULOS_WEB, SHELL_WEB } from '../../apps/web/lib/modulos';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const OITO: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'];

describe('C4.1 — duas variantes do mesmo código (configuração do EAS)', () => {
  const original = process.env.APP_VARIANT;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = original;
  });
  const avaliar = (v: string) => {
    process.env.APP_VARIANT = v;
    return configExpo({ config: {} } as never);
  };

  it('S0-080: app.config.ts gera nome, pacote Android, scheme e variante diferentes (convivem no mesmo aparelho)', () => {
    const campo = avaliar('campo');
    const gestao = avaliar('gestao');
    expect([campo.name, campo.android?.package, campo.scheme, (campo.extra as { variante: string }).variante]).toEqual(['Macuxi Campo', 'br.com.macuxi.campo', 'macuxicampo', 'campo']);
    expect([gestao.name, gestao.android?.package, gestao.scheme, (gestao.extra as { variante: string }).variante]).toEqual(['Macuxi Gestão', 'br.com.macuxi.gestao', 'macuxigestao', 'gestao']);
    // mesmo projeto EAS e mesmo slug (mesmo código)
    expect(campo.slug).toBe(gestao.slug);
    expect((campo.extra as { eas: unknown }).eas).toEqual((gestao.extra as { eas: unknown }).eas);
    expect(() => avaliar('outra')).toThrow(/APP_VARIANT/);
  });

  it('S0-080: eas.json tem os perfis de desenvolvimento campo e gestao (APK, dev client, distribuição interna, APP_VARIANT certo)', () => {
    const eas = JSON.parse(ler('apps/mobile/eas.json')) as { build: Record<string, { extends?: string; developmentClient?: boolean; distribution?: string; env?: Record<string, string>; android?: { buildType?: string } }> };
    for (const v of ['campo', 'gestao']) {
      const p = eas.build[v]!;
      expect(p, v).toMatchObject({ developmentClient: true, distribution: 'internal', env: { APP_VARIANT: v }, android: { buildType: 'apk' } });
      expect(eas.build[`${v}-preview`]?.env?.APP_VARIANT, `${v}-preview`).toBe(v);
    }
    const pkg = JSON.parse(ler('apps/mobile/package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['expo-dev-client']).toBeDefined();
  });

  it('PENDENTE ALEXANDRE (registrado, não reprova): o ícone da Gestão ainda é o mesmo do Campo', () => {
    expect(avaliar('gestao').icon).toBe(avaliar('campo').icon);
  });
});

describe('C4.3 — os 8 módulos nos shells e na API', () => {
  it('S0-087: web (shell real), mobile (instalados) e API (createApp) instalam os mesmos 8 módulos', async () => {
    expect(MODULOS_WEB.map((m) => m.manifesto.id)).toEqual(OITO);
    expect(INSTALADOS_MOBILE.map((m) => m.id)).toEqual(OITO);
    expect(MODULOS_API.map((m) => m.manifesto.id)).toEqual(OITO);
    const app = createApp();
    const r = await app.inject({ method: 'GET', url: '/v1/saude' });
    // R-20261101-023742-alexandre: /v1/saude se identifica (servico + versao) para o app só salvar um servidor Macuxi
    const saude = SaudeRespostaSchema.parse(r.json());
    expect(saude).toMatchObject({ ok: true, servico: SERVICO_API_MACUXI, modulos: OITO });
    expect(saude.versao.length).toBeGreaterThan(0);
    // corpo sem a identificação (outro serviço que responde { ok: true }) não passa no contrato do app
    expect(SaudeRespostaSchema.safeParse({ ok: true, modulos: OITO }).success).toBe(false);
    // sem banco e sem Core configurado, tudo que é de usuário falha fechado
    expect((await app.inject({ method: 'GET', url: '/v1/me/modulos' })).statusCode).toBe(401);
    await app.close();
  });

  it('S0-082: variante limita os módulos mesmo licenciados (Campo nunca monta Gestor; Integração só no BKO; T-0029 §7: o Gestão monta o Vendedor pela aba Pedidos)', () => {
    expect(modulosDaVariante('campo')).not.toContain('gestor');
    expect(modulosDaVariante('gestao')).toContain('vendedor');
    expect(modulosDaVariante('campo')).not.toContain('integracao');
    expect(modulosDaVariante('gestao')).not.toContain('integracao');
  });

  it('BKO: o menu do shell web real só traz módulos efetivos (Vendedor some quando sai)', () => {
    const com = SHELL_WEB.montar({ perfil: 'analista', modulosAtivos: ['core', 'catalogo', 'vendedor'] });
    const sem = SHELL_WEB.montar({ perfil: 'analista', modulosAtivos: ['core', 'catalogo'] });
    expect(com.navegacao.some((n) => n.modulo === 'vendedor')).toBe(true);
    expect(sem.navegacao.some((n) => n.modulo === 'vendedor')).toBe(false);
    expect(sem.pagina('pedidos')).toBeNull();
  });
});

describe('C4.2 — extensão de exemplo aparece só com o módulo ativo (RN-CORE-03)', () => {
  const porId = new Map(INSTALADOS_MOBILE.map((m) => [m.id, m] as const));
  const fonte = ler('modules/vendedor/app/index.ts');
  const bloco = fonte.slice(fonte.indexOf("slot: 'cliente.acoes'"));
  const novoPedido = { slot: 'cliente.acoes', id: /\bid: '([^']+)'/.exec(bloco)![1]!, acao: /\bacao: '([^']+)'/.exec(bloco)![1]!, payload: { rotulo: 'Novo pedido' } };
  const card = { slot: 'inicio.cards', id: 'desafio-semana', payload: { rotulo: 'Desafio da semana' } };
  const modulos: ModuloShell<unknown>[] = INSTALADOS_MOBILE.map((m) =>
    m.id === 'vendedor' ? { manifesto: m, extensoes: [novoPedido] } : m.id === 'treinamento' ? { manifesto: m, extensoes: [card] } : { manifesto: m },
  );
  const shell = criarShell('campo', modulos);
  const efetivos = (ativos: ModuloId[], perfil: string) =>
    modulosEfetivos({ manifestos: INSTALADOS_MOBILE as Manifesto[], ativosNoTenant: ativos, doPerfil: ativos.filter((id) => porId.get(id)!.perfis.includes(perfil as never)) });

  it('S0-083: "Novo pedido" (Vendedor → slot cliente.acoes do Core) aparece com o Vendedor efetivo', () => {
    expect(novoPedido).toMatchObject({ id: 'novo-pedido', acao: 'pedido.criar' });
    const v = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(['core', 'catalogo', 'vendedor'], 'vendedor') });
    expect(v.extensoes('cliente.acoes').map((e) => `${e.modulo}/${e.id}`)).toEqual(['vendedor/novo-pedido']);
  });

  it('S0-083/S0-085: Vendedor inativo (ou Catálogo inativo, por dependência) → a ação some, sem erro e sem item vazio', () => {
    for (const ativos of [['core', 'catalogo'], ['core', 'vendedor']] as ModuloId[][]) {
      const v = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(ativos, 'vendedor') });
      expect(v.extensoes('cliente.acoes'), ativos.join(',')).toEqual([]);
    }
  });

  it('S0-083: card de exemplo do Treinamento no inicio.cards aparece e some com o módulo, nas duas variantes', () => {
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: efetivos(['core', 'treinamento'], 'promotor') }).extensoes('inicio.cards')).toHaveLength(1);
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: efetivos(['core'], 'promotor') }).extensoes('inicio.cards')).toHaveLength(0);
    const gestao = criarShell('gestao', modulos);
    expect(gestao.montar({ perfil: 'gerente', modulosAtivos: efetivos(['core', 'treinamento'], 'gerente') }).extensoes('inicio.cards')).toHaveLength(1);
    expect(gestao.montar({ perfil: 'gerente', modulosAtivos: efetivos(['core'], 'gerente') }).extensoes('inicio.cards')).toHaveLength(0);
  });
});
