import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-all duration-200 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--accent)] text-[var(--accent-on)] shadow-[var(--shadow-sm)] hover:bg-[var(--accent-hover)] hover:text-[var(--accent-on)] focus-visible:text-[var(--accent-on)]',
        secondary:
          'bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]',
        ghost:
          'bg-transparent text-[var(--text-muted)] border border-transparent hover:text-[var(--text)] hover:bg-[var(--bg-subtle)]',
        danger:
          'bg-[var(--danger)] text-white hover:bg-[color-mix(in_srgb,var(--danger)_88%,#000)]',
        link: 'bg-transparent text-[var(--accent)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'px-[1.05rem] py-[0.58rem] text-sm rounded-[var(--radius-sm)]',
        sm: 'px-[0.72rem] py-[0.38rem] text-[0.8125rem] rounded-[var(--radius-sm)]',
        lg: 'px-5 py-3 text-base rounded-[var(--radius-md)]',
        icon: 'size-9 rounded-[var(--radius-sm)]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
