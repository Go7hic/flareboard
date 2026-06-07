import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-[0.8rem] py-[0.6rem]',
          'text-[length:inherit] font-[family-name:inherit]',
          'placeholder:text-[var(--text-faint)]',
          'transition-[border-color,box-shadow] duration-200',
          'hover:border-[var(--border-strong)]',
          'focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-muted)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
