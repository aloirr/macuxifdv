/**
 * T-0158 (v1.0.4): "Enviar diagnóstico" no Diagnóstico do Perfil, renderizado com `react-dom/server` e `react-native`/kit
 * simulados: o botão, a folha fechada e o histórico com o protocolo ("Enviado · nº 0042") e o "Na fila".
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { montarEnvio, novoRegistro, type RegistroDiagnostico } from '@/lib/diagnostico-envio';

type Props = { children?: ReactNode; testID?: string };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, testID ? { 'data-testid': testID } : {}, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  TextInput: ({ testID }: Props) => createElement('textarea', { 'data-testid': testID }),
  Image: () => createElement('img'),
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  StyleSheet: { create: <T,>(s: T) => s },
}));
vi.mock('@macuxi/platform-sdk/react', () => ({ useMotorSync: () => ({ motor: null, estado: null }) }));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonte: new Proxy({}, { get: () => ({}) }),
  radius: new Proxy({}, { get: () => 8 }),
  type: new Proxy({}, { get: () => ({}) }),
  dateTimeLabel: () => 'Hoje, 11:30',
  vibrarLeve: () => undefined,
  Card: host('section'),
  Icon: () => null,
  Badge: ({ label }: { label: string }) => createElement('b', {}, label),
  LinkTexto: ({ rotulo }: { rotulo: string }) => createElement('a', {}, rotulo),
  Button: ({ label, testID }: { label: string; testID: string }) => createElement('button', { 'data-testid': testID }, label),
  Folha: ({ visivel, titulo, children, testID }: { visivel: boolean; titulo: string; children: ReactNode; testID: string }) =>
    createElement('dialog', { 'data-testid': testID, 'data-visivel': String(visivel) }, visivel ? [titulo, children] : null),
}));
vi.mock('@/services/arquivos', () => ({ uriLocal: () => null }));
vi.mock('@/services/camera', () => ({ escolherFotoDaGaleria: async () => null }));
vi.mock('@/services/device', () => ({ uuid: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }));

const historico: RegistroDiagnostico[] = [];
vi.mock('@/services/diagnostico', () => ({
  useDiagnosticos: () => historico,
  descartarPrint: async () => undefined,
  enviarDiagnosticoDoBotao: async () => null,
  montarDiagnosticoDoBotao: async () => null,
}));

const DONO = { usuarioId: '11111111-1111-4111-8111-111111111111', tenantId: null };
const registro = (id: string, o: Partial<RegistroDiagnostico>): RegistroDiagnostico => ({
  ...novoRegistro(
    montarEnvio({
      id,
      origem: 'botao',
      ocorridoEm: '2026-11-11T15:30:00.000Z',
      contexto: { app: 'campo', versao_app: '1.0.4', build: null, aparelho: { fabricante: 'samsung', modelo: 'SM-A155M', android: '14', api: 34 }, sync: null },
      tela: null,
      motivo: null,
      descricao: null,
      erro: null,
      saida: null,
      ultimasSaidas: null,
      printId: null,
    }),
    DONO,
    new Date('2026-11-11T15:30:00.000Z'),
  ),
  ...o,
});

async function render(): Promise<string> {
  const { EnviarDiagnostico } = await import('./enviar-diagnostico');
  return renderToStaticMarkup(createElement(EnviarDiagnostico, { usuarioId: DONO.usuarioId, tenantId: null, tz: 'America/Manaus' }));
}

describe('EnviarDiagnostico (T-0158)', () => {
  it('sem envios: só o botão, folha fechada e sem histórico', async () => {
    historico.length = 0;
    const html = await render();
    expect(html).toContain('data-testid="diagnostico-enviar"');
    expect(html).toContain('Enviar diagnóstico');
    expect(html).toContain('data-visivel="false"');
    expect(html).not.toContain('diagnostico-historico');
  });

  it('Últimos envios com o selo, o protocolo e o que está na fila (sem a linha "Vai junto")', async () => {
    historico.splice(
      0,
      historico.length,
      registro('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', { situacao: 'enviado', protocolo: 42 }),
      registro('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', {}),
    );
    const html = await render();
    expect(html).toContain('Últimos envios');
    expect(html).toContain('<b>Enviado</b>');
    expect(html).toContain('nº 0042');
    expect(html).toContain('<b>Na fila</b>');
    expect(html).toContain('sem sinal');
    expect(html).toContain('Hoje, 11:30');
    expect(html).not.toContain('Vai junto');
  });
});
