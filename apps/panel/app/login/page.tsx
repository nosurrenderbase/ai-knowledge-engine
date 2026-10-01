import {LoginForm} from './login-form';

export default async function LoginPage({searchParams}: {searchParams: Promise<{next?: string}>}) {
  const {next} = await searchParams;
  return (
    <div style={{minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, position: 'relative', zIndex: 1}}>
      <LoginForm next={next ?? '/'} />
    </div>
  );
}
