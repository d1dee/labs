import {
    Anchor,
    Button,
    Container,
    Group,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import dayjs from 'dayjs';
import { FC } from 'react';

const Landing: FC = () => {
    return (
        <Stack h='100vh' gap={0} bg='dark.7' c='gray.3'>
            <Container size='xl' py='md' w='100%' h={60}>
                <Group justify='space-between' h='100%'>
                    <Title order={4} c='white'>
                        Labs FCD
                    </Title>
                    <Anchor href='/app' c='dimmed' size='sm'>
                        Sign In
                    </Anchor>
                </Group>
            </Container>

            <Stack flex={1} justify='center' align='center' px='md'>
                <Container size='md' ta='center'>
                    <Title order={1} size='3rem' c='white' mb='lg'>
                        Lab Firewall & Control Dashboard
                    </Title>
                    <Text size='xl' c='dimmed' mb='xl'>
                        Manage lab firewall rules, monitor network activity,
                        control DNS blocking, and deploy software — all from one
                        place.
                    </Text>
                    <Button
                        component='a'
                        href='/app'
                        size='lg'
                        radius='md'
                    >
                        Open Dashboard
                    </Button>
                </Container>
            </Stack>

            <Container size='xl' py='md' ta='center'>
                <Text size='sm' c='dimmed'>
                    Crafted with care:{' '}
                    <Anchor
                        href='https://github.com/d1dee'
                        target='_blank'
                        c='dimmed'
                    >
                        Maina Derrick © {dayjs().year()}
                    </Anchor>
                </Text>
            </Container>
        </Stack>
    );
};

export default Landing;
