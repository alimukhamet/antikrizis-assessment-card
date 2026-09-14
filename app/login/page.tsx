import { LoginForm } from './LoginForm';
import { LOGIN_ERRORS, loginDestination } from '../../lib/login-navigation';
import { WORKERS } from '../../lib/worker-session';
export const dynamic = 'force-dynamic';
export default async function LoginPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' && Object.prototype.hasOwnProperty.call(LOGIN_ERRORS, params.error)
    ? LOGIN_ERRORS[params.error as keyof typeof LOGIN_ERRORS] : '';
  const worker = typeof params.worker === 'string' && Object.prototype.hasOwnProperty.call(WORKERS, params.worker) ? params.worker : '';
  return <main style={{maxWidth:420,margin:'10vh auto',padding:24}}><h1>Антикризис</h1><p>Оценка клиента и документы</p><LoginForm returnTo={loginDestination(params.returnTo)} error={error} worker={worker} /></main>;
}
