/**
 * T-0094 — teste de componente do login do app (rota `/login`), renderizado com `react-dom/server`, com `react-native`, o
 * roteador, o estado da plataforma e as telas do Core simulados:
 * - a `TelaLogin` do Core recebe o código salvo no aparelho e, na primeira abertura, nenhum e-mail inicial (o retorno com
 *   código e e-mail é coberto em lib/etapa-login.test.ts);
 * - contraste do laranja (docs/design/componentes.md §1.1, R-20261108-103740): o texto laranja do shell (marca da
 *   demonstração e link "Avançado") usa `accentInk`, nunca o `accent` cru; o `accent` fica só em ícone e spinner.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- simulações ----------
type Estilo = Record<string, unknown> | false | null | undefined | Estilo[];
const achatar = (s: Estilo): Record<string, unknown> =>
  Array.isArray(s) ? Object.assign({}, ...s.map(achatar)) : s ? (s as Record<string, unknown>) : {};
type Props = { children?: ReactNode; testID?: string; style?: Estilo; color?: string };
const host = (tag: string) =>
  function Host({ children, testID, style }: Props) {
    const cor = achatar(style ?? null).color;
    return createElement(tag, { 'data-testid': testID, 'data-cor': typeof cor === 'string' ? cor : undefined }, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  Pressable: host('button'),
  TextInput: host('input'),
  KeyboardAvoidingView: host('div'),
  ActivityIndicator: ({ color }: Props) => createElement('progress', { 'data-cor': color }),
  StyleSheet: { create: <T,>(s: T) => s },
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  Keyboard: { addListener: () => ({ remove: () => undefined }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('expo-router', () => ({ router: { replace: () => undefined } }));
vi.mock('@macuxi/ui/mobile', () => ({
  // a cor vira o nome do token: o teste lê qual token cada texto usa
  colors: new Proxy({}, { get: (_, k) => String(k) }),
  fonts: new Proxy({}, { get: () => 'f' }),
  radius: new Proxy({}, { get: () => 8 }),
  type: new Proxy({}, { get: () => ({}) }),
  initials: (n: string) => n.slice(0, 2),
  Banner: host('p'),
  Button: ({ label }: { label: string }) => createElement('button', null, label),
  Card: host('section'),
  Icon: ({ color }: Props) => createElement('i', { 'data-cor': color }),
  Screen: host('main'),
}));

const sim = vi.hoisted(() => ({ modo: 'real' as 'real' | 'demo', perfilBuild: 'development', telaLogin: [] as Record<string, unknown>[] }));
vi.mock('@macuxi/core/app', () => ({
  AVISO_SENHA_CRIADA: 'Senha criada.',
  detalhesDaTroca: () => null,
  ehAparelhoBloqueado: () => false,
  TelaCrieSuaSenha: () => createElement('div', { 'data-testid': 'crie-sua-senha' }),
  TelaEsqueciSenha: () => createElement('div', { 'data-testid': 'esqueci' }),
  TelaLogin: (props: Record<string, unknown>) => {
    sim.telaLogin.push(props);
    return createElement('form', { 'data-testid': 'login.tela' });
  },
}));
vi.mock('@/components/area-segura', () => ({ useFaixaSuperior: () => 0 }));
vi.mock('@/components/tela-entrada', () => ({
  TelaEntrada: ({ barra }: { barra?: { rotulo: string } | null }) => createElement('div', { 'data-testid': 'tela-entrada' }, barra?.rotulo ?? ''),
}));
vi.mock('@/lib/endereco-do-build', () => ({
  avisoDeServidorNoLogin: () => null,
  cartaoServidorNoLogin: (perfil: string) => (perfil === 'development' ? 'avancado' : 'oculto'),
  mensagemServidorFalhou: () => null,
}));
vi.mock('@/services/api', () => ({ ApiClient: class {}, errorMessage: () => '' }));
vi.mock('@/state/plataforma', () => ({
  usePlataforma: () => ({
    modo: sim.modo,
    variante: 'campo',
    perfilBuild: sim.perfilBuild,
    codigoSalvo: 'DIST01',
    avisoLogin: null,
    offline: false,
    apiUrl: 'http://api/v1',
    apiOverride: null,
    loginComSenha: async () => undefined,
    pedirSenha: async () => undefined,
    trocarSenha: async () => undefined,
    loginDemo: async () => undefined,
  }),
  usuarioDaFaseM: (u: unknown) => u,
}));

const { default: LoginScreen } = await import('../app/login');
const { servidorNaAbertura } = await import('@/lib/entrada');

const html = () => renderToStaticMarkup(createElement(LoginScreen));
/** Cor (token) de cada texto com o conteúdo dado. */
const corDoTexto = (markup: string, texto: string) => new RegExp(`<span data-cor="([^"]+)">${texto}</span>`).exec(markup)?.[1];

beforeEach(() => {
  // o servidor já foi conferido nesta abertura (o teste do servidor tem o próprio caso abaixo)
  servidorNaAbertura.conferido = true;
  sim.modo = 'real';
  sim.perfilBuild = 'development';
  sim.telaLogin = [];
});

describe('T-0172: antes do login, a tela de entrada confere o servidor uma vez por abertura', () => {
  it('na abertura o logo fica no lugar do login enquanto confere; depois de conferido, abre o login', () => {
    servidorNaAbertura.conferido = false;
    const abertura = html();
    expect(abertura).toContain('data-testid="tela-entrada"');
    expect(abertura).not.toContain('login.tela');
    servidorNaAbertura.conferido = true;
    expect(html()).toContain('data-testid="login.tela"');
  });
});

describe('login real: a tela do Core com o que o shell sabe', () => {
  it('primeira abertura: o código salvo no aparelho, sem aviso e sem e-mail inicial', () => {
    expect(html()).toContain('data-testid="login.tela"');
    const props = sim.telaLogin.at(-1)!;
    expect(props.codigoSalvo).toBe('DIST01');
    expect(props.aviso).toBeNull();
    expect('emailInicial' in props).toBe(false);
    expect(props.rodape).toBe('Macuxi Campo · vendedores e promotores');
  });
});

describe('contraste do laranja no shell (accentInk em texto)', () => {
  it('link "Avançado" do build de desenvolvimento em accentInk; o ícone segue accent', () => {
    const m = html();
    expect(corDoTexto(m, 'Avançado')).toBe('accentInk');
    expect(m).toContain('<i data-cor="accent"></i>');
  });
  it('builds preview e produção não mostram o "Avançado"', () => {
    sim.perfilBuild = 'preview';
    expect(html()).not.toContain('Avançado');
  });
  it('demonstração: a marca "MACUXI FDV" em accentInk; o spinner segue accent', () => {
    sim.modo = 'demo';
    const m = html();
    expect(corDoTexto(m, 'MACUXI FDV')).toBe('accentInk');
    expect(m).toContain('<progress data-cor="accent"></progress>');
  });
  it('nenhum texto do login usa o accent cru', () => {
    for (const modo of ['real', 'demo'] as const) {
      sim.modo = modo;
      expect(html()).not.toMatch(/<span data-cor="accent">/);
    }
  });
});
