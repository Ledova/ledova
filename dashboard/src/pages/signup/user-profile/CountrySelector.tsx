import type { CountryData } from '@ledova/shared';

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
  <select
    aria-label="Country code"
    value={selectedCountry.code}
    disabled={disabled}
    onChange={(event) => {
      const country = countries.find((candidate) => candidate.code === event.target.value);
      if (country) onCountryChange(country);
    }}
    className="h-12 w-40 shrink-0 truncate rounded-l-lg border border-r-0 border-border bg-surface-tertiary py-3 pl-10 pr-2 text-text-primary transition-colors hover:bg-surface-raised focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  >
    {countries.map((country) => (
      <option key={country.code} value={country.code}>
        {`${country.flag} ${country.phoneCode} ${country.name}`}
      </option>
    ))}
  </select>
);
