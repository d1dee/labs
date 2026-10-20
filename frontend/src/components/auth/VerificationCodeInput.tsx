import { Box, Group, Text, TextInput } from '@mantine/core';
import { ClipboardEvent, FC, KeyboardEvent, useId, useRef } from 'react';

export const VERIFICATION_CODE_LENGTH = 6;

export const emptyVerificationDigits = (): string[] =>
    Array.from({ length: VERIFICATION_CODE_LENGTH }, () => '');

interface VerificationCodeInputProps {
    digits: string[];
    onChange: (digits: string[]) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    invalid?: boolean;
}

/**
 * One box per code character. Typing advances to the next box, backspace on an
 * empty box steps back, and a pasted code fills every remaining box at once.
 */
const VerificationCodeInput: FC<VerificationCodeInputProps> = ({
    digits,
    onChange,
    disabled,
    autoFocus,
    invalid,
}) => {
    const labelId = useId();
    const inputs = useRef<Array<HTMLInputElement | null>>([]);

    const focusBox = (index: number): void => {
        const target = Math.min(Math.max(index, 0), VERIFICATION_CODE_LENGTH - 1);
        inputs.current[target]?.focus();
    };

    const fillFrom = (index: number, characters: string): void => {
        const next = [...digits];
        for (
            let offset = 0;
            offset < characters.length &&
            index + offset < VERIFICATION_CODE_LENGTH;
            offset += 1
        ) {
            next[index + offset] = characters[offset];
        }
        onChange(next);
        const nextEmpty = next.findIndex((digit) => digit === '');
        focusBox(nextEmpty === -1 ? VERIFICATION_CODE_LENGTH - 1 : nextEmpty);
    };

    const setDigit = (index: number, character: string): void => {
        const next = [...digits];
        next[index] = character;
        onChange(next);
        focusBox(index + 1);
    };

    const handleChange = (index: number, text: string): void => {
        const characters = text.replace(/\D/g, '');
        if (!characters) {
            const next = [...digits];
            next[index] = '';
            onChange(next);
            return;
        }
        const previous = digits[index] ?? '';
        // Typing over a filled box appends to its value, so only the last
        // character belongs to that box.
        if (
            previous &&
            characters.length > 1 &&
            characters.startsWith(previous)
        ) {
            setDigit(index, characters[characters.length - 1]);
            return;
        }
        if (characters.length > 1) {
            fillFrom(index, characters);
            return;
        }
        setDigit(index, characters);
    };

    const handleKeyDown = (
        index: number,
        event: KeyboardEvent<HTMLInputElement>,
    ): void => {
        if (event.key === 'Backspace' && !digits[index] && index > 0) {
            event.preventDefault();
            const next = [...digits];
            next[index - 1] = '';
            onChange(next);
            focusBox(index - 1);
            return;
        }
        if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault();
            focusBox(index - 1);
        }
        if (event.key === 'ArrowRight' && index < VERIFICATION_CODE_LENGTH - 1) {
            event.preventDefault();
            focusBox(index + 1);
        }
    };

    const handlePaste = (
        index: number,
        event: ClipboardEvent<HTMLInputElement>,
    ): void => {
        const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
        if (!pasted) return;
        event.preventDefault();
        fillFrom(index, pasted);
    };

    return (
        <Box role='group' aria-labelledby={labelId}>
            <Text id={labelId} size='sm' fw={500} mb={6}>
                Verification Code
            </Text>
            <Group gap='xs' wrap='nowrap' justify='center'>
                {digits.map((digit, index) => (
                    <TextInput
                        key={index}
                        ref={(element) => {
                            inputs.current[index] = element;
                        }}
                        value={digit}
                        onChange={(event) =>
                            handleChange(index, event.currentTarget.value)
                        }
                        onKeyDown={(event) => handleKeyDown(index, event)}
                        onPaste={(event) => handlePaste(index, event)}
                        aria-label={`Digit ${index + 1} of ${VERIFICATION_CODE_LENGTH}`}
                        inputMode='numeric'
                        autoComplete={
                            index === 0 ? 'one-time-code' : 'off'
                        }
                        disabled={disabled}
                        autoFocus={autoFocus && index === 0}
                        error={invalid}
                        w={48}
                        size='lg'
                        styles={{
                            input: {
                                textAlign: 'center',
                                fontFamily:
                                    'var(--mantine-font-family-monospace)',
                                letterSpacing: 1,
                            },
                        }}
                    />
                ))}
            </Group>
        </Box>
    );
};

export default VerificationCodeInput;
