import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
        secondary: 'bg-surface text-foreground border border-input shadow-sm hover:bg-muted',
        ghost: 'text-foreground/80 hover:bg-muted hover:text-foreground',
        subtle: 'bg-muted text-foreground hover:bg-slate-200/70 dark:hover:bg-slate-700/70',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        'destructive-ghost': 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-[12.5px]',
        xs: 'h-6 px-2 text-xs rounded [&_svg]:size-3.5',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
        'icon-xs': 'h-6 w-6 rounded [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={asChild ? undefined : (props.type ?? 'button')} {...props} />;
});
Button.displayName = 'Button';
