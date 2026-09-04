import type { Settings, FeedbackEntry, NerModelKey, NerProviderMode, NerWebGpuDtype, GroupName, AllowlistEntry, BlocklistEntry, CancelDetectionBehavior, LocalAiUnloadTimeoutMs } from './message-types';
import { ENTITY_TYPES } from './message-types';
import { DEFAULT_CURATED_URLS, DEFAULT_SETTINGS, LOCAL_AI_UNLOAD_TIMEOUT_CHOICES, NER_WEBGPU_DTYPE_CHOICES, runtimeNerModelKey } from './constants';
import { GROUP_NAMES, GROUP_DEFAULT_ON } from './category-groups';

const SETTINGS_KEY = 'pg_settings';
const FEEDBACK_KEY = 'pg_feedback';

/** Load extension settings from chrome.storage.local. */
export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

/** Save extension settings to chrome.storage.local. */
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const merged = normalizeSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

function isNerProviderMode(value: unknown): value is NerProviderMode {
  return value === 'off' || value === 'fixture' || value === 'transformers';
}

function isNerModelKey(value: unknown): value is NerModelKey {
  return value === 'ai4privacy' || value === 'bardsai' || value === 'hikmaai';
}

function isNerWebGpuDtype(value: unknown): value is NerWebGpuDtype {
  return (NER_WEBGPU_DTYPE_CHOICES as readonly unknown[]).includes(value);
}

function normalizeGroupsEnabled(raw: unknown): Record<GroupName, boolean> {
  const base: Record<GroupName, boolean> = {} as Record<GroupName, boolean>;
  for (const group of GROUP_NAMES) {
    const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[group] : undefined;
    base[group] = typeof stored === 'boolean' ? stored : GROUP_DEFAULT_ON[group];
  }
  return base;
}

function normalizeGroupThresholds(raw: unknown): Partial<Record<GroupName, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Partial<Record<GroupName, number>> = {};
  for (const group of GROUP_NAMES) {
    const val = (raw as Record<string, unknown>)[group];
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      result[group] = val;
    }
  }
  return result;
}

function isCancelDetectionBehavior(value: unknown): value is CancelDetectionBehavior {
  return value === 'ask' || value === 'paste-original' || value === 'drop';
}

function isLocalAiUnloadTimeoutMs(value: unknown): value is LocalAiUnloadTimeoutMs {
  return (LOCAL_AI_UNLOAD_TIMEOUT_CHOICES as readonly unknown[]).includes(value);
}

function normalizeAllowlist(raw: unknown): AllowlistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is AllowlistEntry =>
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.pattern === 'string' &&
    entry.scope === 'any' &&
    typeof entry.addedAt === 'number' &&
    (entry.source === 'manual' || entry.source === 'detection')
  );
}

function normalizeBlocklist(raw: unknown): BlocklistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is BlocklistEntry =>
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.pattern === 'string' &&
    (entry.scope === 'any' || (ENTITY_TYPES as readonly string[]).includes(entry.scope)) &&
    typeof entry.addedAt === 'number' &&
    (entry.source === 'manual' || entry.source === 'detection')
  );
}

