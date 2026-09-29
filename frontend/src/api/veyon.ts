import { $fetch, throwOnError } from './client';

export const VEYON_AUTH_METHODS = {
    authKeys: '0c69b301-81b4-42d6-8fae-128cdd113314',
    ldap: '6f0a491e-c1c6-4338-8244-f823b0bf8670',
    logon: '63611f7c-b457-42c7-832e-67d0f9281085',
    simple: '73430b14-ef69-4c75-a145-ba635d1cc676',
} as const;

export interface VeyonComputer {
    id: string;
    name: string;
    host: string;
    macAddress: string | null;
    location: string | null;
    createdAt: string;
    updatedAt: string;
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

export interface VeyonSettings {
    configured: boolean;
    url: string;
    authMethod: string;
    username: string;
    passwordConfigured: boolean;
    keyName: string;
    keyConfigured: boolean;
    verifyTls: boolean;
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
            results: Array<{ id: string; name: string; success: boolean; error?: string }>;
        }>('/api/veyon/commands', { method: 'POST', body: input }),
        'Veyon command failed',
    );
}

export async function powerOnVeyonComputer(id: string) {
    return throwOnError(
        await $fetch<{ success: boolean }>(`/api/veyon/computers/${id}/power-on`, {
            method: 'POST',
        }),
        'Failed to power on computer',
    );
}

export async function setVeyonDemo(input: {
    sourceComputerId: string;
    computerIds: string[];
    windowed: boolean;
    active: boolean;
}) {
    return throwOnError(
        await $fetch<{ success: boolean; targets: number; failed: number }>(
            '/api/veyon/demo',
            { method: 'POST', body: input },
        ),
        'Failed to update demonstration mode',
    );
}

export async function launchVeyonRemoteAccess(id: string, mode: 'view' | 'control') {
    return throwOnError(
        await $fetch<{ success: boolean }>(`/api/veyon/computers/${id}/remote-access`, {
            method: 'POST',
            body: { mode },
        }),
        'Failed to launch Veyon remote access',
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
    authMethod: string;
    username?: string;
    password?: string;
    keyName?: string;
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
