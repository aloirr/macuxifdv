import { describe, expect, it } from 'vitest';
import { avisoTransporteErp, hostEhLocalOuLan } from '../src/erp/transporte';

describe('aviso de ERP sem criptografia fora da LAN', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]', '10.1.2.3', '172.16.0.5', '172.31.255.1', '192.168.0.10', '169.254.1.1', 'fd12:3456::1', 'fe80::1', 'SRV-ERP', 'erp.empresa.local', 'bd.lan', 'sql.intranet'])(
    '%s é local/LAN: sem aviso',
    (h) => {
      expect(hostEhLocalOuLan(h)).toBe(true);
      expect(avisoTransporteErp({ host: h, criptografar: false })).toBeNull();
    },
  );

  it.each(['erp.cliente.com.br', '200.150.10.5', '172.32.0.1', '172.15.0.1', '11.0.0.1', '2001:db8::1'])('%s é externo: avisa quando criptografar=false', (h) => {
    expect(hostEhLocalOuLan(h)).toBe(false);
    expect(avisoTransporteErp({ host: h, criptografar: false })).toMatch(/fora de localhost\/LAN.*criptografar": true/);
  });

  it('com criptografia ligada nunca avisa, mesmo em host externo', () => {
    expect(avisoTransporteErp({ host: 'erp.cliente.com.br', criptografar: true })).toBeNull();
  });
});
