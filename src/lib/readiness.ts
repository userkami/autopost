/**
 * Blog readiness checklist (PLAN.md §7 / §17 Phase 4).
 *
 * Pure so the schedule gate (Phase 6), overview and settings all agree:
 * "all three roles + an image host are configured and have a passing recent
 * test" (§7 line 224), plus the Google connection and a usable profile.
 * The "skip test" escape hatch belongs to the schedule-enable action, not here.
 */

export type AIRole = 'research' | 'writing' | 'image';

export type TestStatus = 'ok' | 'failed' | 'untested';

export type RoleReadiness = {
  /** A connection AND a model are selected for the role. */
  configured: boolean;
  /** Status of the AI connection backing the role (connections share tests). */
  test: TestStatus;
  /** false when the role's connection is missing/deleted (orphaned role). */
  connectionPresent: boolean;
};

export type ReadinessInput = {
  googleStatus: 'active' | 'needs_reconnect' | 'revoked' | 'missing';
  /** niche + audience + language present (the levers the pipeline needs). */
  profileComplete: boolean;
  roles: Record<AIRole, RoleReadiness>;
  imageHost: { selected: boolean; test: TestStatus };
};

export type ReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};

export type Readiness = { items: ReadinessItem[]; ready: boolean };

function roleItem(key: AIRole, label: string, role: RoleReadiness): ReadinessItem {
  if (!role.connectionPresent) {
    return { key, label, ready: false, detail: 'Selected connection no longer exists' };
  }
  if (!role.configured) {
    return { key, label, ready: false, detail: 'Not configured — pick a connection and model' };
  }
  if (role.test === 'failed') return { key, label, ready: false, detail: 'Connection test failed — re-run Test' };
  if (role.test === 'untested') {
    return { key, label, ready: false, detail: 'Connection not tested yet — run Test on /connections' };
  }
  return { key, label, ready: true, detail: 'Configured · test passed' };
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [
    input.googleStatus === 'active'
      ? { key: 'google', label: 'Google account connected', ready: true, detail: 'Active' }
      : {
          key: 'google',
          label: 'Google account connected',
          ready: false,
          detail:
            input.googleStatus === 'missing'
              ? 'No Google account connected yet'
              : 'Reconnect required — connection was rejected by Google',
        },
    input.profileComplete
      ? { key: 'profile', label: 'Blog profile', ready: true, detail: 'Niche and audience set' }
      : { key: 'profile', label: 'Blog profile', ready: false, detail: 'Set the niche and audience in Settings' },
    roleItem('research', 'Research role', input.roles.research),
    roleItem('writing', 'Writing role', input.roles.writing),
    roleItem('image', 'Image role', input.roles.image),
    !input.imageHost.selected
      ? { key: 'imageHost', label: 'Image host', ready: false, detail: 'No image host selected' }
      : input.imageHost.test === 'ok'
        ? { key: 'imageHost', label: 'Image host', ready: true, detail: 'Selected · test passed' }
        : input.imageHost.test === 'failed'
          ? { key: 'imageHost', label: 'Image host', ready: false, detail: 'Upload test failed — re-run Test' }
          : { key: 'imageHost', label: 'Image host', ready: false, detail: 'Not tested yet — run Test on /connections' },
  ];
  return { items, ready: items.every((item) => item.ready) };
}
