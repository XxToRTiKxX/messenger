export type AuthProviders = {
  yandex?: { enabled?: boolean };
  google?: { enabled?: boolean };
  telegram?: { enabled?: boolean; botUsername?: string };
};
