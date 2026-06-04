import {
    Button,
    Card,
    Code,
    CopyButton,
    Group,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Textarea,
    Title,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconCopy,
    IconDownload,
    IconRefresh,
} from '@tabler/icons-react';
import { useState, type FC } from 'react';

type MacFormat = 'colon' | 'hyphen' | 'dot' | 'none' | 'cisco';

const formatMac = (mac: string, format: MacFormat): string => {
    const clean = mac.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    if (clean.length !== 12) return mac;

    const parts = clean.match(/.{1,2}/g) || [];
    switch (format) {
        case 'colon':
            return parts.join(':');
        case 'hyphen':
            return parts.join('-');
        case 'dot':
            return (clean.match(/.{1,4}/g) || []).join('.');
        case 'cisco':
            return (clean.match(/.{1,4}/g) || []).join('.');
        case 'none':
            return clean;
        default:
            return parts.join(':');
    }
};

const generateHostnames = (
    pattern: string,
    start: number,
    end: number,
    padLength: number,
): string[] => {
    const results: string[] = [];
    for (let i = start; i <= end; i++) {
        const padded = String(i).padStart(padLength, '0');
        results.push(pattern.replace('{n}', padded));
    }
    return results;
};

const FormattingTab: FC = () => {
    // Hostname generator state
    const [pattern, setPattern] = useState('LAB-PC-{n}');
    const [startNum, setStartNum] = useState(1);
    const [endNum, setEndNum] = useState(30);
    const [padLength, setPadLength] = useState(2);
    const [generatedNames, setGeneratedNames] = useState<string[]>([]);

    // MAC formatter state
    const [macInput, setMacInput] = useState('');
    const [macFormat, setMacFormat] = useState<MacFormat>('colon');
    const [formattedMacs, setFormattedMacs] = useState<string[]>([]);

    const handleGenerate = () => {
        const names = generateHostnames(pattern, startNum, endNum, padLength);
        setGeneratedNames(names);
    };

    const handleFormatMacs = () => {
        const lines = macInput
            .split(/\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        const formatted = lines.map((line) => formatMac(line, macFormat));
        setFormattedMacs(formatted);
    };

    const downloadCsv = (rows: string[], filename: string) => {
        const csv = rows.map((r) => `"${r}"`).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        notifications.show({
            color: 'green',
            title: 'Downloaded',
            message: `${filename} saved`,
            icon: <IconCheck size={16} />,
        });
    };

    const copyAll = (text: string) => {
        navigator.clipboard.writeText(text);
        notifications.show({
            color: 'blue',
            title: 'Copied',
            message: 'Content copied to clipboard',
            icon: <IconCheck size={16} />,
        });
    };

    return (
        <Stack gap='md'>
            <Title order={4}>Formatting Tools</Title>

            {/* Hostname Generator */}
            <Card withBorder p='md'>
                <Stack gap='md'>
                    <Title order={5}>Hostname Generator</Title>
                    <Text size='sm' c='dimmed'>
                        Generate sequential hostnames using{' '}
                        <Code>{'{n}'}</Code> as the placeholder.
                    </Text>

                    <Group grow align='flex-end'>
                        <TextInput
                            label='Pattern'
                            placeholder='LAB-PC-{n}'
                            value={pattern}
                            onChange={(e) => setPattern(e.currentTarget.value)}
                        />
                        <TextInput
                            label='Start'
                            type='number'
                            value={startNum}
                            onChange={(e) =>
                                setStartNum(parseInt(e.currentTarget.value || '0', 10))
                            }
                        />
                        <TextInput
                            label='End'
                            type='number'
                            value={endNum}
                            onChange={(e) =>
                                setEndNum(parseInt(e.currentTarget.value || '0', 10))
                            }
                        />
                        <TextInput
                            label='Pad Length'
                            type='number'
                            value={padLength}
                            onChange={(e) =>
                                setPadLength(parseInt(e.currentTarget.value || '0', 10))
                            }
                        />
                    </Group>

                    <Group>
                        <Button
                            leftSection={<IconRefresh size={14} />}
                            onClick={handleGenerate}
                        >
                            Generate
                        </Button>
                        {generatedNames.length > 0 && (
                            <>
                                <Button
                                    variant='light'
                                    leftSection={<IconCopy size={14} />}
                                    onClick={() =>
                                        copyAll(generatedNames.join('\n'))
                                    }
                                >
                                    Copy All
                                </Button>
                                <Button
                                    variant='light'
                                    color='green'
                                    leftSection={<IconDownload size={14} />}
                                    onClick={() =>
                                        downloadCsv(
                                            generatedNames,
                                            'hostnames.csv',
                                        )
                                    }
                                >
                                    Export CSV
                                </Button>
                            </>
                        )}
                    </Group>

                    {generatedNames.length > 0 && (
                        <Card withBorder p='xs' bg='gray.0'>
                            <Table>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>#</Table.Th>
                                        <Table.Th>Hostname</Table.Th>
                                        <Table.Th style={{ textAlign: 'right' }}>
                                            Copy
                                        </Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {generatedNames.map((name, idx) => (
                                        <Table.Tr key={idx}>
                                            <Table.Td>{idx + 1}</Table.Td>
                                            <Table.Td>
                                                <Text ff='monospace' size='sm'>
                                                    {name}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <Group justify='flex-end'>
                                                    <CopyButton value={name}>
                                                        {({ copied, copy }) => (
                                                            <Tooltip
                                                                label={
                                                                    copied
                                                                        ? 'Copied'
                                                                        : 'Copy'
                                                                }
                                                            >
                                                                <Button
                                                                    size='xs'
                                                                    variant='subtle'
                                                                    onClick={copy}
                                                                >
                                                                    <IconCopy
                                                                        size={14}
                                                                    />
                                                                </Button>
                                                            </Tooltip>
                                                        )}
                                                    </CopyButton>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Card>
                    )}
                </Stack>
            </Card>

            {/* MAC Address Formatter */}
            <Card withBorder p='md'>
                <Stack gap='md'>
                    <Title order={5}>MAC Address Formatter</Title>
                    <Text size='sm' c='dimmed'>
                        Paste MAC addresses (one per line) to normalize them.
                    </Text>

                    <Group align='flex-end' grow>
                        <Select
                            label='Output Format'
                            value={macFormat}
                            onChange={(val) =>
                                setMacFormat((val as MacFormat) || 'colon')
                            }
                            data={[
                                { value: 'colon', label: 'Colon (aa:bb:cc:dd:ee:ff)' },
                                { value: 'hyphen', label: 'Hyphen (aa-bb-cc-dd-ee-ff)' },
                                { value: 'dot', label: 'Dot (aabb.ccdd.eeff)' },
                                { value: 'none', label: 'None (aabbccddeeff)' },
                            ]}
                        />
                    </Group>

                    <Textarea
                        label='Input MACs'
                        placeholder='Paste MAC addresses, one per line...'
                        value={macInput}
                        onChange={(e) => setMacInput(e.currentTarget.value)}
                        minRows={4}
                        maxRows={8}
                    />

                    <Group>
                        <Button
                            leftSection={<IconRefresh size={14} />}
                            onClick={handleFormatMacs}
                        >
                            Format
                        </Button>
                        {formattedMacs.length > 0 && (
                            <>
                                <Button
                                    variant='light'
                                    leftSection={<IconCopy size={14} />}
                                    onClick={() =>
                                        copyAll(formattedMacs.join('\n'))
                                    }
                                >
                                    Copy All
                                </Button>
                                <Button
                                    variant='light'
                                    color='green'
                                    leftSection={<IconDownload size={14} />}
                                    onClick={() =>
                                        downloadCsv(
                                            formattedMacs,
                                            'mac-addresses.csv',
                                        )
                                    }
                                >
                                    Export CSV
                                </Button>
                            </>
                        )}
                    </Group>

                    {formattedMacs.length > 0 && (
                        <Card withBorder p='xs' bg='gray.0'>
                            <Table>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>#</Table.Th>
                                        <Table.Th>Original</Table.Th>
                                        <Table.Th>Formatted</Table.Th>
                                        <Table.Th style={{ textAlign: 'right' }}>
                                            Copy
                                        </Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {formattedMacs.map((mac, idx) => {
                                        const original = macInput
                                            .split(/\n/)
                                            .map((l) => l.trim())
                                            .filter((l) => l.length > 0)[idx];
                                        return (
                                            <Table.Tr key={idx}>
                                                <Table.Td>{idx + 1}</Table.Td>
                                                <Table.Td>
                                                    <Text
                                                        size='sm'
                                                        c='dimmed'
                                                        ff='monospace'
                                                    >
                                                        {original}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text
                                                        size='sm'
                                                        ff='monospace'
                                                        fw={500}
                                                    >
                                                        {mac}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group justify='flex-end'>
                                                        <CopyButton
                                                            value={mac}
                                                        >
                                                            {({
                                                                copied,
                                                                copy,
                                                            }) => (
                                                                <Tooltip
                                                                    label={
                                                                        copied
                                                                            ? 'Copied'
                                                                            : 'Copy'
                                                                    }
                                                                >
                                                                    <Button
                                                                        size='xs'
                                                                        variant='subtle'
                                                                        onClick={
                                                                            copy
                                                                        }
                                                                    >
                                                                        <IconCopy
                                                                            size={
                                                                                14
                                                                            }
                                                                        />
                                                                    </Button>
                                                                </Tooltip>
                                                            )}
                                                        </CopyButton>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        </Card>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
};

export default FormattingTab;
