/** Login redirects carry only an approved page and an optional deal identifier. */
export function loginDestination(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://assessment.invalid');
    if (url.origin !== 'https://assessment.invalid' || !['/', '/assessment-review', '/assessment-feedback','/lawyer-handoff'].includes(url.pathname)) return '/';
    const id = url.searchParams.get('dealId');
    return url.pathname + (id && /^[1-9]\d*$/.test(id) ? '?dealId=' + id : '');
  } catch { return '/'; }
}

export const LOGIN_ERRORS = {
  credentials: 'Неверное имя или пароль.',
  unavailable: 'Сервис входа временно недоступен. Повторите попытку позже.',
  configured: 'Вход ещё не настроен. Сообщите Ali.',
  rate: 'Слишком много попыток входа. Подождите и повторите.',
  invalid: 'Не удалось отправить форму. Повторите вход.',
  cookies: 'Браузер не сохранил вход. Разрешите cookies для этого сайта и повторите вход.',
} as const;
