import React from 'react';

// Hand-rolled outline icons matching lucide-react's visual style (24x24
// viewBox, currentColor stroke, round caps/joins) for the platforms lucide
// itself dropped from its icon set — same reason src/components/ui/
// linkedin-icon.tsx already exists as a custom component instead of a
// lucide import. Used by src/lib/custom-link-icons.ts's preset picker.

function baseProps(className: string, label: string): React.SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-label': label,
  };
}

export function InstagramIcon({ className = 'h-4 w-4', ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps(className, 'Instagram')} {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function FacebookIcon({ className = 'h-4 w-4', ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps(className, 'Facebook')} {...props}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function YoutubeIcon({ className = 'h-4 w-4', ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps(className, 'YouTube')} {...props}>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

export function GithubIcon({ className = 'h-4 w-4', ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps(className, 'GitHub')} {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}
