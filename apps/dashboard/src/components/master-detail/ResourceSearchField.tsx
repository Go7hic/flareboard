import { Search } from 'lucide-react';
import { Input } from '../ui/input';

type ResourceSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  'aria-label': string;
  className?: string;
};

export function ResourceSearchField({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  className,
}: ResourceSearchFieldProps) {
  return (
    <div className={['cohorts-search-wrap', className].filter(Boolean).join(' ')}>
      <Search className="cohorts-search-icon" size={16} strokeWidth={2} aria-hidden />
      <Input
        type="search"
        className="cohorts-search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
      />
    </div>
  );
}