function normalizeSettings(raw: unknown): Settings {
  const candidate = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const settings = { ...DEFAULT_SETTINGS, ...candidate };
  if (typeof settings.minConfidence !== 'number' || settings.minConfidence <= 0 || settings.minConfidence > 1) {
    settings.minConfidence = DEFAULT_SETTINGS.minConfidence;
  }
  if (!isNerProviderMode(settings.nerProvider)) {
    settings.nerProvider = DEFAULT_SETTINGS.nerProvider;
  }
  if (!isNerModelKey(settings.nerModel)) {
    settings.nerModel = DEFAULT_SETTINGS.nerModel;
  } else {
    settings.nerModel = runtimeNerModelKey(settings.nerModel);
  }
  if (!isNerWebGpuDtype(settings.nerWebGpuDtype)) {
    settings.nerWebGpuDtype = DEFAULT_SETTINGS.nerWebGpuDtype;
  }
  if (settings.sensitivityMode !== 'global' && settings.sensitivityMode !== 'individual') {
    settings.sensitivityMode = 'global';
  }
  if (
    settings.defaultReplacementMode !== 'placeholder' &&
    settings.defaultReplacementMode !== 'synthetic'
  ) {
    settings.defaultReplacementMode = DEFAULT_SETTINGS.defaultReplacementMode;
  }
  if (typeof settings.identityVaultEnabled !== 'boolean') {
    settings.identityVaultEnabled = DEFAULT_SETTINGS.identityVaultEnabled;
  }
  if (settings.theme !== 'dark' && settings.theme !== 'light') {
    settings.theme = DEFAULT_SETTINGS.theme;
  }
  if (typeof settings.clipboardInterceptEnabled !== 'boolean') {
    settings.clipboardInterceptEnabled = DEFAULT_SETTINGS.clipboardInterceptEnabled;
  }
  settings.groupsEnabled = normalizeGroupsEnabled(candidate.groupsEnabled);
  settings.groupThresholds = normalizeGroupThresholds(candidate.groupThresholds);
  settings.allowlist = normalizeAllowlist(candidate.allowlist);
  settings.blocklist = normalizeBlocklist(candidate.blocklist);
  if (typeof settings.skipCodeBlocks !== 'boolean') {
    settings.skipCodeBlocks = false;
  }
  if (!isCancelDetectionBehavior(settings.cancelDetectionBehavior)) {
    settings.cancelDetectionBehavior = DEFAULT_SETTINGS.cancelDetectionBehavior;
  }
  if (!isLocalAiUnloadTimeoutMs(settings.localAiUnloadTimeoutMs)) {
    settings.localAiUnloadTimeoutMs = DEFAULT_SETTINGS.localAiUnloadTimeoutMs;
  }
  if (typeof settings.keepLocalAiLoadedWhileActive !== 'boolean') {
    settings.keepLocalAiLoadedWhileActive = DEFAULT_SETTINGS.keepLocalAiLoadedWhileActive;
  }
  if (typeof settings.autoWarmLocalAiOnActiveSupportedPage !== 'boolean') {
    settings.autoWarmLocalAiOnActiveSupportedPage = DEFAULT_SETTINGS.autoWarmLocalAiOnActiveSupportedPage;
  }
  // Union the stored list with the current defaults so a chat site added in a
  // later release reaches users who already have settings. A stored array
  // otherwise shadows the defaults for good: `isSupportedPageUrl` never
  // matches the new host, so the toolbar icon stays inactive and Local AI
  // warm-up is gated off there, while the content script — matched from the
  // manifest rather than from settings — still runs.
  //
  // This only ever adds. Entries the defaults do not know about survive, so
  // additions keep working if the list becomes user-editable (#19), but
  // nothing is ever dropped: a default a user removed would come back, and a
  // host retired from DEFAULT_CURATED_URLS stays curated for everyone who
  // already has settings. Both cases need a record of which defaults a user
  // has been offered, worth adding alongside the UI that edits the list.
  settings.curatedUrls = Array.isArray(settings.curatedUrls)
    ? [...new Set([...settings.curatedUrls, ...DEFAULT_CURATED_URLS])]
    : [...DEFAULT_CURATED_URLS];
  return settings;
}

/** Append a feedback entry to the log. */
export async function logFeedback(entry: FeedbackEntry): Promise<void> {
  const result = await chrome.storage.local.get(FEEDBACK_KEY);
  const log: FeedbackEntry[] = result[FEEDBACK_KEY] || [];
  log.push(entry);
  // Keep last 1000 entries to avoid unbounded growth
  if (log.length > 1000) {
    log.splice(0, log.length - 1000);
  }
  await chrome.storage.local.set({ [FEEDBACK_KEY]: log });
}

/** Get all feedback entries. */
export async function getFeedbackLog(): Promise<FeedbackEntry[]> {
  const result = await chrome.storage.local.get(FEEDBACK_KEY);
  return result[FEEDBACK_KEY] || [];
}

/** Clear all feedback entries. */
export async function clearFeedback(): Promise<void> {
  await chrome.storage.local.remove(FEEDBACK_KEY);
}

/**
 * Legacy conversation records, written by versions up to 0.4.2: a plain
 * `token -> original` object per conversation URL. Read-only from here on.
 * Nothing migrates them, rewrites them or deletes them — an upgrade that
 * touched user data to save a lookup would be a poor trade.
 */
const LEGACY_ENTITY_MAPS_KEY = 'pg_entity_maps';

/**
 * Conversation records in the shape this version writes: a list of the
 * replacement tokens used in one conversation, and nothing else. The same key
 * is used in `chrome.storage.session`, where a profile with cross-session
 * memory switched off keeps `token -> original` pairs instead — see
 * `saveSessionConversationPairs`.
 */
const CONVERSATION_RECORDS_KEY = 'pg_conversation_records';

/** Legacy record shape: replacement token → original value. */
export interface StoredEntityMap {
  [placeholder: string]: string;
}

/**
 * One conversation's record as the resolver needs it, with both shapes
 * already folded together.
 *
 * `tokens` are resolved through the identity vault, which is the sole source
 * of original values for records written by this version. `originals` carries
 * the pairs held by records that came with their own — legacy durable records,
 * and the session records written while cross-session memory is off.
 */
