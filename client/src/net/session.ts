// Session tokens, so a reloaded or reopened tab takes its place back in the room and the match.
// This tab's own token lives in sessionStorage (it survives a reload). All recent tokens of this
// browser live in localStorage: a reopened tab offers them and the server gives back a player
// that is offline right now. Several open tabs each keep their own player.

const OWN_KEY = 'tw.session';
const ALL_KEY = 'tw.sessions';
const MAX = 8;

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    // private mode or blocked storage: rejoin only works while the tab stays open
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

function all(): string[] {
  try {
    const list = JSON.parse(read(local, ALL_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Tokens to offer in hello: this tab's own one, and the other recent ones of this browser. */
export function sessionCandidates(): { own: string | undefined; others: string[] } {
  const own = read(session, OWN_KEY) ?? undefined;
  return {
    own,
    others: all()
      .filter((t) => t !== own)
      .slice(0, MAX),
  };
}

export function rememberSession(token: string): void {
  write(session, OWN_KEY, token);
  write(local, ALL_KEY, JSON.stringify([token, ...all().filter((t) => t !== token)].slice(0, MAX)));
}

/** Another tab took this session: start fresh next time. */
export function forgetOwnSession(): void {
  write(session, OWN_KEY, null);
}
