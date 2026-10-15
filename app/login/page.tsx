import { LoginForm } from './LoginForm';
import { LOGIN_ERRORS, loginDestination } from '../../lib/login-navigation';
import { WORKERS } from '../../lib/worker-session';
import { hasPlatformEntry, platformSignInUrl } from '../../lib/platform-sign-in';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function LoginPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' && Object.prototype.hasOwnProperty.call(LOGIN_ERRORS, params.error)
    ? LOGIN_ERRORS[params.error as keyof typeof LOGIN_ERRORS] : '';
  const worker = typeof params.worker === 'string' && Object.prototype.hasOwnProperty.call(WORKERS, params.worker) ? params.worker : '';
  const returnTo = loginDestination(params.returnTo);
  // Entered through the Platform before: return through it, without a password, unless that just failed.
  if (!error && hasPlatformEntry((await headers()).get('cookie'))) redirect(platformSignInUrl(returnTo));
  return <main style={{maxWidth:420,margin:'10vh auto',padding:24}}><h1>Антикризис</h1><p>Оценка клиента и документы</p><LoginForm returnTo={returnTo} error={error} worker={worker} platformUrl={platformSignInUrl(returnTo)} /></main>;
}