export interface ConversationRecord {
  tokens: string[];
  originals: StoredEntityMap;
}

/** A stored record in either shape. */
type StoredConversationRecord = string[] | StoredEntityMap;

/**
 * `chrome.storage.session`, or null where it is unavailable — an older
 * Chromium, or a test environment that has not mocked it. Session storage is
 * a convenience here, never the only path that has to work: every caller
 * degrades to "this conversation is not remembered" rather than failing.
 */
function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.session ?? null;
}

async function readRecords(
  area: chrome.storage.StorageArea | null,
  key: string,
): Promise<Record<string, StoredConversationRecord>> {
  if (!area) return {};
  try {
    const result = await area.get(key);
    const records = result?.[key];
    return records && typeof records === 'object' ? records : {};
  } catch {
    // A storage area that rejects (session storage without the access level
    // set, a revoked context) must not take restoration down with it.
    return {};
  }
}

/** The replacement tokens a stored record names, in either shape. */
function tokensOf(record: StoredConversationRecord | undefined): string[] {
  if (Array.isArray(record)) {
    return record.filter((token): token is string => typeof token === 'string');
  }
  if (record && typeof record === 'object') return Object.keys(record);
  return [];
}

/** The `token -> original` pairs a stored record carries, if it carries any. */
function originalsOf(record: StoredConversationRecord | undefined): StoredEntityMap {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const pairs: StoredEntityMap = {};
  for (const [token, original] of Object.entries(record)) {
    if (typeof original === 'string') pairs[token] = original;
  }
  return pairs;
}

/**
 * Read everything known about one conversation, across every shape and both
 * storage areas.
 *
 * Three writers can have contributed: this version (a token list in
 * `chrome.storage.local`), this version with cross-session memory off (pairs
 * in `chrome.storage.session`), and a version up to 0.4.2 (pairs in
 * `chrome.storage.local` under the old key). All three resolve; none is
 * rewritten.
 */
export async function loadConversationRecord(
  conversationUrl: string,
): Promise<ConversationRecord> {
  const [durable, session, legacy] = await Promise.all([
    readRecords(chrome.storage.local, CONVERSATION_RECORDS_KEY),
    readRecords(sessionArea(), CONVERSATION_RECORDS_KEY),
    readRecords(chrome.storage.local, LEGACY_ENTITY_MAPS_KEY),
  ]);

  const shapes = [durable[conversationUrl], session[conversationUrl], legacy[conversationUrl]];
  const tokens = new Set<string>();
  let originals: StoredEntityMap = {};
  for (const shape of shapes) {
    for (const token of tokensOf(shape)) tokens.add(token);
    originals = { ...originals, ...originalsOf(shape) };
  }

  return { tokens: [...tokens], originals };
}

/**
 * Whether some earlier session already filed a record under this URL.
 *
 * This is the one piece of positive proof that a URL change is a conversation
 * switch rather than a site renaming the conversation it just created: a key
 * that has been on screen as its own conversation before. It is what clears
 * the tab ledger, so it must not be inferred from anything softer.
 */
export async function conversationRecordExists(conversationUrl: string): Promise<boolean> {
  const record = await loadConversationRecord(conversationUrl);
  return record.tokens.length > 0;
}

/**
 * File replacement tokens under a conversation, durably.
 *
 * No original values are written. The identity vault holds those, and a
 * record filed against the wrong conversation therefore misdirects the
 * resolvable set but exposes nothing.
 */
export async function saveConversationTokens(
  conversationUrl: string,
  tokens: Iterable<string>,
): Promise<void> {
  const incoming = [...tokens];
  if (incoming.length === 0) return;

  const records = await readRecords(chrome.storage.local, CONVERSATION_RECORDS_KEY);
  const merged = new Set([...tokensOf(records[conversationUrl]), ...incoming]);
  records[conversationUrl] = [...merged];
  await chrome.storage.local.set({ [CONVERSATION_RECORDS_KEY]: records });
}

/**
 * File `token -> original` pairs for the length of this browser session only.
 *
 * Used when cross-session memory is off. The vault is not keeping the
 * originals, so the record is the only copy — and a setting named for not
 * remembering across sessions must not leave them in durable storage. Session
 * storage still survives a reload and a conversation switch, so the setting
 * costs persistence rather than usability.
 */
export async function saveSessionConversationPairs(
  conversationUrl: string,
  pairs: StoredEntityMap,
): Promise<void> {
  const area = sessionArea();
  if (!area || Object.keys(pairs).length === 0) return;

  const records = await readRecords(area, CONVERSATION_RECORDS_KEY);
  records[conversationUrl] = {
    ...originalsOf(records[conversationUrl]),
    ...pairs,
  };
  try {
    await area.set({ [CONVERSATION_RECORDS_KEY]: records });
  } catch {
    // Restoration in this tab still works from memory; only persistence
    // across a reload is lost.
  }
}

