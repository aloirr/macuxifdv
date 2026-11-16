// Dublê de next/navigation: lê o filtro da URL da página do print.
export const useSearchParams = () => new URLSearchParams(window.location.search);
export const usePathname = () => '/usuarios';
export const useRouter = () => ({ replace: () => undefined, push: () => undefined });
