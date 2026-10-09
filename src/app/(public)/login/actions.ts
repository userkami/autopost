'use server';

import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { devLogin } from '@/lib/dev-login';

export async function googleSignInAction(): Promise<void> {
  await signIn('google', { redirectTo: '/dashboard' });
}

export async function devSignInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const result = await devLogin(email, password);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error)}`);
  }
  redirect('/dashboard');
}
