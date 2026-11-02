import { describe, expect, it, vi } from 'vitest';
import { enviarPush, montarMensagemExpo, pushAtivo } from './push';

const destino = { token: 'ExponentPushToken[abc]', titulo: 'Recado', corpo: 'Reunião às 9h', link: '/m/core/notificacoes', prioridade: 'alta' as const };

describe('RF-CORE-09: push atrás de configuração', () => {
  it('desligado por padrão: não toca na rede', async () => {
    const f = vi.fn();
    expect(pushAtivo({})).toBe(false);
    expect(await enviarPush([destino], { env: {}, fetcher: f as never })).toEqual({ enviadas: 0, ignoradas: 1 });
    expect(f).not.toHaveBeenCalled();
  });
  it('ligado: envia só tokens do Expo, prioridade alta vira high, sem texto fora da mensagem', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const r = await enviarPush([destino, { ...destino, token: 'lixo' }], { env: { MACUXI_PUSH_ATIVO: '1' }, fetcher: f as never });
    expect(r).toEqual({ enviadas: 1, ignoradas: 1 });
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corpo).toEqual([{ to: destino.token, title: 'Recado', body: 'Reunião às 9h', priority: 'high', data: { link: '/m/core/notificacoes' } }]);
  });
  it('RN-CORE-23: push silencioso não leva title nem body, só data.entidades, com prioridade alta', () => {
    const m = montarMensagemExpo({ ...destino, titulo: '', corpo: '', prioridade: 'normal', entidades: ['meta', 'notificacao'] })!;
    expect(m).toEqual({ to: destino.token, priority: 'high', data: { link: '/m/core/notificacoes', entidades: ['meta', 'notificacao'] } });
    expect('title' in m || 'body' in m).toBe(false);
  });
  it('corpo longo é cortado e token inválido não gera mensagem', () => {
    expect(montarMensagemExpo({ ...destino, corpo: 'x'.repeat(500) })!.body).toHaveLength(178);
    expect(montarMensagemExpo({ ...destino, token: '' })).toBeNull();
  });
});
