import {LoginForm} from './login-form';

export default async function LoginPage({searchParams}: {searchParams: Promise<{next?: string}>}) {
  const {next} = await searchParams;
  return (
    <div style={{minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f5'}}>
      <LoginForm next={next ?? '/'} />
    </div>
  );
}
