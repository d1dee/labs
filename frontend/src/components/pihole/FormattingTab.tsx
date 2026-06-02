import { Card, Center, Stack, Text, Title } from '@mantine/core';
import { IconBrush } from '@tabler/icons-react';
import { type FC } from 'react';

const FormattingTab: FC = () => {
    return (
        <Stack gap='md'>
            <Title order={4}>Formatting</Title>
            <Card withBorder p='xl'>
                <Center>
                    <Stack align='center' gap='sm'>
                        <IconBrush size={48} color='gray' />
                        <Text size='lg' fw={500}>Coming Soon</Text>
                        <Text c='dimmed' ta='center' maw={400}>
                            Formatting features will be implemented in a future
                            update. This section will include data export,
                            report generation, and formatting tools.
                        </Text>
                    </Stack>
                </Center>
            </Card>
        </Stack>
    );
};

export default FormattingTab;
