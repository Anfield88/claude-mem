import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../../src/services/sqlite/SessionSearch.js';

/**
 * Regression coverage for #2389 — search must honor a `platformSource` filter so
 * one agent's memory search can be scoped to its own source (or any other).
 * platform_source lives on sdk_sessions, so the filter resolves it via the
 * owning session and treats a missing value as the default ('claude').
 */
describe('platformSource search filter (#2389)', () => {
  let store: SessionStore;
  let search: SessionSearch;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    // SessionSearch (constructed second) creates the FTS tables + sync triggers,
    // so the rows seeded below get indexed for the FTS-backed search path.
    search = new SessionSearch(store.db);

    // Claude Code session — created without an explicit source, so it stores the
    // default ('claude') and also exercises the "treat missing as default" path.
    const claudeSdk = store.createSDKSession('content-claude', 'proj', 'tweak the statusline');
    store.updateMemorySessionId(claudeSdk, 'session-claude');
    store.storeObservations(
      'session-claude',
      'proj',
      [{ type: 'task', title: 'statusline tweak from Claude', subtitle: null, facts: ['adjusted the statusline'], narrative: null, concepts: [], files_read: [], files_modified: [] }],
      null,
      1,
      0,
      1_700_000_000_000,
    );
    store.saveUserPrompt('content-claude', 1, 'tweak the statusline');

    // Codex CLI session — explicit platformSource.
    const codexSdk = store.createSDKSession('content-codex', 'proj', 'review the statusline', undefined, 'codex');
    store.updateMemorySessionId(codexSdk, 'session-codex');
    store.storeObservations(
      'session-codex',
      'proj',
      [{ type: 'task', title: 'statusline review from Codex', subtitle: null, facts: ['reviewed the statusline'], narrative: null, concepts: [], files_read: [], files_modified: [] }],
      null,
      1,
      0,
      1_700_000_100_000,
    );
    store.saveUserPrompt('content-codex', 1, 'review the statusline');
  });

  afterEach(() => {
    store.close();
  });

  it('returns rows from all sources when no platformSource is given', () => {
    const titles = search.searchObservations('statusline').map(r => r.title).sort();
    expect(titles).toEqual(['statusline review from Codex', 'statusline tweak from Claude']);
  });

  it('restricts the FTS search path to a single source', () => {
    expect(search.searchObservations('statusline', { platformSource: 'codex' }).map(r => r.title)).toEqual(['statusline review from Codex']);
    expect(search.searchObservations('statusline', { platformSource: 'claude' }).map(r => r.title)).toEqual(['statusline tweak from Claude']);
  });

  it('restricts the filter-only search path (no query text) to a single source', () => {
    expect(search.searchObservations(undefined, { platformSource: 'codex' }).map(r => r.title)).toEqual(['statusline review from Codex']);
    expect(search.searchObservations(undefined, { platformSource: 'claude' }).map(r => r.title)).toEqual(['statusline tweak from Claude']);
  });

  it('filters getObservationsByIds (the Chroma-hydration path) by source', () => {
    const ids = search.searchObservations('statusline').map(r => r.id);
    expect(store.getObservationsByIds(ids, { platformSource: 'codex' }).map(r => r.title)).toEqual(['statusline review from Codex']);
    expect(store.getObservationsByIds(ids, { platformSource: 'claude' }).map(r => r.title)).toEqual(['statusline tweak from Claude']);
  });

  it('filters user-prompt search by source', () => {
    expect(search.searchUserPrompts('statusline').length).toBe(2);
    expect(search.searchUserPrompts('statusline', { platformSource: 'codex' }).map(r => r.prompt_text)).toEqual(['review the statusline']);
    expect(search.searchUserPrompts('statusline', { platformSource: 'claude' }).map(r => r.prompt_text)).toEqual(['tweak the statusline']);
  });
});
