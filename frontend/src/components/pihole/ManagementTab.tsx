import { Card, Center, Stack, Text, Title } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { type FC } from 'react';

const ManagementTab: FC = () => {
    return (
        <Stack gap='md'>
            <Title order={4}>Management</Title>
            <Card withBorder p='xl'>
                <Center>
                    <Stack align='center' gap='sm'>
                        <IconSettings size={48} color='gray' />
                        <Text size='lg' fw={500}>Coming Soon</Text>
                        <Text c='dimmed' ta='center' maw={400}>
                            Management features will be implemented in a future
                            update. This section will include user management,
                            system settings, and advanced configuration options.
                        </Text>
                    </Stack>
                </Center>
            </Card>
        </Stack>
    );
};

export default ManagementTab;
