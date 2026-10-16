import { getFogHost, type FogHost } from '@/api/fog';
import { Badge, HoverCard, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

export function InventoryCard({ host }: { host: FogHost }) {
    const inventory = host.inventory;
    return (
        <HoverCard width={320} shadow='md' withArrow>
            <HoverCard.Target>
                <Badge radius='md' style={{ cursor: 'help' }}>
                    {inventory?.sysman || 'Unknown'} /{' '}
                    {inventory?.sysproduct || 'Unknown'}
                </Badge>
            </HoverCard.Target>
            <HoverCard.Dropdown>
                <InventoryDetails host={host} />
            </HoverCard.Dropdown>
        </HoverCard>
    );
}

export function InventoryHostDetails({ host }: { host: FogHost }) {
    const [details, setDetails] = useState<FogHost | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        getFogHost(host.id)
            .then((data) => {
                if (active) setDetails(data);
            })
            .catch((err: unknown) => {
                if (active)
                    setError(
                        err instanceof Error
                            ? err.message
                            : 'Failed to load inventory',
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [host.id]);
    return (
        <Stack gap='xs'>
            {loading ? (
                <Text size='sm' role='status'>
                    Loading inventory...
                </Text>
            ) : null}
            {error ? (
                <Text size='sm' c='red' role='alert'>
                    {error}
                </Text>
            ) : null}
            {details || host.inventory ? (
                <InventoryDetails host={details ?? host} withTitle={false} />
            ) : !loading && !error ? (
                <Text c='dimmed' size='sm'>
                    No inventory
                </Text>
            ) : null}
        </Stack>
    );
}

export function InventoryDetails({
    host,
    withTitle = true,
}: {
    host: FogHost;
    withTitle?: boolean;
}) {
    const inventory = host.inventory;
    const fields = inventory
        ? [
              ['Manufacturer', inventory.sysman],
              ['Model', inventory.sysproduct],
              ['Version', inventory.sysversion],
              ['Serial', inventory.sysserial],
              ['UUID', inventory.sysuuid],
              ['System type', inventory.systype],
              [
                  'BIOS',
                  [
                      inventory.biosvendor,
                      inventory.biosversion,
                      inventory.biosdate,
                  ]
                      .filter(Boolean)
                      .join(' '),
              ],
              [
                  'CPU',
                  [inventory.cpuman, inventory.cpuversion]
                      .filter(Boolean)
                      .join(' '),
              ],
              ['CPU speed', inventory.cpucurrent],
              ['Maximum CPU speed', inventory.cpumax],
              ['Memory', inventory.memory?.trim() || inventory.mem],
              [
                  'HDD',
                  [inventory.hdmodel, inventory.hdserial]
                      .filter(Boolean)
                      .join(' '),
              ],
              ['Disk firmware', inventory.hdfirmware],
              [
                  'Motherboard',
                  [
                      inventory.mbman,
                      inventory.mbproductname,
                      inventory.mbversion,
                  ]
                      .filter(Boolean)
                      .join(' '),
              ],
              ['Motherboard serial', inventory.mbserial],
              ['Motherboard asset', inventory.mbasset],
              [
                  'Chassis',
                  [inventory.caseman, inventory.casever]
                      .filter(Boolean)
                      .join(' '),
              ],
              ['Chassis serial', inventory.caseserial],
              ['Chassis asset', inventory.caseasset],
              [
                  'GPU',
                  [inventory.gpuvendors, inventory.gpuproducts]
                      .filter(Boolean)
                      .join(' '),
              ],
              ['Primary user', inventory.primaryUser],
              ['Other tag', inventory.other1],
              ['Other tag 2', inventory.other2],
              ['Collected', inventory.createdTime],
          ].filter(([, value]) => value?.trim())
        : [];
    if (fields.length === 0) {
        return (
            <Text c='dimmed' size='sm'>
                No inventory
            </Text>
        );
    }
    return (
        <Stack gap='xs'>
            {withTitle ? (
                <Text size='md' fw={600}>
                    Inventory
                </Text>
            ) : null}
            {fields.map(([label, value]) => (
                <Text key={label} size='xs'>
                    <strong>{label}:</strong> {value}
                </Text>
            ))}
        </Stack>
    );
}
