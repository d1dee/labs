import { $fetch, throwOnError } from './client';

// Key file authentication is the only supported Veyon auth mode. The WebAPI
// server signs each Veyon Server challenge with the stored PEM private key.
export const VEYON_AUTH_KEYS_METHOD = '0c69b301-81b4-42d6-8fae-128cdd113314';

export interface VeyonComputer {
    id: string;
    name: string;
    host: string;
    macAddress: string | null;
    location: string | null;
    fogHostId: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface VeyonSyncAddition {
    fogHostId: number;
    name: string;
    host: string;
    macAddress: string | null;
    location: string | null;
}

export interface VeyonSyncRename {
    computerId: string;
    fogHostId: number;
    currentName: string;
    newName: string;
    host: string;
}

export interface VeyonSyncRemoval {
    computerId: string;
    name: string;
    host: string;
    fogHostId: number;
    reason: 'fog-host-deleted';
}

export interface VeyonSyncLink {
    computerId: string;
    fogHostId: number;
}

export interface VeyonSyncPlan {
    additions: VeyonSyncAddition[];
    renames: VeyonSyncRename[];
    removals: VeyonSyncRemoval[];
    links: VeyonSyncLink[];
    unchanged: number;
    unmanaged: Array<{ computerId: string; name: string; host: string }>;
    warnings: string[];
}

export interface VeyonSyncPreview {
    fogConfigured: boolean;
    plan: VeyonSyncPlan | null;
}

export interface VeyonSyncApplyInput {
    additions?: number[];
    renames?: string[];
    removals?: string[];
    links?: Array<{ computerId: string; fogHostId: number }>;
    confirmRemovals?: boolean;
}

export interface VeyonSyncApplyResultItem {
    type: 'addition' | 'rename' | 'removal' | 'link';
    id: string | number;
    name: string;
    success: boolean;
    error?: string;
}

export interface VeyonSyncApplyResult {
    success: boolean;
    results: VeyonSyncApplyResultItem[];
}

export interface VeyonInformation {
    user: { login: string; fullName: string };
    session: {
        sessionId: number;
        sessionUptime: number;
        sessionClientAddress: string;
        sessionClientName: string;
        sessionHostName: string;
    };
    features: VeyonFeature[];
}

export interface VeyonFeature {
    uid?: string;
    id?: string;
    name?: string;
    displayName?: string;
    description?: string;
    [key: string]: unknown;
}

export type VeyonInformationEvent = { computerId: string } & (
    | { state: 'online'; information: VeyonInformation }
    | { state: 'offline'; error: string }
);

export interface VeyonSettings {
    configured: boolean;
    url: string;
    keyName: string;
    keyConfigured: boolean;
    verifyTls: boolean;
}

// Server-sent event payloads of GET /api/veyon/screenshots/stream. The
// backend polls Veyon once per machine and fans frames out to every viewer.
export interface VeyonScreenshotFrameEvent {
    computerId: string;
    /** Cached subscription snapshot, not a result of a fresh poll. */
    initial?: boolean;
    /** Base64-encoded screenshot bytes. */
    image: string;
    mimeType: string;
    lastUpdated: number;
    stale: boolean;
    consecutiveFailures: number;
}

export interface VeyonScreenshotStateEvent {
    computerId: string;
    /** Cached subscription snapshot, not a result of a fresh poll. */
    initial?: boolean;
    stale: boolean;
    lastUpdated: number | null;
    consecutiveFailures: number;
    lastError: string | null;
}

export type VeyonCommandAction =
    | 'screen-lock'
    | 'input-lock'
    | 'user-login'
    | 'user-logoff'
    | 'reboot'
    | 'power-down'
    | 'start-app'
    | 'open-website'
    | 'text-message'
    | 'custom-feature';

export async function getVeyonStatus() {
    return throwOnError(
        await $fetch<{ configured: boolean; url: string | null }>('/api/veyon/status'),
        'Failed to load Veyon status',
    );
}

export async function listVeyonComputers() {
    return throwOnError(
        await $fetch<{ computers: VeyonComputer[] }>('/api/veyon/computers'),
        'Failed to load computers',
    );
}

export async function createVeyonComputer(
    computer: Pick<VeyonComputer, 'name' | 'host'> &
        Partial<Pick<VeyonComputer, 'macAddress' | 'location'>>,
) {
    return throwOnError(
        await $fetch<VeyonComputer>('/api/veyon/computers', {
            method: 'POST',
            body: computer,
        }),
        'Failed to add computer',
    );
}

export async function updateVeyonComputer(
    id: string,
    computer: Pick<VeyonComputer, 'name' | 'host'> &
        Partial<Pick<VeyonComputer, 'macAddress' | 'location'>>,
) {
    return throwOnError(
        await $fetch<VeyonComputer>(`/api/veyon/computers/${id}`, {
            method: 'PUT',
            body: computer,
        }),
        'Failed to update computer',
    );
}

export async function deleteVeyonComputer(id: string) {
    return throwOnError(
        await $fetch<{ success: boolean }>(`/api/veyon/computers/${id}`, {
            method: 'DELETE',
        }),
        'Failed to delete computer',
    );
}

export async function getVeyonInformation(id: string) {
    return throwOnError(
        await $fetch<VeyonInformation>(`/api/veyon/computers/${id}/information`),
        'Computer is unavailable',
    );
}

export function veyonFramebufferUrl(
    id: string,
    options: { width?: number; height?: number; download?: boolean } = {},
) {
    const query = new URLSearchParams({
        format: 'jpeg',
        quality: '74',
        nonce: String(Date.now()),
    });
    if (options.width) query.set('width', String(options.width));
    if (options.height) query.set('height', String(options.height));
    if (options.download) query.set('download', 'true');
    return `/api/veyon/computers/${id}/framebuffer?${query}`;
}

// Server-sent event stream of live screenshots for the given computers. The
// backend owns all Veyon polling; browsers only receive pushed frames.
export function veyonScreenshotStreamUrl(
    computerIds: string[],
    options: { intervalMs?: number | null; refresh?: boolean; width?: number; quality?: number; priority?: 'grid' | 'viewer' } = {},
) {
    const query = new URLSearchParams({ ids: [...new Set(computerIds)].sort().join(',') });
    if (options.intervalMs != null) query.set('intervalMs', String(options.intervalMs));
    if (options.refresh) query.set('refresh', 'true');
    if (options.width != null) query.set('width', String(options.width));
    if (options.quality != null) query.set('quality', String(options.quality));
    if (options.priority) query.set('priority', options.priority);
    return `/api/veyon/screenshots/stream?${query}`;
}

export type VeyonCommandResult = { id: string; name: string; success: boolean; error?: string };

export async function sendVeyonCommand(input: {
    computerIds: string[];
    action: VeyonCommandAction;
    active?: boolean;
    arguments?: Record<string, unknown>;
    featureUid?: string;
}) {
    return throwOnError(
        await $fetch<{
            success: boolean;
            results: VeyonCommandResult[];
        }>('/api/veyon/commands', { method: 'POST', body: input }),
        'Veyon command failed',
    );
}

export async function getVeyonSyncPreview() {
    return throwOnError(
        await $fetch<VeyonSyncPreview>('/api/veyon/sync/preview'),
        'Failed to load FOG sync preview',
    );
}

export async function applyVeyonSync(input: VeyonSyncApplyInput) {
    return throwOnError(
        await $fetch<VeyonSyncApplyResult>('/api/veyon/sync/apply', {
            method: 'POST',
            body: input,
        }),
        'Failed to apply FOG sync',
    );
}

export async function getVeyonSettings() {
    return throwOnError(
        await $fetch<VeyonSettings>('/api/settings/veyon'),
        'Failed to load Veyon settings',
    );
}

export async function saveVeyonSettings(input: {
    url: string;
    keyName: string;
    keyData?: string;
    verifyTls: boolean;
    testHost: string;
}) {
    return throwOnError(
        await $fetch<VeyonSettings & { success: boolean }>('/api/settings/veyon', {
            method: 'POST',
            body: input,
        }),
        'Failed to connect to Veyon',
    );
}

export async function deleteVeyonSettings() {
    return throwOnError(
        await $fetch<{ success: boolean; configured: boolean }>('/api/settings/veyon', {
            method: 'DELETE',
        }),
        'Failed to remove Veyon configuration',
    );
}

export async function getVeyonHostState(id: string) {
    return throwOnError(
        await $fetch<Record<string, unknown>>(`/api/veyon/computers/${id}/hoststate`),
        'Failed to query host state',
    );
}

export async function getVeyonAuthenticationMethods(id: string) {
    return throwOnError(
        await $fetch<{ methods: string[] }>(
            `/api/veyon/computers/${id}/authentication-methods`,
        ),
        'Failed to query authentication methods',
    );
}

export async function connectVeyonComputer(id: string) {
    return throwOnError(
        await $fetch<{ success: boolean; host: string; validUntil: number }>(
            `/api/veyon/computers/${id}/connect`,
            { method: 'POST' },
        ),
        'Failed to authenticate with key',
    );
}

export async function getVeyonUser(id: string) {
    return throwOnError(
        await $fetch<{ login: string; fullName: string }>(
            `/api/veyon/computers/${id}/user`,
        ),
        'Failed to load user information',
    );
}

export async function getVeyonSession(id: string) {
    return throwOnError(
        await $fetch<VeyonInformation['session']>(`/api/veyon/computers/${id}/session`),
        'Failed to load session information',
    );
}

export async function getVeyonFeatureStatus(id: string, featureUid: string) {
    return throwOnError(
        await $fetch<{ active: boolean }>(
            `/api/veyon/computers/${id}/feature/${featureUid}`,
        ),
        'Failed to load feature status',
    );
}

export async function setVeyonFeatureStatus(
    id: string,
    featureUid: string,
    active: boolean,
    args: Record<string, unknown> = {},
) {
    return throwOnError(
        await $fetch<{ success: boolean }>(`/api/veyon/computers/${id}/feature/${featureUid}`, {
            method: 'PUT',
            body: { active, arguments: args },
        }),
        'Failed to update feature',
    );
}
