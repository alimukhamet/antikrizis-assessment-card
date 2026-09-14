import { WORKERS } from '../../lib/worker-session';

export function LoginForm({returnTo, error, worker}: {returnTo: string; error: string; worker: string}) {
  return (
    <form className="login-form" method="post" action="/api/session">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        Ваше имя
        <select name="worker" autoComplete="username" required defaultValue={worker}>
          <option value="" disabled>Выберите имя</option>
          {Object.entries(WORKERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label>
        Пароль
        <input name="password" type="password" autoComplete="current-password" required maxLength={1024} />
      </label>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button type="submit">Войти</button>
    </form>
  );
}