/**
 * Move replacement tokens from the conversation they were last filed under to
 * the one they have now been seen in.
 *
 * Every supported chat site creates the conversation on the first send and
 * rewrites the URL in place, so tokens emitted while composing are filed
 * under the URL being left behind. This is what carries them across — driven
 * by having observed them rendered at `toUrl`, not by any reading of what the
 * URL change meant.
 *
 * Only the named tokens move, so a second tab composing its own first message
 * keeps its pending tokens under the shared key untouched. Both storage areas
 * are swept because the cross-session memory setting can be flipped between a
 * paste and the send that follows it. Repeating a move that already happened
 * changes nothing.
 */
export async function moveConversationTokens(
  fromUrl: string,
  toUrl: string,
  tokens: Iterable<string>,
): Promise<void> {
  const moving = [...tokens];
  if (moving.length === 0 || fromUrl === toUrl) return;

  await moveWithin(chrome.storage.local, moving, fromUrl, toUrl);
  await moveWithin(sessionArea(), moving, fromUrl, toUrl);
}

async function moveWithin(
  area: chrome.storage.StorageArea | null,
  tokens: string[],
  fromUrl: string,
  toUrl: string,
): Promise<void> {
  if (!area) return;

  const records = await readRecords(area, CONVERSATION_RECORDS_KEY);
  const source = records[fromUrl];
  const sourceTokens = new Set(tokensOf(source));
  const present = tokens.filter((token) => sourceTokens.has(token));
  if (present.length === 0) return;

  const sourcePairs = originalsOf(source);
  const targetPairs = originalsOf(records[toUrl]);
  const carriesOriginals = !Array.isArray(source) && Object.keys(sourcePairs).length > 0;

  if (carriesOriginals) {
    // A pairs-shaped source (session records, or a legacy record read back
    // into the session area) has to take its originals with it, or the moved
    // tokens arrive unresolvable.
    const merged: StoredEntityMap = { ...targetPairs };
    for (const token of present) merged[token] = sourcePairs[token];
    records[toUrl] = merged;
  } else {
    records[toUrl] = [...new Set([...tokensOf(records[toUrl]), ...present])];
  }

  const remaining = tokensOf(source).filter((token) => !present.includes(token));
  if (remaining.length === 0) {
    delete records[fromUrl];
  } else if (Array.isArray(source)) {
    records[fromUrl] = remaining;
  } else {
    const kept: StoredEntityMap = {};
    for (const token of remaining) kept[token] = sourcePairs[token];
    records[fromUrl] = kept;
  }

  try {
    await area.set({ [CONVERSATION_RECORDS_KEY]: records });
  } catch {
    // Leaving the tokens filed where they were costs a reveal after reload,
    // never a wrong one.
  }
}

/**
 * Narrow a map to the entries whose replacement token a single page session
 * actually emitted into the page.
 *
 * The "new chat" URL is a shared key: every new conversation in every tab
 * files under it until the site assigns a real one. A session restores that
 * key on load, so its in-memory map can hold entries belonging to other
 * sessions' drafts. Filing or persisting the map wholesale would carry those
 * tokens into this conversation. Every writer passes through here so a
 * session only ever stores what it used.
 */
export function ownedEntries(
  map: StoredEntityMap,
  owned: ReadonlySet<string>,
): StoredEntityMap {
  const result: StoredEntityMap = {};
  for (const [replacement, original] of Object.entries(map)) {
    if (owned.has(replacement)) result[replacement] = original;
  }
  return result;
}

/** Clear conversation records for one conversation, or for all of them. */
export async function clearEntityMaps(conversationUrl?: string): Promise<void> {
  const areas: Array<[chrome.storage.StorageArea | null, string]> = [
    [chrome.storage.local, CONVERSATION_RECORDS_KEY],
    [chrome.storage.local, LEGACY_ENTITY_MAPS_KEY],
    [sessionArea(), CONVERSATION_RECORDS_KEY],
  ];

  for (const [area, key] of areas) {
    if (!area) continue;
    try {
      if (!conversationUrl) {
        await area.remove(key);
        continue;
      }
      const records = await readRecords(area, key);
      if (records[conversationUrl] === undefined) continue;
      delete records[conversationUrl];
      await area.set({ [key]: records });
    } catch {
      // Best effort per area; a store that cannot be reached holds nothing
      // this call could have removed anyway.
    }
  }
}
