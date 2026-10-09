import { describe, expect, it } from 'vitest';
import { evaluateSignIn, isAdminEmail, parseAdminEmails } from '@/lib/auth-policy';

const base = {
  email: 'user@example.com',
  isAdminEmail: false,
  signupsMode: 'open' as const,
  hasInvite: false,
  existingUser: null,
};

describe('evaluateSignIn (PLAN.md §6.1)', () => {
  it('allows a new user when signups are open', () => {
    const d = evaluateSignIn(base);
    expect(d).toMatchObject({ allow: true, grantAdmin: false, isNewUser: true });
  });

  it('rejects when signups are closed', () => {
    const d = evaluateSignIn({ ...base, signupsMode: 'closed' });
    expect(d).toMatchObject({ allow: false, reason: 'signups_closed' });
  });

  it('requires an invite when invite_only', () => {
    const d = evaluateSignIn({ ...base, signupsMode: 'invite_only' });
    expect(d).toMatchObject({ allow: false, reason: 'invite_required' });
  });

  it('allows with an invite and marks it consumed', () => {
    const d = evaluateSignIn({ ...base, signupsMode: 'invite_only', hasInvite: true });
    expect(d).toMatchObject({ allow: true, consumeInvite: true });
  });

  it('rejects suspended users (even admins)', () => {
    const suspended = { status: 'suspended' as const, deletedAt: null };
    expect(evaluateSignIn({ ...base, existingUser: suspended })).toMatchObject({
      allow: false,
      reason: 'suspended',
    });
    expect(evaluateSignIn({ ...base, isAdminEmail: true, existingUser: suspended })).toMatchObject({
      allow: false,
      reason: 'suspended',
    });
  });

  it('rejects soft-deleted users', () => {
    const d = evaluateSignIn({
      ...base,
      existingUser: { status: 'active', deletedAt: new Date() },
    });
    expect(d).toMatchObject({ allow: false, reason: 'deleted' });
  });

  it('grants admin and bypasses closed signups for ADMIN_EMAILS', () => {
    const d = evaluateSignIn({
      ...base,
      email: 'owner@example.com',
      isAdminEmail: true,
      signupsMode: 'closed',
    });
    expect(d).toMatchObject({ allow: true, grantAdmin: true });
  });

  it('existing active user passes without invite logic in open mode', () => {
    const d = evaluateSignIn({
      ...base,
      existingUser: { status: 'active', deletedAt: null },
    });
    expect(d).toMatchObject({ allow: true, isNewUser: false, consumeInvite: false });
  });
});

describe('parseAdminEmails / isAdminEmail', () => {
  it('trims, lowercases and drops empty entries', () => {
    expect(parseAdminEmails(' A@X.com ,, b@y.com , ')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseAdminEmails('')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const admins = parseAdminEmails('Owner@Gmail.com');
    expect(isAdminEmail('owner@gmail.com', admins)).toBe(true);
    expect(isAdminEmail('someone@gmail.com', admins)).toBe(false);
  });
});
