import type { ReactNode } from 'react';

interface AppHeaderProps {
  action?: ReactNode;
}

export function AppHeader({ action }: AppHeaderProps) {
  return (
    <header className="site-header">
      <a className="brand" href="#contenido" aria-label="Binder Observabilidad, inicio">
        <span className="brand__mark" aria-hidden="true">B</span>
        <span>Binder <span className="brand__section">/ Observabilidad</span></span>
      </a>
      <div className="header-actions">{action}</div>
    </header>
  );
}
