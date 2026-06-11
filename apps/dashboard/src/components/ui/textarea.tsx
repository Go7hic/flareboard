import * as React from 'react';
import { cn } from '../../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[88px] w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-[var(--control-padding-x)] py-[0.55rem]',
          'text-[length:var(--control-font-size)] leading-[1.45] font-[family-name:inherit]',
          'placeholder:text-[var(--text-faint)]',
          'resize-vertical',
          'transition-[border-color,box-shadow] duration-200',
          'hover:border-[var(--border-strong)]',
          'focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-muted)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
