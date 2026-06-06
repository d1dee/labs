/* 

    const handleSendSnapin = async () => {
        if (!taskingHost || !selectedSnapin) return;
        setTaskLoading(true);
        try {
            const snapinId = parseInt(selectedSnapin, 10);
            const result = await createFogSnapinTask(taskingHost.id, snapinId);
            notifications.show({
                color: 'green',
                title: 'Snapin Task Sent',
                message:
                    result.message || `Snapin task sent to ${taskingHost.name}`,
                icon: <IconCheck size={16} />,
            });
            setSnapinModalOpen(false);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Snapin Task Failed',
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setTaskLoading(false);
        }
    };
export function SnapinModal() {
    return (
        <Modal
            opened={snapinModalOpen}
            onClose={() => setSnapinModalOpen(false)}
            title={`Send Snapin to ${taskingHost?.name}`}
            centered
        >
            <Stack gap='md'>
                <Select
                    label='Select Snapin'
                    placeholder='Choose a snapin...'
                    data={snapins?.map((s) => ({
                        value: String(s.id),
                        label: s.name,
                    }))}
                    value={selectedSnapin}
                    onChange={setSelectedSnapin}
                    searchable
                    nothingFoundMessage='No snapins found'
                />
                {selectedSnapin && (
                    <Text size='sm' c='dimmed'>
                        {
                            snapins.find(
                                (s) => s.id === parseInt(selectedSnapin, 10),
                            )?.description
                        }
                    </Text>
                )}
                <Group justify='flex-end' mt='md'>
                    <Button
                        variant='default'
                        onClick={() => setSnapinModalOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        color='blue'
                        onClick={handleSendSnapin}
                        loading={taskLoading}
                        disabled={!selectedSnapin}
                    >
                        Send Snapin
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
 */
