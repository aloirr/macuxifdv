import { describe, expect, it } from 'vitest';
import { destinoDaNotificacao } from './destino-notificacao';

describe('destinoDaNotificacao', () => {
  const existe = (c: string) => c === 'pedido';
  it('RN-CORE-80: tocar no aviso de versão nova abre a tela de atualização, mesmo sem link', () => {
    expect(destinoDaNotificacao({ tipo: 'sistema', subtipo: 'app_versao_nova', link: null }, existe)).toBe('/atualizar-app');
  });
  it('RN-CORE-80: sistema com outro subtipo e sem link não navega', () => {
    expect(destinoDaNotificacao({ tipo: 'sistema', subtipo: 'outro', link: null }, existe)).toBeNull();
  });
  it('RF-CORE-09: notificação comum segue o link interno', () => {
    expect(destinoDaNotificacao({ tipo: 'sistema', subtipo: null, link: '/m/pedido?id=1' }, existe)).toBe('/m/pedido?id=1');
  });
});
