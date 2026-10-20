import { CaretDownIcon } from '@phosphor-icons/react';
import type { CountryData } from '@ledova/shared';
import { ICON_SM } from '@components/iconSizes';

interface CountrySelectorProps {
  countries: CountryData[];
  selectedCountry: CountryData;
  onCountryChange: (country: CountryData) => void;
  disabled?: boolean;
}

export const CountrySelector = ({
  countries,
  selectedCountry,
  onCountryChange,
  disabled = false,
}: CountrySelectorProps) => (
  <div className="relative flex h-12 shrink-0 items-center gap-1 rounded-l-lg border border-r-0 border-border bg-surface-tertiary pl-10 pr-2 transition-colors hover:bg-surface-raised has-[:disabled]:opacity-50">
    <span aria-hidden className="text-lg">
      {selectedCountry.flag}
    </span>
    <span aria-hidden className="text-text-primary">
      {selectedCountry.phoneCode}
    </span>
    <CaretDownIcon size={ICON_SM} aria-hidden className="text-text-muted" />
    <select
      aria-label="Country code"
      value={selectedCountry.code}
      disabled={disabled}
      onChange={(event) => {
        const country = countries.find((candidate) => candidate.code === event.target.value);
        if (country) onCountryChange(country);
      }}
      className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
    >
      {countries.map((country) => (
        <option key={country.code} value={country.code}>
          {`${country.flag} ${country.phoneCode} ${country.name}`}
        </option>
      ))}
    </select>
  </div>
);
