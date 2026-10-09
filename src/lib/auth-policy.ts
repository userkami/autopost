import type { SignupsMode } from '@/lib/settings';

/**
 * Sign-in gating policy — PLAN.md §6.1.
 * Pure and unit-tested: on sign-in apply signups_mode (reject if closed, or
 * invite_only without an invite), reject suspended/deleted users, grant admin
 * to emails in ADMIN_EMAILS (admins bypass signup restrictions so the owner
 * can always get in).
 */

export type ExistingUserState = {
  status: 'active' | 'suspended';
  deletedAt: Date | null;
};

export type SignInContext = {
  email: string;
  isAdminEmail: boolean;
  signupsMode: SignupsMode;
  hasInvite: boolean;
  existingUser: ExistingUserState | null;
};

export type SignInDenyReason = 'deleted' | 'suspended' | 'signups_closed' | 'invite_required';

export type SignInDecision = {
  allow: boolean;
  reason?: SignInDenyReason;
  /** email ∈ ADMIN_EMAILS → set users.is_admin on successful login */
  grantAdmin: boolean;
  /** invite_only sign-in consumed an invite row */
  consumeInvite: boolean;
  isNewUser: boolean;
};

export function evaluateSignIn(ctx: SignInContext): SignInDecision {
  const base = {
    grantAdmin: ctx.isAdminEmail,
    consumeInvite: false,
    isNewUser: ctx.existingUser === null,
  };

  if (ctx.existingUser?.deletedAt) {
    return { ...base, allow: false, reason: 'deleted' };
  }
  if (ctx.existingUser?.status === 'suspended') {
    return { ...base, allow: false, reason: 'suspended' };
  }

  // Admins (ADMIN_EMAILS) always get in — including when signups are closed.
  if (ctx.isAdminEmail) {
    return {
      ...base,
      allow: true,
      consumeInvite: ctx.signupsMode === 'invite_only' && ctx.hasInvite,
    };
  }

  if (ctx.signupsMode === 'closed') {
    return { ...base, allow: false, reason: 'signups_closed' };
  }
  if (ctx.signupsMode === 'invite_only' && !ctx.hasInvite) {
    return { ...base, allow: false, reason: 'invite_required' };
  }

  return {
    ...base,
    allow: true,
    consumeInvite: ctx.signupsMode === 'invite_only' && ctx.hasInvite,
  };
}

/** ADMIN_EMAILS env → normalized (trimmed, lowercased) list. */
export function parseAdminEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string, adminEmails: string[]): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}
