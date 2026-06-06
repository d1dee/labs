/*     {selectedHost && (
                <Card withBorder p='md'>
                    <Stack gap='md'>
                        <Group justify='space-between'>
                            <div>
                                <Title order={5}>{selectedHost.name}</Title>
                                <Text size='sm' c='dimmed'>
                                    Host details and available actions.
                                </Text>
                            </div>
                            <Badge size='lg'>ID: {selectedHost.id}</Badge>
                        </Group>

                        {hostDetailLoading && <Loader size='sm' />}

                        <Group grow align='flex-start'>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>MAC Addresses</Title>
                                    <Text size='sm' c='dimmed'>
                                        Network addresses for this host.
                                    </Text>
                                </div>
                                <Stack gap={4}>
                                    {selectedHost.macs?.map((mac) => (
                                        <Group key={mac} gap='xs'>
                                            <Text ff='monospace' size='sm'>
                                                {mac}
                                            </Text>
                                            <ActionIcon
                                                size='xs'
                                                variant='subtle'
                                                onClick={() =>
                                                    copyToClipboard(mac)
                                                }
                                            >
                                                <IconCopy size={12} />
                                            </ActionIcon>
                                        </Group>
                                    )) || <Text size='sm'>-</Text>}
                                </Stack>
                            </Stack>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Description</Title>
                                    <Text size='sm' c='dimmed'>
                                        Notes or details about this host.
                                    </Text>
                                </div>
                                <Text size='sm'>
                                    {selectedHost.description || '-'}
                                </Text>
                            </Stack>
                        </Group>

                        <Group grow align='flex-start'>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Current Image</Title>
                                    <Text size='sm' c='dimmed'>
                                        The image currently linked to this host.
                                    </Text>
                                </div>
                                <Text size='sm' fw={500}>
                                    {selectedHost.imagename || 'None assigned'}
                                </Text>
                            </Stack>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Assign Image</Title>
                                    <Text size='sm' c='dimmed'>
                                        Choose a new image to deploy to this
                                        host.
                                    </Text>
                                </div>
                                <Select
                                    placeholder='Select image...'
                                    data={images.map((img) => ({
                                        value: String(img.id),
                                        label: img.name,
                                    }))}
                                    onChange={(val) => {
                                        if (val)
                                            handleAssignImage(
                                                parseInt(val, 10),
                                            );
                                    }}
                                    clearable
                                />
                            </Stack>
                        </Group>

                        <Stack gap='xs'>
                            <div>
                                <Title order={6}>Imaging Actions</Title>
                                <Text size='sm' c='dimmed'>
                                    Start deploy, capture, or snapin tasks.
                                </Text>
                            </div>
                            <Group gap='sm'>
                                <Button
                                    size='sm'
                                    color='green'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (selectedHost && deployTaskTypeId) {
                                            handleCreateTask(
                                                selectedHost,
                                                deployTaskTypeId,
                                            );
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Deploy Type',
                                                message:
                                                    'Could not detect deploy task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!deployTaskTypeId}
                                >
                                    Deploy
                                </Button>
                                <Button
                                    size='sm'
                                    color='orange'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (selectedHost && captureTaskTypeId) {
                                            handleCreateTask(
                                                selectedHost,
                                                captureTaskTypeId,
                                            );
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Capture Type',
                                                message:
                                                    'Could not detect capture task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!captureTaskTypeId}
                                >
                                    Capture
                                </Button>
                                <Button
                                    size='sm'
                                    color='blue'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() =>
                                        handleOpenSnapinModal(selectedHost)
                                    }
                                    loading={taskLoading}
                                >
                                    Send Snapin
                                </Button>
                            </Group>
                        </Stack>

                        {taskTypes.length > 0 && (
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>
                                        Available Task Types
                                    </Title>
                                    <Text size='sm' c='dimmed'>
                                        All task types defined in FOG.
                                    </Text>
                                </div>
                                <Group gap='xs'>
                                    {taskTypes.map((tt) => (
                                        <Badge
                                            key={tt.id}
                                            variant='outline'
                                            size='sm'
                                        >
                                            {tt.id}: {tt.name}
                                        </Badge>
                                    ))}
                                </Group>
                            </Stack>
                        )}
                    </Stack>
                </Card>
            )}    {selectedHost && (
                <Card withBorder p='md'>
                    <Stack gap='md'>
                        <Group justify='space-between'>
                            <div>
                                <Title order={5}>{selectedHost.name}</Title>
                                <Text size='sm' c='dimmed'>
                                    Host details and available actions.
                                </Text>
                            </div>
                            <Badge size='lg'>ID: {selectedHost.id}</Badge>
                        </Group>

                        {hostDetailLoading && <Loader size='sm' />}

                        <Group grow align='flex-start'>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>MAC Addresses</Title>
                                    <Text size='sm' c='dimmed'>
                                        Network addresses for this host.
                                    </Text>
                                </div>
                                <Stack gap={4}>
                                    {selectedHost.macs?.map((mac) => (
                                        <Group key={mac} gap='xs'>
                                            <Text ff='monospace' size='sm'>
                                                {mac}
                                            </Text>
                                            <ActionIcon
                                                size='xs'
                                                variant='subtle'
                                                onClick={() =>
                                                    copyToClipboard(mac)
                                                }
                                            >
                                                <IconCopy size={12} />
                                            </ActionIcon>
                                        </Group>
                                    )) || <Text size='sm'>-</Text>}
                                </Stack>
                            </Stack>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Description</Title>
                                    <Text size='sm' c='dimmed'>
                                        Notes or details about this host.
                                    </Text>
                                </div>
                                <Text size='sm'>
                                    {selectedHost.description || '-'}
                                </Text>
                            </Stack>
                        </Group>

                        <Group grow align='flex-start'>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Current Image</Title>
                                    <Text size='sm' c='dimmed'>
                                        The image currently linked to this host.
                                    </Text>
                                </div>
                                <Text size='sm' fw={500}>
                                    {selectedHost.imagename || 'None assigned'}
                                </Text>
                            </Stack>
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>Assign Image</Title>
                                    <Text size='sm' c='dimmed'>
                                        Choose a new image to deploy to this
                                        host.
                                    </Text>
                                </div>
                                <Select
                                    placeholder='Select image...'
                                    data={images.map((img) => ({
                                        value: String(img.id),
                                        label: img.name,
                                    }))}
                                    onChange={(val) => {
                                        if (val)
                                            handleAssignImage(
                                                parseInt(val, 10),
                                            );
                                    }}
                                    clearable
                                />
                            </Stack>
                        </Group>

                        <Stack gap='xs'>
                            <div>
                                <Title order={6}>Imaging Actions</Title>
                                <Text size='sm' c='dimmed'>
                                    Start deploy, capture, or snapin tasks.
                                </Text>
                            </div>
                            <Group gap='sm'>
                                <Button
                                    size='sm'
                                    color='green'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (selectedHost && deployTaskTypeId) {
                                            handleCreateTask(
                                                selectedHost,
                                                deployTaskTypeId,
                                            );
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Deploy Type',
                                                message:
                                                    'Could not detect deploy task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!deployTaskTypeId}
                                >
                                    Deploy
                                </Button>
                                <Button
                                    size='sm'
                                    color='orange'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (selectedHost && captureTaskTypeId) {
                                            handleCreateTask(
                                                selectedHost,
                                                captureTaskTypeId,
                                            );
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Capture Type',
                                                message:
                                                    'Could not detect capture task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!captureTaskTypeId}
                                >
                                    Capture
                                </Button>
                                <Button
                                    size='sm'
                                    color='blue'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() =>
                                        handleOpenSnapinModal(selectedHost)
                                    }
                                    loading={taskLoading}
                                >
                                    Send Snapin
                                </Button>
                            </Group>
                        </Stack>

                        {taskTypes.length > 0 && (
                            <Stack gap='xs'>
                                <div>
                                    <Title order={6}>
                                        Available Task Types
                                    </Title>
                                    <Text size='sm' c='dimmed'>
                                        All task types defined in FOG.
                                    </Text>
                                </div>
                                <Group gap='xs'>
                                    {taskTypes.map((tt) => (
                                        <Badge
                                            key={tt.id}
                                            variant='outline'
                                            size='sm'
                                        >
                                            {tt.id}: {tt.name}
                                        </Badge>
                                    ))}
                                </Group>
                            </Stack>
                        )}
                    </Stack>
                </Card>
            )} */
