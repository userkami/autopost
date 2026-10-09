import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      isAdmin: boolean;
      status: 'active' | 'suspended';
    } & DefaultSession['user'];
  }

  interface User {
    isAdmin?: boolean;
    status?: 'active' | 'suspended';
  }
}

// Extra columns our users table adds beyond the Auth.js adapter contract.
declare module '@auth/core/adapters' {
  interface AdapterUser {
    isAdmin: boolean;
    status: 'active' | 'suspended';
  }
}
