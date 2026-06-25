export interface FogHostScreen {
    id: number | null;
    hostID: number | null;
    width: number | null;
    height: number | null;
    refresh: number | null;
    orientation: number | null;
    other1: number | null;
    other2: number | null;
}

export interface FogHostAlo {
    id: number | null;
    hostID: number | null;
    time: number | null;
}

export interface FogInventory {
    id: number;
    hostID: number;
    primaryUser: string;
    other1: string;
    other2: string;
    createdTime: string;
    deleteDate: string;
    sysman: string;
    sysproduct: string;
    sysversion: string;
    sysserial: string;
    sysuuid: string;
    systype: string;
    biosversion: string;
    biosvendor: string;
    biosdate: string;
    mbman: string;
    mbproductname: string;
    mbversion: string;
    mbserial: string;
    mbasset: string;
    cpuman: string;
    cpuversion: string;
    cpucurrent: string;
    cpumax: string;
    mem: string;
    hdmodel: string;
    hdserial: string;
    hdfirmware: string;
    caseman: string;
    casever: string;
    caseserial: string;
    caseasset: string;
    gpuvendors: string;
    gpuproducts: string;
    memory: string;
}

export interface FogImageDetails {
    imageTypeID: number;
    imagePartitionTypeID: number;
    id: number;
    name: string;
    description: string;
    path: string;
    createdTime: string;
    createdBy: string;
    building: number;
    size: string;
    osID: number;
    deployed: string;
    format: string;
    magnet: string;
    protected: number;
    compress: number;
    isEnabled: string;
    toReplicate: string;
    srvsize: number;
    os: Record<string, unknown>;
    imagepartitiontype: Record<string, unknown>;
    imagetype: Record<string, unknown>;
}

export interface FogHost {
    id: number;
    name: string;
    description?: string;
    ip?: string;
    imageID?: number;
    building?: number;
    createdTime?: string;
    deployed?: string;
    createdBy?: string;
    useAD?: string;
    ADDomain?: string;
    ADOU?: string;
    ADUser?: string;
    ADPass?: string;
    ADPassLegacy?: string;
    productKey?: string;
    printerLevel?: string;
    kernelArgs?: string;
    kernel?: string;
    kernelDevice?: string;
    init?: string;
    pending?: string;
    pub_key?: string;
    sec_tok?: string;
    sec_time?: string;
    pingstatus?: string;
    biosexit?: string;
    efiexit?: string;
    enforce?: string;
    token?: string;
    tokenlock?: number;
    primac?: string;
    imagename?: string;
    hostscreen?: FogHostScreen;
    hostalo?: FogHostAlo;
    inventory?: FogInventory;
    image?: FogImageDetails;
    pingstatuscode?: number;
    pingstatustext?: string;
    macs?: string[];
    snapinID?: number[];
    [key: string]: unknown;
}

export type ListFogHosts = {
    count: number;
    hosts: FogHost[];
};

export type ListFogImages = {
    count: number;
    images: FogImage[];
};

export type ListFogTaskTypes = {
    count: number;
    tasktypes: FogTaskType[];
};

export type ListFogSnapins = {
    count: number;
    snapins: FogSnapin[];
};

export interface FogActiveTask {
    id: number;
    name?: string;
    hostID?: number;
    hostName?: string;
    host?: FogHost;
    typeID?: number;
    typeName?: string;
    type?: FogTaskType;
    stateID?: number;
    state?: FogTaskState;
    percent?: number | string;
    createdTime?: string;
    checkInTime?: string;
    completed?: string | number;
    createdBy?: string;
    isForced?: string;
    scheduledStartTime?: string;
    pct?: string;
    bpm?: string;
    timeElapsed?: string;
    timeRemaining?: string;
    dataCopied?: string;
    dataTotal?: string;
    storagegroupID?: number;
    storagenodeID?: number;
    NFSFailures?: string;
    NFSLastMemberID?: number;
    shutdown?: string;
    passreset?: string;
    isDebug?: number;
    imageID?: number;
    wol?: string;
    image?: FogImageDetails;
    storagenode?: FogStorageNode;
    storagegroup?: FogStorageGroup;
    [key: string]: unknown;
}

export type ListActiveFogTasks = {
    count: number;
    tasks: FogActiveTask[];
};

export type ListActiveFogMulticastSessions = {
    count: number;
    multicastsessions: unknown[];
};

export interface FogImage {
    id: number;
    name: string;
    description?: string;
    path?: string;
    size?: string;
    [key: string]: unknown;
}

export interface FogTaskType {
    id: number;
    name: string;
    description?: string;
    icon?: string;
    kernel?: string;
    kernelArgs?: string;
    type?: string;
    isAdvanced?: string;
    access?: string;
    initrd?: string;
    [key: string]: unknown;
}

export interface FogTaskState {
    id: number;
    name: string;
    description?: string;
    order?: number;
    icon?: string;
    [key: string]: unknown;
}

