import {
    ActionIcon,
    CheckIcon,
    Combobox,
    Group,
    Input,
    InputBase,
    ScrollArea,
    useCombobox,
    type InputBaseProps,
    type PolymorphicComponentProps,
} from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import {
    AsYouType,
    getCountries,
    getExampleNumber,
    parsePhoneNumberFromString,
    type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/mobile/examples';
import { memo, useEffect, useRef, useState } from 'react';
import { IMaskInput } from 'react-imask';

countries.registerLocale(en);

function getFlagEmoji(countryCode: string) {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

const libIsoCountries = countries.getNames('en', { select: 'official' });
const libPhoneNumberCountries = getCountries();

const countryOptionsDataMap = Object.fromEntries(
    libPhoneNumberCountries
        .map((code) => {
            const name = libIsoCountries[code] ?? code;
            const emoji = getFlagEmoji(code);

            return [
                code,
                {
                    code,
                    name,
                    emoji,
                },
            ] as [
                CountryCode,
                {
                    code: CountryCode;
                    name: string;
                    emoji: string;
                },
            ];
        })
        .filter((o) => !!o),
);

const countryOptionsData = Object.values(countryOptionsDataMap);

type Country = (typeof countryOptionsData)[number];

function getFormat(countryCode: CountryCode) {
    const example = getExampleNumber(countryCode, examples)?.formatNational() ?? '';
    const mask = example ? example.replace(/\d/g, '0') : '000000000000000';
    return { example, mask };
}

function getInitialDataFromValue(
    value: string | null | undefined,
    options: {
        initialCountryCode: CountryCode;
    },
): {
    country: Country;
    format: ReturnType<typeof getFormat>;
    localValue: string;
} {
    const defaultValue = {
        country: countryOptionsDataMap[options.initialCountryCode],
        format: getFormat(options.initialCountryCode),
        localValue: '',
    };
    if (!value) return defaultValue;
    const phoneNumber = parsePhoneNumberFromString(value);
    if (!phoneNumber) return defaultValue;
    if (!phoneNumber.country) return defaultValue;
    return {
        country: countryOptionsDataMap[phoneNumber.country],
        localValue: phoneNumber.formatNational().replace(/\D/g, ''),
        format: getFormat(phoneNumber.country),
    };
}

export type PhoneInputProps = {
    initialCountryCode?: CountryCode;
    value?: string | null;
    defaultValue?: string | null;
} & Omit<
    PolymorphicComponentProps<'input', InputBaseProps>,
    'onChange' | 'defaultValue' | 'value' | 'component' | 'renderRoot'
> & { onChange: (value: string | null) => void };

export function PhoneNumberInput({
    initialCountryCode = 'KE',
    value: _value,
    onChange: _onChange,
    defaultValue,
    ...props
}: PhoneInputProps) {
    const [data, setData] = useState(() => getInitialDataFromValue(
        _value === undefined ? defaultValue : _value,
        { initialCountryCode },
    ));
    const [previousValue, setPreviousValue] = useState(_value);
    const lastNotifiedValue = useRef(_value);
    // Synchronize external values before IMask renders, without notifying consumers.
    if (_value !== previousValue) {
        setPreviousValue(_value);
        if (_value !== undefined && _value !== lastNotifiedValue.current) {
            setData(getInitialDataFromValue(_value, { initialCountryCode }));
        }
        lastNotifiedValue.current = _value;
    }
    const { country, format, localValue } = data;
    const inputRef = useRef<HTMLInputElement>(null);

    const { readOnly, disabled } = props;
    const leftSectionWidth = 45;

    const handleCountryChange = (country: Country) => {
        setData({ country, format: getFormat(country.code), localValue: '' });
        if (localValue || _value) {
            lastNotifiedValue.current = '';
            _onChange('');
        }
        inputRef.current?.focus();
    };

    return (
        <InputBase
            {...props}
            renderRoot={(inputProps) => (
                <IMaskInput
                    {...inputProps}
                    inputRef={inputRef}
                    mask={format.mask}
                    unmask={true}
                    value={localValue}
                    onAccept={(acceptedValue: string, _mask: unknown, event?: InputEvent) => {
                        // IMask also accepts programmatic updates; only user edits notify.
                        if (!event || readOnly || disabled) return;
                        setData({ ...data, localValue: acceptedValue });
                        const formatter = new AsYouType(country.code);
                        formatter.input(acceptedValue);
                        const nextValue = formatter.getNumber()?.number ?? '';
                        lastNotifiedValue.current = nextValue;
                        _onChange(nextValue);
                    }}
                />
            )}
            leftSection={
                <CountrySelect
                    disabled={disabled || readOnly}
                    country={country}
                    setCountry={handleCountryChange}
                    leftSectionWidth={leftSectionWidth}
                />
            }
            leftSectionWidth={leftSectionWidth}
            leftSectionPointerEvents='all'
            styles={{
                input: {
                    paddingLeft: `calc(${leftSectionWidth}px + var(--mantine-spacing-sm))`,
                },
                section: {
                    borderRight:
                        '1px solid var(--mantine-color-default-border)',
                },
            }}
            inputMode='numeric'
        />
    );
}

const CountrySelect = memo(function CountrySelect({
    country,
    setCountry,
    disabled,
    leftSectionWidth,
}: {
    country: Country;
    setCountry: (country: Country) => void;
    disabled: boolean | undefined;
    leftSectionWidth: number;
}) {
    const [search, setSearch] = useState('');

    const selectedRef = useRef<HTMLDivElement>(null);

    const combobox = useCombobox({
        onDropdownClose: () => {
            combobox.resetSelectedOption();
            setSearch('');
        },

        onDropdownOpen: () => {
            combobox.focusSearchInput();
            setTimeout(() => {
                selectedRef.current?.scrollIntoView?.({
                    behavior: 'instant',
                    block: 'center',
                });
            }, 0);
        },
    });

    const options = countryOptionsData
        .filter((item) =>
            item.name?.toLowerCase().includes(search.toLowerCase().trim()),
        )
        .map((item) => (
            <Combobox.Option
                ref={item.code === country.code ? selectedRef : undefined}
                value={item.code}
                key={item.code}
            >
                <Group gap='xs'>
                    {item.code === country.code && <CheckIcon size={12} />}
                    {item.emoji}
                    <span>{item.name}</span>
                </Group>
            </Combobox.Option>
        ));

    useEffect(() => {
        if (search) {
            combobox.selectFirstOption();
        }
    }, [search]);

    return (
        <Combobox
            store={combobox}
            width={250}
            position='bottom-start'
            withArrow
            onOptionSubmit={(val) => {
                setCountry(countryOptionsDataMap[val]);
                combobox.closeDropdown();
            }}
        >
            <Combobox.Target>
                <ActionIcon
                    variant='transparent'
                    onClick={() => combobox.toggleDropdown()}
                    size='lg'
                    aria-label={`Select country, ${country.name}`}
                    disabled={disabled}
                    w={leftSectionWidth}
                    c='dimmed'
                >
                    <Group gap={2}>
                        {country.emoji}
                        <IconArrowDown size={14} />
                    </Group>
                </ActionIcon>
            </Combobox.Target>

            <Combobox.Dropdown>
                <Input.Wrapper>
                    <Combobox.Search
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        placeholder='Search countries'
                        aria-label='Search countries'
                    />
                </Input.Wrapper>
                <Combobox.Options>
                    <ScrollArea.Autosize mah={200} type='scroll'>
                        {options.length > 0 ? (
                            options
                        ) : (
                            <Combobox.Empty>No countries found</Combobox.Empty>
                        )}
                    </ScrollArea.Autosize>
                </Combobox.Options>
            </Combobox.Dropdown>
        </Combobox>
    );
});
