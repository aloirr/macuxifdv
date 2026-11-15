/**
 * Imagens reais de 40×30 para os testes de decodificação (gravadas pelo Pillow): fundo vermelho (200, 30, 30) com uma
 * linha azul, e as versões com transparência em verde (0, 200, 30) com alfa 128.
 */
const b = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export const IMAGENS_TESTE = {
  png: b('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAO0lEQVR4nO3SsQ0AMAgDQZNBzP6bsFWyA5Gg+e+taxxla6OzogJPFtJtj8vZh3k1MDAwMDAwMDAw8HcPHHwERg2o3qgAAAAASUVORK5CYII='),
  pngAlfa: b('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAAP0lEQVR4nO3OMQHAIADAMIYQtE7eZCGBowc7EgV5xrfe8WPzduBEsBKsBCvBSrASrAQrwUqwEqwEK8FKsBKsNqkQAaJM2EHxAAAAAElFTkSuQmCC'),
  webpComPerda: b(
    'UklGRooAAABXRUJQVlA4IH4AAACwBQCdASooAB4APm0wlUekIqIhKrgIAIANiWMAd+FwBggH6Ae//doHSqgI/mJ0i7t1VPgxh4AA/vDDzXy7HcDmbG/gvicqB38hyofW0uf//q1V8lm//5aq+Szf/9Sz/FSScvfNA4+DgiOL9pscp8LAOMVvMyHvwGkc79AAAAA=',
  ),
  webpSemPerda: b('UklGRi4AAABXRUJQVlA4TCIAAAAvJ0AHAA8wHoP8j//5Dx6oadsIKn+0ZdD1u9sj+p/yAeox'),
  webpAlfa: b(
    'UklGRm4AAABXRUJQVlA4WAoAAAAQAAAAJwAAHQAAQUxQSAoAAAABB1DAiAhERP8DVlA4ID4AAABwAwCdASooAB4APm02l0ikIyIhJWgAgA2JZwB2APwAAF8XVTAA/tDK//+YJX5BvIX//7Wh9Wh9Wh/JIAAAAA==',
  ),
} as const;