export interface FogStorageNode {
    id: number;
    name: string;
    description?: string;
    isMaster?: string;
    storagegroupID?: number;
    isEnabled?: string;
    isGraphEnabled?: string;
    path?: string;
    ftppath?: string;
    bitrate?: string;
    helloInterval?: string;
    snapinpath?: string;
    sslpath?: string;
    ip?: string;
    maxClients?: number;
    user?: string;
    pass?: string;
    key?: string;
    interface?: string;
    bandwidth?: number;
    webroot?: string;
    storagegroup?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface FogStorageGroup {
    id: number;
    name: string;
    description?: string;
    [key: string]: unknown;
}

export interface FogSnapin {
    id: number;
    name: string;
    description?: string;
    file?: string;
    args?: string;
    [key: string]: unknown;
}

export interface FogTaskResult {
    id?: number;
    name?: string;
    message?: string;
    [key: string]: unknown;
}

export async function getFogStatus(): Promise<{
    configured: boolean;
    url: string | null;
}> {
    const response = await fetch('/api/fog/status', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch FOG status');
    }
    return response.json() as Promise<{
        configured: boolean;
        url: string | null;
    }>;
}

export async function getFogSystemInfo(): Promise<unknown> {
    const response = await fetch('/api/fog/system-info', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch FOG system info');
    }
    return response.json();
}

export async function listFogHosts(search?: string): Promise<ListFogHosts> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const response = await fetch(`/api/fog/hosts${query}`, {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list FOG hosts');
    }
    return response.json() as Promise<ListFogHosts>;
}

export async function getFogHost(id: number): Promise<FogHost> {
    const response = await fetch(`/api/fog/hosts/${id}`, {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(`Failed to get FOG host ${id}`);
    }
    return response.json() as Promise<FogHost>;
}

export async function createFogHost(hostData: {
    name: string;
    macs: string[];
    description?: string;
    imageID?: number;
}): Promise<FogHost> {
    const response = await fetch('/api/fog/hosts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hostData),
    });
    if (!response.ok) {
        throw new Error('Failed to create FOG host');
    }
    return response.json() as Promise<FogHost>;
}

export async function updateFogHost(
    id: number,
    updates: Partial<FogHost>,
): Promise<FogHost> {
    const response = await fetch(`/api/fog/hosts/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!response.ok) {
        throw new Error(`Failed to update FOG host ${id}`);
    }
    return response.json() as Promise<FogHost>;
}

export async function deleteFogHost(id: number): Promise<{ success: boolean }> {
    const response = await fetch(`/api/fog/hosts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(`Failed to delete FOG host ${id}`);
    }
    return response.json() as Promise<{ success: boolean }>;
}

export async function listFogImages(): Promise<ListFogImages> {
    const response = await fetch('/api/fog/images', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list FOG images');
    }
    return response.json() as Promise<ListFogImages>;
}

export async function listFogTaskTypes(): Promise<ListFogTaskTypes> {
    const response = await fetch('/api/fog/tasktypes', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list FOG task types');
    }
    return response.json() as Promise<ListFogTaskTypes>;
}

export async function listFogSnapins(): Promise<ListFogSnapins> {
    const response = await fetch('/api/fog/snapins', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list FOG snapins');
    }
    return response.json() as Promise<ListFogSnapins>;
}

export async function listActiveFogTasks(): Promise<ListActiveFogTasks> {
    const response = await fetch('/api/fog/tasks/active', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list active FOG tasks');
    }
    return response.json() as Promise<ListActiveFogTasks>;
}

export async function listActiveFogMulticastSessions(): Promise<ListActiveFogMulticastSessions> {
    const response = await fetch('/api/fog/multicastsessions/current', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to list active multicast sessions');
    }
    return response.json() as Promise<ListActiveFogMulticastSessions>;
}

export async function cancelFogTask(taskId: number): Promise<{ success: boolean }> {
    const response = await fetch(`/api/fog/tasks/${taskId}/cancel`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to cancel FOG task ${taskId}`);
    }
    return response.json() as Promise<{ success: boolean }>;
}

export async function pauseFogTask(taskId: number): Promise<{ success: boolean }> {
    const response = await fetch(`/api/fog/tasks/${taskId}/pause`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to pause FOG task ${taskId}`);
    }
    return response.json() as Promise<{ success: boolean }>;
}

export async function forceFogTask(taskId: number): Promise<{ success: boolean }> {
    const response = await fetch(`/api/fog/tasks/${taskId}/force`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to force FOG task ${taskId}`);
    }
    return response.json() as Promise<{ success: boolean }>;
}

export async function restartFogTask(taskId: number, hostId?: number, taskTypeId?: number): Promise<{ success: boolean }> {
    const response = await fetch(`/api/fog/tasks/${taskId}/restart`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, taskTypeId }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Failed to restart FOG task ${taskId}`);
    }
    return response.json() as Promise<{ success: boolean }>;
}

export async function createFogTask(
    hostId: number,
    taskTypeId: number,
    options?: Record<string, unknown>,
): Promise<FogTaskResult> {
    const response = await fetch(`/api/fog/hosts/${hostId}/task`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTypeID: taskTypeId, ...options }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || error.message || 'Failed to create FOG task');
    }
    // FOG returns null or "" on success
    const text = await response.text();
    if (text === '' || text === 'null') {
        return { success: true };
    }
    return response.json() as Promise<FogTaskResult>;
}

export async function createFogSnapinTask(
    hostId: number,
    snapinId: number,
    options?: Record<string, unknown>,
): Promise<FogTaskResult> {
    const response = await fetch(`/api/fog/hosts/${hostId}/snapin-task`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapinID: snapinId, ...options }),
    });
    if (!response.ok) {
        throw new Error('Failed to create FOG snapin task');
    }
    return response.json() as Promise<FogTaskResult>;
}
